const express = require('express');
const { validateAmount } = require('../utils/validators');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { queryOne, queryAll, query } = require('../pgdb');
const { authMiddleware } = require('../middleware/auth');
let sendVerificationCode;
try { ({ sendVerificationCode } = require('../email')); } catch(e) { sendVerificationCode = async (email, code) => { console.log('[EMAIL-FALLBACK] code for', email, ':', code); }; }
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || '3135b75346a97155548cc44066544d15ad492e688ed87a173dee33916e626087';

function affAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.type !== 'affiliate') return res.status(403).json({ error: 'Not an affiliate token' });
    req.affAccount = payload;
    next();
  } catch(e) { return res.status(401).json({ error: 'Invalid token' }); }
}

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
router.get('/me', affAuth, async (req, res) => {
  try {
    const aff = await queryOne('SELECT * FROM affiliates WHERE account_id = $1', [req.affAccount.id]);
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
router.post('/apply', affAuth, async (req, res) => {
  try {
    const existing = await queryOne('SELECT id, ref_code FROM affiliates WHERE account_id = $1', [req.affAccount.id]);
    if (existing) return res.status(409).json({ error: 'Already an affiliate', ref_code: existing.ref_code });

    const { postback_url } = req.body;
    const acc = await queryOne('SELECT name, email FROM affiliate_accounts WHERE id=$1', [req.affAccount.id]);
    const ref_code = genRefCode(acc?.name || acc?.email || 'AFF');
    const id = uuidv4();

    await query(
      'INSERT INTO affiliates (id, account_id, ref_code, postback_url) VALUES ($1, $2, $3, $4)',
      [id, req.affAccount.id, ref_code, postback_url || null]
    );

    res.json({ ok: true, ref_code, ref_link: `https://cryptora.live/?ref=${ref_code}` });
  } catch (e) { console.error('[affiliate/apply]', e.message); res.status(500).json({ error: 'Server error' }); }
});

// GET /api/affiliate/referrals
router.get('/referrals', affAuth, async (req, res) => {
  try {
    const aff = await queryOne('SELECT id FROM affiliates WHERE account_id = $1', [req.affAccount.id]);
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

// GET /api/affiliate/earnings?from=&to=&limit=
router.get('/earnings', affAuth, async (req, res) => {
  try {
    const aff = await queryOne('SELECT id FROM affiliates WHERE account_id = $1', [req.affAccount.id]);
    if (!aff) return res.status(403).json({ error: 'Not an affiliate' });

    const { from = '2020-01-01', to, limit = 500 } = req.query;
    const toDate = to || new Date().toISOString().slice(0, 10);

    const rows = await queryAll(`
      SELECT e.*, u.name as user_name, u.email as referred_email
      FROM affiliate_earnings e
      LEFT JOIN users u ON u.id = e.referred_user_id
      WHERE e.affiliate_id = $1
        AND e.created_date >= $2::date
        AND e.created_date < ($3::date + INTERVAL '1 day')
      ORDER BY e.created_date DESC
      LIMIT $4
    `, [aff.id, from, toDate, parseInt(limit)]);

    res.json(rows.map(r => ({ ...r, amount: parseFloat(r.amount) })));
  } catch (e) { console.error('[affiliate/earnings]', e.message); res.status(500).json({ error: 'Server error' }); }
});

// GET /api/affiliate/stats?from=&to=  — NGR stats for affiliate dashboard
router.get('/stats', affAuth, async (req, res) => {
  try {
    const aff = await queryOne('SELECT * FROM affiliates WHERE account_id = $1', [req.affAccount.id]);
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

// (old /admin/list removed)
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
    const amtCheck = validateAmount(amount, { min: 0.01, max: 1000000 });
    if (!amtCheck.valid) return res.status(400).json({ error: amtCheck.error });
    const validAmt = amtCheck.value;
    const aff = await queryOne('SELECT * FROM affiliates WHERE id = $1', [req.params.id]);
    if (!aff) return res.status(404).json({ error: 'Not found' });

    const balance = parseFloat(aff.total_earned) - parseFloat(aff.total_paid);
    if (validAmt > balance)
      return res.status(400).json({ error: `Balance is only $${balance.toFixed(2)}` });

    await query('UPDATE affiliates SET total_paid = total_paid + $1 WHERE id = $2',
      [validAmt, aff.id]);
    await query(
      `INSERT INTO affiliate_earnings (id, affiliate_id, type, amount, description)
       VALUES ($1, $2, 'payout', $3, 'Payout by admin')`,
      [uuidv4(), aff.id, -validAmt]
    );

    res.json({ ok: true, new_balance: balance - validAmt });
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
router.get('/clicks', affAuth, async (req, res) => {
  try {
    const aff = await queryOne('SELECT id FROM affiliates WHERE account_id = $1', [req.affAccount.id]);
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



// ── Commission endpoints ──────────────────────────────────────────────────────

// GET /api/affiliate/commissions — affiliate sees own commissions
router.get('/commissions', affAuth, async (req, res) => {
  try {
    const aff = await queryOne('SELECT id FROM affiliates WHERE account_id = $1', [req.affAccount.id]);
    if (!aff) return res.status(403).json({ error: 'Not an affiliate' });

    const rows = await queryAll(`
      SELECT id, period_start, period_end, total_ggr, revshare_percent, amount, status, paid_at, created_at
      FROM affiliate_commissions WHERE affiliate_id = $1
      ORDER BY period_start DESC
    `, [aff.id]);

    res.json(rows.map(r => ({
      ...r,
      total_ggr: parseFloat(r.total_ggr),
      revshare_percent: parseFloat(r.revshare_percent),
      amount: parseFloat(r.amount),
    })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// GET /api/affiliate/admin/list — all affiliates with user info
router.get('/admin/list', adminAuth, async (req, res) => {
  try {
    const { status } = req.query;
    const rows = await queryAll(`
      SELECT a.*, u.name as affiliate_name, u.email as affiliate_email,
        (SELECT COUNT(*) FROM affiliate_referrals ar WHERE ar.affiliate_id = a.id) as referral_count,
        (SELECT COUNT(*) FROM affiliate_referrals ar WHERE ar.affiliate_id = a.id AND ar.status != 'registered') as depositor_count
      FROM affiliates a
      JOIN users u ON u.id = a.user_id
      ${status ? 'WHERE a.status = $1' : ''}
      ORDER BY a.created_date DESC
    `, status ? [status] : []);

    res.json(rows.map(r => ({
      ...r,
      revshare_percent: parseFloat(r.revshare_percent),
      cpa_amount: parseFloat(r.cpa_amount),
      total_earned: parseFloat(r.total_earned),
      total_paid: parseFloat(r.total_paid),
      referral_count: parseInt(r.referral_count),
      depositor_count: parseInt(r.depositor_count),
    })));
  } catch(e) { console.error('[affiliate/admin/list]', e.message); res.status(500).json({ error: e.message }); }
});

// PATCH /api/affiliate/admin/affiliates/:id — update revshare % and status
router.patch('/admin/affiliates/:id', adminAuth, async (req, res) => {
  try {
    const { revshare_percent, status, notes } = req.body;
    const aff = await queryOne('SELECT id FROM affiliates WHERE id = $1', [req.params.id]);
    if (!aff) return res.status(404).json({ error: 'Affiliate not found' });

    const updates = [];
    const vals = [];
    let idx = 1;

    if (revshare_percent !== undefined) { updates.push('revshare_percent=$' + idx++); vals.push(parseFloat(revshare_percent)); }
    if (status !== undefined) { updates.push('status=$' + idx++); vals.push(status); }
    if (notes !== undefined) { updates.push('notes=$' + idx++); vals.push(notes); }

    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(req.params.id);

    await query('UPDATE affiliates SET ' + updates.join(', ') + ' WHERE id=$' + idx, vals);
    res.json({ ok: true });
  } catch(e) { console.error('[affiliate/admin/affiliates]', e.message); res.status(500).json({ error: e.message }); }
});

// GET /api/affiliate/admin/commissions — admin view all
router.get('/admin/commissions', adminAuth, async (req, res) => {
  try {
    const { status } = req.query;
    const rows = await queryAll(`
      SELECT ac.*, u.email as affiliate_email, u.name as affiliate_name, a.ref_code
      FROM affiliate_commissions ac
      JOIN affiliates a ON a.id = ac.affiliate_id
      JOIN users u ON u.id = a.user_id
      ${status ? "WHERE ac.status = $1" : "WHERE 1=1"}
      ORDER BY ac.period_start DESC, ac.created_at DESC
    `, status ? [status] : []);

    res.json(rows.map(r => ({
      ...r,
      total_ggr: parseFloat(r.total_ggr),
      revshare_percent: parseFloat(r.revshare_percent),
      amount: parseFloat(r.amount),
    })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/affiliate/admin/commissions/run — trigger cron manually
router.post('/admin/commissions/run', adminAuth, async (req, res) => {
  try {
    const { period_start, period_end } = req.body;
    const { runCommissionCron } = require('../cron/affiliateCommissions');
    const result = await runCommissionCron(period_start, period_end);
    res.json({ ok: true, ...result });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/affiliate/admin/commissions/:id — approve/pay/reject
router.patch('/admin/commissions/:id', adminAuth, async (req, res) => {
  try {
    const { status, notes } = req.body;
    const allowed = ['approved', 'paid', 'rejected'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const comm = await queryOne('SELECT * FROM affiliate_commissions WHERE id = $1', [req.params.id]);
    if (!comm) return res.status(404).json({ error: 'Not found' });

    const paid_at = status === 'paid' ? new Date().toISOString() : null;
    const paid_by = status === 'paid' ? req.user.id : null;

    await query(`
      UPDATE affiliate_commissions SET status=$1, paid_at=$2, paid_by=$3, notes=COALESCE($4, notes)
      WHERE id=$5
    `, [status, paid_at, paid_by, notes || null, req.params.id]);

    // If paid → update affiliate total_paid
    if (status === 'paid') {
      await query('UPDATE affiliates SET total_paid = total_paid + $1 WHERE id = $2',
        [parseFloat(comm.amount), comm.affiliate_id]);
    }

    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// POST /api/affiliate/auth/register
router.post('/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const existing = await queryOne('SELECT id, email_confirmed FROM affiliate_accounts WHERE email=$1', [email.toLowerCase()]);
    if (existing && existing.email_confirmed) return res.status(409).json({ error: 'Email already registered' });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const hash = await bcrypt.hash(password, 10);

    if (existing) {
      // Resend code for unconfirmed account
      await query(
        'UPDATE affiliate_accounts SET password_hash=$1, name=$2, confirm_code=$3, confirm_code_expires=$4 WHERE id=$5',
        [hash, name || existing.name, code, expires, existing.id]
      );
    } else {
      await query(
        'INSERT INTO affiliate_accounts (email, password_hash, name, email_confirmed, confirm_code, confirm_code_expires) VALUES ($1,$2,$3,false,$4,$5)',
        [email.toLowerCase(), hash, name || email.split('@')[0], code, expires]
      );
    }

    await sendVerificationCode(email.toLowerCase(), code);
    res.json({ ok: true, pending: true, email: email.toLowerCase() });
  } catch(e) { console.error('[aff/register]', e.message); res.status(500).json({ error: e.message }); }
});

// POST /api/affiliate/auth/confirm
router.post('/auth/confirm', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: 'Email and code required' });

    const acc = await queryOne(
      'SELECT * FROM affiliate_accounts WHERE email=$1',
      [email.toLowerCase()]
    );
    if (!acc) return res.status(404).json({ error: 'Account not found' });
    if (acc.email_confirmed) return res.status(409).json({ error: 'Already confirmed' });
    if (!acc.confirm_code || acc.confirm_code !== String(code).trim())
      return res.status(400).json({ error: 'Invalid code' });
    if (new Date(acc.confirm_code_expires) < new Date())
      return res.status(400).json({ error: 'Code expired. Please register again.' });

    // Confirm + create affiliate record
    await query(
      'UPDATE affiliate_accounts SET email_confirmed=true, confirm_code=NULL, confirm_code_expires=NULL WHERE id=$1',
      [acc.id]
    );

    const ref_code = genRefCode(acc.name);
    await query(
      'INSERT INTO affiliates (id, account_id, ref_code) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [uuidv4(), acc.id, ref_code]
    );

    const token = jwt.sign({ id: acc.id, email: acc.email, type: 'affiliate' }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ ok: true, token, account: { id: acc.id, email: acc.email, name: acc.name } });
  } catch(e) { console.error('[aff/confirm]', e.message); res.status(500).json({ error: e.message }); }
});

// POST /api/affiliate/auth/resend-code
router.post('/auth/resend-code', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const acc = await queryOne('SELECT * FROM affiliate_accounts WHERE email=$1', [email.toLowerCase()]);
    if (!acc) return res.status(404).json({ error: 'Account not found' });
    if (acc.email_confirmed) return res.status(409).json({ error: 'Already confirmed' });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await query('UPDATE affiliate_accounts SET confirm_code=$1, confirm_code_expires=$2 WHERE id=$3', [code, expires, acc.id]);
    await sendVerificationCode(email.toLowerCase(), code);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/affiliate/auth/login
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const acc = await queryOne('SELECT * FROM affiliate_accounts WHERE email=$1', [email.toLowerCase()]);
    if (!acc) return res.status(401).json({ error: 'Invalid credentials' });
    if (acc.status === 'suspended') return res.status(403).json({ error: 'Account suspended' });
    if (!acc.email_confirmed) return res.status(403).json({ error: 'Please confirm your email first', pending: true, email: acc.email });

    const ok = await bcrypt.compare(password, acc.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: acc.id, email: acc.email, type: 'affiliate' }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ ok: true, token, account: { id: acc.id, email: acc.email, name: acc.name } });
  } catch(e) { console.error('[aff/login]', e.message); res.status(500).json({ error: e.message }); }
});

// GET /api/affiliate/auth/me
router.get('/auth/me', affAuth, async (req, res) => {
  try {
    const acc = await queryOne('SELECT id, email, name, status, created_at FROM affiliate_accounts WHERE id=$1', [req.affAccount.id]);
    if (!acc) return res.status(404).json({ error: 'Not found' });
    const aff = await queryOne('SELECT * FROM affiliates WHERE account_id=$1', [acc.id]);
    res.json({ ...acc, affiliate: aff || null });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


module.exports = router;
module.exports.trackRegistration = trackRegistration;
module.exports.betSettled = betSettled;

