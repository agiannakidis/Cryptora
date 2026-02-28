
const { CHAINS } = require('../config');

const API = CHAINS.TON.api;

function getHeaders() {
  return process.env.TONCENTER_API_KEY
    ? { 'X-API-Key': process.env.TONCENTER_API_KEY }
    : {};
}

async function getTONBalance(address) {
  const res = await fetch(`${API}/getAddressBalance?address=${address}`, { headers: getHeaders() });
  const data = await res.json();
  if (!data.ok) return 0;
  return Number(data.result) / 1e9;
}

async function getIncomingTransactions(address, limit = 20) {
  const res = await fetch(`${API}/getTransactions?address=${address}&limit=${limit}`, { headers: getHeaders() });
  const data = await res.json();
  if (!data.ok) return [];

  return (data.result || [])
    .filter(tx => tx.in_msg?.value > 0)
    .map(tx => ({
      txHash: `${tx.transaction_id?.lt}_${tx.transaction_id?.hash}`,
      amount: Number(tx.in_msg.value) / 1e9,
      confirmed: true,
      lt: tx.transaction_id?.lt,
    }));
}

// TON withdrawal — requires @ton/ton async client
async function sendTON(privateKeyHex, toAddress, amount) {
  try {
    const { TonClient, WalletContractV4, internal } = require('@ton/ton');
    const { mnemonicToPrivateKey } = require('@ton/crypto');
    const { toNano, Address } = require('@ton/core');

    const client = new TonClient({ endpoint: `${API}/jsonRPC` });
    const mnemonic = process.env.MASTER_MNEMONIC.split(' ');
    const keyPair = await mnemonicToPrivateKey(mnemonic);

    const wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey });
    const contract = client.open(wallet);

    const seqno = await contract.getSeqno();
    await contract.sendTransfer({
      secretKey: keyPair.secretKey,
      seqno,
      messages: [
        internal({
          value: toNano(amount.toString()),
          to: Address.parse(toAddress),
          bounce: false,
        }),
      ],
    });

    return { txHash: `ton-${Date.now()}` }; // TON doesn't return txHash immediately
  } catch (e) {
    throw new Error(`TON send failed: ${e.message}`);
  }
}

module.exports = { getTONBalance, getIncomingTransactions, sendTON };
