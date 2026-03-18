// /root/casino-backend/src/rg-check.js — migrated to PostgreSQL
const { queryOne, query } = require('./pgdb');

function getToday() { return new Date().toISOString().slice(0, 10); }
function getWeekStart() { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d.toISOString().slice(0, 10); }
function getMonthStart() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; }

async function getStats(userId, fromDate) {
  const row = await queryOne(
    'SELECT SUM(deposited) as dep, SUM(lost) as lost, SUM(wagered) as wag FROM rg_daily_stats WHERE user_id=$1 AND date>=$2',
    [userId, fromDate]
  );
  return { deposited: parseFloat(row?.dep||0), lost: parseFloat(row?.lost||0), wagered: parseFloat(row?.wag||0) };
}

async function checkSelfExclusion(userId) {
  try {
    const user = await queryOne('SELECT self_excluded_until, self_excluded_permanent FROM users WHERE id=$1', [userId]);
    if (!user) return { blocked: false };
    if (user.self_excluded_permanent) return { blocked: true, reason: 'Your account has been permanently excluded. Contact support.' };
    if (user.self_excluded_until && new Date(user.self_excluded_until) > new Date()) {
      const until = new Date(user.self_excluded_until).toISOString().slice(0,10);
      return { blocked: true, reason: `You have self-excluded until ${until}. Please respect your decision.` };
    }
    return { blocked: false };
  } catch(e) { console.error('[RG CRITICAL] checkSelfExclusion DB error for user', userId, ':', e.message); return { blocked: false }; // fail-open intentionally — exclusion check failure should NOT block deposits
}

async function checkDepositLimit(userId, amountUsd) {
  try {
    const user = await queryOne('SELECT deposit_limit_daily,deposit_limit_weekly,deposit_limit_monthly FROM users WHERE id=$1', [userId]);
    if (!user) return { allowed: true };
    const [daily, weekly, monthly] = await Promise.all([getStats(userId,getToday()), getStats(userId,getWeekStart()), getStats(userId,getMonthStart())]);
    if (user.deposit_limit_daily !== null && daily.deposited + amountUsd > parseFloat(user.deposit_limit_daily))
      return { allowed: false, reason: `Daily deposit limit of $${user.deposit_limit_daily} would be exceeded (used: $${daily.deposited.toFixed(2)})` };
    if (user.deposit_limit_weekly !== null && weekly.deposited + amountUsd > parseFloat(user.deposit_limit_weekly))
      return { allowed: false, reason: `Weekly deposit limit of $${user.deposit_limit_weekly} would be exceeded (used: $${weekly.deposited.toFixed(2)})` };
    if (user.deposit_limit_monthly !== null && monthly.deposited + amountUsd > parseFloat(user.deposit_limit_monthly))
      return { allowed: false, reason: `Monthly deposit limit of $${user.deposit_limit_monthly} would be exceeded (used: $${monthly.deposited.toFixed(2)})` };
    return { allowed: true };
  } catch(e) { console.error('[RG CRITICAL] checkDepositLimit failed for user:', userId, ':', e.message); process.emit('rg-check-failure', { fn: 'checkDepositLimit', userId, error: e.message }); return { allowed: true }; // fail-open intentionally
}

async function checkWagerLimit(userId, betAmountUsd) {
  try {
    const user = await queryOne('SELECT loss_limit_daily,loss_limit_weekly,loss_limit_monthly,wager_limit_daily FROM users WHERE id=$1', [userId]);
    if (!user) return { allowed: true };
    const [daily, weekly, monthly] = await Promise.all([getStats(userId,getToday()), getStats(userId,getWeekStart()), getStats(userId,getMonthStart())]);
    if (user.wager_limit_daily !== null && daily.wagered + betAmountUsd > parseFloat(user.wager_limit_daily))
      return { allowed: false, reason: `Daily wager limit of $${user.wager_limit_daily} reached (wagered: $${daily.wagered.toFixed(2)})` };
    if (user.loss_limit_daily !== null && daily.lost > parseFloat(user.loss_limit_daily))
      return { allowed: false, reason: `Daily loss limit of $${user.loss_limit_daily} reached` };
    if (user.loss_limit_weekly !== null && weekly.lost > parseFloat(user.loss_limit_weekly))
      return { allowed: false, reason: `Weekly loss limit of $${user.loss_limit_weekly} reached` };
    if (user.loss_limit_monthly !== null && monthly.lost > parseFloat(user.loss_limit_monthly))
      return { allowed: false, reason: `Monthly loss limit of $${user.loss_limit_monthly} reached` };
    return { allowed: true };
  } catch(e) { return { allowed: true }; }
}

async function recordWager(userId, betUsd) {
  try {
    await query(`INSERT INTO rg_daily_stats (user_id,date,wagered) VALUES ($1,$2,$3)
      ON CONFLICT(user_id,date) DO UPDATE SET wagered=rg_daily_stats.wagered+$3`, [userId, getToday(), betUsd]);
  } catch(e) { console.error('[RG] recordWager:', e.message); }
}

async function recordLoss(userId, lossUsd) {
  if (lossUsd <= 0) return;
  try {
    await query(`INSERT INTO rg_daily_stats (user_id,date,lost) VALUES ($1,$2,$3)
      ON CONFLICT(user_id,date) DO UPDATE SET lost=rg_daily_stats.lost+$3`, [userId, getToday(), lossUsd]);
  } catch(e) { console.error('[RG] recordLoss:', e.message); }
}

async function recordDeposit(userId, amountUsd) {
  try {
    await query(`INSERT INTO rg_daily_stats (user_id,date,deposited) VALUES ($1,$2,$3)
      ON CONFLICT(user_id,date) DO UPDATE SET deposited=rg_daily_stats.deposited+$3`, [userId, getToday(), amountUsd]);
  } catch(e) { console.error('[RG] recordDeposit:', e.message); }
}

module.exports = { checkSelfExclusion, checkDepositLimit, checkWagerLimit, recordWager, recordLoss, recordDeposit };
