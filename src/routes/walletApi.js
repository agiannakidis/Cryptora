const express = require('express');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { queryOne, queryAll, query, transaction } = require('../pgdb');
const { insert: chInsert } = require('../chdb');

const router = express.Router();


// ── Wallet API Logger ─────────────────────────────────────────────────────────
function logWalletApi(action, opts) {
  const o = opts || {};
  const { insert: chIns } = require('../chdb');
  chIns('wallet_api_logs', [{
    action: String(action),
    user_id: String(o.userId||''),
    username: String(o.username||''),
    session_id: String(o.sessionId||''),
    round_id: String(o.roundId||''),
    amount: parseFloat(o.amount)||0,
    balance_before: parseFloat(o.balanceBefore)||0,
    balance_after: parseFloat(o.balanceAfter)||0,
    currency: String(o.currency||'USD'),
    game_id: String(o.gameId||''),
    provider: String(o.provider||''),
    request_raw: '{}',
    response_status: String(o.status||'ok'),
    error_msg: String(o.error||''),
    operator_id: String(o.operatorId||''),
  }]).catch(function(){});
}

// ── MD5 ───────────────────────────────────────────────────────────────────────
function md5(message) {
  return crypto.createHash('md5').update(message).digest('hex').toUpperCase();
}

// ── XML helpers ───────────────────────────────────────────────────────────────
function xmlOk(request, data = {}) {
  let inner = '<APIVERSION>1.2</APIVERSION>';
  for (const [k, v] of Object.entries(data)) inner += `<${k.toUpperCase()}>${v}</${k.toUpperCase()}>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<RSP request="${request}" rc="0">\n  ${inner}\n</RSP>`;
}
function xmlErr(request, rc, msg) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<RSP request="${request}" rc="${rc}" msg="${msg}">\n  <APIVERSION>1.2</APIVERSION>\n</RSP>`;
}
function sendXml(res, body) {
  res.set('Content-Type', 'application/xml; charset=UTF-8').send(body);
}

// ── PG helpers ────────────────────────────────────────────────────────────────
async function findUserBySession(sessionToken) {
  if (!sessionToken) return null;
  const session = await queryOne(
    'SELECT * FROM game_sessions WHERE session_token = $1', [sessionToken]
  );
  if (!session) return null;
  const user = await queryOne(
    'SELECT * FROM users WHERE email = $1', [session.user_email]
  );
  return user ? { user, session } : null;
}

async function findUserById(id) {
  if (!id) return null;
  // Try by UUID first, fall back to email (backward compat during transition)
  const byId = await queryOne("SELECT * FROM users WHERE id = $1", [id]);
  if (byId) return byId;
  return queryOne("SELECT * FROM users WHERE email = $1", [id]);
}


// ── Land player helpers ───────────────────────────────────────────────────────
// Land player usernames are prefixed with 'land_' + player UUID
async function findLandPlayer(identifier) {
  if (!identifier) return null;
  let id = identifier;
  if (id.startsWith('land_')) id = id.slice(5);
  // try by UUID
  const p = await queryOne('SELECT * FROM operator_players WHERE id=$1', [id]);
  if (p) return p;
  // try by username (in case they sent raw username)
  return queryOne('SELECT * FROM operator_players WHERE username=$1', [identifier]);
}

function isLandPlayer(identifier) {
  if (!identifier) return false;
  return String(identifier).startsWith('land_');
}

async function updateLandPlayerBalance(id, newBalance) {
  return query('UPDATE operator_players SET balance=$1 WHERE id=$2', [newBalance, id]);
}

async function findUserByEmail(email) {
  if (!email) return null;
  return queryOne('SELECT * FROM users WHERE email = $1', [email]);
}

async function findTx(reference) {
  if (!reference) return null;
  return queryOne('SELECT * FROM tx_idempotency WHERE reference = $1', [reference]);
}

async function createTx(data) {
  const id = data.id || uuidv4();
  const now = new Date().toISOString();

  // Write to PG tx_idempotency (for fast duplicate checks)
  await query(`
    INSERT INTO tx_idempotency (id, reference, user_email, type, amount, balance_after, game_id, game_title, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (reference) DO NOTHING
  `, [id, data.reference, data.user_email, data.type, data.amount, data.balance_after,
      data.game_id || '', data.game_title || '', now]);

  // Write to ClickHouse transactions (analytics) — fire and forget
  chInsert('transactions', [{
    id,
    user_id: data.user_id || '',
    user_email: data.user_email || '',
    type: data.type || '',
    amount: parseFloat(data.amount) || 0,
    currency: data.currency || 'USD',
    status: 'completed',
    description: data.description || '',
    reference: data.reference || '',
    created_at: now.replace('T', ' ').slice(0, 23),
  }]).catch(e => console.error('[CH tx insert]', e.message));

  return { id, ...data };
}

async function updateBalance(userId, newBalance) {
  await query(
    'UPDATE users SET balance = $1, updated_date = NOW() WHERE id = $2',
    [newBalance, userId]
  );
}

// ── VIP points ────────────────────────────────────────────────────────────────
const VIP_THRESHOLDS = [
  { level: 4, minPoints: 100000 },
  { level: 3, minPoints: 25000 },
  { level: 2, minPoints: 5000 },
  { level: 1, minPoints: 1000 },
  { level: 0, minPoints: 0 },
];

async function awardVipPoints(userId, wageredAmount) {
  try {
    const user = await queryOne('SELECT vip_points, vip_level, total_wagered FROM users WHERE id = $1', [userId]);
    if (!user) return;
    const newPoints = parseFloat(user.vip_points || 0) + wageredAmount;
    const newWagered = parseFloat(user.total_wagered || 0) + wageredAmount;
    const newLevel = VIP_THRESHOLDS.find(t => newPoints >= t.minPoints).level;
    await query(
      'UPDATE users SET vip_points = $1, vip_level = $2, total_wagered = $3 WHERE id = $4',
      [newPoints, newLevel, newWagered, userId]
    );
  } catch (e) { /* non-fatal */ }
}

// ── Wagering progress ─────────────────────────────────────────────────────────
const MAX_BET_WAGERING = 5;

async function updateWageringProgress(userId, wageredAmount) {
  try {
    const user = await queryOne('SELECT * FROM users WHERE id = $1', [userId]);
    if (!user || !user.wagering_required || user.wagering_required <= 0) return;

    if (user.bonus_expires_at && new Date(user.bonus_expires_at) < new Date()) {
      await query(`
        UPDATE users SET bonus_balance=0, wagering_required=0,
          wagering_progress=0, wagering_bonus_amount=0, bonus_expires_at=NULL
        WHERE id=$1
      `, [userId]);
      return;
    }

    const counted = Math.min(wageredAmount, MAX_BET_WAGERING);
    const newProgress = parseFloat(user.wagering_progress || 0) + counted;

    if (newProgress >= parseFloat(user.wagering_required)) {
      const bonus = parseFloat(user.bonus_balance || 0);
      await query(`
        UPDATE users SET
          balance = balance + $1, bonus_balance = 0,
          wagering_required = 0, wagering_progress = 0,
          wagering_bonus_amount = 0, bonus_expires_at = NULL
        WHERE id = $2
      `, [bonus, userId]);

      if (bonus > 0) {
        const updated = await queryOne('SELECT balance, email FROM users WHERE id = $1', [userId]);
        await createTx({
          user_email: updated.email, type: 'bonus_unlock', amount: bonus,
          balance_after: updated.balance, reference: `bonus_unlock_${userId}_${Date.now()}`,
          description: 'Bonus unlocked after wagering completed',
        });
      }
    } else {
      await query('UPDATE users SET wagering_progress = $1 WHERE id = $2', [newProgress, userId]);
    }
  } catch (e) {
    console.error('[wagering]', e.message);
  }
}

// ── RG checks (sync wrappers for now) ────────────────────────────────────────
function rgCheckExcl(user) {
  if (user.self_excluded_permanent) return { blocked: true, reason: 'Self-excluded permanently' };
  if (user.self_excluded_until && new Date(user.self_excluded_until) > new Date()) {
    return { blocked: true, reason: 'Self-excluded until ' + user.self_excluded_until };
  }
  return { blocked: false };
}

// ── ClickHouse bet tracking ───────────────────────────────────────────────────
function trackBet(user, gameTitle, provider, sessionId, roundId, betAmount, winAmount, balanceBefore, balanceAfter) {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 23);
  chInsert('bets', [{
    id:            uuidv4(),
    user_id:       user.id || '',
    user_email:    user.email || '',
    game_id:       gameTitle || '',
    game_title:    gameTitle || '',
    provider:      provider || 'pragmatic',
    session_id:    sessionId || '',
    round_id:      roundId || '',
    bet_amount:    betAmount || 0,
    win_amount:    winAmount || 0,
    currency:      user.currency || 'USD',
    multiplier:    betAmount > 0 ? parseFloat(((winAmount || 0) / betAmount).toFixed(4)) : 0,
    is_win:        (winAmount || 0) > (betAmount || 0) ? 1 : 0,
    balance_before: balanceBefore || 0,
    balance_after:  balanceAfter || 0,
    created_at:    now,
  }]).catch(e => console.error('[CH bet insert]', e.message));
  // Affiliate RevShare
  if (user && user.id) trackAffiliateRevShare(user.id, betAmount||0, winAmount||0, { round_id: roundId, game_id: gameTitle, provider });
}

// ── Affiliate RevShare tracking (fire-and-forget, in-process) ────────────────
let _affiliateModule = null;
function getAffiliateModule() {
  if (!_affiliateModule) { try { _affiliateModule = require('./affiliate'); } catch(e) {} }
  return _affiliateModule;
}
function trackAffiliateRevShare(userId, betAmount, winAmount, meta) {
  try {
    const aff = getAffiliateModule();
    if (aff && aff.betSettled) aff.betSettled(userId, betAmount, winAmount, meta||{}).catch(()=>{});
  } catch(e) {}
}
async function trackWagerAffiliate(userId, amount) {
  // kept for compat — no-op
}

async function recordRgWager(userId, amount) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    await query(`
      INSERT INTO rg_daily_stats (user_id, date, wagered)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, date) DO UPDATE SET wagered = rg_daily_stats.wagered + $3
    `, [userId, today, amount]);
  } catch (e) { /* non-fatal */ }
}

// ── Main handler ──────────────────────────────────────────────────────────────
router.all(['/', ''], async (req, res) => {
  const p = { ...req.query, ...req.body };
  const get = (key) => (p[key] !== undefined ? String(p[key]) : '');

  const request = (get('request') || '').toLowerCase();
  const sessionId = get('sessionid') || get('gamesessionid') || '';
  const accountId = get('accountid') || '';

  console.log(`[walletApi] request=${request} session=${sessionId} account=${accountId}`);
  if(request==='result') console.log('[walletApi] result params:', JSON.stringify(p));

  try {
    switch (request) {

      case 'getaccount': {
        const sid = get('sessionid');
        const loginname = get('loginname') || '';
        let user = null;
        const bySession = await findUserBySession(sid);
        if (bySession) {
          user = bySession.user;
        } else if (isLandPlayer(loginname)) {
          const lp = await findLandPlayer(loginname);
          if (lp) return sendXml(res, xmlOk('getaccount', {
            accountid: 'land_' + lp.id,
            username:  lp.username,
            balance:   parseFloat(lp.balance || 0).toFixed(2),
            currency:  lp.currency || 'USD',
            country:   'US', language: 'en', sessionid: sid || '',
          }));
        } else if (loginname) {
          user = await findUserByEmail(loginname);
        }
        if (!user) return sendXml(res, xmlErr('getaccount', 1000, 'Not logged on'));
        return sendXml(res, xmlOk('getaccount', {
          accountid:  user.id,
          username:   user.name || user.email,
          balance:    parseFloat(user.balance || 0).toFixed(2),
          currency:   user.currency || 'USD',
          country:    'US', language:   'en', sessionid:  sid || '',
        }));
      }

      case 'getbalance': {
        if (isLandPlayer(accountId)) {
          const lp = await findLandPlayer(accountId);
          if (!lp) return sendXml(res, xmlErr('getbalance', 1000, 'Not logged on'));
          logWalletApi('getbalance', {userId:lp.id,username:lp.username,sessionId:get('sessionid'),balanceAfter:parseFloat(lp.balance||0),currency:lp.currency||'USD',operatorId:String(lp.operator_id||'')});
        return sendXml(res, xmlOk('getbalance', { balance: parseFloat(lp.balance||0).toFixed(2), currency: lp.currency||'USD' }));
        }
        const found = accountId
          ? await findUserById(accountId)
          : (await findUserBySession(sessionId))?.user;
        if (!found) return sendXml(res, xmlErr('getbalance', 1000, 'Not logged on'));
        logWalletApi('getbalance', {userId:found.id,username:found.name||found.email,sessionId:get('sessionid'),balanceAfter:parseFloat(found.balance||0),currency:found.currency||'USD'});
        return sendXml(res, xmlOk('getbalance', {
          balance:  parseFloat(found.balance || 0).toFixed(2),
          currency: found.currency || 'USD',
        }));
      }

      case 'wager': {
        const transactionId = get('transactionid');
        const roundId       = get('roundid');
        const wagerAmount   = parseFloat(get('betamount') || get('wageramount') || '0');
        const gpid          = get('gpid') || '';
        const gameTitle     = get('gpgameid') || get('gameid') || '';
        const provider      = get('providersessionid') ? 'pragmatic' : (get('provider') || 'unknown');

        if (!transactionId || !roundId)
          return sendXml(res, xmlErr('wager', 1008, 'Parameter required'));

        if (isLandPlayer(accountId)) {
          const lp = await findLandPlayer(accountId);
          if (!lp) return sendXml(res, xmlErr('wager', 1000, 'Not logged on'));
          const lpBal = parseFloat(lp.balance || 0);
          if (lpBal < wagerAmount) return sendXml(res, xmlErr('wager', 1004, 'Insufficient funds'));
          const wagerKey2 = `wager_${accountId}_${roundId}_${transactionId}`;
          const existing2 = await findTx(wagerKey2);
          if (existing2) return sendXml(res, xmlOk('wager', {
            gamesessionid: sessionId, realmoneybet: parseFloat(existing2.amount||0).toFixed(2),
            bonusmoneybet: '0', balance: parseFloat(existing2.balance_after||0).toFixed(2),
            accounttransactionid: existing2.id,
          }));
          const newLpBal = parseFloat((lpBal - wagerAmount).toFixed(2));
          await updateLandPlayerBalance(lp.id, newLpBal);
          const txId = uuidv4();
          await createTx({ id: txId, reference: wagerKey2, user_id: lp.id, user_email: lp.username,
            type: 'bet', amount: wagerAmount, balance_after: newLpBal,
            game_id: get('gpgameid')||'', game_title: get('gpgameid')||'' }).catch(()=>{});
          logWalletApi('wager', {userId:lp.id,username:lp.username,sessionId:get('gamesessionid')||get('sessionid'),roundId:get('roundid'),amount:wagerAmount,balanceBefore:lpBal,balanceAfter:newLpBal,currency:lp.currency||'USD',operatorId:String(lp.operator_id||'')});
          return sendXml(res, xmlOk('wager', {
            gamesessionid: sessionId, realmoneybet: wagerAmount.toFixed(2),
            bonusmoneybet: '0', balance: newLpBal.toFixed(2), accounttransactionid: txId,
          }));
        }
        const user = accountId
          ? await findUserById(accountId)
          : (await findUserBySession(sessionId))?.user;
        if (!user) return sendXml(res, xmlErr('wager', 1000, 'Not logged on'));

        // Idempotency
        const wagerKey = `wager_${gpid}_${roundId}_${transactionId}`;
        const existing = await findTx(wagerKey);
        if (existing) {
          return sendXml(res, xmlOk('wager', {
            gamesessionid:        sessionId,
            realmoneybet:         parseFloat(existing.amount || 0).toFixed(2),
            bonusmoneybet:        '0',
            balance:              parseFloat(existing.balance_after || 0).toFixed(2),
            accounttransactionid: existing.id,
          }));
        }

        // RG exclusion check
        const rgExcl = rgCheckExcl(user);
        if (rgExcl.blocked) return sendXml(res, xmlErr('wager', 1003, rgExcl.reason));

        if (parseFloat(user.balance || 0) < wagerAmount)
          return sendXml(res, xmlErr('wager', 1004, 'Insufficient funds'));

        const balanceBefore = parseFloat(user.balance || 0);
        const newBalance    = parseFloat((balanceBefore - wagerAmount).toFixed(2));

        await updateBalance(user.id, newBalance);

        // Fire-and-forget side effects
        awardVipPoints(user.id, wagerAmount).catch(() => {});
        trackWagerAffiliate(user.id, wagerAmount).catch(() => {});
        recordRgWager(user.id, wagerAmount).catch(() => {});
        updateWageringProgress(user.id, wagerAmount).catch(() => {});

        const tx = await createTx({
          user_id: user.id, user_email: user.email,
          type: 'bet', amount: wagerAmount,
          balance_after: newBalance, reference: wagerKey,
          game_title: gameTitle, description: `Wager round ${roundId}`,
        });

        // ClickHouse: record bet (win will be filled in on 'result')
        trackBet(user, gameTitle, provider, sessionId, roundId,
          wagerAmount, 0, balanceBefore, newBalance);

        return sendXml(res, xmlOk('wager', {
          gamesessionid:        sessionId,
          realmoneybet:         wagerAmount.toFixed(2),
          bonusmoneybet:        '0',
          balance:              newBalance.toFixed(2),
          accounttransactionid: tx.id,
        }));
      }

      case 'result': {
        const transactionId = get('transactionid');
        const roundId       = get('roundid');
        // 'result' param name conflicts with request name — use resultamount/winamount
        const winAmount     = parseFloat(get('winamount') || get('resultamount') || get('win') || (request==='result' ? get('result') : '') || '0');
        const gpid          = get('gpid') || '';
        const gameStatus    = get('gamestatus') || '';
        const gameTitle     = get('gpgameid') || get('gameid') || '';
        const provider      = get('providersessionid') ? 'pragmatic' : (get('provider') || 'unknown');

        if (!transactionId || !roundId)
          return sendXml(res, xmlErr('result', 1008, 'Parameter required'));

        if (isLandPlayer(accountId)) {
          const lp = await findLandPlayer(accountId);
          if (!lp) return sendXml(res, xmlErr('result', 1000, 'Not logged on'));
          const resultKey2 = `result_${accountId}_${roundId}_${transactionId}`;
          const existing2 = await findTx(resultKey2);
          if (existing2) return sendXml(res, xmlOk('result', {
            gamesessionid: sessionId, balance: parseFloat(existing2.balance_after||0).toFixed(2),
            accounttransactionid: existing2.id,
          }));
          const lpBal = parseFloat(lp.balance || 0);
          const newLpBal = parseFloat((lpBal + winAmount).toFixed(2));
          await updateLandPlayerBalance(lp.id, newLpBal);
          const txId = uuidv4();
          await createTx({ id: txId, reference: resultKey2, user_id: lp.id, user_email: lp.username,
            type: 'win', amount: winAmount, balance_after: newLpBal,
            game_id: gameTitle, game_title: gameTitle }).catch(()=>{});
          logWalletApi('result', {userId:lp.id,username:lp.username,sessionId:get('gamesessionid')||get('sessionid'),roundId:get('roundid'),amount:winAmount,balanceBefore:lpBal,balanceAfter:newLpBal,currency:lp.currency||'USD',operatorId:String(lp.operator_id||'')});
          return sendXml(res, xmlOk('result', {
            gamesessionid: sessionId, balance: newLpBal.toFixed(2), accounttransactionid: txId,
          }));
        }
        const user = accountId
          ? await findUserById(accountId)
          : (await findUserBySession(sessionId))?.user;
        if (!user) return sendXml(res, xmlErr('result', 1000, 'Not logged on'));

        const resultKey = `result_${gpid}_${roundId}_${transactionId}`;
        const existing  = await findTx(resultKey);
        if (existing) {
          return sendXml(res, xmlOk('result', {
            gamesessionid:        sessionId,
            balance:              parseFloat(existing.balance_after || 0).toFixed(2),
            accounttransactionid: existing.id,
          }));
        }

        const balanceBefore = parseFloat(user.balance || 0);
        const newBalance    = parseFloat((balanceBefore + winAmount).toFixed(2));

        await updateBalance(user.id, newBalance);

        const tx = await createTx({
          user_id: user.id, user_email: user.email,
          type: 'win', amount: winAmount,
          balance_after: newBalance, reference: resultKey,
          game_title: gameTitle, description: `Result round ${roundId} (${gameStatus})`,
        });

        if (gameStatus === 'completed') {
          await createTx({
            user_email: user.email, type: 'round_complete', amount: 0,
            balance_after: newBalance,
            reference: `result_completed_${gpid}_${roundId}`,
            game_title: gameTitle, description: `Round ${roundId} closed`,
          });
        }

        // ClickHouse: record full bet+win for this round
        // Find original wager amount from idempotency table
        const wagerTx = await queryOne(
          "SELECT amount FROM tx_idempotency WHERE reference LIKE $1 AND type = 'bet'",
          [`wager_${gpid}_${roundId}_%`]
        );
        const betAmount = wagerTx ? parseFloat(wagerTx.amount) : 0;
        trackBet(user, gameTitle, provider, sessionId, roundId,
          betAmount, winAmount, balanceBefore, newBalance);

        return sendXml(res, xmlOk('result', {
          gamesessionid:        sessionId,
          balance:              newBalance.toFixed(2),
          accounttransactionid: tx.id,
        }));
      }

      case 'rollback': {
        const transactionId  = get('transactionid');
        const roundId        = get('roundid');
        const rollbackAmount = parseFloat(get('betamount') || get('rollbackamount') || '0');
        const gpid           = get('gpid') || '';

        if (!transactionId || !roundId)
          return sendXml(res, xmlErr('rollback', 1008, 'Parameter required'));

        const user = accountId
          ? await findUserById(accountId)
          : (await findUserBySession(sessionId))?.user;
        if (!user) return sendXml(res, xmlErr('rollback', 1000, 'Not logged on'));

        const completedKey = `result_completed_${gpid}_${roundId}`;
        if (await findTx(completedKey))
          return sendXml(res, xmlErr('rollback', 110, 'Operation not allowed'));

        const rbKey   = `rollback_${gpid}_${roundId}_${transactionId}`;
        const existing = await findTx(rbKey);
        if (existing) {
          return sendXml(res, xmlOk('rollback', {
            gamesessionid:        sessionId,
            balance:              parseFloat(existing.balance_after || 0).toFixed(2),
            accounttransactionid: existing.id,
          }));
        }

        const newBalance = parseFloat((parseFloat(user.balance || 0) + rollbackAmount).toFixed(2));
        await updateBalance(user.id, newBalance);

        const tx = await createTx({
          user_id: user.id, user_email: user.email,
          type: 'refund', amount: rollbackAmount,
          balance_after: newBalance, reference: rbKey,
          description: `Rollback round ${roundId}`,
        });

        return sendXml(res, xmlOk('rollback', {
          gamesessionid:        sessionId,
          balance:              newBalance.toFixed(2),
          accounttransactionid: tx.id,
        }));
      }

      case 'freespin': {
        const user = accountId
          ? await findUserById(accountId)
          : (await findUserBySession(sessionId))?.user;
        if (!user) return sendXml(res, xmlErr('freespin', 1000, 'Not logged on'));
        return sendXml(res, xmlOk('freespin', {
          balance: parseFloat(user.balance || 0).toFixed(2),
        }));
      }

      case 'ping':
        return sendXml(res, xmlOk('ping', {}));

      case 'close':
        return sendXml(res, xmlOk('close', {}));

      default:
        return sendXml(res, xmlErr(request || 'unknown', 1, 'Unknown request method'));
    }
  } catch (e) {
    console.error('[walletApi] ERROR:', e.message, e.stack);
    return sendXml(res, xmlErr(request || 'error', 500, 'Internal error'));
  }
});

module.exports = router;
