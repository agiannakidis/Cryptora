// /root/casino-backend/src/routes/rg.js
// Responsible Gambling routes

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

// ─── Helpers ────────────────────────────────────────────────────────────────

function getToday() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function getWeekStart() {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0, 10);
}

function getMonthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function sumStats(userId, fromDate) {
  const rows = db.prepare(
    "SELECT SUM(deposited) as dep, SUM(lost) as lost, SUM(wagered) as wag FROM rg_daily_stats WHERE user_id = ? AND date >= ?"
  ).get(userId, fromDate);
  return {
    deposited: rows.dep || 0,
    lost: rows.lost || 0,
    wagered: rows.wag || 0,
  };
}

// ─── GET /api/rg/status ──────────────────────────────────────────────────────
// Returns user's limits + current usage
router.get('/status', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const today = getToday();
  const weekStart = getWeekStart();
  const monthStart = getMonthStart();

  const daily = sumStats(user.id, today);
  const weekly = sumStats(user.id, weekStart);
  const monthly = sumStats(user.id, monthStart);

  // Check if pending limit upgrades are ready to apply
  if (user.rg_limit_change_at && new Date(user.rg_limit_change_at) <= new Date()) {
    const updates = [];
    const vals = [];
    if (user.rg_deposit_limit_pending_daily !== null) {
      updates.push('deposit_limit_daily = ?'); vals.push(user.rg_deposit_limit_pending_daily);
    }
    if (user.rg_deposit_limit_pending_weekly !== null) {
      updates.push('deposit_limit_weekly = ?'); vals.push(user.rg_deposit_limit_pending_weekly);
    }
    if (user.rg_deposit_limit_pending_monthly !== null) {
      updates.push('deposit_limit_monthly = ?'); vals.push(user.rg_deposit_limit_pending_monthly);
    }
    if (updates.length) {
      updates.push('rg_deposit_limit_pending_daily = NULL');
      updates.push('rg_deposit_limit_pending_weekly = NULL');
      updates.push('rg_deposit_limit_pending_monthly = NULL');
      updates.push('rg_limit_change_at = NULL');
      vals.push(user.id);
      db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
    }
  }

  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  res.json({
    limits: {
      deposit_limit_daily: fresh.deposit_limit_daily,
      deposit_limit_weekly: fresh.deposit_limit_weekly,
      deposit_limit_monthly: fresh.deposit_limit_monthly,
      loss_limit_daily: fresh.loss_limit_daily,
      loss_limit_weekly: fresh.loss_limit_weekly,
      loss_limit_monthly: fresh.loss_limit_monthly,
      wager_limit_daily: fresh.wager_limit_daily,
      session_limit_minutes: fresh.session_limit_minutes,
      self_excluded_until: fresh.self_excluded_until,
      self_excluded_permanent: fresh.self_excluded_permanent,
      pending_deposit_limit_daily: fresh.rg_deposit_limit_pending_daily,
      pending_deposit_limit_weekly: fresh.rg_deposit_limit_pending_weekly,
      pending_deposit_limit_monthly: fresh.rg_deposit_limit_pending_monthly,
      limit_change_at: fresh.rg_limit_change_at,
    },
    usage: { daily, weekly, monthly },
  });
});

// ─── PUT /api/rg/limits ──────────────────────────────────────────────────────
// Set limits. Lowering = immediate. Raising = 24h cooling-off.
router.put('/limits', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.self_excluded_permanent) return res.status(403).json({ error: 'Account permanently excluded' });

  const {
    deposit_limit_daily, deposit_limit_weekly, deposit_limit_monthly,
    loss_limit_daily, loss_limit_weekly, loss_limit_monthly,
    wager_limit_daily, session_limit_minutes,
  } = req.body;

  const immediateUpdates = {};
  const pendingUpdates = {};
  const COOLING_HOURS = 24;

  // Helper: null means remove limit, number must be > 0
  function validateLimit(val) {
    if (val === null || val === undefined) return { ok: true, value: null };
    const n = parseFloat(val);
    if (isNaN(n) || n < 0) return { ok: false };
    return { ok: true, value: n === 0 ? null : n };
  }

  // Deposit limits — cooling-off when raising
  const depositFields = [
    ['deposit_limit_daily', deposit_limit_daily, 'rg_deposit_limit_pending_daily'],
    ['deposit_limit_weekly', deposit_limit_weekly, 'rg_deposit_limit_pending_weekly'],
    ['deposit_limit_monthly', deposit_limit_monthly, 'rg_deposit_limit_pending_monthly'],
  ];

  let hasPending = false;
  for (const [field, val, pendingField] of depositFields) {
    if (val === undefined) continue;
    const { ok, value } = validateLimit(val);
    if (!ok) return res.status(400).json({ error: `Invalid value for ${field}` });

    const current = user[field];
    const isRaising = value === null ? current !== null : (current !== null && value > current);
    if (isRaising) {
      pendingUpdates[pendingField] = value;
      hasPending = true;
    } else {
      immediateUpdates[field] = value;
    }
  }

  // Loss limits — always immediate (lowering only enforced by UI; server accepts any)
  const lossFields = [
    ['loss_limit_daily', loss_limit_daily],
    ['loss_limit_weekly', loss_limit_weekly],
    ['loss_limit_monthly', loss_limit_monthly],
  ];
  for (const [field, val] of lossFields) {
    if (val === undefined) continue;
    const { ok, value } = validateLimit(val);
    if (!ok) return res.status(400).json({ error: `Invalid value for ${field}` });
    immediateUpdates[field] = value;
  }

  // Wager limit — immediate
  if (wager_limit_daily !== undefined) {
    const { ok, value } = validateLimit(wager_limit_daily);
    if (!ok) return res.status(400).json({ error: 'Invalid wager_limit_daily' });
    immediateUpdates.wager_limit_daily = value;
  }

  // Session limit — immediate
  if (session_limit_minutes !== undefined) {
    const v = parseInt(session_limit_minutes);
    immediateUpdates.session_limit_minutes = (isNaN(v) || v <= 0) ? null : v;
  }

  // Apply immediate
  if (Object.keys(immediateUpdates).length > 0) {
    const sets = Object.keys(immediateUpdates).map(k => `${k} = ?`).join(', ');
    const vals = [...Object.values(immediateUpdates), user.id];
    db.prepare(`UPDATE users SET ${sets} WHERE id = ?`).run(...vals);
  }

  // Apply pending
  if (hasPending) {
    const changeAt = new Date(Date.now() + COOLING_HOURS * 3600 * 1000).toISOString();
    const sets = Object.keys(pendingUpdates).map(k => `${k} = ?`).join(', ');
    const vals = [...Object.values(pendingUpdates), changeAt, user.id];
    db.prepare(`UPDATE users SET ${sets}, rg_limit_change_at = ? WHERE id = ?`).run(...vals);
  }

  res.json({
    ok: true,
    message: hasPending
      ? `Limits updated. Deposit limit increases will take effect in ${COOLING_HOURS} hours.`
      : 'Limits updated immediately.',
    cooling_off: hasPending,
    cooling_off_until: hasPending
      ? new Date(Date.now() + COOLING_HOURS * 3600 * 1000).toISOString()
      : null,
  });
});

// ─── POST /api/rg/self-exclude ───────────────────────────────────────────────
router.post('/self-exclude', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { duration } = req.body; // '1d' | '7d' | '30d' | '180d' | 'permanent'
  const durations = { '1d': 1, '7d': 7, '30d': 30, '180d': 180 };

  if (duration === 'permanent') {
    db.prepare('UPDATE users SET self_excluded_permanent = 1, self_excluded_until = NULL WHERE id = ?').run(user.id);
    return res.json({ ok: true, message: 'Account permanently excluded. Contact support to appeal.', permanent: true });
  }

  if (!durations[duration]) {
    return res.status(400).json({ error: 'Invalid duration. Use: 1d, 7d, 30d, 180d, permanent' });
  }

  const days = durations[duration];
  const until = new Date(Date.now() + days * 86400 * 1000).toISOString();
  db.prepare('UPDATE users SET self_excluded_until = ?, self_excluded_permanent = 0 WHERE id = ?').run(until, user.id);

  res.json({
    ok: true,
    message: `Self-excluded for ${days} day(s). You can return after ${until.slice(0, 10)}.`,
    excluded_until: until,
  });
});

// ─── DELETE /api/rg/self-exclude ─────────────────────────────────────────────
// Cancel exclusion only if period has passed (permanent cannot be undone here)
router.delete('/self-exclude', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.self_excluded_permanent) {
    return res.status(403).json({ error: 'Permanent exclusion can only be lifted by support.' });
  }
  if (!user.self_excluded_until || new Date(user.self_excluded_until) > new Date()) {
    return res.status(400).json({ error: 'Exclusion period has not ended yet.' });
  }
  db.prepare('UPDATE users SET self_excluded_until = NULL WHERE id = ?').run(user.id);
  res.json({ ok: true, message: 'Exclusion lifted. Welcome back.' });
});

module.exports = router;
