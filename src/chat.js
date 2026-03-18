// /root/casino-backend/src/chat.js — migrated to PostgreSQL
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const { pool, queryOne } = require('./pgdb');
const { JWT_SECRET } = require('./middleware/auth');

const MAX_MSG_LEN = 300;
const MAX_HISTORY = 100;

async function getHistory(limit = 50) {
  const res = await pool.query(
    `SELECT id, username, role, message, created_at FROM community_messages ORDER BY id DESC LIMIT $1`,
    [limit]
  );
  return res.rows.reverse();
}

async function saveMessage(userId, username, role, message) {
  const res = await pool.query(
    `INSERT INTO community_messages (user_id, username, role, message) VALUES ($1,$2,$3,$4) RETURNING id, username, role, message, created_at`,
    [userId, username, role, message]
  );
  // Keep last 1000 messages
  pool.query(`DELETE FROM community_messages WHERE id NOT IN (SELECT id FROM community_messages ORDER BY id DESC LIMIT 1000)`).catch(()=>{});
  return res.rows[0];
}

async function getUserFromToken(token) {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await queryOne('SELECT id, name, email, role FROM users WHERE id=$1', [decoded.id]);
    return user || null;
  } catch { return null; }
}

function broadcast(wss, data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

function createChatServer(server) {
  const wss = new WebSocketServer({ server, path: '/ws/chat' });

  const broadcastOnline = () => {
    broadcast(wss, { type: 'online', count: wss.clients.size });
  };

  wss.on('connection', async (ws, req) => {
    ws.user = null;
    broadcastOnline();

    try {
      const history = await getHistory(50);
      ws.send(JSON.stringify({ type: 'history', messages: history }));
      ws.send(JSON.stringify({ type: 'online', count: wss.clients.size }));
    } catch(e) {
      ws.send(JSON.stringify({ type: 'history', messages: [] }));
    }

    ws.on('message', async (raw) => {
      let data;
      try { data = JSON.parse(raw); } catch { return; }

      if (data.type === 'auth') {
        ws.user = await getUserFromToken(data.token);
        ws.send(JSON.stringify({ type: 'auth', ok: !!ws.user, user: ws.user ? { name: ws.user.name || ws.user.email, role: ws.user.role } : null }));
        return;
      }

      if (data.type === 'message') {
        if (!ws.user) {
          ws.send(JSON.stringify({ type: 'error', message: 'Login to chat' }));
          return;
        }
        const text = (data.text || '').trim().slice(0, MAX_MSG_LEN);
        if (!text) return;

        const now = Date.now();
        if (ws._lastMsg && now - ws._lastMsg < 1000) return;
        ws._lastMsg = now;

        const username = ws.user.name || ws.user.email.split('@')[0];
        try {
          const saved = await saveMessage(ws.user.id, username, ws.user.role, text);
          broadcast(wss, { type: 'message', msg: saved });
        } catch(e) {
          console.error('[chat saveMessage]', e.message);
        }
      }
    });

    ws.on('close', () => { broadcastOnline(); });
    ws.on('error', () => {});
  });

  console.log('💬 Chat WebSocket server ready at /ws/chat');
  return wss;
}

module.exports = { createChatServer };
