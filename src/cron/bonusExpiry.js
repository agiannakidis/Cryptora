/**
 * Bonus Expiry Cron Job
 * Runs: every hour
 * Finds users with expired bonus_expires_at and clears their bonus balance
 */
const { queryAll, query } = require('../pgdb');

async function runBonusExpiry() {
  try {
    // Find users with expired bonuses that still have bonus balance or wagering
    const expired = await queryAll(`
      SELECT id, email, bonus_balance, wagering_required
      FROM users
      WHERE bonus_expires_at IS NOT NULL
        AND bonus_expires_at < NOW()
        AND (bonus_balance > 0 OR wagering_required > 0)
    `);

    if (!expired.length) return;

    console.log(`[bonus-expiry] Expiring bonuses for ${expired.length} users`);

    for (const user of expired) {
      await query(`
        UPDATE users SET
          bonus_balance         = 0,
          wagering_required     = 0,
          wagering_progress     = 0,
          wagering_bonus_amount = 0,
          bonus_expires_at      = NULL
        WHERE id = $1
      `, [user.id]);

      console.log(`[bonus-expiry] Cleared bonus for ${user.email} (was: $${user.bonus_balance} bonus, $${user.wagering_required} wagering)`);
    }

    // Also clean up expired invalidated_tokens (housekeeping)
    await query("DELETE FROM invalidated_tokens WHERE expires_at < NOW()").catch(() => {});

  } catch (e) {
    console.error('[bonus-expiry] Error:', e.message);
  }
}

function scheduleBonusExpiry() {
  // Run immediately on startup, then every hour
  runBonusExpiry();
  setInterval(runBonusExpiry, 60 * 60 * 1000);
  console.log('[bonus-expiry] Scheduled — hourly bonus cleanup');
}

module.exports = { scheduleBonusExpiry, runBonusExpiry };
