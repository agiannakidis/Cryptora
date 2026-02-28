/**
 * Full migration: SQLite → PostgreSQL + ClickHouse
 * Migrates remaining tables + updates users with all columns
 */
require('dotenv').config();

const Database = require('better-sqlite3');
const path = require('path');
const { Pool } = require('pg');
const { createClient } = require('@clickhouse/client');

const sqlite = new Database(path.join(__dirname, '../casino.db'));
const pg = new Pool({
  host: process.env.PG_HOST || 'localhost',
  database: process.env.PG_DATABASE || 'casino_db',
  user: process.env.PG_USER || 'casino',
  password: process.env.PG_PASSWORD || 'casino_pg_2026',
});
const ch = createClient({
  url: process.env.CH_HOST || 'http://localhost:8123',
  database: process.env.CH_DATABASE || 'casino',
  username: process.env.CH_USER || 'default',
  password: process.env.CH_PASSWORD || '',
});

function ts(val) {
  if (!val) return null;
  try { return new Date(val).toISOString(); } catch { return null; }
}

async function run() {
  console.log('🚀 Full migration: SQLite → PostgreSQL + ClickHouse\n');

  // ── Users (full update with all columns) ─────────────────────────────
  console.log('👤 Updating users (full columns)...');
  const users = sqlite.prepare('SELECT * FROM users').all();
  for (const u of users) {
    await pg.query(`
      INSERT INTO users (
        id, email, password_hash, name, role, balance, currency, preferred_currency,
        favorite_games, created_date, updated_date,
        bonus_balance, vip_level, vip_points, total_wagered,
        wagering_required, wagering_progress, wagering_bonus_amount, bonus_expires_at,
        email_verified, email_verification_token, email_verification_expires,
        telegram_id, telegram_username, avatar_url,
        phone, phone_verified, referred_by, affiliate_balance,
        deposit_limit_daily, deposit_limit_weekly, deposit_limit_monthly,
        loss_limit_daily, loss_limit_weekly, loss_limit_monthly,
        wager_limit_daily, session_limit_minutes,
        self_excluded_until, self_excluded_permanent
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,
        $12,$13,$14,$15,$16,$17,$18,$19,
        $20,$21,$22,$23,$24,$25,$26,$27,$28,$29,
        $30,$31,$32,$33,$34,$35,$36,$37,$38,$39
      )
      ON CONFLICT (id) DO UPDATE SET
        balance = EXCLUDED.balance,
        bonus_balance = EXCLUDED.bonus_balance,
        vip_level = EXCLUDED.vip_level,
        vip_points = EXCLUDED.vip_points,
        total_wagered = EXCLUDED.total_wagered,
        email_verified = EXCLUDED.email_verified,
        updated_date = EXCLUDED.updated_date
    `, [
      u.id, u.email, u.password_hash, u.name, u.role || 'player',
      u.balance || 0, u.currency || 'USD', u.preferred_currency,
      u.favorite_games || '[]',
      ts(u.created_date) || new Date().toISOString(),
      ts(u.updated_date) || new Date().toISOString(),
      u.bonus_balance || 0, u.vip_level || 0, u.vip_points || 0, u.total_wagered || 0,
      u.wagering_required || 0, u.wagering_progress || 0,
      u.wagering_bonus_amount || 0, ts(u.bonus_expires_at),
      !!u.email_verified, u.email_verification_token, ts(u.email_verification_expires),
      u.telegram_id, u.telegram_username, u.avatar_url,
      u.phone, !!u.phone_verified, u.referred_by, u.affiliate_balance || 0,
      u.deposit_limit_daily, u.deposit_limit_weekly, u.deposit_limit_monthly,
      u.loss_limit_daily, u.loss_limit_weekly, u.loss_limit_monthly,
      u.wager_limit_daily, u.session_limit_minutes,
      ts(u.self_excluded_until), !!u.self_excluded_permanent,
    ]);
  }
  console.log(`  ✅ ${users.length} users`);

  // ── Games (update with all columns) ──────────────────────────────────
  console.log('🎮 Updating games...');
  const games = sqlite.prepare('SELECT * FROM games').all();
  for (const g of games) {
    await pg.query(`
      INSERT INTO games (id, title, provider, category, thumbnail, is_enabled, is_featured,
        game_id, provider_game_id, rtp, launch_url, slug, has_jackpot, min_bet, max_bet, play_count,
        created_date, updated_date)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT (id) DO UPDATE SET
        play_count = EXCLUDED.play_count,
        is_enabled = EXCLUDED.is_enabled,
        updated_date = EXCLUDED.updated_date
    `, [
      g.id, g.title, g.provider, g.category || 'slots', g.thumbnail,
      g.is_enabled !== 0, g.is_featured !== 0,
      g.game_id, g.provider_game_id, g.rtp,
      g.launch_url, g.slug, !!g.has_jackpot,
      g.min_bet || 0, g.max_bet || 1000, g.play_count || 0,
      ts(g.created_date) || new Date().toISOString(),
      ts(g.updated_date) || new Date().toISOString(),
    ]);
  }
  console.log(`  ✅ ${games.length} games`);

  // ── Promotion claims ──────────────────────────────────────────────────
  console.log('🎁 Migrating promotion_claims...');
  const claims = sqlite.prepare('SELECT * FROM promotion_claims').all();
  for (const c of claims) {
    await pg.query(`
      INSERT INTO promotion_claims (id, user_id, user_email, promotion_id, bonus_amount, status, claimed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING
    `, [c.id, c.user_id, c.user_email, c.promotion_id, c.bonus_amount || 0, c.status || 'active', ts(c.claimed_at)]);
  }
  console.log(`  ✅ ${claims.length} claims`);

  // ── Affiliates ────────────────────────────────────────────────────────
  console.log('🤝 Migrating affiliates...');
  const affiliates = sqlite.prepare('SELECT * FROM affiliates').all();
  for (const a of affiliates) {
    await pg.query(`
      INSERT INTO affiliates (id, user_id, ref_code, status, commission_type, cpa_amount,
        revshare_percent, total_earned, total_paid, postback_url, notes, created_date)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (id) DO NOTHING
    `, [a.id, a.user_id, a.ref_code, a.status || 'active', a.commission_type || 'hybrid',
      a.cpa_amount || 20, a.revshare_percent || 25, a.total_earned || 0, a.total_paid || 0,
      a.postback_url, a.notes, ts(a.created_date)]);
  }
  console.log(`  ✅ ${affiliates.length} affiliates`);

  // ── Affiliate referrals ───────────────────────────────────────────────
  console.log('🔗 Migrating affiliate_referrals...');
  const refs = sqlite.prepare('SELECT * FROM affiliate_referrals').all();
  for (const r of refs) {
    await pg.query(`
      INSERT INTO affiliate_referrals (id, affiliate_id, referred_user_id, referred_user_email,
        status, first_deposit_amount, first_deposit_date, cpa_paid, total_wagered, total_ggr, created_date)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING
    `, [r.id, r.affiliate_id, r.referred_user_id, r.referred_user_email,
      r.status || 'registered', r.first_deposit_amount || 0, ts(r.first_deposit_date),
      !!r.cpa_paid, r.total_wagered || 0, r.total_ggr || 0, ts(r.created_date)]);
  }
  console.log(`  ✅ ${refs.length} referrals`);

  // ── Affiliate earnings ────────────────────────────────────────────────
  console.log('💰 Migrating affiliate_earnings...');
  const earnings = sqlite.prepare('SELECT * FROM affiliate_earnings').all();
  for (const e of earnings) {
    await pg.query(`
      INSERT INTO affiliate_earnings (id, affiliate_id, referred_user_id, type, amount, description, created_date)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING
    `, [e.id, e.affiliate_id, e.referred_user_id, e.type, e.amount || 0, e.description, ts(e.created_date)]);
  }
  console.log(`  ✅ ${earnings.length} earnings`);

  // ── RG daily stats ────────────────────────────────────────────────────
  console.log('🛡️ Migrating rg_daily_stats...');
  const rgStats = sqlite.prepare('SELECT * FROM rg_daily_stats').all();
  for (const r of rgStats) {
    await pg.query(`
      INSERT INTO rg_daily_stats (user_id, date, deposited, lost, wagered)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (user_id, date) DO UPDATE SET deposited=EXCLUDED.deposited, lost=EXCLUDED.lost, wagered=EXCLUDED.wagered
    `, [r.user_id, r.date, r.deposited || 0, r.lost || 0, r.wagered || 0]);
  }
  console.log(`  ✅ ${rgStats.length} rg stats`);

  // ── Jackpot ───────────────────────────────────────────────────────────
  console.log('🎰 Migrating jackpot...');
  const jackpots = sqlite.prepare('SELECT * FROM jackpot').all();
  for (const j of jackpots) {
    await pg.query(`
      INSERT INTO jackpot (id, amount, seed_amount, contribution_rate, total_contributed,
        last_won_at, last_winner_email, last_winner_amount, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO UPDATE SET
        amount = EXCLUDED.amount, total_contributed = EXCLUDED.total_contributed
    `, [j.id, j.amount || 10000, j.seed_amount || 5000, j.contribution_rate || 0.0001,
      j.total_contributed || 0, ts(j.last_won_at), j.last_winner_email,
      j.last_winner_amount, ts(j.updated_at)]);
  }
  console.log(`  ✅ ${jackpots.length} jackpot entries`);

  // ── Jackpot winners ───────────────────────────────────────────────────
  console.log('🏆 Migrating jackpot_winners...');
  const jWinners = sqlite.prepare('SELECT * FROM jackpot_winners').all();
  for (const w of jWinners) {
    await pg.query(`
      INSERT INTO jackpot_winners (id, user_id, user_email, amount, game_title, won_at)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING
    `, [w.id, w.user_id, w.user_email, w.amount, w.game_title, ts(w.won_at)]);
  }
  console.log(`  ✅ ${jWinners.length} jackpot winners`);

  // ── Banner slides ─────────────────────────────────────────────────────
  console.log('🖼️ Migrating banner_slides...');
  const banners = sqlite.prepare('SELECT * FROM banner_slides').all();
  for (const b of banners) {
    await pg.query(`
      INSERT INTO banner_slides (id, position, title, subtitle, description, background_image,
        overlay_color, accent, badge, cta_text, cta_link, cta_color, active, created_date)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (id) DO NOTHING
    `, [b.id, b.position || 0, b.title, b.subtitle, b.description, b.background_image,
      b.overlay_color, b.accent, b.badge, b.cta_text, b.cta_link, b.cta_color,
      b.active !== 0, ts(b.created_date)]);
  }
  console.log(`  ✅ ${banners.length} banners`);

  // ── Chat messages ─────────────────────────────────────────────────────
  console.log('💬 Migrating chat_messages...');
  const chats = sqlite.prepare('SELECT * FROM chat_messages').all();
  for (const m of chats) {
    await pg.query(`
      INSERT INTO chat_messages (user_id, username, role, message, created_at)
      VALUES ($1,$2,$3,$4,$5)
    `, [m.user_id, m.username, m.role || 'player', m.message, ts(m.created_at)]);
  }
  console.log(`  ✅ ${chats.length} chat messages`);

  // ── ClickHouse: transactions (re-migrate with game fields) ────────────
  console.log('📊 Migrating transactions → ClickHouse (full)...');
  const txns = sqlite.prepare('SELECT * FROM transactions').all();
  if (txns.length > 0) {
    const usersMap = {};
    const allUsers = await pg.query('SELECT id, email FROM users');
    allUsers.rows.forEach(u => { usersMap[u.email] = u.id; });

    const rows = txns.map(t => ({
      id:          t.id || require('crypto').randomUUID(),
      user_id:     usersMap[t.user_email] || '00000000-0000-0000-0000-000000000000',
      user_email:  t.user_email || '',
      type:        t.type || 'unknown',
      amount:      parseFloat(t.amount) || 0,
      currency:    t.currency || 'USD',
      status:      t.status || 'completed',
      description: t.description || '',
      reference:   t.reference || '',
      created_at:  t.created_date
        ? new Date(t.created_date).toISOString().replace('T', ' ').slice(0, 23)
        : new Date().toISOString().replace('T', ' ').slice(0, 23),
    }));

    // Delete existing and reinsert (ClickHouse doesn't support upsert easily)
    await ch.command({ query: 'TRUNCATE TABLE casino.transactions' });
    await ch.insert({ table: 'casino.transactions', values: rows, format: 'JSONEachRow' });
  }
  console.log(`  ✅ ${txns.length} transactions`);

  console.log('\n🎉 Full migration complete!');
  console.log('\n📋 Summary:');
  const pgTables = await pg.query(`
    SELECT table_name, 
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_name=t.table_name AND table_schema='public') as cols
    FROM information_schema.tables t
    WHERE table_schema = 'public' ORDER BY table_name
  `);
  pgTables.rows.forEach(r => console.log(`  PG: ${r.table_name}`));

  await pg.end();
  await ch.close();
  sqlite.close();
}

run().catch(err => {
  console.error('❌ Migration failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
