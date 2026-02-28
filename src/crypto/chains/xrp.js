const xrpl = require('xrpl');

let client = null;
let connecting = false;
let connectPromise = null;

async function getClient() {
  if (client && client.isConnected()) return client;

  if (connecting) {
    await connectPromise;
    return client;
  }

  connecting = true;
  connectPromise = (async () => {
    client = new xrpl.Client('wss://s1.ripple.com');
    await client.connect();
    client.on('error', () => { client = null; connecting = false; });
    client.on('disconnected', () => { client = null; connecting = false; });
    connecting = false;
  })();

  await connectPromise;
  return client;
}

async function getXRPBalance(address) {
  try {
    const cl = await getClient();
    const response = await cl.request({
      command: 'account_info',
      account: address,
      ledger_index: 'validated',
    });
    return Number(response.result.account_data.Balance) / 1e6;
  } catch (e) {
    if (e.message?.includes('actNotFound') || e.data?.error === 'actNotFound') return 0;
    throw e;
  }
}

async function getIncomingTransactions(address, limit = 20) {
  try {
    const cl = await getClient();
    const response = await cl.request({
      command: 'account_tx',
      account: address,
      limit,
    });

    return (response.result.transactions || [])
      .filter(item => {
        const tx = item.tx || item.tx_json;
        return tx?.Destination === address && tx?.TransactionType === 'Payment' && item.validated;
      })
      .map(item => {
        const tx = item.tx || item.tx_json;
        const amount = typeof tx.Amount === 'string'
          ? Number(tx.Amount) / 1e6
          : 0; // skip IOU tokens for now
        return {
          txHash: tx.hash,
          amount,
          confirmed: item.validated,
          ledger: tx.ledger_index,
        };
      })
      .filter(tx => tx.amount > 0);
  } catch (e) {
    if (e.data?.error === 'actNotFound') return [];
    throw e;
  }
}

async function sendXRP(privateKey, toAddress, amount) {
  const cl = await getClient();
  const wallet = new xrpl.Wallet(privateKey);

  const prepared = await cl.autofill({
    TransactionType: 'Payment',
    Account: wallet.address,
    Amount: xrpl.xrpToDrops(amount.toString()),
    Destination: toAddress,
  });

  const signed = wallet.sign(prepared);
  const result = await cl.submitAndWait(signed.tx_blob);

  if (result.result.meta?.TransactionResult !== 'tesSUCCESS') {
    throw new Error(`XRP tx failed: ${result.result.meta?.TransactionResult}`);
  }

  return { txHash: result.result.hash };
}

async function disconnect() {
  if (client && client.isConnected()) {
    await client.disconnect();
    client = null;
  }
}

module.exports = { getXRPBalance, getIncomingTransactions, sendXRP, disconnect };
