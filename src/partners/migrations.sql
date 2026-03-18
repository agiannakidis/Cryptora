-- ================================================================
-- Cryptora Partners Dashboard — Database Schema
-- Run: psql -U casino -d casino_db -h localhost -f migrations.sql
-- ================================================================

-- Partner accounts (separate from main casino users — for affiliate login)
CREATE TABLE IF NOT EXISTS affiliate_accounts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','suspended','pending')),
  totp_enabled BOOLEAN DEFAULT false,
  totp_secret VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- API Keys for affiliates
CREATE TABLE IF NOT EXISTS affiliate_api_keys (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id UUID REFERENCES affiliate_accounts(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL DEFAULT 'Default Key',
  key_hash VARCHAR(64) NOT NULL UNIQUE,
  key_prefix VARCHAR(12) NOT NULL,
  last_used_at TIMESTAMPTZ,
  last_used_ip VARCHAR(45),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_aff_api_keys_account ON affiliate_api_keys(account_id);

-- Audit logs for security-sensitive actions
CREATE TABLE IF NOT EXISTS affiliate_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  account_id UUID,
  action VARCHAR(100) NOT NULL,
  ip_address VARCHAR(45),
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_aff_audit_account ON affiliate_audit_logs(account_id, created_at DESC);

-- Postback delivery log
CREATE TABLE IF NOT EXISTS affiliate_postback_deliveries (
  id BIGSERIAL PRIMARY KEY,
  affiliate_id TEXT NOT NULL,
  event_type VARCHAR(50),
  url TEXT,
  response_code INTEGER,
  response_body TEXT,
  retry_count INTEGER DEFAULT 0,
  success BOOLEAN DEFAULT false,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_aff_pb_deliveries ON affiliate_postback_deliveries(affiliate_id, created_at DESC);

-- Tracking links (named links with sub-IDs)
CREATE TABLE IF NOT EXISTS affiliate_tracking_links (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  affiliate_id TEXT NOT NULL,
  account_id UUID,
  name VARCHAR(100) NOT NULL,
  sub1 VARCHAR(100),
  sub2 VARCHAR(100),
  landing_url TEXT DEFAULT 'https://cryptora.live/',
  active BOOLEAN DEFAULT true,
  clicks INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_aff_links_account ON affiliate_tracking_links(account_id);

-- Payout requests
CREATE TABLE IF NOT EXISTS affiliate_payout_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  affiliate_id TEXT NOT NULL,
  account_id UUID,
  amount DECIMAL(18,2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'USD',
  method VARCHAR(50) DEFAULT 'crypto',
  wallet_address TEXT,
  chain VARCHAR(20),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','processing','paid','rejected')),
  notes TEXT,
  admin_notes TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_aff_payouts_affiliate ON affiliate_payout_requests(affiliate_id, created_at DESC);
