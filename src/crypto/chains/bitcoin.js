
const bitcoin = require('bitcoinjs-lib');
const { ECPairFactory } = require('ecpair');
const ecc = require('tiny-secp256k1');

const ECPair = ECPairFactory(ecc);

// Supports both BTC (blockstream) and LTC (blockcypher)
function getApiBase(chain) {
  if (chain === 'LTC') return 'https://api.blockcypher.com/v1/ltc/main';
  return 'https://blockstream.info/api';
}

async function getBalance(address, chain = 'BTC') {
  if (chain === 'LTC') {
    const res = await fetch(`${getApiBase(chain)}/addrs/${address}/balance`);
    const data = await res.json();
    return {
      confirmed: (data.balance || 0) / 1e8,
      unconfirmed: (data.unconfirmed_balance || 0) / 1e8,
      total: ((data.balance || 0) + (data.unconfirmed_balance || 0)) / 1e8,
    };
  }
  // BTC via blockstream
  const res = await fetch(`${getApiBase(chain)}/address/${address}`);
  const data = await res.json();
  const confirmed = (data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum) / 1e8;
  const unconfirmed = (data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum) / 1e8;
  return { confirmed, unconfirmed, total: confirmed + unconfirmed };
}

// LTC uses blockcypher public API — rate limited to 3 req/s, no API key
async function getIncomingTransactionsLTC(address, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`https://api.blockcypher.com/v1/ltc/main/addrs/${address}/full?limit=20`);
      if (!res.ok) {
        if (res.status === 429) {
          const wait = attempt * 2000;
          console.warn(`[LTC Monitor] blockcypher rate limited (429), retry ${attempt}/${retries} after ${wait}ms`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        throw new Error(`blockcypher HTTP ${res.status}`);
      }
      const data = await res.json();
      const incoming = [];
      for (const tx of (data.txs || [])) {
        let amount = 0;
        for (const out of (tx.outputs || [])) {
          if (out.addresses?.includes(address)) amount += out.value;
        }
        if (amount > 0) {
          incoming.push({
            txHash: tx.hash,
            amount: amount / 1e8,
            confirmations: tx.confirmations || 0,
            confirmed: tx.confirmations >= 1,
          });
        }
      }
      return incoming;
    } catch (e) {
      if (attempt === retries) {
        console.error(`[LTC Monitor] blockcypher failed after ${retries} attempts for ${address}: ${e.message}`);
        return []; // Don't crash the monitor loop
      }
      const wait = attempt * 1500;
      console.warn(`[LTC Monitor] blockcypher error, retry ${attempt}/${retries} after ${wait}ms: ${e.message}`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  return [];
}

async function getIncomingTransactions(address, chain = 'BTC') {
  if (chain === 'LTC') {
    return await getIncomingTransactionsLTC(address);
  }

  // BTC via blockstream
  const res = await fetch(`${getApiBase(chain)}/address/${address}/txs`);
  const txs = await res.json();
  const incoming = [];

  for (const tx of txs) {
    let amount = 0;
    for (const vout of tx.vout) {
      if (vout.scriptpubkey_address === address) amount += vout.value;
    }
    if (amount > 0) {
      incoming.push({
        txHash: tx.txid,
        amount: amount / 1e8,
        confirmations: tx.status.confirmed ? 3 : 0,
        confirmed: tx.status.confirmed,
        blockHeight: tx.status.block_height,
      });
    }
  }
  return incoming;
}

async function getUTXOs(address, chain = 'BTC') {
  if (chain === 'LTC') {
    const res = await fetch(`${getApiBase(chain)}/addrs/${address}?unspentOnly=true`);
    const data = await res.json();
    return (data.txrefs || []).map(u => ({
      txid: u.tx_hash,
      vout: u.tx_output_n,
      value: u.value,
    }));
  }
  const res = await fetch(`${getApiBase(chain)}/address/${address}/utxo`);
  return res.json();
}

async function broadcastTx(txHex, chain = 'BTC') {
  if (chain === 'LTC') {
    const res = await fetch(`${getApiBase(chain)}/txs/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tx: txHex }),
    });
    const data = await res.json();
    return data.tx?.hash || data.error;
  }
  const res = await fetch(`${getApiBase(chain)}/tx`, { method: 'POST', body: txHex });
  return res.text();
}

async function sendBTC(privateKeyHex, fromAddress, toAddress, amountSats, chain = 'BTC') {
  const utxos = await getUTXOs(fromAddress, chain);
  if (!utxos.length) throw new Error('No UTXOs available');

  const network = chain === 'LTC'
    ? { messagePrefix: '\x19Litecoin Signed Message:\n', bech32: 'ltc', bip32: { public: 0x019da462, private: 0x019d9cfe }, pubKeyHash: 0x30, scriptHash: 0x32, wif: 0xb0 }
    : bitcoin.networks.bitcoin;

  const keyPair = ECPair.fromPrivateKey(Buffer.from(privateKeyHex, 'hex'), { network });
  const psbt = new bitcoin.Psbt({ network });

  let inputTotal = 0;
  for (const utxo of utxos) {
    if (chain === 'LTC') {
      // BlockCypher doesn't provide raw txs easily, use simplified approach
      psbt.addInput({ hash: utxo.txid, index: utxo.vout });
    } else {
      const txRes = await fetch(`https://blockstream.info/api/tx/${utxo.txid}/hex`);
      const txHex = await txRes.text();
      psbt.addInput({ hash: utxo.txid, index: utxo.vout, nonWitnessUtxo: Buffer.from(txHex, 'hex') });
    }
    inputTotal += utxo.value;
  }

  const fee = 10000; // ~10k sats
  const change = inputTotal - amountSats - fee;
  if (change < 0) throw new Error('Insufficient funds (including fee)');

  psbt.addOutput({ address: toAddress, value: amountSats });
  if (change > 546) psbt.addOutput({ address: fromAddress, value: change });

  psbt.signAllInputs(keyPair);
  psbt.finalizeAllInputs();

  const txHex = psbt.extractTransaction().toHex();
  const txid = await broadcastTx(txHex, chain);
  return { txHash: txid };
}

module.exports = { getBalance, getIncomingTransactions, sendBTC };
