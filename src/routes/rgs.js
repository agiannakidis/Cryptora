/**
 * rgs.js — game-services.work RGS integration
 * Routes registered at /api/rgs
 *
 * Endpoints:
 *   GET  /api/rgs/launch            — frontend calls this to get launch URL
 *   GET  /api/rgs/games             — proxy to fetch game list from RGS
 *   GET  /api/rgs/wallet/session    — RGS callback: validate player token
 *   GET  /api/rgs/wallet/balance    — RGS callback: return player balance
 *   POST /api/rgs/wallet/credit-debit — RGS callback: bet+win
 *   POST /api/rgs/wallet/credit/rollback — RGS callback: rollback
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { queryOne, queryAll, query } = require('../pgdb');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const RGS_AUTH_TOKEN = process.env.RGS_AUTH_TOKEN || '';
const RGS_OPERATOR_ID = process.env.RGS_OPERATOR_ID || 'cryptora';
const RGS_ACCESS_TOKEN = process.env.RGS_ACCESS_TOKEN || '';
const RGS_LAUNCH_URL = process.env.RGS_LAUNCH_URL || 'https://rgs.game-services.work/platform/api/game/launch';
const RGS_GAMES_URL = process.env.RGS_GAMES_URL || 'https://rgs.game-services.work/platform/api/games';

// ── Auth middleware for RGS wallet callbacks ───────────────────────────────
function rgsAuth(req, res, next) {
  const token = req.headers['x-auth-token'];
  if (!token || token !== RGS_AUTH_TOKEN) {
    return res.status(400).json({ error_code: 'NOT_AUTHORIZED' });
  }
  next();
}

// ── Helpers ────────────────────────────────────────────────────────────────
async function getBalance(userId) {
  // Support both main users and land operator_players (prefixed with 'land:')
  if (String(userId).startsWith('land:')) {
    const pid = userId.slice(5);
    const row = await queryOne('SELECT balance FROM operator_players WHERE id=$1', [pid]);
    return parseFloat(row?.balance || 0);
  }
  const row = await queryOne('SELECT balance FROM users WHERE id=$1', [userId]);
  return parseFloat(row?.balance || 0);
}

async function updateBalance(userId, delta) {
  if (String(userId).startsWith('land:')) {
    const pid = userId.slice(5);
    const row = await queryOne(
      'UPDATE operator_players SET balance = balance + $1 WHERE id=$2 RETURNING balance',
      [delta, pid]
    );
    return parseFloat(row?.balance || 0);
  }
  const row = await queryOne(
    'UPDATE users SET balance = balance + $1 WHERE id=$2 RETURNING balance',
    [delta, userId]
  );
  return parseFloat(row?.balance || 0);
}

// ── 1. GET /api/rgs/launch ─────────────────────────────────────────────────
// Called by frontend. Returns redirect URL to game-services.work.
router.get('/launch', authMiddleware, async (req, res) => {
  try {
    const { game_uuid, device } = req.query;
    if (!game_uuid) return res.status(400).json({ error: 'game_uuid required' });

    const user = req.user;
    const currency = user.preferred_currency || user.currency || 'USD';

    // Create player token + session
    const playerToken = uuidv4();
    const sessionId = uuidv4();

    await query(
      `INSERT INTO rgs_sessions (player_token, session_id, user_id, game_uuid, currency)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (player_token) DO NOTHING`,
      [playerToken, sessionId, user.id, game_uuid, currency]
    );

    const deviceType = (device || '').toUpperCase() === 'MOBILE' ? 'MOBILE' : 'DESKTOP';
    const lobbyUrl = encodeURIComponent('https://cryptora.live/');
    const launchUrl = `${RGS_LAUNCH_URL}?operator_id=${RGS_OPERATOR_ID}&player_token=${playerToken}&currency=${currency}&game_uuid=${encodeURIComponent(game_uuid)}&device_type=${deviceType}&lobby_url=${lobbyUrl}`;

    res.json({ url: launchUrl });
  } catch (e) {
    console.error('[RGS launch]', e.message);
    res.status(500).json({ error: 'Launch failed' });
  }
});

// ── 2. GET /api/rgs/games ──────────────────────────────────────────────────
// Proxies game list from RGS (for admin import)
router.get('/games', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const provider = req.query.provider || '';
    const url = provider ? `${RGS_GAMES_URL}?softwareProvider=${encodeURIComponent(provider)}` : RGS_GAMES_URL;
    const r = await fetch(url, {
      headers: { 'Authorization': `Bearer ${RGS_ACCESS_TOKEN}` }
    });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    console.error('[RGS games]', e.message);
    res.status(500).json({ error: 'Failed to fetch games' });
  }
});

// ── 3. GET /api/rgs/wallet/session ─────────────────────────────────────────
// RGS → operator: validate playerToken, return playerId + sessionId + currency
router.get('/wallet/session', rgsAuth, async (req, res) => {
  try {
    const { playerToken, gameUuid } = req.query;
    console.log('[RGS session] playerToken:', playerToken?.slice(0,8), 'gameUuid:', gameUuid?.slice(0,8));
    if (!playerToken) return res.status(400).json({ error_code: 'INVALID_TOKEN' });

    let session = await queryOne(
      'SELECT * FROM rgs_sessions WHERE player_token=$1 AND active=TRUE AND expires_at > NOW()',
      [playerToken]
    );

    if (!session) {
      // Try expired session — extend it (game reload after >24h)
      const expired = await queryOne(
        'SELECT * FROM rgs_sessions WHERE player_token=$1 AND active=TRUE',
        [playerToken]
      );
      if (expired) {
        await query(
          'UPDATE rgs_sessions SET expires_at = NOW() + INTERVAL \'24 hours\' WHERE player_token=$1',
          [playerToken]
        );
        session = expired;
      }
    }

    if (!session) return res.status(400).json({ error_code: 'INVALID_TOKEN' });

    // Rolling 24h session
    await query(
      'UPDATE rgs_sessions SET expires_at = NOW() + INTERVAL \'24 hours\' WHERE player_token=$1',
      [playerToken]
    );

    res.json({
      playerId: session.user_id,
      sessionId: session.session_id,
      currency: session.currency || 'USD',
    });
  } catch (e) {
    console.error('[RGS /session]', e.message);
    res.status(400).json({ error_code: 'TECHNICAL_ERROR' });
  }
});

// ── 4. GET /api/rgs/wallet/balance ─────────────────────────────────────────
// RGS → operator: return player balance
router.get('/wallet/balance', rgsAuth, async (req, res) => {
  try {
    const { playerId, sessionId, currency, gameUuid } = req.query;
    console.log('[RGS balance] playerId:', playerId?.slice(0,8), 'sessionId:', sessionId?.slice(0,8));
    if (!playerId || !sessionId) return res.status(400).json({ error_code: 'INVALID_SESSION' });

    // Validate session
    const session = await queryOne(
      `SELECT * FROM rgs_sessions WHERE session_id=$1 AND user_id=$2 AND active=TRUE`,
      [sessionId, playerId]
    );
    if (!session) return res.status(400).json({ error_code: 'INVALID_SESSION' });

    const balance = await getBalance(playerId);
    res.json({ balance: parseFloat(balance.toFixed(2)) });
  } catch (e) {
    console.error('[RGS /balance]', e.message);
    res.status(400).json({ error_code: 'TECHNICAL_ERROR' });
  }
});

// ── 5. POST /api/rgs/wallet/credit-debit ───────────────────────────────────
// RGS → operator: combined bet + win (idempotent)
router.post('/wallet/credit-debit', rgsAuth, async (req, res) => {
  try {
    const {
      playerId, creditAmount, debitAmount, gameUuid, sessionId,
      roundId, transactionId, transactionType, transactionTimestamp,
      roundStarted, roundFinished, currency
    } = req.body;

    console.log('[RGS credit-debit] body:', JSON.stringify({
      playerId, creditAmount, debitAmount, gameUuid: gameUuid?.slice(0,8),
      sessionId: sessionId?.slice(0,8), roundId: roundId?.slice(0,8),
      transactionId: transactionId?.slice(0,8), transactionType, currency
    }));

    if (!playerId || !sessionId || !transactionId) {
      return res.status(400).json({ error_code: 'INVALID_PLAYER_ID' });
    }

    // Idempotency — return existing result if already processed
    const existing = await queryOne(
      'SELECT balance_after FROM rgs_transactions WHERE transaction_id=$1 AND rolled_back=FALSE',
      [transactionId]
    );
    if (existing) {
      return res.json({ balance: parseFloat(existing.balance_after) });
    }

    // Validate session
    const session = await queryOne(
      'SELECT * FROM rgs_sessions WHERE session_id=$1 AND user_id=$2 AND active=TRUE',
      [sessionId, playerId]
    );
    if (!session) return res.status(400).json({ error_code: 'INVALID_SESSION' });

    const debit = parseFloat(debitAmount) || 0;
    const credit = parseFloat(creditAmount) || 0;
    const net = debit - credit;  // debit = operator pays player (win), credit = operator receives from player (bet)

    // Check sufficient funds — creditAmount = bet (money from player), debitAmount = win (money to player)
    if (credit > 0) {
      const currentBalance = await getBalance(playerId);
      if (currentBalance < credit) {
        return res.status(400).json({ error_code: 'INSUFFICIENT_FUNDS' });
      }
    }

    // Apply balance change
    const newBalance = await updateBalance(playerId, net);

    // Record transaction
    await query(
      `INSERT INTO rgs_transactions
         (transaction_id, player_id, session_id, round_id, game_uuid,
          debit_amount, credit_amount, net_amount, currency, transaction_type,
          round_started, round_finished, balance_after)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [transactionId, playerId, sessionId, roundId, gameUuid,
       debit, credit, net, currency || 'USD', transactionType || '',
       !!roundStarted, !!roundFinished, newBalance]
    );

    // Record in ClickHouse for analytics
    try {
      const { insert: chInsert } = require('../chdb');
      const rows = [];
      const ts = new Date().toISOString().replace('T',' ').slice(0,19);
      if (debit > 0) rows.push({ id: uuidv4(), user_id: playerId, game_id: gameUuid, amount: String(debit), currency: currency || 'USD', created_at: ts });
      if (credit > 0) rows.push({ id: uuidv4(), user_id: playerId, game_id: gameUuid, amount: String(-credit), currency: currency || 'USD', created_at: ts });
      if (rows.length > 0) await chInsert('bets', rows);
    } catch (_) {}

    // Update jackpot contribution
    if (debit > 0) {
      try {
        await query(
          `UPDATE jackpot SET amount = LEAST(amount + $1 * contribution_rate, max_amount) WHERE id = (SELECT id FROM jackpot LIMIT 1)`,
          [debit]
        );
      } catch (_) {}
    }

    res.json({ balance: parseFloat(newBalance.toFixed(2)) });
  } catch (e) {
    console.error('[RGS /credit-debit]', e.message);
    res.status(400).json({ error_code: 'TECHNICAL_ERROR' });
  }
});


// POST /api/rgs/wallet/debit — win payout to player (idempotent)
router.post('/wallet/debit', rgsAuth, async (req, res) => {
  try {
    const { playerId, amount, gameUuid, sessionId, roundId, transactionId,
            transactionType, transactionTimestamp, roundFinished, currency } = req.body;

    console.log('[RGS debit/win] playerId:', playerId && playerId.slice(0,8), 'amount:', amount);

    if (!playerId || !sessionId || !transactionId) {
      return res.status(400).json({ error_code: 'INVALID_PLAYER_ID' });
    }

    // Idempotency
    const existing = await queryOne(
      'SELECT balance_after FROM rgs_transactions WHERE transaction_id=$1 AND rolled_back=FALSE',
      [transactionId]
    );
    if (existing) return res.json({ balance: parseFloat(existing.balance_after) });

    // Validate session
    const session = await queryOne(
      'SELECT * FROM rgs_sessions WHERE session_id=$1 AND user_id=$2 AND active=TRUE',
      [sessionId, playerId]
    );
    if (!session) return res.status(400).json({ error_code: 'INVALID_SESSION' });

    const winAmount = parseFloat(amount) || 0;

    // Credit player with win
    const newBalance = await updateBalance(playerId, winAmount);

    // Record — debit_amount = winAmount (operator pays player)
    await query(
      `INSERT INTO rgs_transactions
         (transaction_id, player_id, session_id, round_id, game_uuid,
          debit_amount, credit_amount, net_amount, currency, transaction_type,
          round_finished, balance_after)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [transactionId, playerId, sessionId, roundId, gameUuid,
       winAmount, 0, winAmount, currency || 'USD', transactionType || 'DEBIT_SPIN',
       !!roundFinished, newBalance]
    );

    try {
      const { insert: chInsert } = require('../chdb');
      const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
      await chInsert('bets', [{ id: uuidv4(), user_id: playerId, game_id: gameUuid, amount: String(-winAmount), currency: currency || 'USD', created_at: ts }]);
    } catch (_) {}

    res.json({ balance: parseFloat(newBalance.toFixed(2)) });
  } catch (e) {
    console.error('[RGS /debit]', e.message);
    res.status(400).json({ error_code: 'TECHNICAL_ERROR' });
  }
});

// ── 6. POST /api/rgs/wallet/credit/rollback ────────────────────────────────
// RGS → operator: rollback a previously recorded transaction
router.post('/wallet/credit/rollback', rgsAuth, async (req, res) => {
  try {
    const { playerId, amount, gameUuid, sessionId, roundId, transactionId, currency } = req.body;

    if (!playerId || !transactionId) {
      return res.status(400).json({ error_code: 'INVALID_PLAYER_ID' });
    }

    // Find original transaction
    const tx = await queryOne(
      'SELECT * FROM rgs_transactions WHERE transaction_id=$1 AND player_id=$2',
      [transactionId, playerId]
    );

    if (!tx) return res.status(400).json({ error_code: 'INVALID_TRANSACTION' });
    if (tx.rolled_back) return res.status(400).json({ error_code: 'INVALID_TRANSACTION' });

    // Reverse the net amount
    const reversal = -parseFloat(tx.net_amount);
    const newBalance = await updateBalance(playerId, reversal);

    // Mark as rolled back
    await query(
      'UPDATE rgs_transactions SET rolled_back=TRUE WHERE transaction_id=$1',
      [transactionId]
    );

    res.json({ balance: parseFloat(newBalance.toFixed(2)) });
  } catch (e) {
    console.error('[RGS /rollback]', e.message);
    res.status(400).json({ error_code: 'TECHNICAL_ERROR' });
  }
});

module.exports = router;
