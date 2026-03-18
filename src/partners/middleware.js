'use strict';
const { queryOne } = require('../pgdb');

async function requirePartnerAuth(req, res, next) {
  if (!req.session || !req.session.partnerId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    const account = await queryOne(
      "SELECT id, email, status FROM affiliate_accounts WHERE id = $1 AND status = 'active'",
      [req.session.partnerId]
    );
    if (!account) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'Session invalid' });
    }
    req.partnerAccount = account;
    next();
  } catch(e) {
    console.error('[partner auth]', e.message);
    res.status(500).json({ error: 'Auth check failed' });
  }
}

function validate(schema) {
  return (req, res, next) => {
    try {
      const { z } = require('zod');
      const result = schema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          error: 'Validation failed',
          details: result.error.issues.map(i => ({ field: i.path.join('.'), message: i.message }))
        });
      }
      req.body = result.data;
      next();
    } catch(e) {
      res.status(400).json({ error: 'Invalid request body' });
    }
  };
}

async function logAudit(accountId, action, ip, meta) {
  try {
    const { query } = require('../pgdb');
    await query(
      'INSERT INTO affiliate_audit_logs (account_id, action, ip_address, meta, created_at) VALUES ($1, $2, $3, $4, NOW())',
      [accountId, action, ip || '', JSON.stringify(meta || {})]
    );
  } catch(e) { /* non-blocking */ }
}

module.exports = { requirePartnerAuth, validate, logAudit };
