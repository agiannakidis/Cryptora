const express = require('express');
const router = express.Router();
const { query, queryAll, queryOne } = require('../pgdb');
const { authMiddleware } = require('../middleware/auth');

// ── Helper ──────────────────────────────────────────────────────────────────
function days(period) {
  return period === '1d' ? 1 : period === '30d' ? 30 : period === '90d' ? 90 : 7;
}

// ── POST /api/analytics/track ───────────────────────────────────────────────
router.post('/track', async (req, res) => {
  try {
    const {
      sessionId, event, page, extra, userId,
      referrer, landingPage,
      utmSource, utmMedium, utmCampaign, utmTerm, utmContent
    } = req.body;

    if (!sessionId || !event) return res.json({ ok: false, error: 'missing params' });

    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const userAgent = req.headers['user-agent'] || '';

    // On 'visit' event — create session record if new
    if (event === 'visit') {
      const existing = await query('SELECT id FROM visits WHERE session_id=$1 LIMIT 1', [sessionId]);
      if (existing.rows.length === 0) {
        await query(
          `INSERT INTO visits (session_id, ip, user_agent, referrer, landing_page, utm_source, utm_medium, utm_campaign, utm_term, utm_content, user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [sessionId, ip, userAgent, referrer || null, landingPage || null,
           utmSource || null, utmMedium || null, utmCampaign || null, utmTerm || null, utmContent || null,
           userId || null]
        );
      } else if (userId) {
        await query('UPDATE visits SET user_id=$1 WHERE session_id=$2 AND user_id IS NULL', [userId, sessionId]);
      }
    }

    // Link user_id to session on any authenticated event
    if (userId) {
      await query('UPDATE visits SET user_id=$1 WHERE session_id=$2 AND user_id IS NULL', [userId, sessionId]);
    }

    // Log event
    await query(
      `INSERT INTO visit_events (session_id, event_type, page, extra, user_id) VALUES ($1,$2,$3,$4,$5)`,
      [sessionId, event, page || null, extra ? JSON.stringify(extra) : null, userId || null]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error('Analytics track error:', e.message);
    res.json({ ok: false, error: e.message });
  }
});

// ── GET /api/analytics/stats?period=7d ─────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const d = days(req.query.period || '7d');
    const since = `NOW() - INTERVAL '${d} days'`;

    const [
      visits,
      events,
      topReferrers,
      topUtm,
      topPages,
      registrations,   // from users table — real data
      gameSessions,    // from game_sessions table — real data
      dailyVisits,
      newUsers,        // daily new registrations
      conversion,
      topGames,        // most played games
      deposits,        // from ClickHouse
    ] = await Promise.all([
      // Unique visitor sessions
      query(`SELECT COUNT(DISTINCT session_id) as total FROM visits WHERE created_at >= ${since}`),
      // Event breakdown from tracker
      query(`SELECT event_type, COUNT(*) as cnt FROM visit_events WHERE created_at >= ${since} GROUP BY event_type ORDER BY cnt DESC`),
      // Top traffic sources
      query(`SELECT COALESCE(referrer, 'Direct') as referrer, COUNT(*) as cnt FROM visits WHERE created_at >= ${since} GROUP BY referrer ORDER BY cnt DESC LIMIT 10`),
      // UTM breakdown
      query(`SELECT COALESCE(utm_source, '—') as source, COALESCE(utm_medium, '—') as medium, COALESCE(utm_campaign, '—') as campaign, COUNT(*) as cnt FROM visits WHERE created_at >= ${since} GROUP BY utm_source, utm_medium, utm_campaign ORDER BY cnt DESC LIMIT 10`),
      // Top pages
      query(`SELECT page, COUNT(*) as cnt FROM visit_events WHERE event_type='pageview' AND created_at >= ${since} GROUP BY page ORDER BY cnt DESC LIMIT 10`),
      // Registrations from users table (source of truth)
      query(`SELECT COUNT(*) as cnt FROM users WHERE role='player' AND created_date >= ${since}`),
      // Game sessions started
      query(`SELECT COUNT(*) as cnt FROM game_sessions WHERE created_date >= ${since}`),
      // Daily unique visits
      query(`SELECT DATE(created_at AT TIME ZONE 'UTC') as day, COUNT(DISTINCT session_id) as cnt FROM visits WHERE created_at >= ${since} GROUP BY day ORDER BY day`),
      // Daily new registrations
      query(`SELECT DATE(created_date AT TIME ZONE 'UTC') as day, COUNT(*) as cnt FROM users WHERE role='player' AND created_date >= ${since} GROUP BY day ORDER BY day`),
      // Conversion: sessions with identified users / total sessions
      query(`SELECT
        COUNT(DISTINCT CASE WHEN user_id IS NOT NULL THEN session_id END) as converted,
        COUNT(DISTINCT session_id) as total
        FROM visits WHERE created_at >= ${since}`),
      // Top 5 games played
      query(`SELECT game_title, COUNT(*) as cnt FROM game_sessions WHERE created_date >= ${since} GROUP BY game_title ORDER BY cnt DESC LIMIT 5`),
      // Deposits from ClickHouse via HTTP
      fetch(`http://localhost:8123/?query=SELECT+COUNT(*)+as+cnt,+SUM(amount_usd)+as+vol+FROM+casino.crypto_deposits+WHERE+created_at+%3E%3D+now()-${d}*86400&default_format=JSON`)
        .then(r => r.json())
        .catch(() => ({ data: [{ cnt: 0, vol: 0 }] })),
    ]);

    const depData = deposits?.data?.[0] || { cnt: 0, vol: 0 };
    const convPct = conversion.rows[0]?.total > 0
      ? ((conversion.rows[0].converted / conversion.rows[0].total) * 100).toFixed(1)
      : '0.0';

    res.json({
      ok: true,
      period: d,
      totalVisits:   parseInt(visits.rows[0]?.total || 0),
      registrations: parseInt(registrations.rows[0]?.cnt || 0),
      gameSessions:  parseInt(gameSessions.rows[0]?.cnt || 0),
      deposits:      parseInt(depData.cnt || 0),
      depositVolume: parseFloat(depData.vol || 0).toFixed(2),
      conversionPct: convPct,
      events:        events.rows,
      topReferrers:  topReferrers.rows,
      topUtm:        topUtm.rows,
      topPages:      topPages.rows,
      topGames:      topGames.rows,
      dailyVisits:   dailyVisits.rows,
      dailyNewUsers: newUsers.rows,
      conversion:    conversion.rows[0],
    });
  } catch (e) {
    console.error('Analytics stats error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── GET /api/analytics/sessions ────────────────────────────────────────────
router.get('/sessions', async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit || 50), 200);
    const offset = (parseInt(req.query.page || 1) - 1) * limit;
    const d      = days(req.query.period || '7d');

    const rows = await query(`
      SELECT
        v.session_id, v.ip, v.referrer, v.landing_page,
        v.utm_source, v.utm_medium, v.utm_campaign,
        v.user_id, u.email, u.name,
        v.created_at,
        (SELECT COUNT(*) FROM visit_events ve WHERE ve.session_id=v.session_id) as event_count,
        (SELECT COUNT(*) FROM game_sessions gs WHERE gs.user_id=v.user_id AND gs.created_date >= NOW() - INTERVAL '${d} days') as games_played,
        (SELECT COUNT(*) FROM visit_events ve WHERE ve.session_id=v.session_id AND ve.event_type='deposit') as deposits
      FROM visits v
      LEFT JOIN users u ON u.id = v.user_id
      WHERE v.created_at >= NOW() - INTERVAL '${d} days'
      ORDER BY v.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    const total = await query(`SELECT COUNT(*) as cnt FROM visits WHERE created_at >= NOW() - INTERVAL '${d} days'`);

    res.json({ ok: true, sessions: rows.rows, total: parseInt(total.rows[0]?.cnt || 0) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── GET /api/analytics/audit-log — admin action history ─────────────────────
router.get('/audit-log', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const limit  = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;
    const { entity, admin_id, from, to } = req.query;

    const conditions = [];
    const params = [];
    let i = 1;

    if (entity) { conditions.push(`entity = $${i++}`); params.push(entity); }
    if (admin_id) { conditions.push(`admin_id = $${i++}`); params.push(admin_id); }
    if (from) { conditions.push(`created_at >= $${i++}`); params.push(from); }
    if (to)   { conditions.push(`created_at <= $${i++}`); params.push(to + ' 23:59:59'); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const rows = await queryAll(
      `SELECT id, admin_id, admin_email, action, entity, entity_id,
              changes, ip_address, created_at
       FROM admin_audit_log
       ${where}
       ORDER BY created_at DESC
       LIMIT $${i} OFFSET $${i+1}`,
      [...params, limit, offset]
    );
    const total = await queryOne(
      `SELECT COUNT(*) as cnt FROM admin_audit_log ${where}`, params
    );
    res.json({ rows, total: parseInt(total?.cnt || 0) });
  } catch(e) {
    console.error('[audit-log]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});


// ── GET /api/analytics/bi — BI Dashboard (GGR/NGR/ARPU from ClickHouse) ──────
router.get('/bi', authMiddleware, async (req, res) => {
  try {
    const { queryAll: chQuery } = require('../chdb');
    const { queryOne: pgOne, queryAll: pgAll } = require('../pgdb');
    const period = req.query.period || '30d';
    const d = days(period);

    // Parallel queries: ClickHouse + PostgreSQL
    const [
      ggrData, dailyGgr, topGames, topPlayers, topProviders,
      activeUsers, newUsers, depositsData, bonusData
    ] = await Promise.all([
      // Overall GGR/NGR
      chQuery(`
        SELECT
          sum(bet_amount) AS total_bets,
          sum(win_amount) AS total_wins,
          sum(bet_amount) - sum(win_amount) AS ggr,
          count() AS total_rounds,
          countDistinct(user_id) AS active_players
        FROM casino.bets
        WHERE created_at >= now() - INTERVAL ${d} DAY
      `),

      // Daily GGR breakdown
      chQuery(`
        SELECT
          toDate(created_at) AS day,
          sum(bet_amount) AS bets,
          sum(win_amount) AS wins,
          sum(bet_amount) - sum(win_amount) AS ggr,
          countDistinct(user_id) AS players
        FROM casino.bets
        WHERE created_at >= now() - INTERVAL ${d} DAY
        GROUP BY day
        ORDER BY day ASC
      `),

      // Top games by GGR
      chQuery(`
        SELECT
          game_title,
          provider,
          sum(bet_amount) AS bets,
          sum(win_amount) AS wins,
          sum(bet_amount) - sum(win_amount) AS ggr,
          count() AS rounds,
          countDistinct(user_id) AS players
        FROM casino.bets
        WHERE created_at >= now() - INTERVAL ${d} DAY
        GROUP BY game_title, provider
        ORDER BY ggr DESC
        LIMIT 15
      `),

      // Top players by GGR contribution
      chQuery(`
        SELECT
          user_email,
          sum(bet_amount) AS bets,
          sum(win_amount) AS wins,
          sum(bet_amount) - sum(win_amount) AS ggr,
          count() AS rounds
        FROM casino.bets
        WHERE created_at >= now() - INTERVAL ${d} DAY
        GROUP BY user_email
        ORDER BY ggr DESC
        LIMIT 10
      `),

      // Top providers by GGR
      chQuery(`
        SELECT
          provider,
          sum(bet_amount) AS bets,
          sum(win_amount) AS wins,
          sum(bet_amount) - sum(win_amount) AS ggr,
          countDistinct(game_id) AS games,
          countDistinct(user_id) AS players,
          count() AS rounds
        FROM casino.bets
        WHERE created_at >= now() - INTERVAL ${d} DAY
        GROUP BY provider
        ORDER BY ggr DESC
      `),

      // Active users (PostgreSQL)
      pgOne(`SELECT COUNT(DISTINCT id) as cnt FROM users WHERE role='player' AND created_date >= NOW() - INTERVAL '${d} days'`),

      // New registrations
      pgOne(`SELECT COUNT(*) as cnt FROM users WHERE role='player' AND created_date >= NOW() - INTERVAL '${d} days'`),

      // Deposit volume (ClickHouse)
      chQuery(`
        SELECT
          count() AS cnt,
          sum(amount_usd) AS volume
        FROM casino.crypto_deposits
        WHERE created_at >= now() - INTERVAL ${d} DAY
          AND status = 'credited'
      `),

      // Bonus stats (PostgreSQL)
      pgOne(`
        SELECT
          COUNT(*) as bonuses_claimed,
          COALESCE(SUM(bonus_amount), 0) as bonus_total
        FROM promotions
        WHERE status = 'active' OR status = 'completed'
      `).catch(() => ({ bonuses_claimed: 0, bonus_total: 0 })),
    ]);

    const ggr = ggrData[0] || {};
    const ggrVal = parseFloat(ggr.ggr || 0);
    const bonusTotal = parseFloat(bonusData?.bonus_total || 0);
    const ngrVal = ggrVal - bonusTotal;
    const activePlayers = parseInt(ggr.active_players || 0);
    const arpuVal = activePlayers > 0 ? (ggrVal / activePlayers) : 0;

    res.json({
      ok: true,
      period,
      summary: {
        ggr:           parseFloat(ggrVal.toFixed(2)),
        ngr:           parseFloat(ngrVal.toFixed(2)),
        arpu:          parseFloat(arpuVal.toFixed(2)),
        totalBets:     parseFloat(parseFloat(ggr.total_bets || 0).toFixed(2)),
        totalWins:     parseFloat(parseFloat(ggr.total_wins || 0).toFixed(2)),
        totalRounds:   parseInt(ggr.total_rounds || 0),
        activePlayers: activePlayers,
        newPlayers:    parseInt(newUsers?.cnt || 0),
        deposits:      parseInt(depositsData[0]?.cnt || 0),
        depositVolume: parseFloat(parseFloat(depositsData[0]?.volume || 0).toFixed(2)),
        bonusCost:     parseFloat(bonusTotal.toFixed(2)),
      },
      dailyGgr,
      topGames,
      topPlayers: topPlayers.map(p => ({ ...p, user_email: p.user_email.replace(/(?<=.{2}).+(?=@)/, '***') })),
      topProviders,
    });
  } catch(e) {
    console.error('[bi]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
