const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../casino.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ──────────────────────────────────────────────────────────────────

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  role TEXT DEFAULT 'player',
  balance REAL DEFAULT 0,
  currency TEXT DEFAULT 'USD',
  preferred_currency TEXT,
  favorite_games TEXT DEFAULT '[]',
  created_date TEXT DEFAULT (datetime('now')),
  updated_date TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  provider TEXT,
  category TEXT DEFAULT 'slots',
  thumbnail TEXT,
  is_enabled INTEGER DEFAULT 1,
  is_featured INTEGER DEFAULT 0,
  game_id TEXT,
  rtp REAL,
  created_date TEXT DEFAULT (datetime('now')),
  updated_date TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS game_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_enabled INTEGER DEFAULT 1,
  logo TEXT,
  created_date TEXT DEFAULT (datetime('now')),
  updated_date TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS game_sessions (
  id TEXT PRIMARY KEY,
  user_email TEXT,
  game_id TEXT,
  game_title TEXT,
  provider TEXT,
  session_token TEXT,
  status TEXT DEFAULT 'active',
  start_time TEXT,
  launch_url TEXT,
  created_date TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS promotions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  image TEXT,
  bonus_type TEXT,
  bonus_value REAL,
  wagering_requirement REAL,
  min_deposit REAL,
  is_active INTEGER DEFAULT 1,
  expires_at TEXT,
  created_date TEXT DEFAULT (datetime('now')),
  updated_date TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS support (
  id TEXT PRIMARY KEY,
  user_email TEXT,
  subject TEXT,
  messages TEXT DEFAULT '[]',
  status TEXT DEFAULT 'open',
  created_date TEXT DEFAULT (datetime('now')),
  updated_date TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_email TEXT,
  type TEXT,
  amount REAL,
  currency TEXT DEFAULT 'USD',
  status TEXT DEFAULT 'completed',
  description TEXT,
  reference TEXT,
  created_date TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS crypto_addresses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  chain TEXT NOT NULL,
  token TEXT NOT NULL,
  address TEXT NOT NULL,
  derivation_index INTEGER NOT NULL,
  created_date TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, chain, token)
);

CREATE TABLE IF NOT EXISTS crypto_deposits (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  chain TEXT NOT NULL,
  token TEXT NOT NULL,
  amount_crypto TEXT NOT NULL,
  amount_usd REAL,
  tx_hash TEXT UNIQUE NOT NULL,
  confirmations INTEGER DEFAULT 0,
  required_confirmations INTEGER DEFAULT 1,
  status TEXT DEFAULT 'pending',
  credited INTEGER DEFAULT 0,
  created_date TEXT DEFAULT (datetime('now')),
  confirmed_date TEXT
);

CREATE TABLE IF NOT EXISTS crypto_withdrawals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  chain TEXT NOT NULL,
  token TEXT NOT NULL,
  amount_crypto TEXT NOT NULL,
  amount_usd REAL,
  to_address TEXT NOT NULL,
  tx_hash TEXT,
  fee_crypto TEXT,
  status TEXT DEFAULT 'pending',
  error TEXT,
  created_date TEXT DEFAULT (datetime('now')),
  processed_date TEXT
);
`);

// ── Seed data ────────────────────────────────────────────────────────────────

function seed() {
  const { v4: uuidv4 } = require('uuid');

  // Admin user
  if (!db.prepare('SELECT id FROM users WHERE email = ?').get('admin@casino.com')) {
    db.prepare(`INSERT INTO users (id, email, password_hash, name, role, balance, currency)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      uuidv4(), 'admin@casino.com',
      bcrypt.hashSync('admin123', 10),
      'Admin', 'admin', 10000, 'USD'
    );
  }

  // Demo player
  if (!db.prepare('SELECT id FROM users WHERE email = ?').get('player@casino.com')) {
    db.prepare(`INSERT INTO users (id, email, password_hash, name, role, balance, currency)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      uuidv4(), 'player@casino.com',
      bcrypt.hashSync('player123', 10),
      'Demo Player', 'player', 500, 'USD'
    );
  }

  // Games, providers and promotions are imported from real data — no seed needed
}

seed();

module.exports = db;
