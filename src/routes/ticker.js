const express = require('express');
const router = express.Router();
const { query, queryOne, queryAll } = require('../pgdb');
const { authMiddleware } = require('../middleware/auth');

// ─── Fake wins pool (shown until real bets come in) ───────────────────────────
const FAKE_WINS = [
  { player: 'Alex***', game: 'Sweet Bonanza', amount: 3240.00, multiplier: 162 },
  { player: 'Mike***', game: 'Gates of Olympus', amount: 1870.50, multiplier: 374 },
  { player: 'Serg***', game: 'Big Bass Bonanza', amount: 5600.00, multiplier: 280 },
  { player: 'Ivan***', game: 'Book of Dead', amount: 920.00, multiplier: 184 },
  { player: 'Dima***', game: 'Wolf Gold', amount: 2100.00, multiplier: 105 },
  { player: 'Anna***', game: 'Starburst', amount: 750.00, multiplier: 150 },
  { player: 'Olga***', game: 'Pragmatic Roulette', amount: 4500.00, multiplier: 450 },
  { player: 'Roma***', game: 'Fruit Party', amount: 1340.00, multiplier: 134 },
  { player: 'Max***',  game: 'The Dog House', amount: 2800.00, multiplier: 280 },
  { player: 'Kate***', game: 'Aztec Bonanza', amount: 1100.00, multiplier: 110 },
  { player: 'Vova***', game: 'Extra Juicy', amount: 3950.00, multiplier: 197 },
  { player: 'Nas***',  game: 'Wild West Gold', amount: 6200.00, multiplier: 310 },
  { player: 'Den***',  game: "Joker's Jewels", amount: 870.00, multiplier: 87 },
  { player: 'Lena***', game: 'Chilli Heat', amount: 1620.00, multiplier: 162 },
  { player: 'Pav***',  game: 'Emerald King', amount: 4100.00, multiplier: 205 },
];

// ─── Init table ───────────────────────────────────────────────────────────────
async function initTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS ticker_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      enabled BOOLEAN NOT NULL DEFAULT true,
      mode TEXT NOT NULL DEFAULT 'wins',
      announcement TEXT DEFAULT '',
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CHECK (id = 1)
    )
  `);
  // Seed default row if not exists
  await query(`
    INSERT INTO ticker_settings (id, enabled, mode, announcement)
    VALUES (1, true, 'wins', '')
    ON CONFLICT (id) DO NOTHING
  `);
}
initTable().catch(console.error);

// ─── GET /api/ticker ── public ────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const settings = await queryOne('SELECT * FROM ticker_settings WHERE id = 1');

    // Try to get real big wins from ClickHouse (if available)
    let wins = [];
    try {
      const { ch } = require('../chdb');
      const result = await ch.query({
        query: `
          SELECT player_name, game_name, win_amount, bet_amount,
                 round(win_amount / bet_amount, 0) AS multiplier
          FROM casino.bets
          WHERE win_amount > 0 AND win_amount / bet_amount >= 50
          ORDER BY created_at DESC
          LIMIT 20
        `,
        format: 'JSONEachRow',
      });
      const rows = await result.json();
      wins = rows.map(r => ({
        player: maskPlayer(r.player_name),
        game: r.game_name,
        amount: parseFloat(r.win_amount),
        multiplier: parseInt(r.multiplier),
      }));
    } catch {}

    // Fall back to fake wins if no real ones
    if (wins.length < 5) {
      wins = FAKE_WINS;
    }

    res.json({
      enabled: settings.enabled,
      mode: settings.mode,
      announcement: settings.announcement || '',
      wins,
    });
  } catch (err) {
    console.error('Ticker GET error:', err);
    res.json({ enabled: true, mode: 'wins', announcement: '', wins: FAKE_WINS });
  }
});

// ─── GET /api/admin/ticker ── admin only ──────────────────────────────────────
router.get('/admin', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const settings = await queryOne('SELECT * FROM ticker_settings WHERE id = 1');
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/admin/ticker ── admin only ──────────────────────────────────────
// Body: { enabled?, mode?, announcement? }
router.put('/admin', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { enabled, mode, announcement } = req.body;
    const updates = [];
    const params = [];
    let i = 1;

    if (enabled !== undefined) { updates.push(`enabled = $${i++}`); params.push(!!enabled); }
    if (mode !== undefined)    { updates.push(`mode = $${i++}`);    params.push(mode);      }
    if (announcement !== undefined) { updates.push(`announcement = $${i++}`); params.push(announcement); }

    if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });
    updates.push(`updated_at = NOW()`);
    params.push(1);

    await query(
      `UPDATE ticker_settings SET ${updates.join(', ')} WHERE id = $${i}`,
      params
    );
    const settings = await queryOne('SELECT * FROM ticker_settings WHERE id = 1');
    res.json({ ok: true, settings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
}

function maskPlayer(name) {
  if (!name) return 'Anon***';
  const visible = name.slice(0, Math.min(4, name.length));
  return visible + '***';
}

module.exports = router;
