const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { queryOne, queryAll, query: queryRun, query } = require('../pgdb');
const { authMiddleware, optionalAuth } = require('../middleware/auth');

const router = express.Router();
const MAX_BET_DURING_WAGERING = 5;
const BONUS_EXPIRY_DAYS = 30;

function getWageringStatus(user) {
  const req   = parseFloat(user.wagering_required   || 0);
  const prog  = parseFloat(user.wagering_progress   || 0);
  const bonus = parseFloat(user.wagering_bonus_amount || 0);
  if (req <= 0) return null;
  return {
    required:     req,
    progress:     Math.min(prog, req),
    remaining:    Math.max(req - prog, 0),
    percent:      Math.min(Math.round((prog / req) * 100), 100),
    bonus_amount: bonus,
    expires_at:   user.bonus_expires_at,
    completed:    prog >= req,
  };
}

// GET /api/promotions — public
router.get('/', optionalAuth, async (req, res) => {
  try {
    const promos = await queryAll('SELECT * FROM promotions WHERE is_active = true ORDER BY created_date DESC');
    let claimedIds = new Set();
    if (req.user) {
      const claims = await queryAll('SELECT promotion_id FROM promotion_claims WHERE user_id = $1', [req.user.id]);
      claimedIds = new Set(claims.map(c => c.promotion_id));
    }
    res.json(promos.map(p => ({
      ...p,
      bonus_value: p.bonus_value != null ? parseFloat(parseFloat(p.bonus_value).toPrecision(10)) : null,
      wagering_requirement: p.wagering_requirement != null ? parseFloat(p.wagering_requirement) : null,
      min_deposit: p.min_deposit != null ? parseFloat(p.min_deposit) : null,
      is_claimed: claimedIds.has(p.id)
    })));
  } catch (e) {
    console.error('[promotions GET]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/promotions/wagering
router.get('/wagering', authMiddleware, async (req, res) => {
  try {
    const user = await queryOne('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.bonus_expires_at && new Date(user.bonus_expires_at) < new Date()) {
      if (parseFloat(user.wagering_required || 0) > parseFloat(user.wagering_progress || 0)) {
        await queryRun(`UPDATE users SET bonus_balance=0, wagering_required=0, wagering_progress=0,
          wagering_bonus_amount=0, bonus_expires_at=NULL WHERE id=$1`, [user.id]);
        return res.json({ status: 'expired', wagering: null });
      }
    }

    const wagering = getWageringStatus(user);
    res.json({
      status: wagering ? (wagering.completed ? 'completed' : 'active') : 'none',
      wagering,
      bonus_balance: parseFloat(user.bonus_balance || 0),
      max_bet: MAX_BET_DURING_WAGERING,
    });
  } catch (e) {
    console.error('[promotions wagering]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/promotions/:id/claim
router.post('/:id/claim', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const promo = await queryOne('SELECT * FROM promotions WHERE id = $1 AND is_active = true', [id]);
    if (!promo) return res.status(404).json({ error: 'Promotion not found or expired' });

    const existing = await queryOne('SELECT id FROM promotion_claims WHERE user_id = $1 AND promotion_id = $2', [user.id, id]);
    if (existing) return res.status(409).json({ error: 'You have already claimed this bonus' });

    if (promo.expires_at && new Date(promo.expires_at) < new Date())
      return res.status(400).json({ error: 'This promotion has expired' });

    let bonusAmount = 0;
    let message = '';
    const wagerMultiplier = parseFloat(promo.wagering_requirement || 30);
    const bonusValue = parseFloat(promo.bonus_value || 0);
    const curUser = await queryOne('SELECT * FROM users WHERE id = $1', [user.id]);

    switch (promo.bonus_type) {
      case 'welcome_bonus': {
        // Real deposit match: bonus_value% of last deposit, capped at $500
        const lastDeposit = await queryOne(
          `SELECT amount FROM tx_idempotency WHERE user_email=$1 AND type='deposit' ORDER BY created_at DESC LIMIT 1`,
          [user.email]
        );
        if (!lastDeposit) return res.status(400).json({ error: 'Make a deposit first to claim the welcome bonus' });
        const depositAmt = parseFloat(lastDeposit.amount);
        const minDep = parseFloat(promo.min_deposit || 20);
        if (depositAmt < minDep) return res.status(400).json({ error: `Minimum deposit $${minDep} required` });
        const pct = bonusValue > 0 ? bonusValue / 100 : 2; // default 200%
        bonusAmount = Math.min(Math.round(depositAmt * pct * 100) / 100, 500);
        message = `Welcome! ${bonusValue || 200}% deposit match — $${bonusAmount.toFixed(2)} bonus. Wager ${wagerMultiplier}x to unlock.`;
        break;
      }
      case 'deposit_match': {
        // deposit_match: bonus_value% of last deposit, capped at $1000
        const lastDeposit = await queryOne(
          `SELECT amount FROM tx_idempotency WHERE user_email=$1 AND type='deposit' ORDER BY created_at DESC LIMIT 1`,
          [user.email]
        );
        if (!lastDeposit) return res.status(400).json({ error: 'Make a deposit first to claim this bonus' });
        const depositAmt = parseFloat(lastDeposit.amount);
        const minDep = parseFloat(promo.min_deposit || 20);
        if (depositAmt < minDep) return res.status(400).json({ error: `Minimum deposit $${minDep} required` });
        const pct = bonusValue > 0 ? bonusValue / 100 : 1;
        bonusAmount = Math.min(Math.round(depositAmt * pct * 100) / 100, 1000);
        message = `Deposit match: $${bonusAmount.toFixed(2)} bonus added! Wager ${wagerMultiplier}x to unlock.`;
        break;
      }
      case 'cashback': {
        // Real cashback: bonusValue% of net losses in last 24h
        const lossRow = await queryOne(
          `SELECT COALESCE(SUM(CASE WHEN type='bet' THEN amount ELSE -amount END),0) as net_loss
           FROM tx_idempotency
           WHERE user_email=$1 AND type IN ('bet','win') AND created_at > NOW() - INTERVAL '24 hours'`,
          [user.email]
        );
        const netLoss = Math.max(parseFloat(lossRow?.net_loss || 0), 0);
        if (netLoss < 1) return res.status(400).json({ error: 'No losses in last 24 hours to apply cashback' });
        const pct = bonusValue > 0 ? bonusValue / 100 : 0.10;
        bonusAmount = Math.min(Math.round(netLoss * pct * 100) / 100, 500);
        message = `Cashback ${bonusValue || 10}% — $${bonusAmount.toFixed(2)} on $${netLoss.toFixed(2)} losses. Wager ${wagerMultiplier}x to unlock.`;
        break;
      }
      case 'free_spins': {
        // Free spins: bonus_value spins × $0.20 per spin, capped at $100
        const spins = bonusValue > 0 ? bonusValue : 20;
        bonusAmount = Math.min(Math.round(spins * 0.20 * 100) / 100, 100);
        message = `${spins} Free Spins — $${bonusAmount.toFixed(2)} bonus credited! Wager ${wagerMultiplier}x to unlock.`;
        break;
      }
      case 'tournament': {
        bonusAmount = 0;
        message = `You are registered for ${promo.title}!`;
        break;
      }
      case 'vip': {
        bonusAmount = bonusValue > 0 ? bonusValue : 25;
        message = `VIP bonus of $${bonusAmount.toFixed(2)} credited! Wager ${wagerMultiplier}x to unlock.`;
        break;
      }
      default: {
        bonusAmount = bonusValue > 0 ? bonusValue : 10;
        message = `Bonus of $${bonusAmount.toFixed(2)} credited! Wager ${wagerMultiplier}x to unlock.`;
      }
    }

    // ON CONFLICT: DB-level unique constraint prevents race condition double-claim
    const claimResult = await query(
      `INSERT INTO promotion_claims (id, user_id, user_email, promotion_id, bonus_amount, status)
       VALUES ($1,$2,$3,$4,$5,'active')
       ON CONFLICT (user_id, promotion_id) DO NOTHING`,
      [uuidv4(), user.id, user.email, id, bonusAmount]
    );
    if (claimResult.rowCount === 0)
      return res.status(409).json({ error: 'You have already claimed this bonus' });

    if (bonusAmount > 0) {
      const wageringRequired = parseFloat((bonusAmount * wagerMultiplier).toFixed(2));
      const expiresAt = new Date(Date.now() + BONUS_EXPIRY_DAYS*24*3600*1000).toISOString();
      const newWageringRequired = parseFloat(curUser.wagering_required||0) + wageringRequired;
      const newBonusAmount = parseFloat(curUser.wagering_bonus_amount||0) + bonusAmount;

      await queryRun(`UPDATE users SET
        bonus_balance=bonus_balance+$1, wagering_required=$2,
        wagering_bonus_amount=$3, bonus_expires_at=COALESCE(bonus_expires_at,$4)
        WHERE id=$5`, [bonusAmount, newWageringRequired, newBonusAmount, expiresAt, user.id]);

      const updatedUser = await queryOne('SELECT balance FROM users WHERE id=$1', [user.id]);
      await queryRun(`INSERT INTO transactions (id,user_email,type,amount,balance_after,status,description)
        VALUES ($1,$2,'bonus',$3,$4,'completed',$5)`,
        [uuidv4(), user.email, bonusAmount, updatedUser.balance,
         `Bonus: ${promo.title} (${wagerMultiplier}x wagering required)`]);
    }

    res.json({ ok: true, message, bonusAmount, wageringRequired: bonusAmount*wagerMultiplier, wageringMultiplier: wagerMultiplier });
  } catch (e) {
    console.error('[promotions claim]', e.message);
    res.status(500).json({ error: 'Server error: ' + e.message });
  }
});

module.exports = router;
