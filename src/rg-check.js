// /root/casino-backend/src/rg-check.js
// Responsible Gambling enforcement helpers

const db = require('./db');

function getToday() {
  return new Date().toISOString().slice(0, 10);
}
function getWeekStart() {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0, 10);
}
function getMonthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function getStats(userId, fromDate) {
  const row = db.prepare(
    'SELECT SUM(deposited) as dep, SUM(lost) as lost, SUM(wagered) as wag FROM rg_daily_stats WHERE user_id = ? AND date >= ?'
  ).get(userId, fromDate);
  return { deposited: row.dep || 0, lost: row.lost || 0, wagered: row.wag || 0 };
}

/**
 * Check if user is self-excluded.
 * Returns { blocked: true, reason } or { blocked: false }
 */
function checkSelfExclusion(userId) {
  const user = db.prepare('SELECT self_excluded_until, self_excluded_permanent FROM users WHERE id = ?').get(userId);
  if (!user) return { blocked: false };
  if (user.self_excluded_permanent) {
    return { blocked: true, reason: 'Your account has been permanently excluded. Contact support.' };
  }
  if (user.self_excluded_until && new Date(user.self_excluded_until) > new Date()) {
    const until = user.self_excluded_until.slice(0, 10);
    return { blocked: true, reason: `You have self-excluded until ${until}. Please respect your decision.` };
  }
  return { blocked: false };
}

/**
 * Check deposit limits before crediting.
 * Returns { allowed: true } or { allowed: false, reason }
 */
function checkDepositLimit(userId, amountUsd) {
  const user = db.prepare('SELECT deposit_limit_daily, deposit_limit_weekly, deposit_limit_monthly FROM users WHERE id = ?').get(userId);
  if (!user) return { allowed: true };

  const daily = getStats(userId, getToday());
  const weekly = getStats(userId, getWeekStart());
  const monthly = getStats(userId, getMonthStart());

  if (user.deposit_limit_daily !== null) {
    if (daily.deposited + amountUsd > user.deposit_limit_daily) {
      return { allowed: false, reason: `Daily deposit limit of $${user.deposit_limit_daily} would be exceeded (used: $${daily.deposited.toFixed(2)})` };
    }
  }
  if (user.deposit_limit_weekly !== null) {
    if (weekly.deposited + amountUsd > user.deposit_limit_weekly) {
      return { allowed: false, reason: `Weekly deposit limit of $${user.deposit_limit_weekly} would be exceeded (used: $${weekly.deposited.toFixed(2)})` };
    }
  }
  if (user.deposit_limit_monthly !== null) {
    if (monthly.deposited + amountUsd > user.deposit_limit_monthly) {
      return { allowed: false, reason: `Monthly deposit limit of $${user.deposit_limit_monthly} would be exceeded (used: $${monthly.deposited.toFixed(2)})` };
    }
  }
  return { allowed: true };
}

/**
 * Check loss + wager limits before allowing a bet.
 * Returns { allowed: true } or { allowed: false, reason }
 */
function checkWagerLimit(userId, betAmountUsd) {
  const user = db.prepare('SELECT loss_limit_daily, loss_limit_weekly, loss_limit_monthly, wager_limit_daily FROM users WHERE id = ?').get(userId);
  if (!user) return { allowed: true };

  const daily = getStats(userId, getToday());
  const weekly = getStats(userId, getWeekStart());
  const monthly = getStats(userId, getMonthStart());

  // Wager limit
  if (user.wager_limit_daily !== null) {
    if (daily.wagered + betAmountUsd > user.wager_limit_daily) {
      return { allowed: false, reason: `Daily wager limit of $${user.wager_limit_daily} reached (wagered: $${daily.wagered.toFixed(2)})` };
    }
  }
  // Loss limits — use wagered - won as approximation. Here we just check wagered as proxy.
  if (user.loss_limit_daily !== null) {
    if (daily.lost > user.loss_limit_daily) {
      return { allowed: false, reason: `Daily loss limit of $${user.loss_limit_daily} reached` };
    }
  }
  if (user.loss_limit_weekly !== null) {
    if (weekly.lost > user.loss_limit_weekly) {
      return { allowed: false, reason: `Weekly loss limit of $${user.loss_limit_weekly} reached` };
    }
  }
  if (user.loss_limit_monthly !== null) {
    if (monthly.lost > user.loss_limit_monthly) {
      return { allowed: false, reason: `Monthly loss limit of $${user.loss_limit_monthly} reached` };
    }
  }
  return { allowed: true };
}

/**
 * Record a bet (debit) for RG stats.
 * @param {string} userId
 * @param {number} betUsd
 */
function recordWager(userId, betUsd) {
  try {
    const today = getToday();
    db.prepare(
      'INSERT INTO rg_daily_stats (user_id, date, wagered) VALUES (?, ?, ?) ON CONFLICT(user_id, date) DO UPDATE SET wagered = wagered + excluded.wagered'
    ).run(userId, today, betUsd);
  } catch (e) {
    console.error('[RG] recordWager error:', e.message);
  }
}

/**
 * Record a loss for RG stats (call when game result is a loss).
 * @param {string} userId
 * @param {number} lossUsd  — amount lost (bet - win)
 */
function recordLoss(userId, lossUsd) {
  if (lossUsd <= 0) return;
  try {
    const today = getToday();
    db.prepare(
      'INSERT INTO rg_daily_stats (user_id, date, lost) VALUES (?, ?, ?) ON CONFLICT(user_id, date) DO UPDATE SET lost = lost + excluded.lost'
    ).run(userId, today, lossUsd);
  } catch (e) {
    console.error('[RG] recordLoss error:', e.message);
  }
}

/**
 * Record a deposit for RG stats.
 * @param {string} userId
 * @param {number} amountUsd
 */
function recordDeposit(userId, amountUsd) {
  try {
    const today = getToday();
    db.prepare(
      'INSERT INTO rg_daily_stats (user_id, date, deposited) VALUES (?, ?, ?) ON CONFLICT(user_id, date) DO UPDATE SET deposited = deposited + excluded.deposited'
    ).run(userId, today, amountUsd);
  } catch (e) {
    console.error('[RG] recordDeposit error:', e.message);
  }
}

module.exports = {
  checkSelfExclusion,
  checkDepositLimit,
  checkWagerLimit,
  recordWager,
  recordLoss,
  recordDeposit,
};
