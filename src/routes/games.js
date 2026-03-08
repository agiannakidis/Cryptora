const express = require('express');
const router = express.Router();
const { queryAll, queryOne, query } = require('../pgdb');
const { authMiddleware } = require('../middleware/auth');

const VALID_CATEGORIES = ['last_played','featured','new','table','crash','megaways','bonus_buy','jackpot','slots'];

// GET /api/games/categories — list all categories with game counts
router.get('/categories', async (req, res) => {
  try {
    const rows = await queryAll(`
      SELECT unnest(categories) as cat, COUNT(*) as count
      FROM games WHERE is_enabled = true
      GROUP BY cat
    `);
    res.json(rows);
  } catch (e) {
    console.error('[games/categories]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/games/by-category — games grouped by category
// ?limit=20 per category (default 20), ?userId=... for last_played
router.get('/by-category', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    const userId = req.query.userId || null;

    const categories = [
      { key: 'last_played', label: 'Last Played' },
      { key: 'jackpot',     label: 'Jackpot' },
      { key: 'top',         label: 'Top' },
      { key: 'featured',    label: 'Featured' },
      { key: 'slots',       label: 'All Slots' },
    ];

    const result = [];

    for (const cat of categories) {
      let games = [];

      if (cat.key === 'last_played') {
        if (!userId) continue; // skip if no user
        const rows = await queryAll(`
          SELECT DISTINCT ON (gs.game_id) gs.game_id, g.id, g.title, g.provider, g.thumbnail, g.categories, g.has_jackpot
          FROM game_sessions gs
          JOIN games g ON g.game_id = gs.game_id
          WHERE gs.user_id = $1 AND g.is_enabled = true
          ORDER BY gs.game_id, gs.created_date DESC
          LIMIT $2
        `, [userId, limit]);
        games = rows;
      } else {
        const rows = await queryAll(`
          SELECT id, title, provider, thumbnail, categories, has_jackpot, is_featured, sort_order
          FROM games
          WHERE is_enabled = true AND $1 = ANY(categories)
          ORDER BY sort_order DESC, created_date DESC
          LIMIT $2
        `, [cat.key, limit]);
        games = rows;
      }

      if (games.length > 0) {
        result.push({ key: cat.key, label: cat.label, games });
      }
    }

    res.json(result);
  } catch (e) {
    console.error('[games/by-category]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/games/list — all games (with optional category filter)
router.get('/list', async (req, res) => {
  try {
    const { category, provider, search, limit = 200, offset = 0 } = req.query;
    let where = ['is_enabled = true'];
    const params = [];

    if (category && category !== 'all') {
      params.push(category);
      where.push(`$${params.length} = ANY(categories)`);
    }
    if (provider) {
      params.push(provider);
      where.push(`provider = $${params.length}`);
    }
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      where.push(`LOWER(title) LIKE $${params.length}`);
    }

    params.push(parseInt(limit));
    params.push(parseInt(offset));

    const rows = await queryAll(`
      SELECT id, title, provider, thumbnail, categories, has_jackpot, is_featured,
             game_id, sort_order, is_enabled, rtp, play_count, min_bet, max_bet, launch_url
      FROM games
      WHERE ${where.join(' AND ')}
      ORDER BY sort_order DESC, created_date DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json(rows);
  } catch (e) {
    console.error('[games/list]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/games/:id/categories — admin: update game categories
router.patch('/:id/categories', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const { categories } = req.body;
    if (!Array.isArray(categories)) return res.status(400).json({ error: 'categories must be array' });

    const valid = categories.filter(c => VALID_CATEGORIES.includes(c));
    await query('UPDATE games SET categories = $1, updated_date = NOW() WHERE id = $2', [valid, req.params.id]);
    res.json({ ok: true, categories: valid });
  } catch (e) {
    console.error('[games/categories patch]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/games/providers — list providers
router.get('/providers', async (req, res) => {
  try {
    const rows = await queryAll('SELECT DISTINCT provider FROM games WHERE is_enabled=true ORDER BY provider');
    res.json(rows.map(r => r.provider));
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});


// ── PUT /api/games/:id — edit game (admin) ────────────────────────────────
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const { id } = req.params;
    const allowed = ['title', 'provider', 'thumbnail', 'is_enabled', 'is_featured',
                     'sort_order', 'rtp', 'min_bet', 'max_bet', 'categories',
                     'launch_url', 'has_jackpot', 'category'];
    const updates = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });

    updates.updated_date = new Date().toISOString();
    const keys = Object.keys(updates);
    const setClauses = keys.map((k, i) => {
      if (k === 'categories') return `categories = $${i + 1}::text[]`;
      return `${k} = $${i + 1}`;
    }).join(', ');
    const values = keys.map(k => updates[k]);
    values.push(id);

    const row = await queryOne(
      `UPDATE games SET ${setClauses} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (!row) return res.status(404).json({ error: 'Game not found' });
    res.json(row);
  } catch (e) {
    console.error('[games PUT]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/games/providers-list — unique providers with count ───────────
router.get('/providers-list', async (req, res) => {
  try {
    const rows = await queryAll(
      `SELECT provider, COUNT(*)::int as count FROM games WHERE is_enabled = true GROUP BY provider ORDER BY provider`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
