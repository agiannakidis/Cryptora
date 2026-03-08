const express = require('express');
let checkSelfExclusion = () => ({ blocked: false });
let checkDepositLimit = () => ({ allowed: true });
let recordDeposit = () => {};
try {
  ({ checkSelfExclusion, checkDepositLimit, recordDeposit } = require('../rg-check'));
} catch(e) { console.warn('[crypto] rg-check not available:', e.message); }
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authMiddleware: authenticate } = require('../middleware/auth');
const { getUserAddress, getPrivateKey } = require('../crypto/wallet');
const { processWithdrawal } = require('../crypto/withdraw');
const { getPrices } = require('../crypto/monitor');
const { CHAINS } = require('../crypto/config');
const { queryOne, queryAll, query, transaction } = require('../pgdb');
const { queryAll: chQueryAll, queryOne: chQueryOne } = require('../chdb');

// ── Chains & prices (public) ──────────────────────────────────────────────────

router.get('/chains', (req, res) => {
  const chains = Object.values(CHAINS).map(c => ({
    id: c.id, name: c.name, symbol: c.symbol,
    tokens: c.tokens, confirmations: c.confirmations, type: c.type,
  }));
  res.json({ chains });
});

router.get('/prices', async (req, res) => {
  const prices = await getPrices();
  res.json({ prices });
});

// ── Deposit address ───────────────────────────────────────────────────────────

router.get('/deposit-address', authenticate, async (req, res) => {
  const { chain, token } = req.query;
  if (!chain || !token) return res.status(400).json({ error: 'chain and token required' });

  const chainConfig = CHAINS[chain];
  if (!chainConfig) return res.status(400).json({ error: `Unsupported chain: ${chain}` });
  if (!chainConfig.tokens.includes(token)) return res.status(400).json({ error: `Token ${token} not supported on ${chain}` });

  try {
    const address = await getUserAddress(req.user.id, chain, token);
    res.json({ address, chain, token, network: chainConfig.name, confirmations: chainConfig.confirmations });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Deposit history (from ClickHouse) ────────────────────────────────────────

router.get('/deposits', authenticate, async (req, res) => {
  try {
    const deposits = await chQueryAll(
      `SELECT * FROM casino.crypto_deposits WHERE user_id = {userId:String} ORDER BY created_at DESC LIMIT 50`,
      { userId: req.user.id }
    );
    res.json({ deposits });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Withdrawal history (from PG) ──────────────────────────────────────────────

router.get('/withdrawals', authenticate, async (req, res) => {
  const withdrawals = await queryAll(
    'SELECT * FROM crypto_withdrawals WHERE user_id = $1 ORDER BY created_date DESC LIMIT 50',
    [req.user.id]
  );
  res.json({ withdrawals });
});

// ── Request withdrawal ────────────────────────────────────────────────────────

router.post('/withdraw', authenticate, async (req, res) => {
  const { chain, token, amount, to_address } = req.body;

  if (!chain || !token || !amount || !to_address)
    return res.status(400).json({ error: 'chain, token, amount, to_address required' });

  const chainConfig = CHAINS[chain];
  if (!chainConfig) return res.status(400).json({ error: `Unsupported chain: ${chain}` });
  if (!chainConfig.tokens.includes(token)) return res.status(400).json({ error: `Token ${token} not supported on ${chain}` });

  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0) return res.status(400).json({ error: 'Invalid amount' });

  const prices = await getPrices();
  const priceKey = (token === 'USDT' || token === 'USDC') ? token : chainConfig.symbol;
  const amountUsd = amountNum * (prices[priceKey] || 0);

  if (amountUsd < 1) return res.status(400).json({ error: 'Minimum withdrawal is $1' });

  // RG: Self-exclusion check before withdrawal
  const rgExclusion = await checkSelfExclusion(req.user.id);
  if (rgExclusion.blocked) return res.status(403).json({ error: rgExclusion.reason });

  // 2FA: Check TOTP if enabled
  const twoFaUser = await queryOne('SELECT totp_enabled, totp_secret FROM users WHERE id = ', [req.user.id]);
  if (twoFaUser && twoFaUser.totp_enabled) {
    const { totp_code } = req.body;
    if (!totp_code) return res.status(400).json({ error: '2FA code required', requires2fa: true });
    const speakeasy2 = require('speakeasy');
    const valid2fa = speakeasy2.totp.verify({
      secret: twoFaUser.totp_secret,
      encoding: 'base32',
      token: String(totp_code).replace(/\s/g, ''),
      window: 2,
    });
    if (!valid2fa) return res.status(401).json({ error: 'Invalid 2FA code', requires2fa: true });
  }

  // FIX: Atomic balance check + deduction with FOR UPDATE (prevents double-spend race condition)
  const withdrawalId = uuidv4();
  try {
    await transaction(async (client) => {
      // Lock user row — blocks concurrent withdrawals for same user
      const locked = await client.query(
        'SELECT balance FROM users WHERE id = $1 FOR UPDATE',
        [req.user.id]
      );
      if (!locked.rowCount) throw new Error('USER_NOT_FOUND');
      if (parseFloat(locked.rows[0].balance) < amountUsd) throw new Error('INSUFFICIENT_FUNDS');

      // Atomic deduction with balance guard
      const updated = await client.query(
        'UPDATE users SET balance = balance - $1 WHERE id = $2 AND balance >= $1 RETURNING balance',
        [amountUsd, req.user.id]
      );
      if (!updated.rowCount) throw new Error('INSUFFICIENT_FUNDS');

      await client.query(`
        INSERT INTO crypto_withdrawals (id, user_id, user_email, chain, token, amount_crypto, amount_usd, to_address, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
      `, [withdrawalId, req.user.id, req.user.email, chain, token, amountNum.toString(), amountUsd, to_address]);
    });
  } catch (e) {
    if (e.message === 'INSUFFICIENT_FUNDS') return res.status(400).json({ error: 'Insufficient balance' });
    if (e.message === 'USER_NOT_FOUND') return res.status(404).json({ error: 'User not found' });
    throw e;
  }

  // Process async — refund on failure
  processWithdrawal(withdrawalId).catch(async (err) => {
    await query('UPDATE users SET balance = balance + $1 WHERE id = $2', [amountUsd, req.user.id]);
    console.error(`Withdrawal refunded for user ${req.user.id}: ${err.message}`);
  });

  res.json({
    success: true, withdrawalId,
    message: 'Withdrawal processing',
    amountCrypto: amountNum, amountUsd: amountUsd.toFixed(2),
    chain, token,
  });
});

// ── Admin: stats ──────────────────────────────────────────────────────────────

router.get('/admin/stats', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const [depositStats, withdrawalStats, pendingWd, totalDep, totalWd] = await Promise.all([
    chQueryAll(`SELECT chain, token, COUNT(*) as count, SUM(amount_usd) as total_usd FROM casino.crypto_deposits WHERE credited=1 GROUP BY chain, token ORDER BY total_usd DESC`),
    queryAll(`SELECT chain, token, COUNT(*) as count, SUM(amount_usd) as total_usd FROM crypto_withdrawals WHERE status='completed' GROUP BY chain, token ORDER BY total_usd DESC`),
    queryOne(`SELECT COUNT(*) as count FROM crypto_withdrawals WHERE status='pending'`),
    chQueryOne(`SELECT SUM(amount_usd) as total FROM casino.crypto_deposits WHERE credited=1`),
    queryOne(`SELECT COALESCE(SUM(amount_usd),0) as total FROM crypto_withdrawals WHERE status='completed'`),
  ]);

  res.json({
    depositStats, withdrawalStats,
    pendingWithdrawals: pendingWd?.count || 0,
    totalDeposited: totalDep?.total || 0,
    totalWithdrawn: totalWd?.total || 0,
  });
});

// ── Admin: pending withdrawals ────────────────────────────────────────────────

// GET /admin/withdrawals?status=pending (frontend compat alias)
router.get('/admin/withdrawals', authenticate, async (req, res) => {
  try {
    const status = req.query.status || 'pending';
    const limit = parseInt(req.query.limit) || 100;
    const rows = await queryAll(
      `SELECT cw.*, u.email FROM crypto_withdrawals cw
       LEFT JOIN users u ON u.id = cw.user_id
       WHERE cw.status = $1 ORDER BY cw.created_date DESC LIMIT $2`,
      [status, limit]
    );
    res.json({ withdrawals: rows });
  } catch (e) {
    console.error('[admin withdrawals]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/admin/withdrawals/pending', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const rows = await queryAll(`
    SELECT w.*, u.email FROM crypto_withdrawals w
    JOIN users u ON u.id = w.user_id
    WHERE w.status = 'pending' ORDER BY w.created_date ASC
  `);
  res.json({ withdrawals: rows });
});

// ── Admin: approve/reject withdrawal ─────────────────────────────────────────

router.post('/withdraw', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const w = await queryOne('SELECT * FROM crypto_withdrawals WHERE id = $1', [req.params.id]);
  if (!w || w.status !== 'pending') return res.status(400).json({ error: 'Not found or not pending' });

  await query('UPDATE crypto_withdrawals SET status=$1, approved_by=$2 WHERE id=$3',
    ['processing', req.user.email, req.params.id]);

  processWithdrawal(req.params.id).catch(async (err) => {
    await query('UPDATE users SET balance = balance + $1 WHERE id = $2', [w.amount_usd, w.user_id]);
    await query('UPDATE crypto_withdrawals SET status=$1, error=$2 WHERE id=$3',
      ['failed', err.message, req.params.id]);
  });

  res.json({ success: true, message: 'Processing withdrawal' });
});

router.post('/withdraw', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const w = await queryOne('SELECT * FROM crypto_withdrawals WHERE id = $1', [req.params.id]);
  if (!w || w.status !== 'pending') return res.status(400).json({ error: 'Not found or not pending' });

  await transaction(async (client) => {
    await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [w.amount_usd, w.user_id]);
    await client.query('UPDATE crypto_withdrawals SET status=$1, reject_reason=$2, approved_by=$3 WHERE id=$4',
      ['rejected', req.body.reason || 'Rejected by admin', req.user.email, req.params.id]);
  });

  res.json({ success: true, message: 'Withdrawal rejected, funds returned' });
});

// ── Admin: all addresses ──────────────────────────────────────────────────────

router.get('/admin/addresses', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const rows = await queryAll(`
    SELECT ca.*, u.email FROM crypto_addresses ca
    JOIN users u ON u.id = ca.user_id
    ORDER BY ca.created_date DESC
  `);
  res.json({ addresses: rows });
});


// ── Admin: sweep — create withdrawal from admin's own balance
router.post('/admin/sweep', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { chain, token, to_address, amount } = req.body;
  if (!chain || !token || !to_address) return res.status(400).json({ error: 'chain, token, to_address required' });

  try {
    const prices = await getPrices();
    const chainConfig = CHAINS[chain];
    if (!chainConfig) return res.status(400).json({ error: 'Unsupported chain' });

    const adminUser = await queryOne('SELECT balance FROM users WHERE id=$1', [req.user.id]);
    const availableUsd = parseFloat(adminUser.balance || 0);
    if (availableUsd <= 0) return res.status(400).json({ error: 'No balance to sweep' });

    const priceKey = (token === 'USDT' || token === 'USDC') ? token : chainConfig.symbol;
    const tokenPrice = prices[priceKey] || 1;
    const amountCrypto = amount ? parseFloat(amount) : availableUsd / tokenPrice;
    const amountUsd = amountCrypto * tokenPrice;

    if (amountUsd > availableUsd) return res.status(400).json({ error: 'Insufficient balance' });

    const withdrawalId = uuidv4();
    await transaction(async (client) => {
      await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [amountUsd, req.user.id]);
      await client.query(
        "INSERT INTO crypto_withdrawals (id, user_id, user_email, chain, token, amount_crypto, amount_usd, to_address, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')",
        [withdrawalId, req.user.id, req.user.email, chain, token, amountCrypto.toString(), amountUsd, to_address]
      );
    });

    processWithdrawal(withdrawalId).catch(async (err) => {
      await query('UPDATE users SET balance = balance + $1 WHERE id = $2', [amountUsd, req.user.id]);
      console.error('[sweep refund]', err.message);
    });

    res.json({ ok: true, swept: 1, totalSent: amountCrypto, withdrawalId,
      results: [{ address: to_address, txHash: 'pending', amount: amountCrypto }] });
  } catch(e) {
    console.error('[admin sweep]', e.message);
    res.status(500).json({ error: e.message });
  }
});


// ── Admin: check on-chain balances across all user wallets ──────────────────

router.get('/admin/wallet-totals', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const evmChain = require('../crypto/chains/evm');

  const rows = await queryAll(
    `SELECT chain, token, array_agg(address) as addresses, COUNT(*) as cnt
     FROM crypto_addresses GROUP BY chain, token ORDER BY chain, token`,
    []
  );

  const prices = await getPrices();
  const results = [];

  // Create ONE TronWeb instance for all TRX calls
  let tronWeb = null;
  let tronContract = null;

  for (const row of rows) {
    const { chain, token, cnt } = row;
    const addresses = row.addresses || [];
    const chainConfig = CHAINS[chain];
    if (!chainConfig || !addresses.length) continue;

    const priceKey = (token === 'USDT' || token === 'USDC') ? token : chainConfig.symbol;
    const tokenPrice = prices[priceKey] || 1;

    let totalBalance = 0;
    let errorCount = 0;

    // Process sequentially for TRX (rate limit), parallel for EVM
    if (chain === 'TRX') {
      try {
        const { TronWeb } = require('tronweb');
        const apiKey = process.env.TRONGRID_API_KEY;
        if (!tronWeb) {
          tronWeb = new TronWeb({
            fullHost: 'https://api.trongrid.io',
            headers: apiKey ? { 'TRON-PRO-API-KEY': apiKey } : {},
            privateKey: 'a'.repeat(64),
          });
        }

        for (const address of addresses) {
          try {
            await new Promise(r => setTimeout(r, 500)); // sequential + delay
            let bal = 0;
            if (token === 'TRX') {
              const b = await tronWeb.trx.getBalance(address);
              bal = (b || 0) / 1e6;
            } else {
              const contractAddr = chainConfig.tokenContracts?.[token];
              if (contractAddr) {
                if (!tronContract || tronContract._address !== contractAddr) {
                  tronContract = await tronWeb.contract().at(contractAddr);
                  tronContract._address = contractAddr;
                }
                const b = await tronContract.balanceOf(address).call();
                bal = Number(b) / 1e6;
              }
            }
            totalBalance += bal;
          } catch (e) {
            errorCount++;
          }
        }
      } catch (e) {
        errorCount += addresses.length;
      }
    } else if (chainConfig.type === 'evm') {
      // EVM: parallel in small batches
      const BATCH = 5;
      for (let i = 0; i < addresses.length; i += BATCH) {
        const batch = addresses.slice(i, i + BATCH);
        const bals = await Promise.all(batch.map(async (address) => {
          try {
            if (token === chainConfig.symbol) {
              return await evmChain.getNativeBalance(chain, address);
            } else {
              const contract = chainConfig.tokenContracts?.[token];
              if (!contract) return 0;
              return await evmChain.getTokenBalance(chain, address, contract);
            }
          } catch { errorCount++; return 0; }
        }));
        totalBalance += bals.reduce((s, b) => s + b, 0);
        if (i + BATCH < addresses.length) await new Promise(r => setTimeout(r, 200));
      }
    } else if (chain === 'BTC' || chain === 'LTC') {
      const api = chain === 'BTC' ? 'https://blockstream.info/api' : 'https://litecoinspace.org/api';
      for (const address of addresses) {
        try {
          await new Promise(r => setTimeout(r, 300));
          const r = await fetch(`${api}/address/${address}/utxo`);
          const utxos = await r.json();
          totalBalance += Array.isArray(utxos) ? utxos.reduce((s, u) => s + (u.value || 0), 0) / 1e8 : 0;
        } catch { errorCount++; }
      }
    } else if (chain === 'XRP') {
      for (const address of addresses) {
        try {
          await new Promise(r => setTimeout(r, 300));
          const r = await fetch('https://xrplcluster.com', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method: 'account_info', params: [{ account: address, ledger_index: 'current' }] })
          });
          const d = await r.json();
          totalBalance += d?.result?.account_data ? Math.max(0, parseInt(d.result.account_data.Balance) / 1e6 - 10) : 0;
        } catch { errorCount++; }
      }
    } else if (chain === 'SOL') {
      for (const address of addresses) {
        try {
          await new Promise(r => setTimeout(r, 300));
          const r = await fetch('https://api.mainnet-beta.solana.com', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address] })
          });
          const d = await r.json();
          totalBalance += (d?.result?.value || 0) / 1e9;
        } catch { errorCount++; }
      }
    }

    const totalUsd = totalBalance * tokenPrice;
    results.push({
      chain, token,
      walletCount: parseInt(cnt),
      totalBalance: parseFloat(totalBalance.toFixed(6)),
      totalUsd: parseFloat(totalUsd.toFixed(2)),
      pricePerToken: tokenPrice,
      errors: errorCount,
    });
  }

  results.sort((a, b) => b.totalUsd - a.totalUsd);
  const grandTotalUsd = results.reduce((s, r) => s + r.totalUsd, 0);
  res.json({ ok: true, results, grandTotalUsd: parseFloat(grandTotalUsd.toFixed(2)) });
});

// ── Admin: sweep ALL user wallet balances on a chain/token → admin's address ──

router.post('/admin/sweep-all', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { chain, token, to_address, min_usd = 1 } = req.body;
  if (!chain || !token || !to_address) return res.status(400).json({ error: 'chain, token, to_address required' });

  const chainConfig = CHAINS[chain];
  if (!chainConfig) return res.status(400).json({ error: 'Unsupported chain' });

  const { getPrivateKey } = require('../crypto/wallet');
  const evmChain = require('../crypto/chains/evm');
  const tronChain = require('../crypto/chains/tron');
  const btcChain = require('../crypto/chains/bitcoin');
  const xrpChain = require('../crypto/chains/xrp');
  const solanaChain = require('../crypto/chains/solana');

  const prices = await getPrices();
  const priceKey = (token === 'USDT' || token === 'USDC') ? token : chainConfig.symbol;
  const tokenPrice = prices[priceKey] || 1;

  // Get all addresses for this chain/token
  const addresses = await queryAll(
    `SELECT DISTINCT ON (address) user_id, address, derivation_index
     FROM crypto_addresses WHERE chain = $1 AND token = $2`,
    [chain, token]
  );

  if (!addresses.length) return res.json({ ok: true, swept: 0, results: [], message: 'No addresses found' });

  const results = [];
  let totalSwept = 0;

  for (const row of addresses) {
    try {
      let balance = 0;

      if (chainConfig.type === 'evm') {
        if (token === chainConfig.symbol) {
          balance = await evmChain.getNativeBalance(chain, row.address);
        } else {
          const contract = chainConfig.tokenContracts?.[token];
          if (!contract) continue;
          balance = await evmChain.getTokenBalance(chain, row.address, contract);
        }
      } else if (chain === 'TRX') {
        if (token === 'TRX') {
          balance = await tronChain.getTRXBalance(row.address);
        } else {
          const contract = chainConfig.tokenContracts?.[token];
          if (!contract) continue;
          balance = await tronChain.getTRC20Balance(row.address, contract);
        }
      } else if (chain === 'BTC') {
        try {
          const r = await fetch(`https://blockstream.info/api/address/${row.address}/utxo`);
          const utxos = await r.json();
          balance = utxos.reduce((s, u) => s + (u.value || 0), 0) / 1e8;
        } catch { balance = 0; }
      } else if (chain === 'LTC') {
        try {
          const r = await fetch(`https://litecoinspace.org/api/address/${row.address}/utxo`);
          const utxos = await r.json();
          balance = utxos.reduce((s, u) => s + (u.value || 0), 0) / 1e8;
        } catch { balance = 0; }
      } else if (chain === 'XRP') {
        try {
          const r = await fetch('https://xrplcluster.com', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method: 'account_info', params: [{ account: row.address, ledger_index: 'current' }] })
          });
          const d = await r.json();
          balance = d?.result?.account_data ? (parseInt(d.result.account_data.Balance) / 1e6) - 10 : 0;
        } catch { balance = 0; }
      } else if (chain === 'SOL') {
        try {
          const r = await fetch('https://api.mainnet-beta.solana.com', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [row.address] })
          });
          const d = await r.json();
          balance = (d?.result?.value || 0) / 1e9;
        } catch { balance = 0; }
      }

      const balanceUsd = balance * tokenPrice;
      if (balanceUsd < parseFloat(min_usd) || balance <= 0) {
        results.push({ address: row.address, balance, balanceUsd, status: 'skipped', reason: 'below min' });
        continue;
      }

      // Reserve gas for native tokens
      let amountToSend = balance;
      if (token === chainConfig.symbol) {
        if (chain === 'ETH') amountToSend = Math.max(0, balance - 0.003);
        else if (chain === 'BSC' || chain === 'POLYGON' || chain === 'ARBITRUM') amountToSend = Math.max(0, balance - 0.005);
        else if (chain === 'TRX') amountToSend = Math.max(0, balance - 5);
        else if (chain === 'BTC') amountToSend = Math.max(0, balance - 0.0001);
        else if (chain === 'LTC') amountToSend = Math.max(0, balance - 0.001);
        else if (chain === 'SOL') amountToSend = Math.max(0, balance - 0.01);
        else if (chain === 'XRP') amountToSend = Math.max(0, balance - 0.1);
      }

      if (amountToSend <= 0) {
        results.push({ address: row.address, balance, balanceUsd, status: 'skipped', reason: 'too small after gas' });
        continue;
      }

      const privateKey = await getPrivateKey(row.user_id, chain, token);
      let txHash = null;

      if (chainConfig.type === 'evm') {
        if (token === chainConfig.symbol) {
          const r = await evmChain.sendNative(chain, privateKey, to_address, amountToSend);
          txHash = r.txHash;
        } else {
          const contract = chainConfig.tokenContracts?.[token];
          const r = await evmChain.sendToken(chain, privateKey, to_address, amountToSend, contract, 6);
          txHash = r.txHash;
        }
      } else if (chain === 'TRX') {
        if (token === 'TRX') {
          const r = await tronChain.sendTRX(privateKey, to_address, amountToSend);
          txHash = r.txHash;
        } else {
          const contract = chainConfig.tokenContracts?.[token];
          const r = await tronChain.sendTRC20(privateKey, to_address, amountToSend, contract);
          txHash = r.txHash;
        }
      } else if (chain === 'BTC' || chain === 'LTC') {
        const amtSats = Math.floor(amountToSend * 1e8);
        const r = await btcChain.sendBTC(privateKey, row.address, to_address, amtSats, chain);
        txHash = r.txHash;
      } else if (chain === 'XRP') {
        const r = await xrpChain.sendXRP(privateKey, to_address, amountToSend);
        txHash = r.txHash;
      } else if (chain === 'SOL') {
        const r = await solanaChain.sendSOL(privateKey, to_address, amountToSend);
        txHash = r.txHash;
      }

      const sentUsd = amountToSend * tokenPrice;
      totalSwept += sentUsd;
      results.push({ address: row.address, balance, amountSent: amountToSend, sentUsd, txHash, status: 'swept' });
      console.log(`[sweep-all] ${row.address} → ${to_address}: ${amountToSend} ${token}@${chain} tx=${txHash}`);

      await new Promise(r => setTimeout(r, 600));
    } catch (e) {
      console.error(`[sweep-all] ${row.address}: ${e.message}`);
      results.push({ address: row.address, status: 'error', error: e.message });
    }
  }

  const swept = results.filter(r => r.status === 'swept').length;
  res.json({ ok: true, swept, totalSweptUsd: totalSwept.toFixed(2), toAddress: to_address, chain, token, results });
});


// ── Admin: get wallets + on-chain balances for a specific user ──────────────
router.get('/admin/user-wallets/:userId', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { userId } = req.params;

  const addrs = await queryAll(
    'SELECT chain, token, address FROM crypto_addresses WHERE user_id = $1 ORDER BY chain, token',
    [userId]
  );

  if (!addrs.length) return res.json({ ok: true, wallets: [] });

  const { TronWeb } = require('tronweb');
  const evmChain = require('../crypto/chains/evm');
  const prices = await getPrices();
  const apiKey = process.env.TRONGRID_API_KEY;

  let tw = null;
  let tronContracts = {};
  const results = [];

  for (const row of addrs) {
    const { chain, token, address } = row;
    const chainConfig = CHAINS[chain];
    if (!chainConfig) { results.push({ chain, token, address, balance: 0, balanceUsd: 0 }); continue; }

    const priceKey = (token === 'USDT' || token === 'USDC') ? token : chainConfig.symbol;
    const price = prices[priceKey] || 1;
    let balance = 0;

    try {
      if (chain === 'TRX') {
        if (!tw) tw = new TronWeb({
          fullHost: 'https://api.trongrid.io',
          headers: apiKey ? { 'TRON-PRO-API-KEY': apiKey } : {},
          privateKey: 'a'.repeat(64),
        });
        await new Promise(r => setTimeout(r, 400));
        if (token === 'TRX') {
          balance = ((await tw.trx.getBalance(address)) || 0) / 1e6;
        } else {
          const contractAddr = chainConfig.tokenContracts?.[token];
          if (contractAddr) {
            if (!tronContracts[contractAddr]) tronContracts[contractAddr] = await tw.contract().at(contractAddr);
            balance = Number(await tronContracts[contractAddr].balanceOf(address).call()) / 1e6;
          }
        }
      } else if (chainConfig.type === 'evm') {
        if (token === chainConfig.symbol) {
          balance = await evmChain.getNativeBalance(chain, address);
        } else {
          const contract = chainConfig.tokenContracts?.[token];
          if (contract) balance = await evmChain.getTokenBalance(chain, address, contract);
        }
      }
    } catch {}

    results.push({
      chain, token, address,
      balance: parseFloat(balance.toFixed(6)),
      balanceUsd: parseFloat((balance * price).toFixed(2)),
    });
  }

  const totalUsd = results.reduce((s, r) => s + r.balanceUsd, 0);
  res.json({ ok: true, wallets: results, totalUsd: parseFloat(totalUsd.toFixed(2)) });
});

module.exports = router;

// ── 2FA for Withdrawals (TOTP) ─────────────────────────────────────────────────

const speakeasy = require('speakeasy');
const QRCode = require('qrcode');

// Ensure totp_secret column exists
(async () => {
  try {
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT FALSE`);
    console.log('[2FA] DB columns ready');
  } catch (e) {
    console.warn('[2FA] Migration warning:', e.message);
  }
})();

// POST /api/crypto/2fa/setup — generate secret, return QR
router.post('/2fa/setup', authenticate, async (req, res) => {
  try {
    const secret = speakeasy.generateSecret({
      name: `Cryptora (${req.user.email})`,
      issuer: 'Cryptora Casino',
      length: 32,
    });

    // Save temp secret (not enabled yet)
    await query('UPDATE users SET totp_secret = $1 WHERE id = $2', [secret.base32, req.user.id]);

    const qrUrl = await QRCode.toDataURL(secret.otpauth_url);
    res.json({
      success: true,
      secret: secret.base32,
      qrCode: qrUrl,
      manualEntry: secret.base32,
    });
  } catch (e) {
    console.error('[2FA setup]', e.message);
    res.status(500).json({ error: 'Failed to setup 2FA' });
  }
});

// POST /api/crypto/2fa/confirm — verify code and activate 2FA
router.post('/2fa/confirm', authenticate, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'TOTP code required' });

  try {
    const user = await queryOne('SELECT totp_secret FROM users WHERE id = $1', [req.user.id]);
    if (!user || !user.totp_secret) return res.status(400).json({ error: 'No 2FA setup in progress. Call /2fa/setup first.' });

    const valid = speakeasy.totp.verify({
      secret: user.totp_secret,
      encoding: 'base32',
      token: String(code).replace(/\s/g, ''),
      window: 2,
    });

    if (!valid) return res.status(400).json({ error: 'Invalid TOTP code. Try again.' });

    await query('UPDATE users SET totp_enabled = TRUE WHERE id = $1', [req.user.id]);
    res.json({ success: true, message: '2FA enabled for withdrawals' });
  } catch (e) {
    console.error('[2FA confirm]', e.message);
    res.status(500).json({ error: 'Failed to confirm 2FA' });
  }
});

// POST /api/crypto/2fa/disable — disable 2FA (requires current code)
router.post('/2fa/disable', authenticate, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'TOTP code required to disable 2FA' });

  try {
    const user = await queryOne('SELECT totp_secret, totp_enabled FROM users WHERE id = $1', [req.user.id]);
    if (!user || !user.totp_enabled) return res.status(400).json({ error: '2FA is not enabled' });

    const valid = speakeasy.totp.verify({
      secret: user.totp_secret,
      encoding: 'base32',
      token: String(code).replace(/\s/g, ''),
      window: 2,
    });

    if (!valid) return res.status(400).json({ error: 'Invalid TOTP code' });

    await query('UPDATE users SET totp_enabled = FALSE, totp_secret = NULL WHERE id = $1', [req.user.id]);
    res.json({ success: true, message: '2FA disabled' });
  } catch (e) {
    console.error('[2FA disable]', e.message);
    res.status(500).json({ error: 'Failed to disable 2FA' });
  }
});

// GET /api/crypto/2fa/status — check if 2FA is enabled for current user
router.get('/2fa/status', authenticate, async (req, res) => {
  try {
    const user = await queryOne('SELECT totp_enabled FROM users WHERE id = $1', [req.user.id]);
    res.json({ enabled: !!(user && user.totp_enabled) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to get 2FA status' });
  }
});
