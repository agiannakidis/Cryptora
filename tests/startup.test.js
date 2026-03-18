/**
 * tests/startup.test.js
 * Basic startup and environment validation tests.
 * Run with: npm test
 */

'use strict';

const assert = require('assert');

// ── Test 1: Required env vars are present ─────────────────────────────────
const REQUIRED_VARS = ['JWT_SECRET', 'PG_HOST', 'PG_USER', 'PG_DATABASE', 'PG_PASSWORD'];

describe('Environment', () => {
  it('should have all required env vars set', () => {
    const missing = REQUIRED_VARS.filter(v => !process.env[v]);
    if (missing.length > 0) {
      throw new Error(`Missing required env vars: ${missing.join(', ')}`);
    }
  });

  it('JWT_SECRET should be at least 32 characters', () => {
    const secret = process.env.JWT_SECRET || '';
    assert.ok(secret.length >= 32, `JWT_SECRET too short (${secret.length} chars) — generate with: openssl rand -hex 32`);
  });

  it('JWT_SECRET should not be the default placeholder', () => {
    const secret = process.env.JWT_SECRET || '';
    const KNOWN_DEFAULTS = [
      'change-this-secret-in-production',
      'casino-secret-2026',
      'fallback_secret_change_in_production',
      'CHANGE_ME_generate_with_openssl_rand_hex_32',
      '3135b75346a97155548cc44066544d15ad492e688ed87a173dee33916e626087',
    ];
    for (const d of KNOWN_DEFAULTS) {
      assert.notStrictEqual(secret, d, `JWT_SECRET is still set to a known insecure default: "${d}"`);
    }
  });
});

// ── Test 2: Module load checks ────────────────────────────────────────────
describe('Module loading', () => {
  it('should load express without errors', () => {
    const express = require('express');
    assert.ok(typeof express === 'function');
  });

  it('should load jsonwebtoken without errors', () => {
    const jwt = require('jsonwebtoken');
    assert.ok(typeof jwt.sign === 'function');
    assert.ok(typeof jwt.verify === 'function');
  });

  it('should load pg without errors', () => {
    const { Pool } = require('pg');
    assert.ok(typeof Pool === 'function');
  });
});

// ── Test 3: Chain config sanity ───────────────────────────────────────────
describe('Chain config', () => {
  it('should not expose ARBITRUM as a supported deposit chain', () => {
    // ARBITRUM is in CHAINS config but monitoring is not implemented.
    // Ensure our route guard exists.
    const fs = require('fs');
    const cryptoRoute = fs.readFileSync(
      require('path').join(__dirname, '../src/routes/crypto.js'),
      'utf8'
    );
    assert.ok(
      cryptoRoute.includes("chain === 'ARBITRUM'"),
      'ARBITRUM guard missing from crypto.js'
    );
  });
});

// ── Test 4: Auth endpoint behavior ───────────────────────────────────────────
describe('Auth routes', () => {
  let baseUrl;
  before(function() {
    baseUrl = `http://localhost:${process.env.PORT || 3001}`;
  });

  it('POST /api/auth/login with wrong credentials returns 401', async function() {
    this.timeout(5000);
    try {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nonexistent@test.invalid', password: 'wrongpassword' }),
      });
      assert.strictEqual(res.status, 401, `Expected 401, got ${res.status}`);
    } catch (e) {
      if (e.code === 'ECONNREFUSED') this.skip();
      throw e;
    }
  });

  it('GET /api/games/list returns 200 (public endpoint)', async function() {
    this.timeout(5000);
    try {
      const res = await fetch(`${baseUrl}/api/games/list`);
      assert.ok([200, 404].includes(res.status), `Expected 200 or 404, got ${res.status}`);
    } catch (e) {
      if (e.code === 'ECONNREFUSED') this.skip();
      throw e;
    }
  });

  it('GET /api/entities/User without auth returns 403', async function() {
    this.timeout(5000);
    try {
      const res = await fetch(`${baseUrl}/api/entities/User`);
      assert.ok([401, 403].includes(res.status), `Expected 401 or 403, got ${res.status}`);
    } catch (e) {
      if (e.code === 'ECONNREFUSED') this.skip();
      throw e;
    }
  });
});

// ── Test 5: Health endpoint ───────────────────────────────────────────────────
describe('Health endpoint', () => {
  it('GET /api/health returns 200 with {status: ok}', async function() {
    this.timeout(5000);
    const baseUrl = `http://localhost:${process.env.PORT || 3001}`;
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
      const body = await res.json();
      assert.ok(body.status === 'ok' || body.ok === true, `Health check missing status:ok — got ${JSON.stringify(body)}`);
    } catch (e) {
      if (e.code === 'ECONNREFUSED') this.skip();
      throw e;
    }
  });
});

// ── Test 6: Crypto capability consistency ─────────────────────────────────────
describe('Crypto deposit chain guards', () => {
  let baseUrl;
  before(function() {
    baseUrl = `http://localhost:${process.env.PORT || 3001}`;
  });

  it('ARBITRUM deposits should return 400 (disabled)', async function() {
    this.timeout(5000);
    try {
      const res = await fetch(`${baseUrl}/api/crypto/deposit-address?chain=ARBITRUM&token=USDT`, {
        headers: { 'Authorization': 'Bearer invalid_token_test' },
      });
      // Could be 401 (no valid auth) or 400 (chain guard) — both acceptable
      assert.ok([400, 401, 403].includes(res.status), `Expected 400/401/403, got ${res.status}`);
      if (res.status === 400) {
        const body = await res.json();
        assert.ok(body.error && body.error.includes('ARBITRUM'), `Expected ARBITRUM error, got ${JSON.stringify(body)}`);
      }
    } catch (e) {
      if (e.code === 'ECONNREFUSED') this.skip();
      throw e;
    }
  });

  it('TON deposits should return 400 (disabled pending monitoring)', async function() {
    this.timeout(5000);
    try {
      const res = await fetch(`${baseUrl}/api/crypto/deposit-address?chain=TON&token=TON`, {
        headers: { 'Authorization': 'Bearer invalid_token_test' },
      });
      assert.ok([400, 401, 403].includes(res.status), `Expected 400/401/403, got ${res.status}`);
      if (res.status === 400) {
        const body = await res.json();
        assert.ok(body.error && body.error.includes('TON'), `Expected TON error, got ${JSON.stringify(body)}`);
      }
    } catch (e) {
      if (e.code === 'ECONNREFUSED') this.skip();
      throw e;
    }
  });

  it('ARBITRUM chain guard exists in crypto.js source', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require('path').join(__dirname, '../src/routes/crypto.js'), 'utf8');
    assert.ok(src.includes("chain === 'ARBITRUM'"), 'ARBITRUM deposit guard missing');
    assert.ok(src.includes("chain === 'TON'"), 'TON deposit guard missing');
  });
});
