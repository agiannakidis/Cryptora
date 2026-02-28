// /root/casino-backend/src/jackpot.js
// Jackpot contribution + win trigger

const db = require('./db');
const crypto = require('crypto'); const uuidv4 = () => crypto.randomUUID();

const WIN_ODDS = 1 / 50000; // 1 in 50,000 bets triggers jackpot win

/**
 * Called on every wager debit.
 * - Adds 0.01% of bet to jackpot pool
 * - Randomly triggers jackpot win
 * Returns { won: true, amount, userId, email } or { won: false }
 */
function processJackpotContribution(userId, userEmail, betAmount, gameTitle) {
  try {
    const jp = db.prepare('SELECT * FROM jackpot').get();
    if (!jp) return { won: false };

    const contribution = betAmount * jp.contribution_rate; // 0.01%
    const newAmount = jp.amount + contribution;

    // Update jackpot pool
    db.prepare(`UPDATE jackpot SET
      amount = ?,
      total_contributed = total_contributed + ?,
      updated_at = datetime('now')
    `).run(newAmount, contribution);

    // Random win check — only if jackpot > seed_amount
    if (newAmount > jp.seed_amount && Math.random() < WIN_ODDS) {
      const winAmount = parseFloat(newAmount.toFixed(2));

      // Pay winner
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(winAmount, userId);

      // Record winner
      const winnerId = uuidv4();
      db.prepare(`INSERT INTO jackpot_winners (id, user_id, user_email, amount, game_title)
        VALUES (?, ?, ?, ?, ?)
      `).run(winnerId, userId, userEmail, winAmount, gameTitle || 'Unknown');

      // Reset jackpot to seed
      db.prepare(`UPDATE jackpot SET
        amount = seed_amount,
        last_won_at = datetime('now'),
        last_winner_email = ?,
        last_winner_amount = ?,
        updated_at = datetime('now')
      `).run(userEmail, winAmount);

      // Add win transaction
      db.prepare(`INSERT INTO transactions
        (id, user_email, type, amount, currency, status, description, reference)
        VALUES (?, ?, 'jackpot', ?, 'USD', 'completed', ?, ?)
      `).run(uuidv4(), userEmail, winAmount, `JACKPOT WIN! $${winAmount.toFixed(2)}`, winnerId);

      console.log(`🎰 JACKPOT WON! ${userEmail} won $${winAmount.toFixed(2)} playing ${gameTitle}`);
      return { won: true, amount: winAmount, userId, email: userEmail };
    }

    return { won: false };
  } catch (e) {
    console.error('[Jackpot] error:', e.message);
    return { won: false };
  }
}

/**
 * Get current jackpot amount (fast, for WebSocket push)
 */
function getJackpotAmount() {
  try {
    const jp = db.prepare('SELECT amount FROM jackpot').get();
    return jp ? jp.amount : 0;
  } catch { return 0; }
}

module.exports = { processJackpotContribution, getJackpotAmount };
