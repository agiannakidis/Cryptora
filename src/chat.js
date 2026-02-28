const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const db = require('./db');
const { JWT_SECRET } = require('./middleware/auth');

const MAX_MSG_LEN = 300;
const MAX_HISTORY = 100;

// Ensure chat_messages table exists
db.exec(`
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    username TEXT NOT NULL,
    role TEXT DEFAULT 'player',
    message TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

function getHistory(limit = 50) {
  return db.prepare(
    `SELECT id, username, role, message, created_at FROM chat_messages ORDER BY id DESC LIMIT ?`
  ).all(limit).reverse();
}

function saveMessage(userId, username, role, message) {
  db.prepare(
    `INSERT INTO chat_messages (user_id, username, role, message) VALUES (?, ?, ?, ?)`
  ).run(userId, username, role, message);
  // Keep last 1000 messages
  db.prepare(`DELETE FROM chat_messages WHERE id NOT IN (SELECT id FROM chat_messages ORDER BY id DESC LIMIT 1000)`).run();
  return db.prepare(`SELECT id, username, role, message, created_at FROM chat_messages ORDER BY id DESC LIMIT 1`).get();
}

function getUserFromToken(token) {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(decoded.id);
    return user || null;
  } catch {
    return null;
  }
}

function broadcast(wss, data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

function createChatServer(server) {
  const wss = new WebSocketServer({ server, path: '/ws/chat' });

  // Online count broadcast
  const broadcastOnline = () => {
    broadcast(wss, { type: 'online', count: wss.clients.size });
  };

  wss.on('connection', (ws, req) => {
    ws.user = null;
    broadcastOnline();

    // Send history
    const history = getHistory(50);
    ws.send(JSON.stringify({ type: 'history', messages: history }));
    ws.send(JSON.stringify({ type: 'online', count: wss.clients.size }));

    ws.on('message', (raw) => {
      let data;
      try { data = JSON.parse(raw); } catch { return; }

      // Auth
      if (data.type === 'auth') {
        ws.user = getUserFromToken(data.token);
        ws.send(JSON.stringify({ type: 'auth', ok: !!ws.user, user: ws.user ? { name: ws.user.name || ws.user.email, role: ws.user.role } : null }));
        return;
      }

      // Message
      if (data.type === 'message') {
        if (!ws.user) {
          ws.send(JSON.stringify({ type: 'error', message: 'Login to chat' }));
          return;
        }
        const text = (data.text || '').trim().slice(0, MAX_MSG_LEN);
        if (!text) return;

        // Spam protection — 1 msg per second
        const now = Date.now();
        if (ws._lastMsg && now - ws._lastMsg < 1000) return;
        ws._lastMsg = now;

        const username = ws.user.name || ws.user.email.split('@')[0];
        const saved = saveMessage(ws.user.id, username, ws.user.role, text);
        broadcast(wss, { type: 'message', msg: saved });
      }
    });

    ws.on('close', () => {
      broadcastOnline();
    });

    ws.on('error', () => {});
  });

  console.log('💬 Chat WebSocket server ready at /ws/chat');
  return wss;
}

module.exports = { createChatServer };
