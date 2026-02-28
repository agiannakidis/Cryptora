const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, query } = require('../pgdb');
const { insert: chInsert } = require('../chdb');
const { CHAINS } = require('./config');
const evmChain = require('./chains/evm');
const btcChain = require('./chains/bitcoin');
const tronChain = require('./chains/tron');
const tonChain = require('./chains/ton');
const solanaChain = require('./chains/solana');
const xrpChain = require('./chains/xrp');

let priceCache = {};
let priceCacheTime = 0;

async function getPrices() {
  const now = Date.now();
  if (now - priceCacheTime < 3_600_000 && Object.keys(priceCache).length > 0) return priceCache;
  try {    const symbols = ['BTCUSDT','ETHUSDT','TRXUSDT','BNBUSDT','SOLUSDT','XRPUSDT','LTCUSDT'];
    const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbols=' + JSON.stringify(symbols));
    const data = await res.json();
    const px = {};
    data.forEach(d => { px[d.symbol] = parseFloat(d.price); });
    let tonPrice = 1.3;
    try { const t = await (await fetch('https://api.binance.com/api/v3/ticker/price?symbol=TONUSDT')).json(); tonPrice = parseFloat(t.price) || 1.3; } catch {}
    let maticPrice = 0.5;
    try { const m = await (await fetch('https://api.binance.com/api/v3/ticker/price?symbol=POLUSDT')).json(); maticPrice = parseFloat(m.price) || 0.5; } catch {}
    priceCache = {
      BTC: px.BTCUSDT || 0, ETH: px.ETHUSDT || 0,
      TRX: px.TRXUSDT || 0, BNB: px.BNBUSDT || 0,
      MATIC: maticPrice, SOL: px.SOLUSDT || 0,
      XRP: px.XRPUSDT || 0, LTC: px.LTCUSDT || 0,
      TON: tonPrice, USDT: 1, USDC: 1,
    };
    priceCacheTime = now;
    console.log('💰 Prices refreshed:', JSON.stringify(priceCache));
  } catch (e) { console.error('Price fetch failed:', e.message); }
  return priceCache;
}

async function creditDeposit(userId, chain, token, amount, txHash, amountUsd) {
  const depositId = uuidv4();
  const now = new Date().toISOString().replace('T',' ').slice(0,23);

  // ClickHouse: analytics
  await chInsert('crypto_deposits', [{
    id: depositId, user_id: userId, chain, token,
    amount_crypto: amount, amount_usd: amountUsd,
    tx_hash: txHash, confirmations: 1, status: 'confirmed', credited: 1,
    created_at: now, confirmed_at: now,
  }]).catch(e => console.error('[CH deposit]', e.message));

  // PG: update user balance
  await query('UPDATE users SET balance = balance + $1, updated_date = NOW() WHERE id = $2', [amountUsd, userId]);

  // Add to PG tx_idempotency for reference
  const user = await queryOne('SELECT email FROM users WHERE id = $1', [userId]);
  if (user) {
    await query(`
      INSERT INTO tx_idempotency (id, reference, user_email, type, amount, balance_after, created_at)
      SELECT $1, $2, $3, 'deposit', $4, balance, NOW() FROM users WHERE id = $5
    `, [depositId, `deposit_${txHash}`, user.email, amountUsd, userId]);

    // ClickHouse: transactions log
    await chInsert('transactions', [{
      id: depositId, user_id: userId, user_email: user.email,
      type: 'deposit', amount: amountUsd, currency: 'USD',
      status: 'completed', description: `Crypto deposit: ${amount} ${token} on ${chain}`,
      reference: txHash, created_at: now,
    }]).catch(() => {});
  }

  console.log(`✅ Credited: user=${userId} +$${amountUsd.toFixed(2)} | ${amount} ${token}@${chain} | tx=${txHash}`);
}

async function checkAddress(row) {
  const { user_id, chain, token, address } = row;
  const chainConfig = CHAINS[chain];
  if (!chainConfig) return;

  let incoming = [];
  try {
    if (chainConfig.type === 'evm') {
      if (token !== chainConfig.symbol) {
        const contract = chainConfig.tokenContracts?.[token];
        if (!contract) return;
        incoming = await evmChain.getIncomingTokenTransfers(chain, address, contract);
      }
    } else if (chain === 'BTC') {
      incoming = await btcChain.getIncomingTransactions(address, 'BTC');
    } else if (chain === 'LTC') {
      incoming = await btcChain.getIncomingTransactions(address, 'LTC');
    } else if (chain === 'TRX') {
      if (token === 'TRX') {
        incoming = await tronChain.getIncomingTransactions(address);
      } else {
        const contract = chainConfig.tokenContracts?.[token];
        if (contract) incoming = await tronChain.getIncomingTRC20Transfers(address, contract);
      }
    } else if (chain === 'TON') {
      incoming = await tonChain.getIncomingTransactions(address);
    } else if (chain === 'SOL' && token === 'SOL') {
      incoming = await solanaChain.getIncomingTransactions(address);
    } else if (chain === 'XRP') {
      incoming = await xrpChain.getIncomingTransactions(address);
    }
  } catch (e) {
    console.error(`[Monitor] ${chain}/${token} ${address}: ${e.message}`);
    return;
  }

  const prices = await getPrices();
  for (const tx of incoming) {
    if (!tx.txHash || tx.amount <= 0) continue;
    // Check ClickHouse for duplicates via tx_idempotency in PG
    const exists = await queryOne('SELECT id FROM tx_idempotency WHERE reference = $1', [`deposit_${tx.txHash}`]);
    if (exists) continue;

    const priceKey = (token === 'USDT' || token === 'USDC') ? token : chainConfig.symbol;
    const amountUsd = tx.amount * (prices[priceKey] || 0);
    if (amountUsd < 0.01) continue;

    await creditDeposit(user_id, chain, token, tx.amount, tx.txHash, amountUsd);
  }
}

async function runMonitor() {
  console.log('🔍 Deposit monitor started');
  while (true) {
    try {
      const addresses = await queryAll('SELECT * FROM crypto_addresses');
      for (const row of addresses) {
        await checkAddress(row);
        await new Promise(r => setTimeout(r, 300));
      }
    } catch (e) {
      console.error('[Monitor] Loop error:', e.message);
    }
    await new Promise(r => setTimeout(r, 30_000));
  }
}

module.exports = { runMonitor, getPrices };
