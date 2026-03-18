const { TronWeb } = require('tronweb');

const { CHAINS } = require('../config');

function getApiHeaders() {
  return process.env.TRONGRID_API_KEY
    ? { 'TRON-PRO-API-KEY': process.env.TRONGRID_API_KEY }
    : {};
}

function getTronWeb(privateKey) {
  return new TronWeb({
    fullHost: CHAINS.TRX.api,
    headers: getApiHeaders(),
    privateKey: privateKey || ('a'.repeat(64)),
  });
}

// Retry wrapper with exponential backoff for rate-limit errors (429)
async function withRetry(fn, retries = 4, delayMs = 800) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err?.message?.includes('429') || err?.response?.status === 429
        || String(err).includes('429') || err?.statusCode === 429;
      if (is429 && i < retries) {
        const wait = delayMs * Math.pow(2, i); // 800, 1600, 3200, 6400ms
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
}

async function getTRXBalance(address) {
  return withRetry(async () => {
    const tw = getTronWeb();
    const balance = await tw.trx.getBalance(address);
    return (balance || 0) / 1e6;
  });
}

async function getTRC20Balance(address, contractAddress) {
  try {
    return await withRetry(async () => {
      const tw = getTronWeb();
      // Check if account exists first (unactivated accounts have no TRX and can't call contracts)
      const accountInfo = await tw.trx.getAccount(address);
      if (!accountInfo || !accountInfo.address) return 0; // account not activated = 0 balance

      const contract = await tw.contract().at(contractAddress);
      const balance = await contract.balanceOf(address).call();
      return Number(balance) / 1e6;
    });
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes('does not exist') || msg.includes('account not found') || msg.includes('CONTRACT_VALIDATE_ERROR')) {
      return 0; // unactivated account = 0 balance
    }
    throw err;
  }
}

// Get incoming TRX transactions
async function getIncomingTransactions(address, limit = 20) {
  const url = `${CHAINS.TRX.api}/v1/accounts/${address}/transactions?limit=${limit}&only_to=true&order_by=block_timestamp,desc`;
  const res = await fetch(url, { headers: getApiHeaders() });
  const data = await res.json();

  return (data.data || []).map(tx => {
    const contract = tx.raw_data?.contract?.[0];
    const value = contract?.parameter?.value;
    return {
      txHash: tx.txID,
      amount: (value?.amount || 0) / 1e6,
      confirmed: tx.ret?.[0]?.contractRet === 'SUCCESS',
      blockNumber: tx.blockNumber,
    };
  }).filter(tx => tx.amount > 0);
}

// Get incoming TRC-20 token transfers
async function getIncomingTRC20Transfers(address, contractAddress, limit = 20) {
  const url = `${CHAINS.TRX.api}/v1/accounts/${address}/transactions/trc20?contract_address=${contractAddress}&limit=${limit}&only_to=true`;
  const res = await fetch(url, { headers: getApiHeaders() });
  const data = await res.json();

  return (data.data || []).map(tx => ({
    txHash: tx.transaction_id,
    amount: Number(tx.value) / 1e6,
    confirmed: true,
    token: tx.token_info?.symbol,
  })).filter(tx => tx.amount > 0);
}

// Send TRX
async function sendTRX(privateKey, toAddress, amount) {
  const tw = getTronWeb(privateKey);
  const amountSun = Math.floor(amount * 1e6);
  const tx = await tw.trx.sendTransaction(toAddress, amountSun);
  return { txHash: tx.txid || tx.transaction?.txID };
}

// Send TRC-20 token
async function sendTRC20(privateKey, toAddress, amount, contractAddress) {
  const tw = getTronWeb(privateKey);
  const contract = await tw.contract().at(contractAddress);
  const amountSun = Math.floor(amount * 1e6);
  const txId = await contract.transfer(toAddress, amountSun).send({
    feeLimit: 100_000_000, // 100 TRX max fee
  });
  return { txHash: txId };
}

module.exports = {
  getTRXBalance,
  getTRC20Balance,
  getIncomingTransactions,
  getIncomingTRC20Transfers,
  sendTRX,
  sendTRC20,
};
