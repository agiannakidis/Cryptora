const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authMiddleware, optionalAuth } = require('../middleware/auth');

const router = express.Router();

const MAX_BET_DURING_WAGERING = 5; // $5 max bet while bonus is active
const BONUS_EXPIRY_DAYS = 30;

// ── helpers ──────────────────────────────────────────────────────────────────

function getWageringStatus(user) {
  const req  = parseFloat(user.wagering_required  || 0);
  const prog = parseFloat(user.wagering_progress  || 0);
  const bonus = parseFloat(user.wagering_bonus_amount || 0);
  if (req <= 0) return null;
  return {
    required:   req,
    progress:   Math.min(prog, req),
    remaining:  Math.max(req - prog, 0),
    percent:    Math.min(Math.round((prog / req) * 100), 100),
    bonus_amount: bonus,
    expires_at: user.bonus_expires_at,
    completed:  prog >= req,
  };
}

// ── GET /api/promotions ───────────────────────────────────────────────────────
router.get('/', optionalAuth, (req, res) => {
  const promos = db.prepare('SELECT * FROM promotions WHERE is_active = 1 ORDER BY created_date DESC').all();

  let claimedIds = new Set();
  if (req.user) {
    const claims = db.prepare('SELECT promotion_id FROM promotion_claims WHERE user_id = ?').all(req.user.id);
    claimedIds = new Set(claims.map(c => c.promotion_id));
  }

  res.json(promos.map(p => ({ ...p, is_claimed: claimedIds.has(p.id) })));
});

// ── GET /api/promotions/wagering ──────────────────────────────────────────────
router.get('/wagering', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Check if bonus has expired
  if (user.bonus_expires_at && new Date(user.bonus_expires_at) < new Date()) {
    if ((user.wagering_required || 0) > (user.wagering_progress || 0)) {
      // Forfeit expired bonus
      db.prepare(`UPDATE users SET
        bonus_balance = 0, wagering_required = 0, wagering_progress = 0,
        wagering_bonus_amount = 0, bonus_expires_at = NULL
        WHERE id = ?`).run(user.id);
      return res.json({ status: 'expired', wagering: null });
    }
  }

  const wagering = getWageringStatus(user);
  res.json({
    status: wagering ? (wagering.completed ? 'completed' : 'active') : 'none',
    wagering,
    bonus_balance: user.bonus_balance || 0,
    max_bet: MAX_BET_DURING_WAGERING,
  });
});

// ── POST /api/promotions/:id/claim ────────────────────────────────────────────
router.post('/:id/claim', authMiddleware, (req, res) => {
  const { id } = req.params;
  const user = req.user;

  const promo = db.prepare('SELECT * FROM promotions WHERE id = ? AND is_active = 1').get(id);
  if (!promo) return res.status(404).json({ error: 'Promotion not found or expired' });

  const existing = db.prepare('SELECT id FROM promotion_claims WHERE user_id = ? AND promotion_id = ?').get(user.id, id);
  if (existing) return res.status(409).json({ error: 'You have already claimed this bonus' });

  if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
    return res.status(400).json({ error: 'This promotion has expired' });
  }

  // ── Calculate bonus amount ──
  let bonusAmount = 0;
  let message = '';
  const wagerMultiplier = parseFloat(promo.wagering_requirement || 30);

  switch (promo.bonus_type) {
    case 'welcome_bonus':
      bonusAmount = 50;
      message = `Welcome! $${bonusAmount} bonus added. Wager ${wagerMultiplier}x to unlock.`;
      break;
    case 'free_spins':
      bonusAmount = Math.round((promo.bonus_value || 20) * 0.20 * 100) / 100;
      message = `${promo.bonus_value || 20} Free Spins credited! ($${bonusAmount}). Wager ${wagerMultiplier}x to unlock.`;
      break;
    case 'cashback':
      bonusAmount = 10;
      message = `Cashback of $${bonusAmount} credited! Wager ${wagerMultiplier}x to unlock.`;
      break;
    case 'deposit_match':
      bonusAmount = Math.round(Math.max(user.balance * 0.1, 5) * 100) / 100;
      message = `Deposit match of $${bonusAmount} credited! Wager ${wagerMultiplier}x to unlock.`;
      break;
    case 'tournament':
      bonusAmount = 0;
      message = `Registered for ${promo.title}!`;
      break;
    case 'vip':
      bonusAmount = 25;
      message = `VIP bonus of $${bonusAmount} credited! Wager ${wagerMultiplier}x to unlock.`;
      break;
    default:
      bonusAmount = promo.bonus_value || 10;
      message = `Bonus of $${bonusAmount} credited!`;
  }

  // ── Save claim ──
  db.prepare(`
    INSERT INTO promotion_claims (id, user_id, user_email, promotion_id, bonus_amount, status)
    VALUES (?, ?, ?, ?, ?, 'active')
  `).run(uuidv4(), user.id, user.email, id, bonusAmount);

  if (bonusAmount > 0) {
    const wageringRequired = parseFloat((bonusAmount * wagerMultiplier).toFixed(2));
    const expiresAt = new Date(Date.now() + BONUS_EXPIRY_DAYS * 24 * 3600 * 1000).toISOString();

    // Credit bonus balance + set wagering requirement (accumulate if already active)
    const curUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    const newWageringRequired = parseFloat((curUser.wagering_required || 0)) + wageringRequired;
    const newBonusAmount = parseFloat((curUser.wagering_bonus_amount || 0)) + bonusAmount;

    db.prepare(`UPDATE users SET
      bonus_balance        = bonus_balance + ?,
      wagering_required    = ?,
      wagering_bonus_amount= ?,
      bonus_expires_at     = COALESCE(bonus_expires_at, ?)
      WHERE id = ?
    `).run(bonusAmount, newWageringRequired, newBonusAmount, expiresAt, user.id);

    // Record transaction
    const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    db.prepare(`
      INSERT INTO transactions (id, user_email, type, amount, balance_after, status, description)
      VALUES (?, ?, 'bonus', ?, ?, 'completed', ?)
    `).run(uuidv4(), user.email, bonusAmount, updatedUser.balance,
       `Bonus: ${promo.title} (${wagerMultiplier}x wagering required)`);
  }

  res.json({
    ok: true,
    message,
    bonusAmount,
    wageringRequired: bonusAmount > 0 ? bonusAmount * wagerMultiplier : 0,
    wageringMultiplier: wagerMultiplier,
  });
});

module.exports = router;
