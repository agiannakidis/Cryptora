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
