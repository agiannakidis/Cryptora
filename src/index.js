require('dotenv').config();

// ── Startup safety checks ─────────────────────────────────────────────────────
(function validateEnv() {
  const REQUIRED = ['JWT_SECRET', 'PG_PASSWORD'];
  const WEAK_VALUES = ['change-this-secret-in-production', 'casino-secret-2026', 'secret'];
  let ok = true;

  for (const key of REQUIRED) {
    if (!process.env[key]) {
      console.error(`[STARTUP] CRITICAL: Missing required env var: ${key}`);
      ok = false;
    }
  }

  const secret = process.env.JWT_SECRET || '';
  if (WEAK_VALUES.includes(secret) || secret.length < 32) {
    console.error('[STARTUP] WARNING: JWT_SECRET is weak or default — rotate immediately!');
  }

  if (!process.env.PRAGMATIC_PRIVATE_KEY) {
    console.warn('[STARTUP] WARNING: PRAGMATIC_PRIVATE_KEY not set — walletApi signature verification disabled');
  }

  if (!ok) {
    console.error('[STARTUP] Aborting due to missing critical config');
    process.exit(1);
  }
})();
const http = require('http');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS — restrict to our domain only
const allowedOrigins = [
  'https://cryptora.live',
  'https://www.cryptora.live',
  'http://localhost:5173',
  'http://localhost:3000',
];
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Nginx proxy same-origin)
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
}));

app.use(express.json());

// GEO-blocking middleware
const geoBlock = require('./geo-block');
app.use('/api', geoBlock({
  countries: ['US', 'GB', 'AU', 'FR', 'DE', 'NL', 'IT', 'ES', 'BE', 'PL', 'HU', 'RO', 'CZ'],
  bypassPaths: [
    // with /api/ prefix (req.originalUrl)
    '/api/auth/login', '/api/auth/register', '/api/auth/telegram', '/api/auth/me',
    '/api/banner', '/api/jackpot', '/api/ticker', '/api/crypto/prices',
    '/api/promotions', '/api/entities/Game', '/api/entities/GameProvider',
    '/api/chat', '/api/analytics', '/health', '/api/health',
    // without /api/ prefix (req.path when mounted under /api)
    '/auth/login', '/auth/register', '/auth/telegram', '/auth/me',
    '/banner', '/jackpot', '/ticker', '/crypto/prices',
    '/promotions', '/entities/Game', '/entities/GameProvider',
    '/chat', '/analytics', '/health',
    '/api/affiliate', '/affiliate', '/api/rgs', '/api/games', '/land', '/api/operator',
  ],
}));

app.set("trust proxy", 1); // Trust Nginx / Cloudflare
app.use(express.urlencoded({ extended: true }));

// Rate limiting — auth endpoints (prevent brute force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                   // max 20 attempts per 15min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again in 15 minutes' },
});

// General API limiter
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/sms', authLimiter);

// Withdrawal limiter: max 5 per 10 min per IP
const withdrawLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many withdrawal requests, please wait 10 minutes' },
});
app.use('/api/crypto/withdraw', withdrawLimiter);

app.use('/api/', apiLimiter);

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/entities', require('./routes/entities'));
app.use('/api/functions/walletApi', require('./routes/walletApi'));
app.use('/api/functions', require('./routes/functions'));
app.use('/api/apps', require('./routes/app'));
app.use('/api/crypto', require('./routes/crypto'));
app.use('/api/affiliate', require('./routes/affiliate'));
app.use('/api/rgs', require('./routes/rgs'));
app.use('/api/promotions', require('./routes/promotions'));
app.use('/api/rg', require('./routes/rg'));
app.use('/api/games', require('./routes/games'));
app.use('/api/banner', require('./routes/banner'));
app.use('/api/admin/geo-block', require('./routes/geoblock'));
app.use('/api/jackpot', require('./routes/jackpot'));
app.use('/api/ticker', require('./routes/ticker'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/chat', require('./routes/chat'));

app.use('/api/operator', require('./routes/operatorAuth'));

// Bonus expiry cron
try {
  const { scheduleBonusExpiry } = require('./cron/bonusExpiry');
  scheduleBonusExpiry();
} catch(e) { console.error('[bonus-expiry] failed to start:', e.message); }

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Create HTTP server and attach WebSocket chat
const server = http.createServer(app);
const { createChatServer } = require('./chat');
createChatServer(server);

// ── Global Express error handler ─────────────────────────────────────────────
// Must be AFTER all routes (4 params = error middleware)
app.use((err, req, res, next) => {
  const isDev = process.env.NODE_ENV !== 'production';
  console.error('[GlobalError]', req.method, req.path, err.message, isDev ? err.stack : '');
  // Never leak internal details in production
  res.status(err.status || 500).json({
    error: isDev ? err.message : 'Internal server error',
    ...(isDev && { stack: err.stack }),
  });
});

// Global crash guards — log instead of dying silently  
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err.stack || err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection:', reason?.stack || String(reason));
});

server.listen(PORT, () => {
  console.log(`🎰 Casino backend running on port ${PORT}`);


  // Affiliate commission cron — runs 1st of each month at 02:00
  // FIX: use hourly check to avoid 32-bit int overflow (26-day timeout crashes Node)
  (function scheduleAffiliateCommissions() {
    let lastRanMonth = -1;
    async function checkAndRun() {
      const now = new Date();
      if (now.getDate() === 1 && now.getHours() === 2 && now.getMonth() !== lastRanMonth) {
        lastRanMonth = now.getMonth();
        try {
          const { runCommissionCron } = require('./cron/affiliateCommissions');
          const r = await runCommissionCron();
          console.log('[affiliate-cron] done:', r);
        } catch (e) {
          console.error('[affiliate-cron] error:', e.message);
        }
      }
    }
    // Check every hour — safe, no overflow
    setInterval(checkAndRun, 60 * 60 * 1000);
    console.log('[affiliate-cron] Scheduled — hourly check, runs on 1st of month at 02:00');
  })();

  // Start deposit monitor (non-blocking)
  if (process.env.MASTER_MNEMONIC) {
    require('./crypto/monitor').runMonitor().catch(err => {
      console.error('Deposit monitor crashed:', err.message);
    });
  } else {
    console.warn('⚠️  MASTER_MNEMONIC not set — crypto deposits disabled');
  }
});
