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
  // Always use absolute SET — caller must ensure correct value from fresh SELECT
  if (newBalance < 0) throw new Error('Balance cannot go negative');
  return query('UPDATE operator_players SET balance=$1 WHERE id=$2', [newBalance, id]);
}

async function deductLandPlayerBalance(id, amount) {
  // Atomic deduction with negative-balance guard
  const result = await query(
    'UPDATE operator_players SET balance = balance - $1 WHERE id = $2 AND balance >= $1 RETURNING balance',
    [amount, id]
  );
  if (!result.rowCount) throw new Error('Insufficient funds or player not found');
  return result.rows[0].balance;
}

async function creditLandPlayerBalance(id, amount) {
  // Atomic credit
  const result = await query(
    'UPDATE operator_players SET balance = balance + $1 WHERE id = $2 RETURNING balance',
    [amount, id]
  );
  if (!result.rowCount) throw new Error('Player not found');
  return result.rows[0].balance;
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
  // Legacy: used only when balance is pre-calculated in a locked transaction
  await query(
    'UPDATE users SET balance = $1, updated_date = NOW() WHERE id = $2',
    [newBalance, userId]
  );
}

async function atomicDeductBalance(client, userId, amount) {
  // Atomic deduction with balance guard — returns new balance
  const r = await client.query(
    'UPDATE users SET balance = balance - $1, updated_date = NOW() WHERE id = $2 AND balance >= $1 RETURNING balance',
    [amount, userId]
  );
  if (!r.rowCount) throw new Error('INSUFFICIENT_FUNDS');
  return parseFloat(r.rows[0].balance);
}

async function atomicCreditBalance(client, userId, amount) {
  // Atomic credit — returns new balance
  const r = await client.query(
    'UPDATE users SET balance = balance + $1, updated_date = NOW() WHERE id = $2 RETURNING balance',
    [amount, userId]
  );
  if (!r.rowCount) throw new Error('USER_NOT_FOUND');
  return parseFloat(r.rows[0].balance);
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
// Jackpot contribution + win check
// Chance = base_chance * betAmount * (currentAmount / maxAmount)
async function contributeToJackpot(betAmount, userId, userEmail, gameTitle) {
  try {
    const jp = await queryOne('SELECT id, amount, contribution_rate, max_amount, win_chance_base, seed_amount FROM jackpot LIMIT 1');
    if (!jp) return;
    const contrib = parseFloat(betAmount) * parseFloat(jp.contribution_rate);
    if (contrib <= 0) return;

    // Add contribution and get updated amount
    const updated = await queryOne(
      'UPDATE jackpot SET amount = amount + $1, total_contributed = total_contributed + $1, updated_at = NOW() WHERE id = $2 RETURNING amount',
      [contrib, jp.id]
    );
    if (!updated || !userId) return;

    // Win probability: scales with bet size and jackpot fill ratio
    const currentAmount = parseFloat(updated.amount);
    const maxAmount = parseFloat(jp.max_amount) || 100000;
    const baseChance = parseFloat(jp.win_chance_base) || 0.00001;
    const bet = parseFloat(betAmount);
    const fillRatio = Math.min(currentAmount / maxAmount, 1);
    const winProbability = baseChance * bet * fillRatio;

    if (Math.random() >= winProbability) return; // no win this time

    // === JACKPOT WIN ===
    const seedAmount = Math.max(currentAmount * 0.01, 100); // 1% of jackpot win, min $100
    const { randomUUID } = require('crypto');

    await transaction(async (client) => {
      // Reset jackpot to seed amount
      await client.query(
        'UPDATE jackpot SET amount = $1, last_won_at = NOW(), last_winner_email = $2, last_winner_amount = $3 WHERE id = $4',
        [seedAmount, userEmail, currentAmount, jp.id]
      );
      // Credit winner balance
      await client.query(
        'UPDATE users SET balance = balance + $1 WHERE id = $2',
        [currentAmount, userId]
      );
      // Record in jackpot_winners
      await client.query(
        'INSERT INTO jackpot_winners (id, user_id, user_email, amount, game_title, won_at) VALUES ($1,$2,$3,$4,$5,NOW())',
        [randomUUID(), userId, userEmail || '', currentAmount, gameTitle || 'Unknown']
      );
    });
    console.log('[JACKPOT WIN] ' + userEmail + ' won $' + currentAmount.toFixed(2) + ' playing ' + gameTitle);
  } catch (e) {
    console.error('[jackpot error]', e.message);
  }
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

  // ── Pragmatic/GrandX signature verification ───────────────────────────────
  // Signature = MD5(PrivateKey + all params sorted alphabetically, excluding 'hash')
  // Only enforce when PRAGMATIC_PRIVATE_KEY is set and hash param is present
  const privateKey = process.env.PRAGMATIC_PRIVATE_KEY;
  const receivedHash = get('hash');
  if (privateKey && receivedHash) {
    const sortedKeys = Object.keys(p).filter(k => k !== 'hash').sort();
    const paramStr = sortedKeys.map(k => `${k}=${p[k]}`).join('&');
    const expectedHash = md5(privateKey + paramStr);
    if (receivedHash.toUpperCase() !== expectedHash) {
      console.warn('[walletApi] SIGNATURE MISMATCH — possible forgery attempt!', { request, sessionId, accountId });
      return sendXml(res, xmlErr(request || 'unknown', 403, 'Invalid signature'));
    }
  }

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
          accountid:     user.id,
          username:      user.name || user.email,
          balance:       parseFloat(user.balance || 0).toFixed(2),
          currency:      user.currency || 'USD',
          country:       'US', language: 'en',
          sessionid:     sid || '',
          gamesessionid: get('gamesessionid') || sid || '',
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
          const wagerKey2 = `wager_${accountId}_${roundId}_${transactionId}`;
          const existing2 = await findTx(wagerKey2);
          if (existing2) return sendXml(res, xmlOk('wager', {
            gamesessionid: sessionId, realmoneybet: parseFloat(existing2.amount||0).toFixed(2),
            bonusmoneybet: '0', balance: parseFloat(existing2.balance_after||0).toFixed(2),
            accounttransactionid: existing2.id,
          }));
          // Atomic deduction — prevents race condition / double-spend
          let newLpBal;
          try {
            newLpBal = parseFloat(await deductLandPlayerBalance(lp.id, wagerAmount));
          } catch(e) {
            return sendXml(res, xmlErr('wager', 1004, 'Insufficient funds'));
          }
          const lpBal = parseFloat((newLpBal + wagerAmount).toFixed(2));
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

        // Idempotency — fast path (before locking)
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

        // Atomic: lock user row, deduct balance, insert idempotency — all in one transaction
        let newBalance, balanceBefore, txId;
        try {
          await transaction(async (client) => {
            // Lock the user row — blocks concurrent wagers for same user
            const locked = await client.query(
              'SELECT balance FROM users WHERE id=$1 FOR UPDATE',
              [user.id]
            );
            if (!locked.rowCount) throw new Error('USER_NOT_FOUND');

            // Double-check idempotency inside the lock
            const dup = await client.query(
              'SELECT id, balance_after FROM tx_idempotency WHERE reference=$1',
              [wagerKey]
            );
            if (dup.rowCount) {
              // Already processed — use stored result
              newBalance = parseFloat(dup.rows[0].balance_after);
              txId = dup.rows[0].id;
              balanceBefore = null; // signal duplicate
              return;
            }

            balanceBefore = parseFloat(locked.rows[0].balance || 0);
            newBalance = await atomicDeductBalance(client, user.id, wagerAmount);
            txId = uuidv4();
            await client.query(`
              INSERT INTO tx_idempotency (id, reference, user_email, type, amount, balance_after, game_id, game_title, created_at)
              VALUES ($1,$2,$3,'bet',$4,$5,$6,$7,$8)
              ON CONFLICT (reference) DO NOTHING
            `, [txId, wagerKey, user.email, wagerAmount, newBalance,
                gameTitle, gameTitle, new Date().toISOString()]);
          });
        } catch(e) {
          if (e.message === 'INSUFFICIENT_FUNDS') return sendXml(res, xmlErr('wager', 1004, 'Insufficient funds'));
          throw e;
        }

        // Fire-and-forget side effects (outside lock)
        if (balanceBefore !== null) {
          awardVipPoints(user.id, wagerAmount).catch(() => {});
          trackWagerAffiliate(user.id, wagerAmount).catch(() => {});
          recordRgWager(user.id, wagerAmount).catch(() => {});
          updateWageringProgress(user.id, wagerAmount).catch(() => {});
          contributeToJackpot(wagerAmount, user.id, user.email, gameTitle).catch(() => {});
          // ClickHouse bet record
          trackBet(user, gameTitle, provider, sessionId, roundId, wagerAmount, 0, balanceBefore, newBalance);
        }

        const tx = { id: txId }; // already inserted above

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
          // Only credit if win > 0 (no-win result still records TX for audit)
          const newLpBal = winAmount > 0
            ? parseFloat(await creditLandPlayerBalance(lp.id, winAmount))
            : lpBal;
          const txId = uuidv4();
          await createTx({ id: txId, reference: resultKey2, user_id: lp.id, user_email: lp.username,
            type: winAmount > 0 ? 'win' : 'loss', amount: winAmount, balance_after: newLpBal,
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

        let balanceBefore, newBalance, txId2;
        await transaction(async (client) => {
          // Lock user row
          const locked = await client.query('SELECT balance FROM users WHERE id=$1 FOR UPDATE', [user.id]);
          if (!locked.rowCount) throw new Error('USER_NOT_FOUND');

          // Double-check idempotency inside lock
          const dup = await client.query('SELECT id, balance_after FROM tx_idempotency WHERE reference=$1', [resultKey]);
          if (dup.rowCount) {
            newBalance = parseFloat(dup.rows[0].balance_after);
            txId2 = dup.rows[0].id;
            balanceBefore = null;
            return;
          }

          balanceBefore = parseFloat(locked.rows[0].balance || 0);
          newBalance = winAmount > 0
            ? await atomicCreditBalance(client, user.id, winAmount)
            : balanceBefore;

          txId2 = uuidv4();
          await client.query(`
            INSERT INTO tx_idempotency (id, reference, user_email, type, amount, balance_after, game_id, game_title, created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            ON CONFLICT (reference) DO NOTHING
          `, [txId2, resultKey, user.email, winAmount > 0 ? 'win' : 'loss',
              winAmount, newBalance, gameTitle, gameTitle, new Date().toISOString()]);
        });

        const tx = { id: txId2 };

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

        // Land player rollback — refund the bet atomically
        if (isLandPlayer(accountId)) {
          const lp = await findLandPlayer(accountId);
          if (!lp) return sendXml(res, xmlErr('rollback', 1000, 'Not logged on'));
          const rbKey2 = `rollback_${accountId}_${roundId}_${transactionId}`;
          const existing2 = await findTx(rbKey2);
          if (existing2) return sendXml(res, xmlOk('rollback', {
            gamesessionid: sessionId, balance: parseFloat(existing2.balance_after||0).toFixed(2),
            accounttransactionid: existing2.id,
          }));
          const lpBal = parseFloat(lp.balance || 0);
          const newLpBal = rollbackAmount > 0
            ? parseFloat(await creditLandPlayerBalance(lp.id, rollbackAmount))
            : lpBal;
          const txId = uuidv4();
          await createTx({ id: txId, reference: rbKey2, user_id: lp.id, user_email: lp.username,
            type: 'refund', amount: rollbackAmount, balance_after: newLpBal,
            game_id: '', game_title: '' }).catch(()=>{});
          return sendXml(res, xmlOk('rollback', {
            gamesessionid: sessionId, balance: newLpBal.toFixed(2), accounttransactionid: txId,
          }));
        }

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

        // Atomic rollback — credit bet amount back with row lock
        let newBalance, rbTxId;
        await transaction(async (client) => {
          const dup = await client.query('SELECT id, balance_after FROM tx_idempotency WHERE reference=$1', [rbKey]);
          if (dup.rowCount) { newBalance = parseFloat(dup.rows[0].balance_after); rbTxId = dup.rows[0].id; return; }
          await client.query('SELECT balance FROM users WHERE id=$1 FOR UPDATE', [user.id]);
          newBalance = rollbackAmount > 0
            ? await atomicCreditBalance(client, user.id, rollbackAmount)
            : parseFloat(user.balance || 0);
          rbTxId = uuidv4();
          const rbSql = 'INSERT INTO tx_idempotency (id, reference, user_email, type, amount, balance_after, game_id, game_title, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (reference) DO NOTHING';
          await client.query(rbSql, [rbTxId, rbKey, user.email, 'refund', rollbackAmount, newBalance, '', '', new Date().toISOString()]);
        });
        const tx = { id: rbTxId };

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
