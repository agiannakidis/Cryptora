const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { queryOne, queryAll, query } = require('../pgdb');
const { authMiddleware, sanitizeUser, JWT_SECRET, invalidateUserCache, blacklistToken } = require('../middleware/auth');

const router = express.Router();

// Optional imports — gracefully handle missing modules
let checkSelfExclusion = () => ({ blocked: false });
let sendVerificationEmail = async () => {};
let sendVerificationCode = async () => {};
let trackRegistration = () => {};

try { ({ checkSelfExclusion } = require('../rg-check')); } catch {}
try { ({ sendVerificationEmail, sendVerificationCode } = require('../email')); } catch {}
try { ({ trackRegistration } = require('../affiliate')); } catch {}

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

// ── POST /login ───────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = await queryOne('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  if (!user.email_verified) {
    return res.status(403).json({
      error: 'Please verify your email before logging in.',
      needsVerification: true,
      email: user.email,
    });
  }

  const rgCheck = await checkSelfExclusion(user.id);
  if (rgCheck.blocked) return res.status(403).json({ error: rgCheck.reason, selfExcluded: true });

  const token = signToken(user);
  res.json({ token, user: sanitizeUser(user) });
});

// ── POST /register ────────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const existing = await queryOne('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const id = uuidv4();
  const password_hash = bcrypt.hashSync(password, 10);
  const verifyCode = Math.floor(100000 + Math.random() * 900000).toString();
  const verifyExpires = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

  await query(`
    INSERT INTO users (id, email, password_hash, name, role, balance, currency,
      email_verified, email_verification_token, email_verification_expires)
    VALUES ($1,$2,$3,$4,'player',0,'USD',false,$5,$6)
  `, [id, email.toLowerCase(), password_hash, name || '', verifyCode, verifyExpires]);

  if (req.body.ref_code || req.body.ref) {
    try { trackRegistration(id, email.toLowerCase(), req.body.ref_code || req.body.ref); } catch {}
  }

  sendVerificationCode(email.toLowerCase(), verifyCode)
    .catch(e => console.error('[register] email error:', e.message));

  res.status(201).json({
    needsVerification: true,
    email: email.toLowerCase(),
    message: 'Account created! Please enter the 6-digit code sent to your email.',
  });
});

// ── GET /verify-email?token=xxx ───────────────────────────────────────────────
router.get('/verify-email', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token required' });

  const user = await queryOne('SELECT * FROM users WHERE email_verification_token = $1', [token]);
  if (!user) return res.status(400).json({ error: 'Invalid or expired verification link' });

  if (new Date(user.email_verification_expires) < new Date()) {
    return res.status(400).json({ error: 'Verification link has expired.' });
  }

  await query(
    'UPDATE users SET email_verified=true, email_verification_token=NULL, email_verification_expires=NULL WHERE id=$1',
    [user.id]
  );

  const updated = await queryOne('SELECT * FROM users WHERE id = $1', [user.id]);
  const authToken = signToken(updated);
  res.json({ ok: true, message: 'Email verified! Welcome to Cryptora.', token: authToken, user: sanitizeUser(updated) });
});

// ── POST /resend-verification ─────────────────────────────────────────────────
router.post('/resend-verification', authMiddleware, async (req, res) => {
  const user = await queryOne('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.email_verified) return res.status(400).json({ error: 'Email is already verified' });

  const verifyToken = crypto.randomBytes(32).toString('hex');
  const verifyExpires = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

  await query(
    'UPDATE users SET email_verification_token=$1, email_verification_expires=$2 WHERE id=$3',
    [verifyToken, verifyExpires, user.id]
  );

  await sendVerificationEmail(user.email, verifyToken);
  res.json({ ok: true, message: 'Verification email sent.' });
});

// ── POST /verify-code ─────────────────────────────────────────────────────────
router.post('/verify-code', async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'email and code required' });

  const user = await queryOne('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  if (!user) return res.status(400).json({ error: 'User not found' });
  if (user.email_verified) {
    return res.json({ ok: true, message: 'Already verified', token: signToken(user), user: sanitizeUser(user) });
  }

  if (!user.email_verification_token)
    return res.status(400).json({ error: 'No pending verification. Request a new code.' });
  if (new Date(user.email_verification_expires) < new Date())
    return res.status(400).json({ error: 'Code expired. Request a new one.' });
  if (user.email_verification_token !== code.toString().trim())
    return res.status(400).json({ error: 'Incorrect code.' });

  await query(
    'UPDATE users SET email_verified=true, email_verification_token=NULL, email_verification_expires=NULL WHERE id=$1',
    [user.id]
  );
  const updated = await queryOne('SELECT * FROM users WHERE id = $1', [user.id]);
  const token = signToken(updated);
  res.json({ ok: true, message: 'Email verified! Welcome to Cryptora.', token, user: sanitizeUser(updated) });
});

// ── POST /resend-code ─────────────────────────────────────────────────────────
router.post('/resend-code', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });

  const user = await queryOne('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  if (!user) return res.status(400).json({ error: 'User not found' });
  if (user.email_verified) return res.status(400).json({ error: 'Email already verified' });

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expires = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

  await query(
    'UPDATE users SET email_verification_token=$1, email_verification_expires=$2 WHERE id=$3',
    [code, expires, user.id]
  );

  await sendVerificationCode(user.email, code).catch(e => console.error('[resend-code]', e.message));
  res.json({ ok: true, message: 'New code sent to your email.' });
});

// ── POST /telegram ────────────────────────────────────────────────────────────
router.post('/telegram', async (req, res) => {
  const data = req.body;
  if (!data?.hash) return res.status(400).json({ error: 'Invalid Telegram data' });

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!BOT_TOKEN) return res.status(500).json({ error: 'Telegram not configured' });

  const { hash, ...fields } = data;
  const checkString = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join('\n');
  const secretKey = crypto.createHash('sha256').update(BOT_TOKEN).digest();
  const hmac = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');

  if (hmac !== hash) return res.status(401).json({ error: 'Invalid Telegram signature' });
  if (Date.now() / 1000 - parseInt(data.auth_date) > 300) {
    return res.status(401).json({ error: 'Telegram auth expired.' });
  }

  const telegramId = data.id.toString();
  const name = [data.first_name, data.last_name].filter(Boolean).join(' ') || data.username || 'Player';
  const avatar = data.photo_url || null;

  let user = await queryOne('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
  if (!user) {
    const id = uuidv4();
    const fakeEmail = `tg_${telegramId}@cryptora.tg`;
    await query(`
      INSERT INTO users (id, email, password_hash, name, role, balance, currency, email_verified, telegram_id, telegram_username, avatar_url)
      VALUES ($1,$2,'',$3,'player',0,'USD',true,$4,$5,$6)
      ON CONFLICT (email) DO NOTHING
    `, [id, fakeEmail, name, telegramId, data.username || null, avatar]);
    user = await queryOne('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
  } else {
    await query(
      'UPDATE users SET name=$1, avatar_url=$2, telegram_username=$3 WHERE id=$4',
      [name, avatar, data.username || null, user.id]
    );
    user = await queryOne('SELECT * FROM users WHERE id = $1', [user.id]);
  }

  res.json({ token: signToken(user), user: sanitizeUser(user) });
});

// ── Telegram Bot deep-link flow (PG-backed states — survives restarts) ─────────
// Cleanup expired states every 5 minutes
setInterval(async () => {
  try { await query("DELETE FROM tg_auth_states WHERE created_at < NOW() - INTERVAL '15 minutes'"); }
  catch (e) {}
}, 5 * 60 * 1000);

router.get('/telegram/init', async (req, res) => {
  try {
    const state = crypto.randomBytes(16).toString('hex');
    const refCode = req.query.ref_code || req.query.ref || '';
    await query(
      'INSERT INTO tg_auth_states (state, ref_code) VALUES ($1, $2)',
      [state, refCode]
    );
    res.json({ state, botUsername: process.env.TELEGRAM_BOT_USERNAME || 'CryptoraLoginBot' });
  } catch (e) { res.status(500).json({ error: 'Internal error' }); }
});

router.get('/telegram/poll', async (req, res) => {
  try {
    const { state } = req.query;
    if (!state) return res.status(400).json({ error: 'state required' });
    const entry = await queryOne(
      "SELECT * FROM tg_auth_states WHERE state=$1 AND created_at > NOW() - INTERVAL '15 minutes'",
      [state]
    );
    if (!entry) return res.status(400).json({ error: 'Invalid or expired state' });
    if (!entry.done) return res.json({ done: false });
    await query('DELETE FROM tg_auth_states WHERE state=$1', [state]);
    res.json({ done: true, token: entry.token, user: entry.user_data });
  } catch (e) { res.status(500).json({ error: 'Internal error' }); }
});

router.post('/telegram/webhook', express.json(), async (req, res) => {
  res.sendStatus(200);
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const sendMsg = (chatId, text) => {
    if (!BOT_TOKEN) return;
    fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    }).catch(() => {});
  };
  try {
    const update = req.body;
    if (!update.message) return;
    const msg = update.message;
    const text = (msg.text || '').trim();
    if (!text.startsWith('/start')) return;

    const state = text.split(' ')[1] || '';
    const tgUser = msg.from;
    if (!tgUser) return;

    // /start без deep-link state
    if (!state) {
      sendMsg(tgUser.id, '\u2139\ufe0f To log in to Cryptora, please return to the website and click the Telegram login button.');
      return;
    }

    const stateEntry = await queryOne(
      "SELECT * FROM tg_auth_states WHERE state=$1 AND created_at > NOW() - INTERVAL '15 minutes'",
      [state]
    );

    if (!stateEntry) {
      sendMsg(tgUser.id, '\u26a0\ufe0f Session expired. Please return to Cryptora and click the Telegram login button again.');
      return;
    }

    const telegramId = tgUser.id.toString();
    const name = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || tgUser.username || 'Player';

    let dbUser = await queryOne('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
    if (!dbUser) {
      const id = uuidv4();
      const fakeEmail = `tg_${telegramId}@cryptora.tg`;
      await query(`
        INSERT INTO users (id, email, password_hash, name, role, balance, currency, email_verified, telegram_id, telegram_username)
        VALUES ($1,$2,'',$3,'player',0,'USD',true,$4,$5)
        ON CONFLICT (email) DO UPDATE SET telegram_id=EXCLUDED.telegram_id, name=EXCLUDED.name, telegram_username=EXCLUDED.telegram_username
      `, [id, fakeEmail, name, telegramId, tgUser.username || null]);
      dbUser = await queryOne('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
    } else {
      await query('UPDATE users SET name=$1, telegram_username=$2 WHERE id=$3',
        [name, tgUser.username || null, dbUser.id]);
      dbUser = await queryOne('SELECT * FROM users WHERE id = $1', [dbUser.id]);
    }

    if (!dbUser) {
      console.error('[TG webhook] Failed to find/create user for telegram_id', telegramId);
      sendMsg(tgUser.id, '\u274c Login failed. Please try again from the website.');
      return;
    }

    const token = signToken(dbUser);
    await query(
      'UPDATE tg_auth_states SET done=true, token=$1, user_data=$2 WHERE state=$3',
      [token, JSON.stringify(sanitizeUser(dbUser)), state]
    );

    sendMsg(tgUser.id, `\u2705 You've been logged in to Cryptora!\n\nWelcome, ${name}! You can close this chat and return to the site.`);
  } catch (e) { console.error('[TG webhook]', e.message, e.stack); }
});

// ── SMS Auth ──────────────────────────────────────────────────────────────────
const smsCodeStore = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of smsCodeStore) {
    if (now > v.expires) smsCodeStore.delete(k);
  }
}, 60000);

function normalizePhone(phone) {
  let p = phone.replace(/[^\d+]/g, '');
  if (p.startsWith('8') && p.length === 11) p = '+7' + p.slice(1);
  if (!p.startsWith('+')) p = '+' + p;
  return p;
}

router.post('/sms/send', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone number required' });

  const normalized = normalizePhone(phone);
  if (normalized.length < 8) return res.status(400).json({ error: 'Invalid phone number' });

  const existing = smsCodeStore.get(normalized);
  if (existing && Date.now() < existing.expires && existing.attempts >= 3) {
    const wait = Math.ceil((existing.expires - Date.now()) / 1000 / 60);
    return res.status(429).json({ error: `Too many attempts. Try again in ${wait} min.` });
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  smsCodeStore.set(normalized, {
    code,
    expires: Date.now() + 10 * 60 * 1000,
    attempts: (existing?.attempts || 0) + 1,
    refCode: req.body.ref_code || req.body.ref || '',
  });

  const login = process.env.SMSC_LOGIN;
  const psw = process.env.SMSC_PASSWORD;

  if (!login || !psw) {
    console.log(`[SMS] Dev mode — code for ${normalized}: ${code}`);
    return res.json({ ok: true, message: 'Code sent', phone: normalized });
  }

  try {
    const url = `https://smsc.ru/sys/send.php?login=${encodeURIComponent(login)}&psw=${encodeURIComponent(psw)}&phones=${encodeURIComponent(normalized)}&mes=${encodeURIComponent(`Cryptora code: ${code}`)}&fmt=3`;
    const r = await fetch(url);
    const d = await r.json();
    if (d.error) return res.status(500).json({ error: 'Failed to send SMS.' });
    res.json({ ok: true, message: 'Code sent', phone: normalized });
  } catch (e) {
    res.status(500).json({ error: 'SMS service unavailable' });
  }
});

router.post('/sms/verify', async (req, res) => {
  const { phone, code } = req.body;
  if (!phone || !code) return res.status(400).json({ error: 'phone and code required' });

  const normalized = normalizePhone(phone);
  const entry = smsCodeStore.get(normalized);

  if (!entry) return res.status(400).json({ error: 'No code sent. Request a new one.' });
  if (Date.now() > entry.expires) return res.status(400).json({ error: 'Code expired.' });
  if (entry.code !== code.toString().trim()) return res.status(400).json({ error: 'Incorrect code.' });

  smsCodeStore.delete(normalized);

  let user = await queryOne('SELECT * FROM users WHERE phone = $1', [normalized]);
  if (!user) {
    const id = uuidv4();
    const fakeEmail = `phone_${normalized.replace(/\+/g, '')}@cryptora.phone`;
    await query(`
      INSERT INTO users (id, email, password_hash, name, role, balance, currency, email_verified, phone, phone_verified)
      VALUES ($1,$2,'','player','player',0,'USD',true,$3,true)
      ON CONFLICT (email) DO NOTHING
    `, [id, fakeEmail, normalized]);
    user = await queryOne('SELECT * FROM users WHERE phone = $1', [normalized]);
    if (entry.refCode) {
      try { trackRegistration(user.id, fakeEmail, entry.refCode); } catch {}
    }
  } else {
    await query('UPDATE users SET phone_verified=true WHERE id=$1', [user.id]);
    user = await queryOne('SELECT * FROM users WHERE id = $1', [user.id]);
  }

  res.json({ ok: true, token: signToken(user), user: sanitizeUser(user) });
});

// ── GET/PUT /me ───────────────────────────────────────────────────────────────
router.get('/me', authMiddleware, (req, res) => {
  res.json(req.user);
});

router.put('/me', authMiddleware, async (req, res) => {
  const allowed = ['name', 'currency', 'preferred_currency', 'favorite_games'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      updates[key] = key === 'favorite_games' ? JSON.stringify(req.body[key]) : req.body[key];
    }
  }
  if (!Object.keys(updates).length) return res.json(req.user);

  updates.updated_date = new Date().toISOString();
  const keys = Object.keys(updates);
  const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  await query(`UPDATE users SET ${sets} WHERE id = $${keys.length + 1}`,
    [...Object.values(updates), req.user.id]);

  const updated = await queryOne('SELECT * FROM users WHERE id = $1', [req.user.id]);
  invalidateUserCache(req._token);
  res.json(sanitizeUser(updated));
});

// ── POST /change-password ────────────────────────────────────────────────────
// Requires current password, invalidates ALL existing sessions
router.post('/change-password', authMiddleware, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password)
    return res.status(400).json({ error: 'current_password and new_password required' });
  if (new_password.length < 8)
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  if (current_password === new_password)
    return res.status(400).json({ error: 'New password must be different from current' });

  try {
    const user = await queryOne('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!user || !user.password_hash)
      return res.status(400).json({ error: 'Password change not available for this account type' });

    const valid = bcrypt.compareSync(current_password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

    const newHash = bcrypt.hashSync(new_password, 12);
    await query('UPDATE users SET password_hash = $1, updated_date = NOW() WHERE id = $2', [newHash, user.id]);

    // Invalidate current token — user must re-login
    if (req._token) {
      const decoded = jwt.decode(req._token);
      if (decoded?.exp) await blacklistToken(req._token, decoded.exp);
      invalidateUserCache(req._token);
    }

    // Also invalidate ALL other active tokens for this user from DB
    // We do this by storing a password_changed_at and checking it in authMiddleware
    await query('UPDATE users SET password_changed_at = NOW() WHERE id = $1', [user.id]);

    res.json({ ok: true, message: 'Password changed. Please log in again.' });
  } catch(e) {
    console.error('[change-password]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /logout ──────────────────────────────────────────────────────────────
router.post('/logout', authMiddleware, async (req, res) => {
  try {
    const token = req._token;
    const decoded = require('jsonwebtoken').decode(token);
    if (token && decoded?.exp) {
      await blacklistToken(token, decoded.exp);
      invalidateUserCache(token);
    }
    res.json({ ok: true });
  } catch(e) {
    res.json({ ok: true }); // Always succeed on logout
  }
});

// ── Admin: delete user ────────────────────────────────────────────────────────
router.delete('/admin/delete-user/:id', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const user = await queryOne('SELECT * FROM users WHERE id = $1', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role === 'admin') return res.status(400).json({ error: 'Cannot delete admin accounts' });

  try {
    await query('DELETE FROM tx_idempotency WHERE user_email = $1', [user.email]);
    await query('DELETE FROM game_sessions WHERE user_email = $1', [user.email]);
    await query('DELETE FROM crypto_deposits_pg WHERE user_id = $1', [user.id]).catch(() => {});
    await query('DELETE FROM crypto_withdrawals WHERE user_id = $1', [user.id]);
    await query('DELETE FROM crypto_addresses WHERE user_id = $1', [user.id]);
    await query('DELETE FROM affiliate_referrals WHERE referred_user_id = $1', [user.id]);
    await query('DELETE FROM promotion_claims WHERE user_id = $1', [user.id]);
    await query('DELETE FROM users WHERE id = $1', [user.id]);
    res.json({ ok: true, message: `Player ${user.email} deleted` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Debug: verify-code (dev only) ─────────────────────────────────────────────
router.get('/debug/verify-code', async (req, res) => {
  const { email, secret } = req.query;
  if (secret !== process.env.JWT_SECRET) return res.status(403).json({ error: 'Forbidden' });
  const user = await queryOne(
    'SELECT email, email_verification_token, email_verification_expires, email_verified FROM users WHERE email=$1',
    [email]
  );
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});


// ── Admin: create new admin account ──────────────────────────────────────────
router.post('/admin/create-admin', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const { email, password, username } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password min 8 characters' });
  try {
    const exists = await queryOne('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
    if (exists) return res.status(409).json({ error: 'Email already exists' });
    const bcrypt = require('bcryptjs');
    const { v4: uuidv4 } = require('uuid');
    const hash = await bcrypt.hash(password, 10);
    const newAdmin = await queryOne(
      `INSERT INTO users (id, email, name, password_hash, role, balance, email_verified, created_date)
       VALUES ($1, $2, $3, $4, 'admin', 0, true, NOW())
       RETURNING id, email, name, role`,
      [uuidv4(), email.toLowerCase(), username || email.split('@')[0], hash]
    );
    res.json({ ok: true, admin: newAdmin });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});


// ── Admin: list all admins ────────────────────────────────────────────────────
router.get('/admin/list-admins', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  try {
    const admins = await queryAll(
      "SELECT id, email, name, role, created_date FROM users WHERE role='admin' ORDER BY created_date ASC"
    );
    res.json({ admins });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
