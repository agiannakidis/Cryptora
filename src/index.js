require('dotenv').config();
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
app.use('/api/', apiLimiter);

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/entities', require('./routes/entities'));
app.use('/api/functions/walletApi', require('./routes/walletApi'));
app.use('/api/functions', require('./routes/functions'));
app.use('/api/apps', require('./routes/app'));
app.use('/api/crypto', require('./routes/crypto'));
app.use('/api/affiliate', require('./routes/affiliate'));
app.use('/api/promotions', require('./routes/promotions'));
app.use('/api/rg', require('./routes/rg'));
app.use('/api/banner', require('./routes/banner'));
app.use('/api/jackpot', require('./routes/jackpot'));
app.use('/api/ticker', require('./routes/ticker'));
app.use('/api/operator', require('./routes/operatorAuth'));

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Create HTTP server and attach WebSocket chat
const server = http.createServer(app);
const { createChatServer } = require('./chat');
createChatServer(server);

server.listen(PORT, () => {
  console.log(`🎰 Casino backend running on port ${PORT}`);

  // Start deposit monitor (non-blocking)
  if (process.env.MASTER_MNEMONIC) {
    require('./crypto/monitor').runMonitor().catch(err => {
      console.error('Deposit monitor crashed:', err.message);
    });
  } else {
    console.warn('⚠️  MASTER_MNEMONIC not set — crypto deposits disabled');
  }
});
