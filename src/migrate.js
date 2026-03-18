/**
 * One-time migration: SQLite → PostgreSQL + ClickHouse
 * Run: node src/migrate.js
 */
require('dotenv').config();

if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_MIGRATE) {
  console.error('[MIGRATE] Refusing to run in production without ALLOW_MIGRATE=1');
  process.exit(1);
}
console.warn('[MIGRATE] This script migrates from SQLite to PostgreSQL. Run only once.');


const Database = require('better-sqlite3');
const path = require('path');
const { Pool } = require('pg');
const { createClient } = require('@clickhouse/client');

const sqlite = new Database(path.join(__dirname, '../casino.db'));

const pg = new Pool({
  host:     process.env.PG_HOST     || 'localhost',
  database: process.env.PG_DATABASE || 'casino_db',
  user:     process.env.PG_USER     || 'casino',
  password: process.env.PG_PASSWORD || 'casino_pg_2026',
});

const ch = createClient({
  host:     process.env.CH_HOST     || 'http://localhost:8123',
  database: process.env.CH_DATABASE || 'casino',
  username: process.env.CH_USER     || 'default',
  password: process.env.CH_PASSWORD || '',
});

async function run() {
  console.log('🚀 Starting migration SQLite → PostgreSQL + ClickHouse\n');

  // ── Users → PostgreSQL ────────────────────────────────────────────────
  console.log('📦 Migrating users...');
  const users = sqlite.prepare('SELECT * FROM users').all();
  for (const u of users) {
    await pg.query(`
      INSERT INTO users (id, email, password_hash, name, role, balance, currency, preferred_currency, favorite_games, created_date, updated_date)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::timestamptz,$11::timestamptz)
      ON CONFLICT (id) DO UPDATE SET
        balance = EXCLUDED.balance,
        updated_date = EXCLUDED.updated_date
    `, [
      u.id, u.email, u.password_hash, u.name, u.role,
      u.balance || 0, u.currency || 'USD', u.preferred_currency,
      u.favorite_games || '[]',
      u.created_date || new Date().toISOString(),
      u.updated_date || new Date().toISOString(),
    ]);
  }
  console.log(`  ✅ ${users.length} users`);

  // ── Games → PostgreSQL ────────────────────────────────────────────────
  console.log('📦 Migrating games...');
  const games = sqlite.prepare('SELECT * FROM games').all();
  for (const g of games) {
    await pg.query(`
      INSERT INTO games (id, title, provider, category, thumbnail, is_enabled, is_featured, game_id, provider_game_id, rtp, created_date, updated_date)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz,$12::timestamptz)
      ON CONFLICT (id) DO NOTHING
    `, [
      g.id, g.title, g.provider, g.category || 'slots', g.thumbnail,
      g.is_enabled !== 0, g.is_featured !== 0,
      g.game_id, g.provider_game_id, g.rtp,
      g.created_date || new Date().toISOString(),
      g.updated_date || new Date().toISOString(),
    ]);
  }
  console.log(`  ✅ ${games.length} games`);

  // ── Providers → PostgreSQL ────────────────────────────────────────────
  console.log('📦 Migrating game_providers...');
  const providers = sqlite.prepare('SELECT * FROM game_providers').all();
  for (const p of providers) {
    await pg.query(`
      INSERT INTO game_providers (id, name, is_enabled, logo, created_date, updated_date)
      VALUES ($1,$2,$3,$4,$5::timestamptz,$6::timestamptz)
      ON CONFLICT (id) DO NOTHING
    `, [
      p.id, p.name, p.is_enabled !== 0, p.logo,
      p.created_date || new Date().toISOString(),
      p.updated_date || new Date().toISOString(),
    ]);
  }
  console.log(`  ✅ ${providers.length} providers`);

  // ── Promotions → PostgreSQL ───────────────────────────────────────────
  console.log('📦 Migrating promotions...');
  const promos = sqlite.prepare('SELECT * FROM promotions').all();
  for (const p of promos) {
    await pg.query(`
      INSERT INTO promotions (id, title, description, image, bonus_type, bonus_value, wagering_requirement, min_deposit, is_active, expires_at, created_date, updated_date)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,$11::timestamptz,$12::timestamptz)
      ON CONFLICT (id) DO NOTHING
    `, [
      p.id, p.title, p.description, p.image, p.bonus_type,
      p.bonus_value, p.wagering_requirement, p.min_deposit,
      p.is_active !== 0,
      p.expires_at || null,
      p.created_date || new Date().toISOString(),
      p.updated_date || new Date().toISOString(),
    ]);
  }
  console.log(`  ✅ ${promos.length} promotions`);

  // ── Support → PostgreSQL ──────────────────────────────────────────────
  console.log('📦 Migrating support...');
  const tickets = sqlite.prepare('SELECT * FROM support').all();
  for (const t of tickets) {
    await pg.query(`
      INSERT INTO support (id, user_email, subject, messages, status, created_date, updated_date)
      VALUES ($1,$2,$3,$4::jsonb,$5,$6::timestamptz,$7::timestamptz)
      ON CONFLICT (id) DO NOTHING
    `, [
      t.id, t.user_email, t.subject, t.messages || '[]', t.status,
      t.created_date || new Date().toISOString(),
      t.updated_date || new Date().toISOString(),
    ]);
  }
  console.log(`  ✅ ${tickets.length} support tickets`);

  // ── Crypto addresses → PostgreSQL ─────────────────────────────────────
  console.log('📦 Migrating crypto_addresses...');
  const addresses = sqlite.prepare('SELECT * FROM crypto_addresses').all().catch ? [] : sqlite.prepare('SELECT * FROM crypto_addresses').all();
  for (const a of addresses) {
    // Need user UUID - check if user exists
    const userRow = await pg.query('SELECT id FROM users WHERE id = $1', [a.user_id]);
    if (!userRow.rows.length) continue;
    await pg.query(`
      INSERT INTO crypto_addresses (id, user_id, chain, token, address, derivation_index, created_date)
      VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz)
      ON CONFLICT (user_id, chain, token) DO NOTHING
    `, [a.id, a.user_id, a.chain, a.token, a.address, a.derivation_index, a.created_date || new Date().toISOString()]);
  }
  console.log(`  ✅ ${addresses.length} crypto addresses`);

  // ── Game sessions → PostgreSQL ────────────────────────────────────────
  console.log('📦 Migrating game_sessions...');
  const sessions = sqlite.prepare('SELECT * FROM game_sessions').all();
  for (const s of sessions) {
    await pg.query(`
      INSERT INTO game_sessions (id, user_email, game_id, game_title, provider, session_token, status, start_time, launch_url, created_date)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9,$10::timestamptz)
      ON CONFLICT (id) DO NOTHING
    `, [
      s.id, s.user_email, s.game_id, s.game_title, s.provider,
      s.session_token, s.status || 'active',
      s.start_time || s.created_date || new Date().toISOString(),
      s.launch_url,
      s.created_date || new Date().toISOString(),
    ]);
  }
  console.log(`  ✅ ${sessions.length} game sessions`);

  // ── Transactions → ClickHouse ─────────────────────────────────────────
  console.log('📦 Migrating transactions → ClickHouse...');
  const txns = sqlite.prepare('SELECT * FROM transactions').all();
  if (txns.length > 0) {
    // Get user_id map
    const usersMap = {};
    const allUsers = await pg.query('SELECT id, email FROM users');
    allUsers.rows.forEach(u => { usersMap[u.email] = u.id; });

    const chRows = txns.map(t => ({
      id:          t.id,
      user_id:     usersMap[t.user_email] || '00000000-0000-0000-0000-000000000000',
      user_email:  t.user_email || '',
      type:        t.type || 'unknown',
      amount:      parseFloat(t.amount) || 0,
      currency:    t.currency || 'USD',
      status:      t.status || 'completed',
      description: t.description || '',
      reference:   t.reference || '',
      created_at:  t.created_date ? new Date(t.created_date).toISOString().replace('T', ' ').slice(0, 23) : new Date().toISOString().replace('T', ' ').slice(0, 23),
    }));

    await ch.insert({ table: 'casino.transactions', values: chRows, format: 'JSONEachRow' });
  }
  console.log(`  ✅ ${txns.length} transactions`);

  // ── Crypto deposits → ClickHouse ─────────────────────────────────────
  console.log('📦 Migrating crypto_deposits → ClickHouse...');
  let deposits = [];
  try {
    deposits = sqlite.prepare('SELECT * FROM crypto_deposits').all();
  } catch (e) { /* table may not exist yet */ }

  if (deposits.length > 0) {
    const chRows = deposits.map(d => ({
      id:           d.id,
      user_id:      d.user_id,
      chain:        d.chain || '',
      token:        d.token || '',
      amount_crypto: parseFloat(d.amount_crypto) || 0,
      amount_usd:   parseFloat(d.amount_usd) || 0,
      tx_hash:      d.tx_hash || '',
      confirmations: d.confirmations || 0,
      status:       d.status || 'confirmed',
      credited:     d.credited || 1,
      created_at:   d.created_date ? new Date(d.created_date).toISOString().replace('T', ' ').slice(0, 23) : new Date().toISOString().replace('T', ' ').slice(0, 23),
      confirmed_at: d.confirmed_date ? new Date(d.confirmed_date).toISOString().replace('T', ' ').slice(0, 23) : new Date().toISOString().replace('T', ' ').slice(0, 23),
    }));
    await ch.insert({ table: 'casino.crypto_deposits', values: chRows, format: 'JSONEachRow' });
  }
  console.log(`  ✅ ${deposits.length} crypto deposits`);

  console.log('\n🎉 Migration complete!');
  await pg.end();
  await ch.close();
  sqlite.close();
}

run().catch(err => {
  console.error('❌ Migration failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
