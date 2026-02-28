const express = require('express');
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

  const user = await queryOne('SELECT balance FROM users WHERE id = $1', [req.user.id]);
  if (!user || parseFloat(user.balance) < amountUsd)
    return res.status(400).json({ error: 'Insufficient balance' });

  // Deduct balance + create withdrawal record atomically
  const withdrawalId = uuidv4();
  await transaction(async (client) => {
    await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [amountUsd, req.user.id]);
    await client.query(`
      INSERT INTO crypto_withdrawals (id, user_id, user_email, chain, token, amount_crypto, amount_usd, to_address, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
    `, [withdrawalId, req.user.id, req.user.email, chain, token, amountNum.toString(), amountUsd, to_address]);
  });

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

router.post('/admin/withdrawals/:id/approve', authenticate, async (req, res) => {
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

router.post('/admin/withdrawals/:id/reject', authenticate, async (req, res) => {
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

module.exports = router;
