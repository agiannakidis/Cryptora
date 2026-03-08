// /root/casino-backend/src/affiliate.js — migrated to PostgreSQL
const { queryOne, query } = require('./pgdb');
const { v4: uuidv4 } = require('uuid');
const https_m = require('https');
const http_m = require('http');
const url_m = require('url');

// Fire affiliate postback
async function firePostback(affId, event, data) {
  try {
    const { queryOne: qOne } = require('./pgdb');
    const aff = (typeof affId === 'object') ? affId
      : await qOne('SELECT postback_url, ref_code FROM affiliates WHERE id = $1', [affId]);
    if (!aff || !aff.postback_url) return;
    let pbUrl = aff.postback_url
      .replace(/\{event\}/g, encodeURIComponent(event))
      .replace(/\{ref_code\}/g, encodeURIComponent(aff.ref_code || ''))
      .replace(/\{click_id\}/g, encodeURIComponent(data.click_id || ''))
      .replace(/\{amount\}/g, encodeURIComponent(String(data.amount || 0)))
      .replace(/\{player_id\}/g, encodeURIComponent(data.player_id || ''))
      .replace(/\{sub1\}/g, encodeURIComponent(data.sub1 || ''))
      .replace(/\{sub2\}/g, encodeURIComponent(data.sub2 || ''))
      .replace(/\{sub3\}/g, encodeURIComponent(data.sub3 || ''));
    if (!pbUrl.includes('event=')) pbUrl += (pbUrl.includes('?') ? '&' : '?') + 'event=' + encodeURIComponent(event);
    const parsed = new url_m.URL(pbUrl);
    const lib = parsed.protocol === 'https:' ? https_m : http_m;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET', timeout: 5000,
      headers: { 'User-Agent': 'Cryptora-Affiliate/1.0' },
    };
    await new Promise(function(resolve) {
      const req = lib.request(options, function(res) {
        console.log('[affiliate/postback]', event, '->', res.statusCode);
        resolve();
      });
      req.on('error', function(e) { console.warn('[affiliate/postback] err:', e.message); resolve(); });
      req.on('timeout', function() { req.destroy(); resolve(); });
      req.end();
    });
  } catch(e) { console.warn('[affiliate/postback]', e.message); }
}
module.exports.firePostback = firePostback;



async function trackRegistration(userId, userEmail, refCode) {
  if (!refCode) return;
  try {
    const aff = await queryOne("SELECT * FROM affiliates WHERE ref_code=$1 AND status='active'", [refCode]);
    if (!aff || aff.user_id === userId) return;
    await query('UPDATE users SET referred_by=$1 WHERE id=$2', [aff.id, userId]);
    // Check if already linked
    const existing = await queryOne('SELECT id FROM affiliate_referrals WHERE affiliate_id=$1 AND referred_user_id=$2', [aff.id, userId]);
    if (!existing) {
      await query(`INSERT INTO affiliate_referrals (id,affiliate_id,referred_user_id,referred_user_email,status)
        VALUES ($1,$2,$3,$4,'registered')`, [uuidv4(), aff.id, userId, userEmail]);
      // Fire registration postback
      firePostback(aff.id, 'registration', { player_id: userId, amount: 0 }).catch(function(){});
    }
  } catch(e) { console.error('[affiliate trackRegistration]', e.message); }
}

async function trackFirstDeposit(userId, userEmail, amountUsd) {
  try {
    const user = await queryOne('SELECT referred_by FROM users WHERE id=$1', [userId]);
    if (!user?.referred_by) return;
    const ref = await queryOne('SELECT * FROM affiliate_referrals WHERE affiliate_id=$1 AND referred_user_id=$2', [user.referred_by, userId]);
    if (!ref || ref.cpa_paid) return;
    const aff = await queryOne('SELECT * FROM affiliates WHERE id=$1', [user.referred_by]);
    if (!aff) return;

    await query(`UPDATE affiliate_referrals SET status='deposited', first_deposit_amount=$1, first_deposit_date=NOW()
      WHERE affiliate_id=$2 AND referred_user_id=$3`, [amountUsd, aff.id, userId]);
    // Fire FTD postback
    firePostback(aff.id, 'ftd', { player_id: userId, amount: amountUsd }).catch(function(){});

    if (aff.commission_type === 'cpa' || aff.commission_type === 'hybrid') {
      const cpaAmount = parseFloat(aff.cpa_amount || 20);
      await query('UPDATE affiliates SET total_earned=total_earned+$1 WHERE id=$2', [cpaAmount, aff.id]);
      await query('UPDATE users SET affiliate_balance=affiliate_balance+$1 WHERE id=$2', [cpaAmount, aff.user_id]);
      await query('UPDATE affiliate_referrals SET cpa_paid=true WHERE affiliate_id=$1 AND referred_user_id=$2', [aff.id, userId]);
    }
  } catch(e) { console.error('[affiliate trackFirstDeposit]', e.message); }
}

async function trackWager(userId, userEmail, betAmount, winAmount) {
  try {
    const user = await queryOne('SELECT referred_by FROM users WHERE id=$1', [userId]);
    if (!user?.referred_by) return;
    const aff = await queryOne('SELECT * FROM affiliates WHERE id=$1', [user.referred_by]);
    if (!aff) return;

    const ggr = betAmount - winAmount;
    await query(`UPDATE affiliate_referrals SET total_wagered=total_wagered+$1, total_ggr=total_ggr+$2
      WHERE affiliate_id=$3 AND referred_user_id=$4`, [betAmount, ggr, aff.id, userId]);

    if ((aff.commission_type === 'revshare' || aff.commission_type === 'hybrid') && ggr > 0) {
      const revshare = ggr * parseFloat(aff.revshare_percent || 25) / 100;
      await query('UPDATE affiliates SET total_earned=total_earned+$1 WHERE id=$2', [revshare, aff.id]);
      await query('UPDATE users SET affiliate_balance=affiliate_balance+$1 WHERE id=$2', [revshare, aff.user_id]);
    }
  } catch(e) { console.error('[affiliate trackWager]', e.message); }
}

module.exports = { trackRegistration, trackFirstDeposit, trackWager };
