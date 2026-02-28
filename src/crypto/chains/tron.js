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

async function getTRXBalance(address) {
  const tw = getTronWeb();
  const balance = await tw.trx.getBalance(address);
  return balance / 1e6;
}

async function getTRC20Balance(address, contractAddress) {
  const tw = getTronWeb();
  const contract = await tw.contract().at(contractAddress);
  const balance = await contract.balanceOf(address).call();
  return Number(balance) / 1e6;
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
