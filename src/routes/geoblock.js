const express = require('express');
const router = express.Router();
const { authMiddleware: authenticate } = require('../middleware/auth');
const fs = require('fs');
const path = require('path');

const GEO_CONFIG_PATH = path.join(__dirname, '../../geo-config.json');

function loadConfig() {
  try {
    if (fs.existsSync(GEO_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(GEO_CONFIG_PATH, 'utf8'));
    }
  } catch {}
  return {
    blocked_countries: ['US','GB','AU','FR','DE','NL','IT','ES','BE','PL','HU','RO','CZ'],
    enabled: true
  };
}

function saveConfig(cfg) {
  fs.writeFileSync(GEO_CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

// Admin only middleware
function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
}

// GET /api/admin/geo-block
router.get('/', authenticate, adminOnly, (req, res) => {
  const cfg = loadConfig();
  res.json(cfg);
});

// PUT /api/admin/geo-block
router.put('/', authenticate, adminOnly, (req, res) => {
  const { blocked_countries, enabled } = req.body;
  const cfg = loadConfig();
  if (Array.isArray(blocked_countries)) cfg.blocked_countries = blocked_countries;
  if (typeof enabled === 'boolean') cfg.enabled = enabled;
  saveConfig(cfg);
  // Reload geo-block module dynamically
  try {
    const geoBlockPath = require.resolve('../geo-block');
    delete require.cache[geoBlockPath];
  } catch {}
  res.json({ ok: true, config: cfg });
});

module.exports = router;
