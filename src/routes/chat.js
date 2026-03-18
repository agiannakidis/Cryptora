const express = require('express');
const router = express.Router();
const { queryAll, queryOne, query } = require('../pgdb');
const { authMiddleware, optionalAuth } = require('../middleware/auth');

// ── POST /api/chat/session — start or resume session ──────────────────────
router.post('/session', optionalAuth, async (req, res) => {
  try {
    const { name, email } = req.body;
    const userId = req.user?.id || null;
    const userEmail = req.user?.email || email || null;
    const userName = req.user?.email?.split('@')[0] || name || 'Guest';

    // Try to find open session for this user
    let session = null;
    if (userId) {
      session = await queryOne(
        `SELECT * FROM chat_sessions WHERE user_id = $1 AND status = 'open' ORDER BY last_message_at DESC LIMIT 1`,
        [userId]
      );
    }

    if (!session) {
      session = await queryOne(
        `INSERT INTO chat_sessions (user_id, user_email, user_name)
         VALUES ($1, $2, $3) RETURNING *`,
        [userId, userEmail, userName]
      );
    }

    res.json(session);
  } catch (e) {
    console.error('[chat/session]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/chat/messages/:sessionId — get messages ─────────────────────
router.get('/messages/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const since = req.query.since || null; // ISO timestamp for polling

    let rows;
    if (since) {
      rows = await queryAll(
        `SELECT * FROM chat_messages WHERE session_id = $1 AND created_at > $2 ORDER BY created_at ASC`,
        [sessionId, since]
      );
    } else {
      rows = await queryAll(
        `SELECT * FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC`,
        [sessionId]
      );
    }

    res.json(rows);
  } catch (e) {
    console.error('[chat/messages]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/chat/send — send message (user side) ────────────────────────
router.post('/send', async (req, res) => {
  try {
    const { session_id, message } = req.body;
    if (!session_id || !message?.trim()) return res.status(400).json({ error: 'Missing fields' });

    // Check session still exists (admin may have deleted it)
    const session = await queryOne('SELECT id FROM chat_sessions WHERE id = $1', [session_id]);
    if (!session) {
      return res.status(404).json({ error: 'session_deleted' });
    }

    const msg = await queryOne(
      `INSERT INTO chat_messages (session_id, sender, message) VALUES ($1, 'user', $2) RETURNING *`,
      [session_id, message.trim().slice(0, 2000)]
    );

    // Update session last_message_at and unread count
    await query(
      `UPDATE chat_sessions SET last_message_at = NOW(), unread_admin = unread_admin + 1 WHERE id = $1`,
      [session_id]
    );

    res.json(msg);
  } catch (e) {
    console.error('[chat/send]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/chat/admin/sessions — list all sessions (admin) ──────────────
router.get('/admin/sessions', authMiddleware, async (req, res) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

    const sessions = await queryAll(`
      SELECT s.*,
        (SELECT message FROM chat_messages WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1) as last_message
      FROM chat_sessions s
      ORDER BY s.last_message_at DESC
      LIMIT 100
    `);

    res.json(sessions);
  } catch (e) {
    console.error('[chat/admin/sessions]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/chat/admin/reply — admin replies ───────────────────────────
router.post('/admin/reply', authMiddleware, async (req, res) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

    const { session_id, message } = req.body;
    if (!session_id || !message?.trim()) return res.status(400).json({ error: 'Missing fields' });

    const msg = await queryOne(
      `INSERT INTO chat_messages (session_id, sender, message) VALUES ($1, 'admin', $2) RETURNING *`,
      [session_id, message.trim().slice(0, 2000)]
    );

    await query(
      `UPDATE chat_sessions SET last_message_at = NOW(), unread_admin = 0 WHERE id = $1`,
      [session_id]
    );

    res.json(msg);
  } catch (e) {
    console.error('[chat/admin/reply]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PUT /api/chat/admin/sessions/:id/close ───────────────────────────────
router.put('/admin/sessions/:id/read', authMiddleware, async (req, res) => {
  const { query } = require('../pgdb');
  await query('UPDATE chat_sessions SET unread_admin = 0 WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

router.delete('/admin/sessions/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    await query('DELETE FROM chat_messages WHERE session_id = $1', [req.params.id]);
    await query('DELETE FROM chat_sessions WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
