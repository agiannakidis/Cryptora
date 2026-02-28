// /root/casino-backend/src/affiliate.js
// Core affiliate tracking: CPA on first deposit, RevShare on wagers

const db = require('./db');
const { v4: uuidv4 } = require('uuid');

/**
 * Called on new user registration.
 * Links user to affiliate if ref_code provided.
 */
function trackRegistration(userId, userEmail, refCode) {
  if (!refCode) return;
  try {
    const aff = db.prepare("SELECT * FROM affiliates WHERE ref_code = ? AND status = 'active'").get(refCode);
    if (!aff) return;
    // Don't let affiliate refer themselves
    if (aff.user_id === userId) return;

    db.prepare('UPDATE users SET referred_by = ? WHERE id = ?').run(aff.id, userId);
    db.prepare(`INSERT OR IGNORE INTO affiliate_referrals
      (id, affiliate_id, referred_user_id, referred_user_email)
      VALUES (?, ?, ?, ?)`)
      .run(uuidv4(), aff.id, userId, userEmail);

    console.log(`[affiliate] User ${userEmail} registered via ref ${refCode} → aff ${aff.id}`);
  } catch (e) {
    console.error('[affiliate] trackRegistration error:', e.message);
  }
}

/**
 * Called when a deposit is credited.
 * Awards CPA if first deposit for this referral.
 */
function trackDeposit(userId, depositAmountUsd) {
  try {
    const user = db.prepare('SELECT referred_by FROM users WHERE id = ?').get(userId);
    if (!user || !user.referred_by) return;

    const ref = db.prepare('SELECT * FROM affiliate_referrals WHERE affiliate_id = ? AND referred_user_id = ?')
      .get(user.referred_by, userId);
    if (!ref) return;

    const aff = db.prepare('SELECT * FROM affiliates WHERE id = ?').get(user.referred_by);
    if (!aff || aff.status !== 'active') return;

    // Update referral status
    if (ref.status === 'registered') {
      db.prepare(`UPDATE affiliate_referrals SET status = 'deposited',
        first_deposit_amount = ?, first_deposit_date = datetime('now')
        WHERE affiliate_id = ? AND referred_user_id = ?`)
        .run(depositAmountUsd, aff.id, userId);
    }

    // CPA — only on first deposit, only if commission_type is cpa or hybrid
    if (!ref.cpa_paid && (aff.commission_type === 'cpa' || aff.commission_type === 'hybrid')) {
      const minDeposit = 10; // min $10 to qualify for CPA
      if (depositAmountUsd >= minDeposit) {
        const cpaAmount = aff.cpa_amount;
        db.prepare('UPDATE affiliates SET total_earned = total_earned + ? WHERE id = ?').run(cpaAmount, aff.id);
        db.prepare('UPDATE users SET affiliate_balance = affiliate_balance + ? WHERE id = ?').run(cpaAmount, aff.user_id);
        db.prepare('UPDATE affiliate_referrals SET cpa_paid = 1 WHERE affiliate_id = ? AND referred_user_id = ?')
          .run(aff.id, userId);
        db.prepare(`INSERT INTO affiliate_earnings (id, affiliate_id, referred_user_id, type, amount, description)
          VALUES (?, ?, ?, 'cpa', ?, ?)`)
          .run(uuidv4(), aff.id, userId, cpaAmount, `CPA for ${ref.referred_user_email} first deposit $${depositAmountUsd.toFixed(2)}`);

        console.log(`[affiliate] CPA $${cpaAmount} → aff ${aff.id} for user ${userId}`);
        sendPostback(aff, 'cpa', cpaAmount, userId);
      }
    }
  } catch (e) {
    console.error('[affiliate] trackDeposit error:', e.message);
  }
}

/**
 * Called after each wager (debit) in walletApi.
 * Awards RevShare % of GGR (approximated as house edge on wager).
 * GGR approximation: 3% of wager amount (average house edge)
 */
function trackWager(userId, wagerAmount, winAmount = 0) {
  try {
    const user = db.prepare('SELECT referred_by FROM users WHERE id = ?').get(userId);
    if (!user || !user.referred_by) return;

    const aff = db.prepare('SELECT * FROM affiliates WHERE id = ?').get(user.referred_by);
    if (!aff || aff.status !== 'active') return;
    if (aff.commission_type !== 'revshare' && aff.commission_type !== 'hybrid') return;

    // GGR approximation: 3% house edge (slot avg RTP = 97%)
    const HOUSE_EDGE = 0.03;
    const ggr = wagerAmount * HOUSE_EDGE;
    if (ggr <= 0) return;

    const revshareAmount = parseFloat((ggr * aff.revshare_percent / 100).toFixed(5));
    if (revshareAmount < 0.001) return; // too small

    db.prepare('UPDATE affiliates SET total_earned = total_earned + ? WHERE id = ?').run(revshareAmount, aff.id);
    db.prepare('UPDATE users SET affiliate_balance = affiliate_balance + ? WHERE id = ?').run(revshareAmount, aff.user_id);
    db.prepare(`UPDATE affiliate_referrals SET total_wagered = total_wagered + ?, total_ggr = total_ggr + ?
      WHERE affiliate_id = ? AND referred_user_id = ?`)
      .run(wagerAmount, ggr, aff.id, userId);
    db.prepare(`INSERT INTO affiliate_earnings (id, affiliate_id, referred_user_id, type, amount, description)
      VALUES (?, ?, ?, 'revshare', ?, ?)`)
      .run(uuidv4(), aff.id, userId, revshareAmount,
        `RevShare ${aff.revshare_percent}% of GGR $${ggr.toFixed(3)} (wager $${wagerAmount})`);
  } catch (e) {
    console.error('[affiliate] trackWager error:', e.message);
  }
}

/**
 * Fire postback to affiliate's URL (non-blocking)
 */
function sendPostback(aff, type, amount, userId) {
  if (!aff.postback_url) return;
  try {
    const url = new URL(aff.postback_url);
    url.searchParams.set('type', type);
    url.searchParams.set('amount', amount);
    url.searchParams.set('aff_id', aff.id);
    url.searchParams.set('user_id', userId);
    url.searchParams.set('ts', Math.floor(Date.now() / 1000));
    fetch(url.toString()).catch(() => {});
    console.log(`[affiliate] Postback fired: ${url.toString()}`);
  } catch (e) {
    console.error('[affiliate] postback error:', e.message);
  }
}

module.exports = { trackRegistration, trackDeposit, trackWager };
