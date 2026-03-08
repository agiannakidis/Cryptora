// /root/casino-backend/src/routes/rg.js — migrated to PostgreSQL
const express = require('express');
const router = express.Router();
const { queryOne, query } = require('../pgdb');
const { authMiddleware } = require('../middleware/auth');

function getToday()      { return new Date().toISOString().slice(0,10); }
function getWeekStart()  { const d=new Date(); d.setDate(d.getDate()-d.getDay()); return d.toISOString().slice(0,10); }
function getMonthStart() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; }

async function getStats(userId, fromDate) {
  const row = await queryOne(
    'SELECT SUM(deposited) as dep, SUM(lost) as lost, SUM(wagered) as wag FROM rg_daily_stats WHERE user_id=$1 AND date>=$2',
    [userId, fromDate]
  );
  return { deposited: parseFloat(row?.dep||0), lost: parseFloat(row?.lost||0), wagered: parseFloat(row?.wag||0) };
}

// GET /api/rg/status
router.get('/status', authMiddleware, async (req, res) => {
  try {
    const user = await queryOne('SELECT * FROM users WHERE id=$1', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const [daily, weekly, monthly] = await Promise.all([
      getStats(user.id, getToday()),
      getStats(user.id, getWeekStart()),
      getStats(user.id, getMonthStart()),
    ]);
    res.json({
      self_excluded_until: user.self_excluded_until,
      self_excluded_permanent: user.self_excluded_permanent,
      deposit_limit_daily: user.deposit_limit_daily !== null ? parseFloat(user.deposit_limit_daily) : null,
      deposit_limit_weekly: user.deposit_limit_weekly !== null ? parseFloat(user.deposit_limit_weekly) : null,
      deposit_limit_monthly: user.deposit_limit_monthly !== null ? parseFloat(user.deposit_limit_monthly) : null,
      loss_limit_daily: user.loss_limit_daily !== null ? parseFloat(user.loss_limit_daily) : null,
      loss_limit_weekly: user.loss_limit_weekly !== null ? parseFloat(user.loss_limit_weekly) : null,
      loss_limit_monthly: user.loss_limit_monthly !== null ? parseFloat(user.loss_limit_monthly) : null,
      wager_limit_daily: user.wager_limit_daily !== null ? parseFloat(user.wager_limit_daily) : null,
      rg_limit_change_at: user.rg_limit_change_at || null,
      stats: { daily, weekly, monthly },
    });
  } catch(e) {
    console.error('[rg status]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/rg/limits
router.post('/limits', authMiddleware, async (req, res) => {
  try {
    const user = await queryOne('SELECT * FROM users WHERE id=$1', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const allowed = ['deposit_limit_daily','deposit_limit_weekly','deposit_limit_monthly',
                     'loss_limit_daily','loss_limit_weekly','loss_limit_monthly','wager_limit_daily'];
    const updates = []; const vals = [];
    let i = 1;
    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        const val = req.body[field] === null || req.body[field] === '' ? null : parseFloat(req.body[field]);
        // Cooldown: can only increase limits (or add new ones), decreasing requires 24h cooldown
        const existing = user[field] !== null ? parseFloat(user[field]) : null;
        if (existing !== null && val !== null && val > existing) {
          const changedAt = user.rg_limit_change_at ? new Date(user.rg_limit_change_at) : null;
          if (changedAt && (Date.now() - changedAt.getTime()) < 24*3600*1000)
            return res.status(429).json({ error: `You can only increase limits once per 24h. Try again later.` });
        }
        updates.push(`${field}=$${i++}`); vals.push(val);
      }
    }
    if (updates.length === 0) return res.status(400).json({ error: 'No valid fields' });
    updates.push(`rg_limit_change_at=NOW()`);
    vals.push(user.id);
    await query(`UPDATE users SET ${updates.join(',')} WHERE id=$${i}`, vals);
    const fresh = await queryOne('SELECT * FROM users WHERE id=$1', [user.id]);
    res.json({ ok: true, limits: {
      deposit_limit_daily: fresh.deposit_limit_daily,
      deposit_limit_weekly: fresh.deposit_limit_weekly,
      deposit_limit_monthly: fresh.deposit_limit_monthly,
      loss_limit_daily: fresh.loss_limit_daily,
      loss_limit_weekly: fresh.loss_limit_weekly,
      loss_limit_monthly: fresh.loss_limit_monthly,
      wager_limit_daily: fresh.wager_limit_daily,
    }});
  } catch(e) {
    console.error('[rg limits]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/rg/self-exclude
router.post('/self-exclude', authMiddleware, async (req, res) => {
  try {
    const user = await queryOne('SELECT id FROM users WHERE id=$1', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { permanent, days } = req.body;
    if (permanent) {
      await query('UPDATE users SET self_excluded_permanent=true, self_excluded_until=NULL WHERE id=$1', [user.id]);
      return res.json({ ok: true, message: 'Permanent self-exclusion applied.' });
    }
    if (!days || isNaN(days) || days < 1) return res.status(400).json({ error: 'Invalid days' });
    const until = new Date(Date.now() + parseInt(days)*24*3600*1000).toISOString();
    await query('UPDATE users SET self_excluded_until=$1, self_excluded_permanent=false WHERE id=$2', [until, user.id]);
    res.json({ ok: true, message: `Self-excluded until ${until.slice(0,10)}.`, until });
  } catch(e) {
    console.error('[rg self-exclude]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/rg/self-exclude/cancel
router.post('/self-exclude/cancel', authMiddleware, async (req, res) => {
  try {
    const user = await queryOne('SELECT self_excluded_until, self_excluded_permanent FROM users WHERE id=$1', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.self_excluded_permanent) return res.status(400).json({ error: 'Permanent exclusion cannot be cancelled.' });
    await query('UPDATE users SET self_excluded_until=NULL WHERE id=$1', [req.user.id]);
    res.json({ ok: true, message: 'Self-exclusion cancelled.' });
  } catch(e) {
    console.error('[rg cancel]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
