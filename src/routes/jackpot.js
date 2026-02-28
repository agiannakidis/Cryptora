// /root/casino-backend/src/routes/jackpot.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const crypto = require('crypto'); const uuidv4 = () => crypto.randomUUID();

// GET /api/jackpot — public
router.get('/', (req, res) => {
  const jp = db.prepare('SELECT * FROM jackpot').get();
  const winners = db.prepare(
    'SELECT user_email, amount, game_title, won_at FROM jackpot_winners ORDER BY won_at DESC LIMIT 5'
  ).all();
  res.json({
    amount: jp ? jp.amount : 0,
    seed_amount: jp ? jp.seed_amount : 5000,
    last_winner_email: jp ? jp.last_winner_email : null,
    last_winner_amount: jp ? jp.last_winner_amount : null,
    last_won_at: jp ? jp.last_won_at : null,
    recent_winners: winners.map(w => ({
      email: w.user_email.replace(/(.{2}).*(@.*)/, '$1***$2'),
      amount: w.amount,
      game: w.game_title,
      won_at: w.won_at,
    })),
  });
});

module.exports = router;
