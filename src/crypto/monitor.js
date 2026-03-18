const { v4: uuidv4 } = require('uuid');
const { getPrivateKey, generateAddress } = require('./wallet');
let recordDeposit = () => {};
let checkDepositLimit = () => ({ allowed: true });
try {
  ({ recordDeposit, checkDepositLimit } = require('../rg-check'));
} catch(e) { console.warn('[monitor] rg-check not available'); }
const { queryAll, queryOne, query } = require('../pgdb');
const { insert: chInsert } = require('../chdb');
const { CHAINS } = require('./config');
const evmChain = require('./chains/evm');
const btcChain = require('./chains/bitcoin');
const tronChain = require('./chains/tron');
const { TronWeb } = require('tronweb');
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

  // RG: record deposit for limits tracking
  await recordDeposit(userId, amountUsd);

  // PG: update user balance (atomic credit)
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


// ── Auto-sweep: move deposited funds to hot wallet ────────────────────────────
// For TRC-20: hot wallet first fuels player address with TRX, then player address sweeps USDT back
const TRX_FUEL_AMOUNT = 8; // TRX to send for energy (covers ~1 sweep + buffer)
const TRX_MIN_FOR_SWEEP = 3; // minimum TRX needed to initiate sweep

async function autoSweep(userId, chain, token, amount) {
  try {
    const chainConfig = CHAINS[chain];
    if (!chainConfig) return;

    const hotWallets = {
      TRX: process.env.HOT_WALLET_TRX_ADDRESS || '',
      ETH: process.env.HOT_WALLET_EVM_ADDRESS || '',
      BSC: process.env.HOT_WALLET_EVM_ADDRESS || '',
      POLYGON: process.env.HOT_WALLET_EVM_ADDRESS || '',
      BTC: process.env.HOT_WALLET_BTC_ADDRESS || '',
    };
    const hotWallet = hotWallets[chain];
    if (!hotWallet) {
      console.log(`[AutoSweep] No hot wallet configured for ${chain}, skipping`);
      return;
    }

    const privateKey = await getPrivateKey(userId, chain, token);
    if (!privateKey) return;
    const playerAddress = TronWeb.address.fromPrivateKey(privateKey);

    if (chain === 'TRX') {
      if (token === 'TRX') {
        // Native TRX: keep buffer for future sweeps, send rest to hot wallet
        const sweepAmount = Math.max(0, amount - TRX_FUEL_AMOUNT);
        if (sweepAmount < 1) {
          console.log(`[AutoSweep] TRX amount too small to sweep after buffer: ${amount}`);
          return;
        }
        const result = await tronChain.sendTRX(privateKey, hotWallet, sweepAmount);
        console.log(`[AutoSweep] ✅ ${sweepAmount} TRX → hot wallet tx=${result.txHash}`);
      } else {
        // TRC-20 (USDT etc): need TRX in player address for energy
        const contractAddress = chainConfig.tokenContracts?.[token];
        if (!contractAddress) return;

        // Check current TRX balance of player address
        const tw = new TronWeb({ fullHost: 'https://api.trongrid.io', headers: { 'TRON-PRO-API-KEY': process.env.TRONGRID_API_KEY } });
        const trxBalanceSun = await tw.trx.getBalance(playerAddress).catch(() => 0);
        const trxBalance = trxBalanceSun / 1_000_000;

        if (trxBalance < TRX_MIN_FOR_SWEEP) {
          // Fuel player address with TRX from hot wallet
          const hotPrivKey = process.env.HOT_WALLET_TRX_PRIVATE_KEY;
          if (!hotPrivKey) {
            console.warn('[AutoSweep] HOT_WALLET_TRX_PRIVATE_KEY not set, cannot fuel');
            return;
          }
          console.log(`[AutoSweep] Fueling ${playerAddress} with ${TRX_FUEL_AMOUNT} TRX for energy...`);
          const fuelResult = await tronChain.sendTRX(hotPrivKey, playerAddress, TRX_FUEL_AMOUNT);
          console.log(`[AutoSweep] ⛽ Fueled tx=${fuelResult.txHash}`);
          // Wait for TRX to confirm (~3-5 seconds on TRON)
          await new Promise(r => setTimeout(r, 6000));
        }

        // Now sweep TRC-20 to hot wallet
        const result = await tronChain.sendTRC20(privateKey, hotWallet, amount, contractAddress);
        console.log(`[AutoSweep] ✅ ${amount} ${token}@TRX → hot wallet tx=${result.txHash}`);
      }

    } else if (chainConfig.type === 'evm') {
      if (token === chainConfig.symbol) {
        // Native EVM coin: keep buffer for gas
        const sweepAmount = Math.max(0, amount - 0.002);
        if (sweepAmount < 0.0001) return;
        const result = await evmChain.sendNative(chain, privateKey, hotWallet, sweepAmount);
        console.log(`[AutoSweep] ✅ ${sweepAmount} ${token}@${chain} → hot wallet tx=${result.txHash}`);
      } else {
        // ERC-20: player needs native coin for gas — for now log and skip
        // (EVM auto-fuel can be added later; deposits usually come with some ETH/BNB)
        const contractAddress = chainConfig.tokenContracts?.[token];
        if (!contractAddress) return;
        const result = await evmChain.sendToken(chain, privateKey, hotWallet, amount, contractAddress, 6);
        console.log(`[AutoSweep] ✅ ${amount} ${token}@${chain} → hot wallet tx=${result.txHash}`);
      }

    } else if (chain === 'BTC' || chain === 'LTC') {
      const addrRow = await queryOne('SELECT derivation_index FROM crypto_addresses WHERE user_id=$1 AND chain=$2 LIMIT 1', [userId, chain]);
      const { address: fromAddr } = generateAddress(chain, addrRow?.derivation_index || 0);
      const amountSats = Math.floor(amount * 1e8);
      if (amountSats < 1000) return;
      const result = await btcChain.sendBTC(privateKey, fromAddr, hotWallet, amountSats, chain);
      console.log(`[AutoSweep] ✅ ${amount} ${chain} → hot wallet tx=${result.txHash}`);
    }

  } catch (e) {
    console.warn(`[AutoSweep] ⚠️ ${amount} ${token}@${chain}: ${e.message}`);
  }
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
      // TON deposits disabled — skip monitoring (no deposit modal for TON)
      return;
    } else if (chain === 'SOL' && token === 'SOL') { // SOL: monitored via mainnet-beta RPC
      incoming = await solanaChain.getIncomingTransactions(address);
    } else if (chain === 'XRP') { // XRP: monitored via s1.ripple.com
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
    // Enforce minimum deposit (must cover sweep fees)
    const MIN_DEPOSIT_USD = { TRX: 20, ETH: 40, BSC: 20, POLYGON: 10, BTC: 20, LTC: 20, SOL: 10, XRP: 10, TON: 10 };
    const minDep = MIN_DEPOSIT_USD[chain] || 5;
    if (amountUsd < minDep) {
      console.log('[Monitor] Deposit below minimum ($' + minDep + '): ' + amountUsd.toFixed(2) + ' ' + token + '@' + chain + ' tx=' + tx.txHash);
      continue; // Skip — don't credit sub-minimum deposits
    }

    await creditDeposit(user_id, chain, token, tx.amount, tx.txHash, amountUsd);
    // Auto-sweep: move funds to hot wallet
    autoSweep(user_id, chain, token, tx.amount).catch(e => 
      console.warn('[AutoSweep] Non-fatal error:', e.message)
    );
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
