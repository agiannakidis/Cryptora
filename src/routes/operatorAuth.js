// src/routes/operatorAuth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { queryOne, queryAll, query, transaction } = require('../pgdb');
const { insert: chInsert } = require('../chdb');

const JWT_SECRET = process.env.JWT_SECRET || 'casino-secret-2026';

// Mirror operator transaction to ClickHouse for analytics (fire-and-forget)
function chMirrorOpTx({ id, operator_id, operator_username, player_id, player_username, type, amount, note }) {
  chInsert('operator_transactions', [{
    id: id || require('crypto').randomUUID(),
    operator_id: String(operator_id || ''),
    operator_username: String(operator_username || ''),
    player_id: String(player_id || ''),
    player_username: String(player_username || ''),
    type: String(type),
    amount: parseFloat(amount) || 0,
    note: String(note || ''),
    created_at: new Date().toISOString().replace('T',' ').replace('Z','')
  }]).catch(e => console.error('[CH op_tx mirror]', e.message));
}


const SITE_URL = process.env.SITE_URL || 'https://cryptora.live';

// Email transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

async function sendMail(to, subject, html) {
  try {
    await transporter.sendMail({ from: process.env.SMTP_FROM, to, subject, html });
    return true;
  } catch(e) {
    console.error('[OperatorMail] error:', e.message);
    return false;
  }
}

// Operator JWT middleware
function operatorAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET);
    if (payload.role !== 'operator') return res.status(403).json({ error: 'Forbidden' });
    req.operatorId = payload.id;
    next();
  } catch(e) { return res.status(401).json({ error: 'Invalid token' }); }
}

// Admin auth middleware (reuse main admin token)
function adminAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET);
    if (payload.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    req.adminId = payload.id;
    next();
  } catch(e) { return res.status(401).json({ error: 'Invalid token' }); }
}

// ── POST /api/operator/register ──
router.post('/register', async (req, res) => {
  try {
    const { email, username, password, currency } = req.body;
    if (!email || !username || !password || !currency)
      return res.status(400).json({ error: 'All fields required' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Password min 8 characters' });

    // Check duplicates
    const exists = await queryOne(
      'SELECT id FROM operators WHERE email=$1 OR username=$2', [email.toLowerCase(), username]
    );
    if (exists) return res.status(409).json({ error: 'Email or username already registered' });

    const hash = await bcrypt.hash(password, 10);
    const token = crypto.randomBytes(32).toString('hex');

    await query(
      `INSERT INTO operators (email, username, password_hash, currency, status, email_token)
       VALUES ($1, $2, $3, $4, 'pending_email', $5)`,
      [email.toLowerCase(), username, hash, currency, token]
    );

    // Send verification email
    const verifyUrl = `${SITE_URL}/api/operator/verify-email?token=${token}`;
    await sendMail(email, 'Cryptora — Verify your email', `
      <div style="font-family:sans-serif;max-width:500px;margin:0 auto;background:#0d0820;color:#e2e8f0;padding:32px;border-radius:12px">
        <h2 style="color:#f5a623">Cryptora Operator Portal</h2>
        <p>Hello <strong>${username}</strong>,</p>
        <p>Please verify your email address to complete your operator registration.</p>
        <a href="${verifyUrl}" style="display:inline-block;margin:20px 0;padding:14px 28px;background:linear-gradient(135deg,#f5a623,#e08010);color:#000;font-weight:700;border-radius:8px;text-decoration:none">
          Verify Email →
        </a>
        <p style="color:#64748b;font-size:13px">Link expires in 24 hours. If you didn't register, ignore this email.</p>
      </div>
    `);

    res.json({ ok: true, message: 'Registration submitted. Check your email to verify.' });
  } catch(e) {
    console.error('[Operator register]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/operator/verify-email ──
router.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.redirect('/operator?error=invalid_token');

    const op = await queryOne(
      `SELECT id, username, email, status FROM operators WHERE email_token=$1`, [token]
    );
    if (!op) return res.redirect('/operator?error=invalid_token');
    if (op.status !== 'pending_email') return res.redirect('/operator?error=already_verified');

    await query(
      `UPDATE operators SET status='pending_approval', email_token=NULL, email_verified_at=NOW() WHERE id=$1`,
      [op.id]
    );

    // Notify admin via operator_messages (system message)
    await query(
      `INSERT INTO operator_messages (operator_id, sender, message)
       VALUES ($1, 'system', $2)`,
      [op.id, `New operator registration: ${op.username} (${op.email}) — email verified, awaiting approval.`]
    );

    // Send email to admin
    const adminEmail = process.env.ADMIN_EMAIL || 'gaminator2013@gmail.com';
    await sendMail(adminEmail, `New operator request: ${op.username}`, `
      <div style="font-family:sans-serif;background:#0d0820;color:#e2e8f0;padding:32px;border-radius:12px">
        <h2 style="color:#f5a623">New Operator Request</h2>
        <p><strong>${op.username}</strong> (${op.email}) has verified their email and is requesting operator access.</p>
        <a href="${SITE_URL}/admin/operators" style="display:inline-block;margin:20px 0;padding:14px 28px;background:#f5a623;color:#000;font-weight:700;border-radius:8px;text-decoration:none">
          Review in Admin Panel →
        </a>
      </div>
    `);

    res.redirect('/operator?verified=1');
  } catch(e) {
    console.error('[Operator verify]', e.message);
    res.redirect('/operator?error=server_error');
  }
});

// ── POST /api/operator/login ──
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'All fields required' });

    const op = await queryOne(
      `SELECT * FROM operators WHERE username=$1 OR email=$1`, [username.toLowerCase()]
    );
    if (!op) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, op.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    if (op.status === 'pending_email')
      return res.status(403).json({ error: 'Please verify your email first' });
    if (op.status === 'pending_approval')
      return res.status(403).json({ error: 'Your account is pending admin approval' });
    if (op.status === 'rejected')
      return res.status(403).json({ error: 'Your application was rejected' });
    if (op.status !== 'approved')
      return res.status(403).json({ error: 'Account not active' });

    const token = jwt.sign({ id: op.id, role: 'operator', username: op.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, operator: { id: op.id, username: op.username, email: op.email, currency: op.currency, balance: parseFloat(op.balance) } });
  } catch(e) {
    console.error('[Operator login]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/operator/me ──
router.get('/me', operatorAuth, async (req, res) => {
  try {
    const op = await queryOne(`SELECT id,username,email,currency,balance,status,created_at FROM operators WHERE id=$1`, [req.operatorId]);
    if (!op) return res.status(404).json({ error: 'Not found' });
    res.json({ ...op, balance: parseFloat(op.balance) });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// ── GET/POST /api/operator/chat ── (operator side)
router.get('/chat', operatorAuth, async (req, res) => {
  try {
    const msgs = await queryAll(
      `SELECT id, sender, message, created_at, read_at FROM operator_messages
       WHERE operator_id=$1 ORDER BY created_at ASC`, [req.operatorId]
    );
    // Mark admin messages as read
    await query(
      `UPDATE operator_messages SET read_at=NOW() WHERE operator_id=$1 AND sender='admin' AND read_at IS NULL`,
      [req.operatorId]
    );
    res.json(msgs);
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/chat', operatorAuth, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Empty message' });
    await query(
      `INSERT INTO operator_messages (operator_id, sender, message) VALUES ($1, 'operator', $2)`,
      [req.operatorId, message.trim()]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// ════════════════════════════════════════════
// ADMIN ROUTES for operators
// ════════════════════════════════════════════


// Super admin check — env-based, no DB round-trip
function isSuperAdmin(adminId) {
  const ids = (process.env.SUPER_ADMIN_ID || 'd5f15957-060d-49ec-afdf-e53131ee193b').split(',').map(s => s.trim());
  return Promise.resolve(ids.includes(adminId));
}

// GET /api/operator/admin/stats
router.get('/admin/stats', adminAuth, async (req, res) => {
  try {
    const su = await isSuperAdmin(req.adminId);
    const row = su
      ? await queryOne('SELECT COUNT(*) as players FROM operator_players WHERE deleted_at IS NULL')
      : await queryOne(
          'SELECT COUNT(*) as players FROM operator_players op JOIN operators o ON o.id=op.operator_id WHERE op.deleted_at IS NULL AND o.owner_admin_id=$1',
          [req.adminId]
        );
    res.json({ players: parseInt(row.players) });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/operator/admin/transactions
router.get('/admin/transactions', adminAuth, async (req, res) => {
  try {
    const su = await isSuperAdmin(req.adminId);
    const whereClause = su ? '' : 'WHERE o.owner_admin_id=$1';
    const params = su ? [] : [req.adminId];
    const txs = await queryAll(
      `SELECT ot.*, o.username as operator_username
       FROM operator_transactions ot
       LEFT JOIN operators o ON o.id = ot.operator_id
       ${whereClause}
       ORDER BY ot.created_at DESC LIMIT 100`, params
    );
    res.json(txs.map(t => ({ ...t, amount: parseFloat(t.amount) })));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});


// GET /api/operator/admin/accounting?from=2026-01-01&to=2026-12-31
router.get('/admin/accounting', adminAuth, async (req, res) => {
  try {
    const { from, to } = req.query;
    const fromDate = from ? from : '2000-01-01';
    const toDate   = to   ? to   : '2099-12-31';
    const su = await isSuperAdmin(req.adminId);
    const ownerWhere = su ? '' : 'AND o.owner_admin_id=$3';
    const params = su ? [fromDate, toDate] : [fromDate, toDate, req.adminId];

    const rows = await require('../pgdb').queryAll(
      `SELECT
         o.id, o.username, o.currency, o.balance,
         COALESCE(SUM(CASE WHEN ot.type='player_deposit'  THEN ot.amount ELSE 0 END),0) AS cashin,
         COALESCE(SUM(CASE WHEN ot.type='player_withdraw' THEN ot.amount ELSE 0 END),0) AS cashout,
         COALESCE(SUM(CASE WHEN ot.type='admin_credit'    THEN ot.amount ELSE 0 END),0) AS admin_in,
         COALESCE(SUM(CASE WHEN ot.type='admin_debit'     THEN ot.amount ELSE 0 END),0) AS admin_out,
         COUNT(CASE WHEN ot.type='player_deposit'  THEN 1 END) AS cashin_count,
         COUNT(CASE WHEN ot.type='player_withdraw' THEN 1 END) AS cashout_count
       FROM operators o
       LEFT JOIN operator_transactions ot
         ON ot.operator_id = o.id
         AND ot.created_at >= $1::timestamptz
         AND ot.created_at <  ($2::date + interval '1 day')::timestamptz
       WHERE 1=1 ${ownerWhere}
       GROUP BY o.id, o.username, o.currency, o.balance
       ORDER BY o.username`,
      params
    );
    res.json(rows.map(r => ({
      ...r,
      cashin:     parseFloat(r.cashin),
      cashout:    parseFloat(r.cashout),
      admin_in:   parseFloat(r.admin_in),
      admin_out:  parseFloat(r.admin_out),
      balance:    parseFloat(r.balance),
      profit:     parseFloat(r.cashin) - parseFloat(r.cashout),
      cashin_count:  parseInt(r.cashin_count),
      cashout_count: parseInt(r.cashout_count),
    })));
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// GET /api/operator/admin/list
router.get('/admin/list', adminAuth, async (req, res) => {
  try {
    const su = await isSuperAdmin(req.adminId);
    const whereClause = su ? '' : 'WHERE owner_admin_id=$1';
    const params = su ? [] : [req.adminId];
    const ops = await queryAll(
      `SELECT id, email, username, currency, status, balance, created_at, approved_at, notes,
              (SELECT COUNT(*) FROM operator_messages WHERE operator_id=operators.id AND sender='operator' AND read_at IS NULL) as unread
       FROM operators ${whereClause} ORDER BY created_at DESC`, params
    );
    res.json(ops.map(o => ({ ...o, balance: parseFloat(o.balance || 0), unread: parseInt(o.unread) })));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/operator/admin/:id/approve
router.post('/admin/:id/approve', adminAuth, async (req, res) => {
  try {
    const op = await queryOne(`SELECT * FROM operators WHERE id=$1`, [req.params.id]);
    if (!op) return res.status(404).json({ error: 'Not found' });

    await query(
      `UPDATE operators SET status='approved', approved_at=NOW(), approved_by=$1 WHERE id=$2`,
      [req.adminId, op.id]
    );

    // Notify operator
    await query(
      `INSERT INTO operator_messages (operator_id, sender, message) VALUES ($1, 'admin', $2)`,
      [op.id, '✅ Your operator account has been approved! You can now log in at cryptora.live/operator']
    );

    await sendMail(op.email, 'Cryptora — Operator account approved!', `
      <div style="font-family:sans-serif;background:#0d0820;color:#e2e8f0;padding:32px;border-radius:12px">
        <h2 style="color:#22c55e">✅ Account Approved!</h2>
        <p>Hello <strong>${op.username}</strong>,</p>
        <p>Your operator account on Cryptora has been approved. You can now log in.</p>
        <a href="${SITE_URL}/operator" style="display:inline-block;margin:20px 0;padding:14px 28px;background:#22c55e;color:#000;font-weight:700;border-radius:8px;text-decoration:none">
          Login to Operator Portal →
        </a>
      </div>
    `);

    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/operator/admin/:id/reject
router.post('/admin/:id/reject', adminAuth, async (req, res) => {
  try {
    const { reason } = req.body;
    const op = await queryOne(`SELECT * FROM operators WHERE id=$1`, [req.params.id]);
    if (!op) return res.status(404).json({ error: 'Not found' });

    await query(`UPDATE operators SET status='rejected', notes=$1 WHERE id=$2`, [reason || '', op.id]);

    await query(
      `INSERT INTO operator_messages (operator_id, sender, message) VALUES ($1, 'admin', $2)`,
      [op.id, `❌ Your operator application was rejected.${reason ? ' Reason: ' + reason : ''}`]
    );

    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/operator/admin/:id/credit — add balance
router.post('/admin/:id/credit', adminAuth, async (req, res) => {
  try {
    const { amount, note } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });

    const op = await queryOne(`SELECT * FROM operators WHERE id=$1`, [req.params.id]);
    if (!op) return res.status(404).json({ error: 'Not found' });

    await query(`UPDATE operators SET balance = balance + $1 WHERE id=$2`, [amt, op.id]);

    const newBalance = parseFloat(op.balance) + amt;
    await query(
      `INSERT INTO operator_messages (operator_id, sender, message) VALUES ($1, 'admin', $2)`,
      [op.id, `💰 Balance credited: +$${amt.toFixed(2)}${note ? ' — ' + note : ''}. New balance: $${newBalance.toFixed(2)}`]
    );

    // Record in operator_transactions for the Admin Tx tab
    const { v4: uuidv4tx } = require('uuid');
    const txId = uuidv4tx();
    await query(
      `INSERT INTO operator_transactions (id, operator_id, player_id, type, amount, note, created_at)
       VALUES ($1, $2, NULL, 'admin_credit', $3, $4, NOW())`,
      [txId, op.id, amt, note || `Admin balance credit +$${amt.toFixed(2)}`]
    ).catch(e => console.error('[admin_credit tx]', e.message));
    chMirrorOpTx({ id: txId, operator_id: op.id, operator_username: op.username, player_id: '', player_username: '', type: 'admin_credit', amount: amt, note: note || '' });

    res.json({ ok: true, newBalance });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/operator/admin/:id/chat
router.get('/admin/:id/chat', adminAuth, async (req, res) => {
  try {
    const msgs = await queryAll(
      `SELECT id, sender, message, created_at, read_at FROM operator_messages
       WHERE operator_id=$1 ORDER BY created_at ASC`, [req.params.id]
    );
    // Mark operator messages as read
    await query(
      `UPDATE operator_messages SET read_at=NOW() WHERE operator_id=$1 AND sender='operator' AND read_at IS NULL`,
      [req.params.id]
    );
    res.json(msgs);
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/operator/admin/:id/chat
router.post('/admin/:id/chat', adminAuth, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Empty message' });
    await query(
      `INSERT INTO operator_messages (operator_id, sender, message) VALUES ($1, 'admin', $2)`,
      [req.params.id, message.trim()]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});




// ══════════════════════════════════════════
// OPERATOR PLAYERS
// ══════════════════════════════════════════

// GET /api/operator/players
router.get('/players', operatorAuth, async (req, res) => {
  try {
    const players = await queryAll(
      `SELECT id, username, balance, currency, in_game, last_seen, created_at FROM operator_players WHERE operator_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC`,
      [req.operatorId]
    );
    res.json(players.map(p => ({ ...p, balance: parseFloat(p.balance) })));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/operator/players — create player
router.post('/players', operatorAuth, async (req, res) => {
  try {
    const { username, password, currency } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password min 8 characters' });
    const op = await queryOne('SELECT currency FROM operators WHERE id=$1', [req.operatorId]);
    const cur = currency || op.currency || 'USD';
    const hash = await bcrypt.hash(password, 10);
    const existing = await queryOne('SELECT id FROM operator_players WHERE operator_id=$1 AND username=$2', [req.operatorId, username]);
    if (existing) return res.status(409).json({ error: 'Username already exists' });
    const player = await queryOne(
      `INSERT INTO operator_players (operator_id, username, password_hash, currency) VALUES ($1,$2,$3,$4) RETURNING id, username, balance, currency, created_at`,
      [req.operatorId, username, hash, cur]
    );
    res.json({ ok: true, player: { ...player, balance: parseFloat(player.balance) } });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// POST /api/operator/players/:id/deposit
router.post('/players/:id/deposit', operatorAuth, async (req, res) => {
  try {
    const { amount, note } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0 || isNaN(amt)) return res.status(400).json({ error: 'Invalid amount' });

    const player = await queryOne(
      'SELECT * FROM operator_players WHERE id=$1 AND operator_id=$2 AND deleted_at IS NULL',
      [req.params.id, req.operatorId]
    );
    if (!player) return res.status(404).json({ error: 'Player not found' });

    let newPlayerBalance;
    await transaction(async (client) => {
      // Atomic operator balance deduction with guard
      const opResult = await client.query(
        'UPDATE operators SET balance = balance - $1 WHERE id=$2 AND balance >= $1 RETURNING balance',
        [amt, req.operatorId]
      );
      if (!opResult.rowCount) throw new Error('Insufficient operator balance');

      // Credit player atomically
      const plResult = await client.query(
        'UPDATE operator_players SET balance = balance + $1 WHERE id=$2 RETURNING balance',
        [amt, req.params.id]
      );
      newPlayerBalance = parseFloat(plResult.rows[0].balance);

      await client.query(
        `INSERT INTO operator_transactions (operator_id, player_id, type, amount, note) VALUES ($1,$2,'player_deposit',$3,$4)`,
        [req.operatorId, req.params.id, amt, note || `Deposit to ${player.username}`]
      );
    });

    chMirrorOpTx({ operator_id: req.operatorId, operator_username: req.username||'', player_id: req.params.id, player_username: player.username, type: 'player_deposit', amount: amt, note: note || '' });
    res.json({ ok: true, playerBalance: newPlayerBalance });
  } catch(e) {
    console.error('[deposit]', e.message);
    if (e.message === 'Insufficient operator balance') return res.status(400).json({ error: e.message });
    res.status(500).json({ error: 'Server error', detail: e.message });
  }
});

// POST /api/operator/players/:id/withdraw
router.post('/players/:id/withdraw', operatorAuth, async (req, res) => {
  try {
    const { amount, note } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0 || isNaN(amt)) return res.status(400).json({ error: 'Invalid amount' });

    const player = await queryOne(
      'SELECT * FROM operator_players WHERE id=$1 AND operator_id=$2 AND deleted_at IS NULL',
      [req.params.id, req.operatorId]
    );
    if (!player) return res.status(404).json({ error: 'Player not found' });
    if (player.in_game) return res.status(409).json({ error: 'Cannot withdraw while player is in-game', in_game: true });

    let newPlayerBalance;
    await transaction(async (client) => {
      // Atomic player balance deduction with guard
      const plResult = await client.query(
        'UPDATE operator_players SET balance = balance - $1 WHERE id=$2 AND balance >= $1 AND in_game = false RETURNING balance',
        [amt, req.params.id]
      );
      if (!plResult.rowCount) throw new Error('Insufficient player balance or player is in-game');
      newPlayerBalance = parseFloat(plResult.rows[0].balance);

      // Credit operator
      await client.query(
        'UPDATE operators SET balance = balance + $1 WHERE id=$2',
        [amt, req.operatorId]
      );
      await client.query(
        `INSERT INTO operator_transactions (operator_id, player_id, type, amount, note) VALUES ($1,$2,'player_withdraw',$3,$4)`,
        [req.operatorId, req.params.id, amt, note || `Withdraw from ${player.username}`]
      );
    });

    chMirrorOpTx({ operator_id: req.operatorId, operator_username: req.username||'', player_id: req.params.id, player_username: player.username, type: 'player_withdraw', amount: amt, note: note || '' });
    res.json({ ok: true, playerBalance: newPlayerBalance });
  } catch(e) {
    console.error('[withdraw]', e.message);
    if (e.message.includes('Insufficient') || e.message.includes('in-game')) return res.status(400).json({ error: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════
// TRANSACTIONS
// ══════════════════════════════════════════

// GET /api/operator/transactions?from=&to=&type=&export=csv
router.get('/transactions', operatorAuth, async (req, res) => {
  try {
    const { from, to, type, export: exp } = req.query;
    let conditions = ['t.operator_id=$1'];
    let params = [req.operatorId];
    let idx = 2;
    if (from) { conditions.push(`t.created_at >= $${idx++}`); params.push(from); }
    if (to)   { conditions.push(`t.created_at <= $${idx++}`); params.push(to + ' 23:59:59'); }
    if (type && type !== 'all') { conditions.push(`t.type=$${idx++}`); params.push(type); }
    const rows = await queryAll(
      `SELECT t.id, t.type, t.amount, t.note, t.created_at,
              p.username as player_username
       FROM operator_transactions t
       LEFT JOIN operator_players p ON p.id = t.player_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY t.created_at DESC LIMIT 500`,
      params
    );
    const data = rows.map(r => ({ ...r, amount: parseFloat(r.amount) }));
    if (exp === 'csv') {
      const header = 'Date,Type,Amount,Player,Note\n';
      const lines = data.map(r =>
        `"${new Date(r.created_at).toLocaleString()}","${r.type}","${r.amount.toFixed(2)}","${r.player_username||''}","${(r.note||'').replace(/"/g,'""')}"`
      ).join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"');
      return res.send(header + lines);
    }
    res.json(data);
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// ══════════════════════════════════════════
// OPERATOR PLAYER LOGIN (for /land)
// ══════════════════════════════════════════

router.post('/player-login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'All fields required' });
    const player = await queryOne(
      `SELECT op.*, o.username as op_username FROM operator_players op
       JOIN operators o ON o.id = op.operator_id
       WHERE op.username=$1 AND o.status='approved'`,
      [username]
    );
    if (!player) return res.status(401).json({ error: 'Invalid credentials' });
    const match = await bcrypt.compare(password, player.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign(
      { id: player.id, role: 'op_player', username: player.username, operatorId: player.operator_id },
      JWT_SECRET, { expiresIn: '7d' }
    );
    res.json({ token, player: { id: player.id, username: player.username, balance: parseFloat(player.balance), currency: player.currency } });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/operator/player-me  
router.get('/player-me', async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const payload = jwt.verify(auth.slice(7), JWT_SECRET);
    if (payload.role !== 'op_player') return res.status(403).json({ error: 'Forbidden' });
    const player = await queryOne(
      'SELECT id, username, balance, currency FROM operator_players WHERE id=$1',
      [payload.id]
    );
    if (!player) return res.status(404).json({ error: 'Not found' });
    res.json({ ...player, balance: parseFloat(player.balance) });
  } catch(e) { res.status(401).json({ error: 'Invalid token' }); }
});

// POST /api/operator/resend-verification
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const op = await queryOne('SELECT * FROM operators WHERE email=$1', [email.toLowerCase()]);
    if (!op) return res.status(404).json({ error: 'Email not found' });
    if (op.status !== 'pending_email') return res.status(400).json({ error: 'Email already verified' });
    const verifyUrl = `${SITE_URL}/api/operator/verify-email?token=${op.email_token}`;
    await sendMail(email, 'Cryptora — Verify your operator email', `
      <div style="font-family:sans-serif;background:#0d0820;color:#e2e8f0;padding:32px;border-radius:12px">
        <h2 style="color:#f5a623">Cryptora Operator Portal</h2>
        <p>Hello <strong>${op.username}</strong>,</p>
        <p>Click to verify your email:</p>
        <a href="${verifyUrl}" style="display:inline-block;margin:20px 0;padding:14px 28px;background:#f5a623;color:#000;font-weight:700;border-radius:8px;text-decoration:none">
          Verify Email &rarr;
        </a>
        <p style="color:#94a3b8;font-size:12px">Direct link: ${verifyUrl}</p>
      </div>
    `);
    res.json({ ok: true, message: 'Verification email resent' });
  } catch(e) { console.error('[Resend verify]', e.message); res.status(500).json({ error: 'Server error' }); }
});


// ─── POST /api/operator/admin/create ─────────────────────────────────────────
router.post('/admin/create', adminAuth, async (req, res) => {
  try {
    const { email, username, password, currency, initialBalance, notes } = req.body;
    if (!email || !username || !password || !currency)
      return res.status(400).json({ error: 'email, username, password, currency are required' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Password min 8 characters' });

    const exists = await queryOne(
      'SELECT id FROM operators WHERE email=$1 OR username=$2',
      [email.toLowerCase(), username]
    );
    if (exists) return res.status(409).json({ error: 'Email or username already exists' });

    const hash = await bcrypt.hash(password, 10);
    const balance = parseFloat(initialBalance) > 0 ? parseFloat(initialBalance) : 0;

    const op = await queryOne(
      `INSERT INTO operators (email, username, password_hash, currency, status, balance, notes, approved_at, approved_by, email_verified_at, owner_admin_id)
       VALUES ($1, $2, $3, $4, 'approved', $5, $6, NOW(), $7, NOW(), $7)
       RETURNING id, email, username, currency, balance, status, created_at`,
      [email.toLowerCase(), username, hash, currency, balance, notes || '', req.adminId]
    );

    await query(
      `INSERT INTO operator_messages (operator_id, sender, message) VALUES ($1, 'admin', $2)`,
      [op.id, 'Your operator account has been created and approved. You can now login at /operator']
    );

    res.json({ ok: true, operator: { ...op, balance: parseFloat(op.balance) } });
  } catch(e) {
    console.error('[admin create operator]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

// ─── POST /api/operator/launch-game ─────────────────────────────────────────
// Land player launches a game — returns game URL for iframe
const landPlayerAuth = (req, res, next) => {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'op_player') return res.status(403).json({ error: 'Forbidden' });
    req.landPlayer = decoded;
    next();
  } catch(e) { res.status(401).json({ error: 'Invalid token' }); }
};

const { v4: uuidv4 } = require('uuid');
const cryptoMod = require('crypto');
function md5hex(s){ return cryptoMod.createHash('md5').update(s).digest('hex').toUpperCase(); }

router.post('/launch-game', landPlayerAuth, async (req, res) => {
  try {
    const { gameId } = req.body;
    const player = req.landPlayer;
    const operatorId = process.env.PRAGMATIC_OPERATOR_ID || '749843';
    const privateKey = process.env.PRAGMATIC_PRIVATE_KEY;

    const game = await queryOne('SELECT * FROM games WHERE game_id=$1 OR id=$1 LIMIT 1', [gameId]);
    if (!game) return res.status(404).json({ error: 'Game not found' });

    const providerName = game.provider || 'Pragmatic Play';
    const providerRow  = await queryOne('SELECT * FROM game_providers WHERE name=$1', [providerName]);
    const gameName     = game.game_id || gameId;
    const sessionId    = uuidv4();
    const username     = 'land_' + player.id;

    let launchUrl = null;

    if (providerName === 'Yggdrasil') {
      const base = providerRow?.api_base_url || 'https://gs2.grandx.pro/yggdrasil-admin/launcher.html';
      const p = new URLSearchParams({ gameName, operatorId, sessionId, userName: username, mode: 'external', currency: 'USD', device: 'desktop', closeUrl: 'https://cryptora.live/land' });
      launchUrl = base + '?' + p.toString();

    } else if (providerName === "Play'n GO") {
      const pngApiUrl = process.env.PRAGMATIC_API_URL || 'https://gs2.grandx.pro/euro-extern/dispatcher/egame/openGame/v2';
      const pngGameId = game.provider_game_id || gameName;
      const sigInput = `${privateKey}operatorId=${operatorId}&username=${username}&sessionId=${sessionId}&gameId=${pngGameId}`;
      const accessPassword = md5hex(sigInput);
      const p = new URLSearchParams({ accessPassword, operatorId, username, sessionId, gameId: pngGameId });
      try {
        const resp = await fetch(pngApiUrl + '?' + p.toString(), { method: 'POST' });
        const text = await resp.text();
        const trimmed = text.trim();
        if (trimmed.startsWith('http')) { launchUrl = trimmed; }
        else { try { const j = JSON.parse(trimmed); launchUrl = j?.gameURL || j?.url || j?.game?.url || j?.gameUrl || null; } catch{} }
      } catch(fe) { console.error('[land playngo launch]', fe.message); }

    } else if (['NetGame', 'Novomatic'].includes(providerName)) {
      const baseMap = {
        Novomatic: 'https://gs2.grandx.pro/novomatic-admin/launcher.html',
        NetGame:   'https://gs2.grandx.pro/netgame-admin/launcher.html',
      };
      const base = providerRow?.api_base_url || baseMap[providerName];
      const p = new URLSearchParams({ gameName, operatorId, sessionId, userName: username, mode: 'external', currency: 'USD', closeUrl: 'https://cryptora.live/land' });
      launchUrl = base + '?' + p.toString();

    } else if (providerName === 'Amatic') {
      const base = providerRow?.api_base_url || 'https://gs2.grandx.pro/amatic-admin/launcher/opengame.html';
      const amaticOpId = operatorId;
      const p = new URLSearchParams({ gameName, operatorId: amaticOpId, sessionId, playerName: username, mode: 'external', currency: 'EUR', closeUrl: 'https://cryptora.live/land' });
      launchUrl = base + '?' + p.toString();

    } else if (game.category === 'GameServices') {
      // RGS providers (EGT, NetEnt, Novomatic, Amatic, Pragmatic via game-services.work)
      const rgsOperatorId = process.env.RGS_OPERATOR_ID || 'cryptora';
      const rgsLaunchBase = process.env.RGS_LAUNCH_URL || 'https://ss.game-services.work/platform/api/game/launch';
      const playerToken = uuidv4();
      const rgsSessionId = uuidv4();
      const currency = 'USD';
      await query(
        'INSERT INTO rgs_sessions (player_token, session_id, user_id, game_uuid, currency) VALUES ($1,$2,$3,$4,$5)',
        [playerToken, rgsSessionId, 'land:' + player.id, game.provider_game_id || game.game_id, currency]
      );
      launchUrl = rgsLaunchBase
        + '?operator_id=' + rgsOperatorId
        + '&player_token=' + playerToken
        + '&currency=' + currency
        + '&game_uuid=' + encodeURIComponent(game.provider_game_id || game.game_id)
        + '&device_type=DESKTOP'
        + '&lobby_url=' + encodeURIComponent('https://cryptora.live/land');

    } else {
      const apiUrl = process.env.PRAGMATIC_API_URL || 'https://gs2.grandx.pro/euro-extern/dispatcher/egame/openGame/v2';
      const sigInput = `${privateKey}operatorId=${operatorId}&username=${username}&sessionId=${sessionId}&gameId=${gameName}`;
      const accessPassword = md5hex(sigInput);
      const p = new URLSearchParams({ accessPassword, operatorId, username, sessionId, gameId: gameName });
      const fullUrl = apiUrl + '?' + p.toString();
      try {
        const resp = await fetch(fullUrl, { method: 'POST' });
        const text = await resp.text();
        const trimmed = text.trim();
        if (trimmed.startsWith('http')) { launchUrl = trimmed; }
        else { try { const j = JSON.parse(trimmed); launchUrl = j?.gameURL || j?.url || j?.game?.url || j?.gameUrl || null; } catch{} }
      } catch(fe) { console.error('[land launch]', fe.message); }
    }

    if (!launchUrl) return res.status(502).json({ error: 'Could not get game URL from provider' });
    res.json({ launchUrl, sessionId });
  } catch(e) { console.error('[land launch-game]', e.message); res.status(500).json({ error: 'Server error' }); }
});


// ─── PATCH /api/operator/player-status — update in_game flag ─────────────────
router.patch('/player-status', landPlayerAuth, async (req, res) => {
  try {
    const { in_game } = req.body;
    const playerId = req.landPlayer.id;
    await query(
      'UPDATE operator_players SET in_game=$1, last_seen=NOW() WHERE id=$2',
      [in_game === true, playerId]
    );
    res.json({ ok: true, in_game: in_game === true });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// ─── GET /api/operator/player-balance — quick balance poll ───────────────────
router.get('/player-balance', landPlayerAuth, async (req, res) => {
  try {
    const player = await queryOne('SELECT balance, in_game FROM operator_players WHERE id=$1', [req.landPlayer.id]);
    if (!player) return res.status(404).json({ error: 'Not found' });
    await query('UPDATE operator_players SET last_seen=NOW() WHERE id=$1', [req.landPlayer.id]);
    res.json({ balance: parseFloat(player.balance), in_game: player.in_game });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});


// ─── GET /api/operator/admin/:id/players ─────────────────────────────────────
router.get('/admin/:id/players', adminAuth, async (req, res) => {
  try {
    const players = await queryAll(
      `SELECT id, username, balance, in_game, last_seen, created_at
       FROM operator_players WHERE operator_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json(players.map(p => ({ ...p, balance: parseFloat(p.balance) })));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// ─── POST /api/operator/admin/:id/debit ──────────────────────────────────────
router.post('/admin/:id/debit', adminAuth, async (req, res) => {
  try {
    const { amount, note } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });
    const op = await queryOne(`SELECT * FROM operators WHERE id=$1`, [req.params.id]);
    if (!op) return res.status(404).json({ error: 'Not found' });
    if (parseFloat(op.balance) < amt) return res.status(400).json({ error: 'Insufficient balance' });

    await query(`UPDATE operators SET balance = balance - $1 WHERE id=$2`, [amt, op.id]);
    const newBalance = parseFloat(op.balance) - amt;

    await query(
      `INSERT INTO operator_messages (operator_id, sender, message) VALUES ($1, 'admin', $2)`,
      [op.id, `💸 Balance debited: -$${amt.toFixed(2)}${note ? ' — ' + note : ''}. New balance: $${newBalance.toFixed(2)}`]
    );

    const { v4: uuidv4tx } = require('uuid');
    await query(
      `INSERT INTO operator_transactions (id, operator_id, player_id, type, amount, note, created_at) VALUES ($1,$2,NULL,'admin_debit',$3,$4,NOW())`,
      [uuidv4tx(), op.id, amt, note || `Admin balance debit -$${amt.toFixed(2)}`]
    ).catch(e => console.error('[admin_debit tx]', e.message));
    chMirrorOpTx({ id: uuidv4tx(), operator_id: op.id, operator_username: op.username, player_id: '', player_username: '', type: 'admin_debit', amount: amt, note: note || '' });

    res.json({ ok: true, newBalance });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});


// ─── GET /api/operator/admin/:id/providers ────────────────────────────────────
router.get('/admin/:id/providers', adminAuth, async (req, res) => {
  try {
    // Get all providers from DB
    const allProviders = await queryAll('SELECT id, name FROM game_providers ORDER BY name');
    // Get enabled ones for this operator
    const opProviders = await queryAll(
      'SELECT provider_id, enabled FROM operator_providers WHERE operator_id=$1',
      [req.params.id]
    );
    const enabledMap = {};
    opProviders.forEach(p => { enabledMap[p.provider_id] = p.enabled; });

    // If no entries yet → all enabled by default
    const result = allProviders.map(p => ({
      id: p.id, name: p.name,
      enabled: enabledMap[p.id] !== undefined ? enabledMap[p.id] : true
    }));
    res.json(result);
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// ─── PATCH /api/operator/admin/:id/providers/:providerId ─────────────────────
router.patch('/admin/:id/providers/:providerId', adminAuth, async (req, res) => {
  try {
    const { enabled } = req.body;
    const opId = req.params.id;
    const provId = req.params.providerId;

    // Get provider name
    const prov = await queryOne('SELECT name FROM game_providers WHERE id=$1', [provId]);
    if (!prov) return res.status(404).json({ error: 'Provider not found' });

    await query(
      `INSERT INTO operator_providers (operator_id, provider_id, provider_name, enabled)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (operator_id, provider_id) DO UPDATE SET enabled=$4`,
      [opId, provId, prov.name, enabled === true]
    );
    res.json({ ok: true, enabled: enabled === true });
  } catch(e) { console.error('[op providers]', e.message); res.status(500).json({ error: 'Server error' }); }
});



// ─── DELETE /api/operator/admin/:opId/players/:playerId ──────────────────────
router.delete('/admin/:opId/players/:playerId', adminAuth, async (req, res) => {
  try {
    const player = await queryOne(
      `SELECT * FROM operator_players WHERE id=$1 AND operator_id=$2`,
      [req.params.playerId, req.params.opId]
    );
    if (!player) return res.status(404).json({ error: 'Player not found' });
    if (player.deleted_at) return res.status(409).json({ error: 'Already deleted' });

    // Soft-delete: mark deleted, anonymize username, zero balance
    await query(
      `UPDATE operator_players SET deleted_at=NOW(), username=$1, balance=0, password_hash='deleted', in_game=false WHERE id=$2`,
      [`deleted_${player.id.substring(0,8)}`, req.params.playerId]
    );

    // Record in transactions that account was closed (keeps history intact)
    if (parseFloat(player.balance) > 0) {
      await query(
        `INSERT INTO operator_transactions (operator_id, player_id, type, amount, note) VALUES ($1,$2,'player_withdraw',$3,$4)`,
        [req.params.opId, req.params.playerId, parseFloat(player.balance), `Account closed — balance returned to operator`]
      );
      await query(`UPDATE operators SET balance = balance + $1 WHERE id=$2`, [parseFloat(player.balance), req.params.opId]);
    }

    res.json({ ok: true, returned: parseFloat(player.balance) });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});
// ─── GET /api/operator/my-providers — for land players ───────────────────────
// Returns providers enabled for the player's operator
router.get('/my-providers', landPlayerAuth, async (req, res) => {
  try {
    const player = await queryOne(
      'SELECT operator_id FROM operator_players WHERE id=$1',
      [req.landPlayer.id]
    );
    if (!player) return res.status(404).json({ error: 'Not found' });

    const allProviders = await queryAll('SELECT id, name FROM game_providers ORDER BY name');
    const opProviders = await queryAll(
      'SELECT provider_id, enabled FROM operator_providers WHERE operator_id=$1',
      [player.operator_id]
    );
    const enabledMap = {};
    opProviders.forEach(p => { enabledMap[p.provider_id] = p.enabled; });

    // Filter to only enabled (default enabled if no entry)
    const enabled = allProviders.filter(p =>
      enabledMap[p.id] !== undefined ? enabledMap[p.id] : true
    );
    res.json(enabled);
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});


// ─── GET /api/operator/my-games — games filtered by operator's enabled providers
router.get('/my-games', landPlayerAuth, async (req, res) => {
  try {
    const player = await queryOne(
      'SELECT operator_id FROM operator_players WHERE id=$1',
      [req.landPlayer.id]
    );
    if (!player) return res.status(404).json({ error: 'Not found' });

    // Get enabled provider IDs for this operator
    const allProviders = await queryAll('SELECT id, name FROM game_providers ORDER BY name');
    const opProviders  = await queryAll(
      'SELECT provider_id, enabled FROM operator_providers WHERE operator_id=$1',
      [player.operator_id]
    );
    const enabledMap = {};
    opProviders.forEach(p => { enabledMap[p.provider_id] = p.enabled; });

    // Filter to enabled providers (default: enabled if no entry)
    const enabledProviderIds = new Set(
      allProviders
        .filter(p => enabledMap[p.id] !== undefined ? enabledMap[p.id] : true)
        .map(p => p.id)
    );
    const enabledProviderNames = new Set(
      allProviders
        .filter(p => enabledProviderIds.has(p.id))
        .map(p => p.name.toLowerCase())
    );

    // Fetch all games and filter
    const allGames = await queryAll(
      `SELECT g.*, gp.name as provider_name, gp.id as provider_id
       FROM games g
       LEFT JOIN game_providers gp ON gp.name = g.provider
       ORDER BY g.title ASC`,
      []
    );

    const filtered = allGames.filter(g => {
      const pid = g.provider_id;
      if (pid && enabledProviderIds.has(pid)) return true;
      const pname = (g.provider || '').toLowerCase();
      return [...enabledProviderNames].some(n => pname.includes(n));
    });

    res.json(filtered);
  } catch(e) { console.error('[my-games]', e.message); res.status(500).json({ error: 'Server error' }); }
});


// ── GET /api/operator/admin/wallet-logs ───────────────────────────────────────
router.get('/admin/wallet-logs', adminAuth, async (req, res) => {
  try {
    const { from, to, user_id, action } = req.query;
    const fromDt = from ? from + ' 00:00:00' : '2020-01-01 00:00:00';
    const toDt   = to   ? to   + ' 23:59:59' : '2099-12-31 23:59:59';
    let where = "created_at >= '" + fromDt + "' AND created_at <= '" + toDt + "'";
    if (user_id) where += " AND user_id = '" + user_id.replace(/'/g,'') + "'";
    if (action && action !== 'all') where += " AND action = '" + action.replace(/'/g,'') + "'";
    const { queryAll: chQuery } = require('../chdb');
    const rows = await chQuery(
      'SELECT action, user_id, username, session_id, round_id, amount, balance_before, balance_after, currency, game_id, provider, response_status, error_msg, operator_id, toString(created_at) as ts FROM casino.wallet_api_logs WHERE ' + where + ' ORDER BY created_at DESC LIMIT 500'
    );
    res.json(rows);
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// ── GET /api/operator/admin/wallet-log-players ────────────────────────────────
router.get('/admin/wallet-log-players', adminAuth, async (req, res) => {
  try {
    const { queryAll: chQuery } = require('../chdb');
    const rows = await chQuery(
      'SELECT DISTINCT user_id, username, operator_id FROM casino.wallet_api_logs ORDER BY username LIMIT 200'
    );
    res.json(rows);
  } catch(e) { res.status(500).json([]); }
});
