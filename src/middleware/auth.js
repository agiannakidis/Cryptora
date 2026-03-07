const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { queryOne, query } = require('../pgdb');

// In-memory token blacklist (fast lookup, survives until restart)
const tokenBlacklist = new Set();

// Add token to blacklist (called on logout)
async function blacklistToken(token, expiresAt) {
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  tokenBlacklist.add(hash);
  // Persist to DB so blacklist survives restarts
  try {
    await query(
      'INSERT INTO invalidated_tokens (token_hash, expires_at) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [hash, new Date(expiresAt * 1000).toISOString()]
    );
  } catch(e) { /* non-fatal — in-memory blacklist still works */ }
}

// Check blacklist (in-memory first, then DB)
async function isBlacklisted(token) {
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  if (tokenBlacklist.has(hash)) return true;
  // Check DB (covers tokens invalidated before this restart)
  try {
    const row = await queryOne(
      'SELECT 1 FROM invalidated_tokens WHERE token_hash=$1 AND expires_at > NOW()',
      [hash]
    );
    if (row) { tokenBlacklist.add(hash); return true; }
  } catch(e) { /* non-fatal */ }
  return false;
}

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

// In-memory user cache: token -> {user, expiresAt}
const userCache = new Map();
const CACHE_TTL = 20000; // 20 seconds

function getCached(token) {
  const entry = userCache.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { userCache.delete(token); return null; }
  return entry.user;
}
function setCached(token, user) {
  userCache.set(token, { user, expiresAt: Date.now() + CACHE_TTL });
  // Prune old entries if cache grows large
  if (userCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of userCache) { if (now > v.expiresAt) userCache.delete(k); }
  }
}
// Call this after any user data update to invalidate cache
function invalidateUserCache(token) { if (token) userCache.delete(token); }

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    // Check if token was invalidated (logout)
    if (await isBlacklisted(token)) return res.status(401).json({ error: 'Token invalidated' });
    const cached = getCached(token);
    if (cached) { req.user = cached; req._token = token; return next(); }
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await queryOne('SELECT * FROM users WHERE id = $1', [decoded.id]);
    if (!user) return res.status(401).json({ error: 'User not found' });

    // Check if token was issued before password change (invalidates all old sessions)
    if (user.password_changed_at && decoded.iat) {
      const changedAt = new Date(user.password_changed_at).getTime() / 1000;
      if (decoded.iat < changedAt) {
        return res.status(401).json({ error: 'Session expired — password was changed, please log in again' });
      }
    }
    req.user = sanitizeUser(user);
    req._token = token;
    setCached(token, req.user);
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
    const cached = getCached(token);
    if (cached) { req.user = cached; return next(); }
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await queryOne('SELECT * FROM users WHERE id = $1', [decoded.id]);
    if (user) { req.user = sanitizeUser(user); setCached(token, req.user); }
  } catch {}
  next();
}

module.exports = { authMiddleware, optionalAuth, sanitizeUser, JWT_SECRET, invalidateUserCache, blacklistToken };
