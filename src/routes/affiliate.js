const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { queryOne, queryAll, query } = require('../pgdb');
const { authMiddleware } = require('../middleware/auth');

function adminAuth(req, res, next) {
  authMiddleware(req, res, () => {
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    next();
  });
}

function genRefCode(name) {
  const base = (name || '').replace(/\s+/g, '').slice(0, 8).toUpperCase() || 'REF';
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return base + rand;
}

// ── Affiliate self-service ────────────────────────────────────────────────────

// GET /api/affiliate/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const aff = await queryOne('SELECT * FROM affiliates WHERE user_id = $1', [req.user.id]);
    if (!aff) return res.status(404).json({ error: 'Not an affiliate. Apply first.' });

    const refRow = await queryOne(
      'SELECT COUNT(*) as c FROM affiliate_referrals WHERE affiliate_id = $1', [aff.id]
    );
    const depRow = await queryOne(
      "SELECT COUNT(*) as c FROM affiliate_referrals WHERE affiliate_id = $1 AND status != 'registered'", [aff.id]
    );
    const earnRow = await queryOne(
      `SELECT COALESCE(SUM(amount),0) as t FROM affiliate_earnings
       WHERE affiliate_id = $1 AND created_date >= date_trunc('month', NOW())`, [aff.id]
    );

    res.json({
      ...aff,
      revshare_percent: parseFloat(aff.revshare_percent),
      cpa_amount: parseFloat(aff.cpa_amount),
      total_earned: parseFloat(aff.total_earned),
      total_paid: parseFloat(aff.total_paid),
      stats: {
        referrals: parseInt(refRow.c),
        depositors: parseInt(depRow.c),
        total_earned: parseFloat(aff.total_earned),
        total_paid: parseFloat(aff.total_paid),
        balance: parseFloat(aff.total_earned) - parseFloat(aff.total_paid),
        earnings_this_month: parseFloat(earnRow.t),
      },
      ref_link: `https://cryptora.live/?ref=${aff.ref_code}`,
    });
  } catch (e) { console.error('[affiliate/me]', e.message); res.status(500).json({ error: 'Server error' }); }
});

// POST /api/affiliate/apply
router.post('/apply', authMiddleware, async (req, res) => {
  try {
    const existing = await queryOne('SELECT id, ref_code FROM affiliates WHERE user_id = $1', [req.user.id]);
    if (existing) return res.status(409).json({ error: 'Already an affiliate', ref_code: existing.ref_code });

    const { postback_url } = req.body;
    const ref_code = genRefCode(req.user.name || req.user.email);
    const id = uuidv4();

    await query(
      'INSERT INTO affiliates (id, user_id, ref_code, postback_url) VALUES ($1, $2, $3, $4)',
      [id, req.user.id, ref_code, postback_url || null]
    );

    res.json({ ok: true, ref_code, ref_link: `https://cryptora.live/?ref=${ref_code}` });
  } catch (e) { console.error('[affiliate/apply]', e.message); res.status(500).json({ error: 'Server error' }); }
});

// GET /api/affiliate/referrals
router.get('/referrals', authMiddleware, async (req, res) => {
  try {
    const aff = await queryOne('SELECT id FROM affiliates WHERE user_id = $1', [req.user.id]);
    if (!aff) return res.status(403).json({ error: 'Not an affiliate' });

    const { limit = 50, offset = 0 } = req.query;
    const rows = await queryAll(`
      SELECT
        r.*,
        u.name as user_name,
        u.balance as user_balance,
        u.vip_level,
        u.total_wagered,
        COALESCE((SELECT SUM(amount_usd) FROM crypto_deposits WHERE user_id = r.referred_user_id AND credited = true), 0) as total_deposits,
        COALESCE((SELECT SUM(amount_usd) FROM crypto_withdrawals WHERE user_id = r.referred_user_id AND status = 'completed'), 0) as total_withdrawals,
        u.created_date as registered_at,
        u.email as user_email_direct
      FROM affiliate_referrals r
      LEFT JOIN users u ON u.id = r.referred_user_id
      WHERE r.affiliate_id = $1
      ORDER BY r.created_date DESC
      LIMIT $2 OFFSET $3
    `, [aff.id, parseInt(limit), parseInt(offset)]);

    const totalRow = await queryOne(
      'SELECT COUNT(*) as c FROM affiliate_referrals WHERE affiliate_id = $1', [aff.id]
    );

    res.json({
      referrals: rows.map(r => ({
        ...r,
        user_balance: parseFloat(r.user_balance || 0),
        total_wagered: parseFloat(r.total_wagered || 0),
        total_deposits: parseFloat(r.total_deposits || 0),
        total_withdrawals: parseFloat(r.total_withdrawals || 0),
        first_deposit_amount: parseFloat(r.first_deposit_amount || 0),
        total_ggr: parseFloat(r.total_ggr || 0),
      })),
      total: parseInt(totalRow.c),
    });
  } catch (e) { console.error('[affiliate/referrals]', e.message); res.status(500).json({ error: 'Server error' }); }
});

// GET /api/affiliate/earnings
router.get('/earnings', authMiddleware, async (req, res) => {
  try {
    const aff = await queryOne('SELECT id FROM affiliates WHERE user_id = $1', [req.user.id]);
    if (!aff) return res.status(403).json({ error: 'Not an affiliate' });

    const rows = await queryAll(`
      SELECT e.*, u.email as referred_email
      FROM affiliate_earnings e
      LEFT JOIN users u ON u.id = e.referred_user_id
      WHERE e.affiliate_id = $1
      ORDER BY e.created_date DESC
      LIMIT 100
    `, [aff.id]);

    res.json({
      earnings: rows.map(r => ({ ...r, amount: parseFloat(r.amount) }))
    });
  } catch (e) { console.error('[affiliate/earnings]', e.message); res.status(500).json({ error: 'Server error' }); }
});

// GET /api/affiliate/stats?from=&to=  — NGR stats for affiliate dashboard
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const aff = await queryOne('SELECT * FROM affiliates WHERE user_id = $1', [req.user.id]);
    if (!aff) return res.status(403).json({ error: 'Not an affiliate' });

    const { from, to } = req.query;
    const fromDt = from || '2020-01-01';
    const toDt   = to   || new Date().toISOString().slice(0, 10);

    // GGR per referred player from affiliate_referrals (updated by walletApi)
    const ngrRow = await queryOne(`
      SELECT
        COALESCE(SUM(total_ggr), 0) as ggr,
        COUNT(*) as players,
        COUNT(*) FILTER (WHERE status != 'registered') as depositors
      FROM affiliate_referrals
      WHERE affiliate_id = $1
    `, [aff.id]);

    // Earnings in period
    const earnRow = await queryOne(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM affiliate_earnings
      WHERE affiliate_id = $1
        AND type != 'payout'
        AND created_date >= $2::date
        AND created_date <  ($3::date + interval '1 day')
    `, [aff.id, fromDt, toDt]);

    res.json({
      ggr:         parseFloat(ngrRow.ggr),
      ngr:         parseFloat(ngrRow.ggr), // bonuses not tracked yet
      players:     parseInt(ngrRow.players),
      depositors:  parseInt(ngrRow.depositors),
      commission:  parseFloat(earnRow.total),
      revshare_percent: parseFloat(aff.revshare_percent),
      balance:     parseFloat(aff.total_earned) - parseFloat(aff.total_paid),
    });
  } catch (e) { console.error('[affiliate/stats]', e.message); res.status(500).json({ error: 'Server error' }); }
});

// ── Admin ─────────────────────────────────────────────────────────────────────

// GET /api/affiliate/admin/list
router.get('/admin/list', adminAuth, async (req, res) => {
  try {
    const rows = await queryAll(`
      SELECT
        a.*,
        u.email,
        u.name as user_name,
        (SELECT COUNT(*) FROM affiliate_referrals WHERE affiliate_id = a.id) as referral_count,
        (SELECT COUNT(*) FROM affiliate_referrals WHERE affiliate_id = a.id AND status != 'registered') as depositor_count,
        (a.total_earned - a.total_paid) as balance
      FROM affiliates a
      LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.total_earned DESC
    `);
    res.json({
      affiliates: rows.map(r => ({
        ...r,
        total_earned: parseFloat(r.total_earned),
        total_paid: parseFloat(r.total_paid),
        balance: parseFloat(r.balance),
        revshare_percent: parseFloat(r.revshare_percent),
        cpa_amount: parseFloat(r.cpa_amount),
        referral_count: parseInt(r.referral_count),
        depositor_count: parseInt(r.depositor_count),
      }))
    });
  } catch (e) { console.error('[affiliate/admin/list]', e.message); res.status(500).json({ error: 'Server error' }); }
});

// PUT /api/affiliate/admin/:id
router.put('/admin/:id', adminAuth, async (req, res) => {
  try {
    const { status, commission_type, cpa_amount, revshare_percent, notes } = req.body;
    const updates = [];
    const vals = [];
    let idx = 1;
    if (status !== undefined)          { updates.push(`status=$${idx++}`);           vals.push(status); }
    if (commission_type !== undefined) { updates.push(`commission_type=$${idx++}`);  vals.push(commission_type); }
    if (cpa_amount !== undefined)      { updates.push(`cpa_amount=$${idx++}`);       vals.push(parseFloat(cpa_amount)); }
    if (revshare_percent !== undefined){ updates.push(`revshare_percent=$${idx++}`); vals.push(parseFloat(revshare_percent)); }
    if (notes !== undefined)           { updates.push(`notes=$${idx++}`);            vals.push(notes); }

    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(req.params.id);
    await query(`UPDATE affiliates SET ${updates.join(', ')} WHERE id=$${idx}`, vals);
    res.json({ ok: true });
  } catch (e) { console.error('[affiliate/admin/put]', e.message); res.status(500).json({ error: 'Server error' }); }
});

// POST /api/affiliate/admin/:id/payout
router.post('/admin/:id/payout', adminAuth, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || parseFloat(amount) <= 0) return res.status(400).json({ error: 'Amount required' });
    const aff = await queryOne('SELECT * FROM affiliates WHERE id = $1', [req.params.id]);
    if (!aff) return res.status(404).json({ error: 'Not found' });

    const balance = parseFloat(aff.total_earned) - parseFloat(aff.total_paid);
    if (parseFloat(amount) > balance)
      return res.status(400).json({ error: `Balance is only $${balance.toFixed(2)}` });

    await query('UPDATE affiliates SET total_paid = total_paid + $1 WHERE id = $2',
      [parseFloat(amount), aff.id]);
    await query(
      `INSERT INTO affiliate_earnings (id, affiliate_id, type, amount, description)
       VALUES ($1, $2, 'payout', $3, 'Payout by admin')`,
      [uuidv4(), aff.id, -parseFloat(amount)]
    );

    res.json({ ok: true, new_balance: balance - parseFloat(amount) });
  } catch (e) { console.error('[affiliate/admin/payout]', e.message); res.status(500).json({ error: 'Server error' }); }
});

// ── Internal: called from walletApi on BET_SETTLED ───────────────────────────
// POST /api/affiliate/internal/bet-settled
router.post('/internal/bet-settled', async (req, res) => {
  try {
    const { player_id, bet_amount, win_amount, round_id, game_id, provider, occurred_at } = req.body;
    if (!player_id) return res.status(400).json({ error: 'player_id required' });
    res.json({ ok: true }); // respond immediately, process async
    betSettled(player_id, parseFloat(bet_amount||0), parseFloat(win_amount||0), { round_id, game_id, provider, occurred_at }).catch(()=>{});
  } catch (e) { console.error('[affiliate/bet-settled]', e.message); }
});

// Core BET_SETTLED logic — also exported for direct in-process calls
async function betSettled(playerId, betAmount, winAmount, meta={}) {
  try {
    const ggr = betAmount - winAmount;
    const roundId = meta.round_id || null;
    const occurredAt = meta.occurred_at || new Date().toISOString();

    // 1. Write to events_ledger (dedup by round_id if present)
    if (roundId) {
      await query(`
        INSERT INTO affiliate_events_ledger (type, player_id, external_id, amount1, amount2, meta, occurred_at)
        VALUES ('BET_SETTLED', $1, $2, $3, $4, $5, $6)
        ON CONFLICT (type, external_id) DO NOTHING
      `, [playerId, roundId, betAmount, winAmount, JSON.stringify(meta), occurredAt]);
    } else {
      await query(`
        INSERT INTO affiliate_events_ledger (type, player_id, amount1, amount2, meta, occurred_at)
        VALUES ('BET_SETTLED', $1, $2, $3, $4, $5)
      `, [playerId, betAmount, winAmount, JSON.stringify(meta), occurredAt]);
    }

    // 2. Upsert player_daily_ngr
    const today = occurredAt.slice(0, 10);
    const ref = await queryOne('SELECT * FROM affiliate_referrals WHERE referred_user_id = $1', [playerId]);
    const affiliateId = ref ? ref.affiliate_id : null;

    await query(`
      INSERT INTO affiliate_player_daily_ngr (date, player_id, affiliate_id, ggr, ngr, bet_count)
      VALUES ($1, $2, $3, $4, $4, 1)
      ON CONFLICT (date, player_id) DO UPDATE
        SET ggr       = affiliate_player_daily_ngr.ggr + EXCLUDED.ggr,
            ngr       = affiliate_player_daily_ngr.ngr + EXCLUDED.ngr,
            bet_count = affiliate_player_daily_ngr.bet_count + 1,
            affiliate_id = COALESCE(affiliate_player_daily_ngr.affiliate_id, EXCLUDED.affiliate_id)
    `, [today, playerId, affiliateId, ggr]);

    if (!ref) return; // not attributed

    // 3. Update referral totals
    await query(
      'UPDATE affiliate_referrals SET total_ggr = total_ggr + $1, total_wagered = total_wagered + $2 WHERE referred_user_id = $3',
      [ggr, betAmount, playerId]
    );

    // 4. RevShare commission (only if GGR > 0)
    if (ggr > 0) {
      const aff = await queryOne('SELECT * FROM affiliates WHERE id = $1 AND status = $2', [ref.affiliate_id, 'active']);
      if (aff) {
        const commission = parseFloat((ggr * parseFloat(aff.revshare_percent) / 100).toFixed(8));
        if (commission > 0) {
          await query(
            `INSERT INTO affiliate_earnings (id, affiliate_id, referred_user_id, type, amount, description)
             VALUES ($1, $2, $3, 'revshare', $4, 'RevShare BET_SETTLED')`,
            [uuidv4(), aff.id, playerId, commission]
          );
          await query('UPDATE affiliates SET total_earned = total_earned + $1 WHERE id = $2', [commission, aff.id]);
        }
      }
    }
  } catch(e) { console.error('[affiliate/betSettled]', e.message); }
}


// ── Click tracking ────────────────────────────────────────────────────────────

// POST /api/affiliate/click — record a click, return click_id + set cookie
router.post('/click', async (req, res) => {
  try {
    const { ref, sub1, sub2, sub3, landing_url } = req.body;
    if (!ref) return res.status(400).json({ error: 'ref required' });

    const aff = await queryOne('SELECT id FROM affiliates WHERE ref_code = $1 AND status = $2', [ref, 'active']);
    if (!aff) return res.status(404).json({ error: 'Invalid ref code' });

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
    const ua = req.headers['user-agent'] || '';

    const row = await queryOne(`
      INSERT INTO affiliate_clicks (affiliate_id, ref_code, sub1, sub2, sub3, ip, user_agent, landing_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, [aff.id, ref, sub1||null, sub2||null, sub3||null, ip, ua, landing_url||null]);

    res.json({ ok: true, click_id: row.id });
  } catch(e) { console.error('[affiliate/click]', e.message); res.status(500).json({ error: 'Server error' }); }
});

// GET /api/affiliate/track?ref=XXX&sub1=...  — redirect + set cookie (for direct link visits)
router.get('/track', async (req, res) => {
  try {
    const { ref, sub1, sub2, sub3, redirect } = req.query;
    if (!ref) return res.redirect('https://cryptora.live');

    const aff = await queryOne('SELECT id FROM affiliates WHERE ref_code = $1 AND status = $2', [ref, 'active']);
    if (!aff) return res.redirect('https://cryptora.live');

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
    const ua = req.headers['user-agent'] || '';
    const landing = req.headers.referer || '';

    const row = await queryOne(`
      INSERT INTO affiliate_clicks (affiliate_id, ref_code, sub1, sub2, sub3, ip, user_agent, landing_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, [aff.id, ref, sub1||null, sub2||null, sub3||null, ip, ua, landing||null]);

    const dest = redirect || `https://cryptora.live/?ref=${ref}&click_id=${row.id}`;
    res.cookie('aff_click', JSON.stringify({ ref, click_id: row.id, sub1: sub1||'' }), {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      httpOnly: false,
      sameSite: 'lax',
      domain: 'cryptora.live',
    });
    res.redirect(dest);
  } catch(e) { console.error('[affiliate/track]', e.message); res.redirect('https://cryptora.live'); }
});

// GET /api/affiliate/clicks — my click stats
router.get('/clicks', authMiddleware, async (req, res) => {
  try {
    const aff = await queryOne('SELECT id FROM affiliates WHERE user_id = $1', [req.user.id]);
    if (!aff) return res.status(403).json({ error: 'Not an affiliate' });

    const { from, to } = req.query;
    const fromDt = from || new Date(Date.now() - 30*24*60*60*1000).toISOString().slice(0,10);
    const toDt   = to   || new Date().toISOString().slice(0,10);

    const rows = await queryAll(`
      SELECT
        DATE(created_at) as date,
        COUNT(*) as clicks,
        COUNT(*) FILTER (WHERE converted = true) as conversions,
        sub1
      FROM affiliate_clicks
      WHERE affiliate_id = $1
        AND created_at >= $2::date
        AND created_at <  ($3::date + interval '1 day')
      GROUP BY DATE(created_at), sub1
      ORDER BY date DESC
    `, [aff.id, fromDt, toDt]);

    const totals = await queryOne(`
      SELECT COUNT(*) as total_clicks, COUNT(*) FILTER (WHERE converted=true) as total_conversions
      FROM affiliate_clicks WHERE affiliate_id = $1
    `, [aff.id]);

    res.json({
      rows: rows.map(r => ({ ...r, clicks: parseInt(r.clicks), conversions: parseInt(r.conversions) })),
      total_clicks: parseInt(totals.total_clicks),
      total_conversions: parseInt(totals.total_conversions),
    });
  } catch(e) { console.error('[affiliate/clicks]', e.message); res.status(500).json({ error: 'Server error' }); }
});


// ── trackRegistration — exported for auth.js ─────────────────────────────────
async function trackRegistration(userId, userEmail, refCode) {
  try {
    if (!refCode) return;
    const aff = await queryOne(
      'SELECT * FROM affiliates WHERE ref_code = $1 AND status = $2', [refCode, 'active']
    );
    if (!aff) return;

    // Avoid double-attribution
    const existing = await queryOne(
      'SELECT id FROM affiliate_referrals WHERE referred_user_id = $1', [userId]
    );
    if (existing) return;

    await query(`
      INSERT INTO affiliate_referrals (id, affiliate_id, referred_user_id, referred_user_email, status)
      VALUES ($1, $2, $3, $4, 'registered')
      ON CONFLICT DO NOTHING
    `, [uuidv4(), aff.id, userId, userEmail]);

    // Mark click as converted (last click wins)
    await query(`
      UPDATE affiliate_clicks SET converted = true, converted_user_id = $1, converted_at = NOW()
      WHERE ref_code = $2 AND converted = false
      ORDER BY created_at DESC
      LIMIT 1
    `, [userId, refCode]);

    console.log('[affiliate] tracked registration:', userEmail, '→', refCode);
  } catch(e) { console.error('[affiliate/trackRegistration]', e.message); }
}


module.exports = router;
module.exports.trackRegistration = trackRegistration;
module.exports.betSettled = betSettled;

