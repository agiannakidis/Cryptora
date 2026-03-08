/**
 * Affiliate Monthly Commission Cron Job
 * Runs: 1st of each month (or on-demand via API)
 * Aggregates affiliate_earnings per affiliate per period → affiliate_commissions
 */
const { queryOne, queryAll, query } = require('../pgdb');

async function runCommissionCron(periodStart, periodEnd) {
  // Default: previous calendar month
  if (!periodStart) {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    periodStart = first.toISOString().slice(0, 10);
    periodEnd = last.toISOString().slice(0, 10);
  }

  console.log(`[affiliate-cron] Processing period ${periodStart} → ${periodEnd}`);

  // Aggregate earnings per affiliate in the period
  const rows = await queryAll(`
    SELECT
      ae.affiliate_id,
      a.revshare_percent,
      COUNT(ae.id) as entries,
      SUM(ae.amount) as total_earned
    FROM affiliate_earnings ae
    JOIN affiliates a ON a.id = ae.affiliate_id
    WHERE ae.created_date >= $1::date
      AND ae.created_date < ($2::date + INTERVAL '1 day')
      AND ae.type = 'revshare'
    GROUP BY ae.affiliate_id, a.revshare_percent
    HAVING SUM(ae.amount) > 0
  `, [periodStart, periodEnd]);

  if (!rows.length) {
    console.log('[affiliate-cron] No earnings found for period, nothing to do.');
    return { created: 0, skipped: 0, period: { periodStart, periodEnd } };
  }

  let created = 0, skipped = 0;

  for (const row of rows) {
    const existing = await queryOne(
      'SELECT id FROM affiliate_commissions WHERE affiliate_id = $1 AND period_start = $2::date',
      [row.affiliate_id, periodStart]
    );
    if (existing) { skipped++; continue; }

    // Recalculate GGR from events ledger for this affiliate's players
    const ggrRow = await queryOne(`
      SELECT COALESCE(SUM(amount1 - amount2), 0) as ggr
      FROM affiliate_events_ledger ael
      JOIN affiliate_referrals ar ON ar.referred_user_id = ael.player_id
      WHERE ar.affiliate_id = $1
        AND ael.type = 'BET_SETTLED'
        AND ael.created_at >= $2::date
        AND ael.created_at < ($3::date + INTERVAL '1 day')
    `, [row.affiliate_id, periodStart, periodEnd]);

    const ggr = parseFloat(ggrRow?.ggr || 0);
    const amount = parseFloat(row.total_earned);

    await query(`
      INSERT INTO affiliate_commissions
        (affiliate_id, period_start, period_end, total_ggr, revshare_percent, amount, status)
      VALUES ($1, $2::date, $3::date, $4, $5, $6, 'pending')
    `, [row.affiliate_id, periodStart, periodEnd, ggr, parseFloat(row.revshare_percent), amount]);

    created++;
    console.log(`[affiliate-cron] Created commission for ${row.affiliate_id}: $${amount.toFixed(2)}`);
  }

  console.log(`[affiliate-cron] Done. Created: ${created}, Skipped (already exist): ${skipped}`);
  return { created, skipped, period: { periodStart, periodEnd } };
}

module.exports = { runCommissionCron };

// Run directly if called as script
if (require.main === module) {
  const [,, start, end] = process.argv;
  runCommissionCron(start, end)
    .then(r => { console.log('Result:', r); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}
