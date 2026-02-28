const jwt = require('jsonwebtoken');
const { queryOne } = require('../pgdb');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';

const NUMERIC_FIELDS = [
  'balance','bonus_balance','vip_points','total_wagered',
  'wagering_required','wagering_progress','wagering_bonus_amount',
  'affiliate_balance','deposit_limit_daily','deposit_limit_weekly',
  'deposit_limit_monthly','loss_limit_daily','loss_limit_weekly',
  'loss_limit_monthly','wager_limit_daily',
];

function sanitizeUser(user) {
  const { password_hash, ...rest } = user;
  // Convert PG NUMERIC strings to JS numbers
  for (const f of NUMERIC_FIELDS) {
    if (rest[f] !== null && rest[f] !== undefined) {
      rest[f] = parseFloat(rest[f]) || 0;
    }
  }
  return {
    ...rest,
    favorite_games: typeof rest.favorite_games === 'string'
      ? JSON.parse(rest.favorite_games || '[]')
      : (rest.favorite_games || []),
  };
}

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await queryOne('SELECT * FROM users WHERE id = $1', [decoded.id]);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = sanitizeUser(user);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

async function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next();
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await queryOne('SELECT * FROM users WHERE id = $1', [decoded.id]);
    if (user) req.user = sanitizeUser(user);
  } catch {}
  next();
}

module.exports = { authMiddleware, optionalAuth, sanitizeUser, JWT_SECRET };
