'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { queryOne, query } = require('../../pgdb');
const { requirePartnerAuth, logAudit } = require('../middleware');
const router = express.Router();

const attempts = new Map();
function rateLimit(ip) {
  const now = Date.now(); const k = ip;
  const a = attempts.get(k) || { n:0, reset: now+900000 };
  if (now > a.reset) { a.n=0; a.reset=now+900000; }
  if (a.n >= 10) return false;
  a.n++; attempts.set(k, a); return true;
}

router.post('/login', async (req, res) => {
  if (!rateLimit(req.ip||'')) return res.status(429).json({ error: 'Too many attempts. Try in 15 min.' });
  const { email, password, totp_code } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const acc = await queryOne('SELECT id,email,password_hash,status,totp_enabled,totp_secret FROM affiliate_accounts WHERE email=$1', [email.toLowerCase().trim()]);
    if (!acc) { await new Promise(r=>setTimeout(r,200)); return res.status(401).json({ error: 'Invalid email or password' }); }
    if (acc.status==='suspended') return res.status(403).json({ error: 'Account suspended' });
    if (!acc.password_hash) return res.status(401).json({ error: 'Account not activated. Contact support.' });
    const ok = await bcrypt.compare(password, acc.password_hash);
    if (!ok) { await logAudit(acc.id,'login_failed',req.ip); return res.status(401).json({ error: 'Invalid email or password' }); }
    if (acc.totp_enabled) {
      if (!totp_code) return res.status(200).json({ requires_2fa: true });
      const speakeasy = require('speakeasy');
      if (!speakeasy.totp.verify({ secret:acc.totp_secret, encoding:'base32', token:String(totp_code), window:1 }))
        return res.status(401).json({ error: 'Invalid 2FA code' });
    }
    req.session.partnerId = acc.id; req.session.partnerEmail = acc.email;
    await logAudit(acc.id,'login',req.ip);
    res.json({ ok:true, email:acc.email });
  } catch(e) { console.error('[partners/login]',e.message); res.status(500).json({ error:'Server error' }); }
});

router.post('/logout', requirePartnerAuth, async (req, res) => {
  await logAudit(req.partnerAccount.id,'logout',req.ip);
  req.session.destroy(()=>{ res.clearCookie('partner_sid'); res.json({ ok:true }); });
});

router.get('/me', requirePartnerAuth, async (req, res) => {
  try {
    const acc = await queryOne(
      `SELECT a.id,a.email,a.status,a.created_at,a.totp_enabled,
              af.id as affiliate_id,af.ref_code,af.commission_type,
              af.revshare_percent,af.cpa_amount,af.status as affiliate_status,
              af.postback_url,af.total_earned,af.total_paid,
              (COALESCE(af.total_earned,0)-COALESCE(af.total_paid,0)) as balance
       FROM affiliate_accounts a LEFT JOIN affiliates af ON af.account_id=a.id
       WHERE a.id=$1`, [req.partnerAccount.id]);
    res.json(acc);
  } catch(e) { res.status(500).json({ error:'Server error' }); }
});

router.post('/change-password', requirePartnerAuth, async (req, res) => {
  const { current_password, new_password } = req.body||{};
  if (!current_password||!new_password) return res.status(400).json({ error:'Both fields required' });
  if (new_password.length<8) return res.status(400).json({ error:'Min 8 characters' });
  try {
    const acc = await queryOne('SELECT password_hash FROM affiliate_accounts WHERE id=$1',[req.partnerAccount.id]);
    if (!acc.password_hash||!await bcrypt.compare(current_password,acc.password_hash))
      return res.status(400).json({ error:'Current password incorrect' });
    await query('UPDATE affiliate_accounts SET password_hash=$1,updated_at=NOW() WHERE id=$2',[await bcrypt.hash(new_password,12),req.partnerAccount.id]);
    await logAudit(req.partnerAccount.id,'password_changed',req.ip);
    res.json({ ok:true });
  } catch(e) { res.status(500).json({ error:'Server error' }); }
});

module.exports = router;
