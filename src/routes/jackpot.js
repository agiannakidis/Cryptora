// /root/casino-backend/src/routes/jackpot.js — migrated to PostgreSQL
const express = require('express');
const router = express.Router();
const { queryOne, queryAll } = require('../pgdb');
const crypto = require('crypto');
const uuidv4 = () => crypto.randomUUID();

// GET /api/jackpot — public
router.get('/', async (req, res) => {
  try {
    const jp = await queryOne('SELECT * FROM jackpot LIMIT 1');
    const winners = await queryAll(
      'SELECT user_email, amount, game_title, won_at FROM jackpot_winners ORDER BY won_at DESC LIMIT 5'
    );
    res.json({
      amount: parseFloat(jp?.amount || 10000),
      seed_amount: parseFloat(jp?.seed_amount || 5000),
      max_amount: parseFloat(jp?.max_amount || 100000),
      contribution_rate: parseFloat(jp?.contribution_rate || 0.0001),
      last_winner_email: jp?.last_winner_email || null,
      last_winner_amount: jp?.last_winner_amount ? parseFloat(jp.last_winner_amount) : null,
      last_won_at: jp?.last_won_at || null,
      recent_winners: (winners || []).map(w => ({
        email: (w.user_email || '').replace(/(.{2}).*(@.*)/, '$1***$2'),
        amount: parseFloat(w.amount),
        game: w.game_title,
        won_at: w.won_at,
      })),
    });
  } catch (e) {
    console.error('[jackpot GET]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});


// GET /api/jackpot/admin/settings — admin only
router.get('/admin/settings', async (req, res) => {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET; if (!JWT_SECRET) return res.status(500).json({error:'Server misconfigured'});
    let payload;
    try { payload = jwt.verify(token, JWT_SECRET); } catch(e) { return res.status(401).json({ error: 'Unauthorized' }); }
    if (payload.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

    const jp = await queryOne('SELECT * FROM jackpot LIMIT 1');
    res.json({
      amount: parseFloat(jp.amount),
      max_amount: parseFloat(jp.max_amount),
      win_chance_base: parseFloat(jp.win_chance_base),
      contribution_rate: parseFloat(jp.contribution_rate),
      seed_amount: parseFloat(jp.seed_amount),
      total_contributed: parseFloat(jp.total_contributed),
      last_won_at: jp.last_won_at,
      last_winner_email: jp.last_winner_email,
      last_winner_amount: jp.last_winner_amount ? parseFloat(jp.last_winner_amount) : null,
    });
  } catch (e) {
    console.error('[jackpot admin GET]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/jackpot/admin/settings — admin only
router.patch('/admin/settings', async (req, res) => {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET; if (!JWT_SECRET) return res.status(500).json({error:'Server misconfigured'});
    let payload;
    try { payload = jwt.verify(token, JWT_SECRET); } catch(e) { return res.status(401).json({ error: 'Unauthorized' }); }
    if (payload.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

    const { max_amount, win_chance_base, contribution_rate } = req.body;
    const updates = [];
    const params = [];
    let i = 1;
    if (max_amount !== undefined && parseFloat(max_amount) > 0) {
      updates.push(`max_amount = $${i++}`); params.push(parseFloat(max_amount));
    }
    if (win_chance_base !== undefined && parseFloat(win_chance_base) > 0) {
      updates.push(`win_chance_base = $${i++}`); params.push(parseFloat(win_chance_base));
    }
    if (contribution_rate !== undefined && parseFloat(contribution_rate) >= 0) {
      updates.push(`contribution_rate = $${i++}`); params.push(parseFloat(contribution_rate));
    }
    if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

    updates.push(`updated_at = NOW()`);
    const jp = await queryOne('SELECT id FROM jackpot LIMIT 1');
    params.push(jp.id);
    await queryOne(`UPDATE jackpot SET ${updates.join(', ')} WHERE id = $${i} RETURNING id`, params);
    res.json({ ok: true });
  } catch (e) {
    console.error('[jackpot admin PATCH]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;


// GET /api/jackpot/my-win — check if current user has a recent unacknowledged jackpot win
router.get('/my-win', async (req, res) => {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.json({ win: false });
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET; if (!JWT_SECRET) return res.status(500).json({error:'Server misconfigured'});
    let payload;
    try { payload = jwt.verify(token, JWT_SECRET); } catch(e) { return res.json({ win: false }); }

    const jp = await queryOne('SELECT last_winner_email, last_winner_amount, last_won_at FROM jackpot LIMIT 1');
    if (!jp || !jp.last_won_at) return res.json({ win: false });

    const age = Date.now() - new Date(jp.last_won_at).getTime();
    if (age > 1800000) return res.json({ win: false }); // 30 min TTL

    const match = jp.last_winner_email && payload.email &&
      jp.last_winner_email.toLowerCase() === payload.email.toLowerCase();
    if (!match) return res.json({ win: false });

    res.json({ win: true, amount: parseFloat(jp.last_winner_amount), won_at: jp.last_won_at });
  } catch(e) {
    res.json({ win: false });
  }
});
