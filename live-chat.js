// live-chat.js — Player chat widget v1
(function () {
  if (location.pathname.startsWith('/admin')) return;
    'use strict';

  const API = '/api/chat';
  let sessionId = null;
  let lastMsgTime = null;
  let pollTimer = null;
  let isOpen = false;
  const seenIds = new Set();

  function getToken() {
    try { return localStorage.getItem('auth_token') || ''; } catch { return ''; }
  }
  function authHeaders() {
    const t = getToken();
    return t ? { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t } : { 'Content-Type': 'application/json' };
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  const CSS = `
    #lc-btn {
      position:fixed; bottom:24px; right:24px; z-index:9000;
      width:56px; height:56px; border-radius:50%;
      background:linear-gradient(135deg,#f0c040,#e07b00);
      border:none; cursor:pointer; box-shadow:0 4px 20px rgba(240,192,64,.4);
      display:flex; align-items:center; justify-content:center;
      transition:transform .2s, box-shadow .2s;
    }
    #lc-btn:hover { transform:scale(1.1); box-shadow:0 6px 28px rgba(240,192,64,.5); }
    #lc-btn svg { width:26px; height:26px; fill:#0a0e1a; }
    #lc-badge {
      position:absolute; top:-3px; right:-3px;
      background:#ef4444; color:#fff; font-size:11px; font-weight:700;
      border-radius:50%; width:18px; height:18px;
      display:none; align-items:center; justify-content:center;
    }
    #lc-window {
      position:fixed; bottom:92px; right:24px; z-index:9001;
      width:340px; height:480px; max-height:calc(100vh - 120px);
      background:#0d1220; border:1px solid #252b45; border-radius:16px;
      display:none; flex-direction:column;
      box-shadow:0 8px 40px rgba(0,0,0,.6);
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    }
    #lc-window.open { display:flex; }
    #lc-header {
      padding:14px 16px; border-bottom:1px solid #252b45;
      display:flex; align-items:center; gap:10px; border-radius:16px 16px 0 0;
      background:linear-gradient(135deg,rgba(240,192,64,.08),transparent);
    }
    #lc-avatar {
      width:36px; height:36px; border-radius:50%;
      background:linear-gradient(135deg,#f0c040,#e07b00);
      display:flex; align-items:center; justify-content:center;
      font-size:18px; flex-shrink:0;
    }
    #lc-header-info { flex:1; }
    #lc-header-title { font-size:18px; font-weight:700; color:#fff; }
    #lc-header-status { font-size:11px; color:#22c55e; display:flex; align-items:center; gap:4px; margin-top:2px; }
    #lc-header-status::before { content:''; width:6px; height:6px; border-radius:50%; background:#22c55e; display:inline-block; }
    #lc-close {
      background:none; border:none; color:#666; cursor:pointer; font-size:20px;
      padding:0; line-height:1; transition:color .2s;
    }
    #lc-close:hover { color:#fff; }
    #lc-messages {
      flex:1; overflow-y:auto; padding:12px; display:flex;
      flex-direction:column; gap:8px; scroll-behavior:smooth;
    }
    #lc-messages::-webkit-scrollbar { width:4px; }
    #lc-messages::-webkit-scrollbar-track { background:transparent; }
    #lc-messages::-webkit-scrollbar-thumb { background:#252b45; border-radius:2px; }
    .lc-msg {
      max-width:80%; padding:10px 14px; border-radius:12px;
      font-size:15px; line-height:1.55; word-break:break-word;
    }
    .lc-msg.user {
      align-self:flex-end;
      background:linear-gradient(135deg,#f0c040,#d97706);
      color:#0a0e1a; font-weight:500; border-radius:12px 12px 2px 12px;
    }
    .lc-msg.admin {
      align-self:flex-start;
      background:#141829; border:1px solid #252b45; color:#e2e8f0;
      border-radius:12px 12px 12px 2px;
    }
    .lc-msg-time { font-size:11px; opacity:.55; margin-top:3px; }
    .lc-msg.user .lc-msg-time { text-align:right; }
    #lc-welcome {
      text-align:center; padding:20px 12px; color:#64748b; font-size:13px;
    }
    #lc-welcome strong { display:block; color:#94a3b8; font-size:18px; margin-bottom:6px; }
    #lc-name-form { padding:12px; border-top:1px solid #252b45; }
    #lc-name-form input {
      width:100%; padding:9px 12px; border-radius:8px;
      background:#141829; border:1px solid #252b45; color:#fff;
      font-size:16px; outline:none; box-sizing:border-box; margin-bottom:8px;
    }
    #lc-name-form input:focus { border-color:#f0c040; }
    #lc-name-form button {
      width:100%; padding:9px; border-radius:8px;
      background:linear-gradient(135deg,#f0c040,#d97706);
      border:none; color:#0a0e1a; font-weight:700; font-size:13px;
      cursor:pointer; transition:opacity .2s;
    }
    #lc-name-form button:hover { opacity:.9; }
    #lc-input-area {
      padding:10px 12px; border-top:1px solid #252b45;
      display:none; gap:8px; align-items:flex-end;
    }
    #lc-input-area.active { display:flex; }
    #lc-input {
      flex:1; padding:9px 12px; border-radius:10px;
      background:#141829; border:1px solid #252b45; color:#fff;
      font-size:13px; outline:none; resize:none; max-height:100px;
      font-family:inherit; line-height:1.4;
    }
    #lc-input:focus { border-color:#f0c040; }
    #lc-send {
      width:36px; height:36px; border-radius:50%;
      background:linear-gradient(135deg,#f0c040,#d97706);
      border:none; cursor:pointer; display:flex; align-items:center; justify-content:center;
      flex-shrink:0; transition:opacity .2s;
    }
    #lc-send:hover { opacity:.9; }
    #lc-send svg { width:16px; height:16px; fill:#0a0e1a; }
    @media(max-width:400px) {
      #lc-window { width:calc(100vw - 20px); right:10px; bottom:80px; }
      #lc-btn { bottom:16px; right:16px; }
    }
  `;

  function injectStyles() {
    if (document.getElementById('lc-styles')) return;
    const s = document.createElement('style');
    s.id = 'lc-styles';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function formatTime(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function addMessage(msg) {
    if (seenIds.has(msg.id)) return;
    seenIds.add(msg.id);
    const el = document.createElement('div');
    el.className = 'lc-msg ' + msg.sender;
    el.innerHTML = `<div>${escHtml(msg.message)}</div><div class="lc-msg-time">${formatTime(msg.created_at)}</div>`;
    const msgs = document.getElementById('lc-messages');
    if (msgs) {
      const welcome = msgs.querySelector('#lc-welcome');
      if (welcome) welcome.remove();
      msgs.appendChild(el);
      msgs.scrollTop = msgs.scrollHeight;
    }
    if (msg.created_at > (lastMsgTime || '')) lastMsgTime = msg.created_at;
  }

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
  }

  // ── Build widget ──────────────────────────────────────────────────────────
  function buildWidget() {
    // Button
    const btn = document.createElement('button');
    btn.id = 'lc-btn';
    btn.title = 'Live Support';
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/>
      </svg>
      <span id="lc-badge"></span>
    `;
    btn.addEventListener('click', toggleChat);

    // Window
    const win = document.createElement('div');
    win.id = 'lc-window';
    win.innerHTML = `
      <div id="lc-header">
        <div id="lc-avatar">💬</div>
        <div id="lc-header-info">
          <div id="lc-header-title">Live Support</div>
          <div id="lc-header-status">Online</div>
        </div>
        <button id="lc-close" title="Close">×</button>
      </div>
      <div id="lc-messages">
        <div id="lc-welcome">
          <strong>Welcome to Cryptora Support!</strong>
          Ask us anything — we're here to help 24/7.
        </div>
      </div>
      <div id="lc-name-form">
        <input id="lc-name-input" type="text" placeholder="Your name (optional)" maxlength="50"/>
        <button id="lc-start-btn">Start Chat →</button>
      </div>
      <div id="lc-input-area">
        <textarea id="lc-input" placeholder="Type a message…" rows="1" maxlength="2000"></textarea>
        <button id="lc-send" title="Send">
          <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>
    `;

    document.body.appendChild(btn);
    document.body.appendChild(win);

    document.getElementById('lc-close').addEventListener('click', () => toggleChat(false));
    document.getElementById('lc-start-btn').addEventListener('click', startChat);
    document.getElementById('lc-name-input').addEventListener('keydown', e => { if (e.key === 'Enter') startChat(); });
    document.getElementById('lc-send').addEventListener('click', sendMessage);
    document.getElementById('lc-input').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });

    // If already logged in, skip name form
    const token = getToken();
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.id) {
          document.getElementById('lc-name-form').style.display = 'none';
          initSession();
        }
      } catch {}
    }
  }

  function toggleChat(forceState) {
    isOpen = typeof forceState === 'boolean' ? forceState : !isOpen;
    const win = document.getElementById('lc-window');
    if (isOpen) {
      win.classList.add('open');
      clearBadge();
    } else {
      win.classList.remove('open');
    }
  }

  function clearBadge() {
    const b = document.getElementById('lc-badge');
    if (b) b.style.display = 'none';
  }
  function showBadge(n) {
    const b = document.getElementById('lc-badge');
    if (b) { b.textContent = n > 9 ? '9+' : n; b.style.display = 'flex'; }
  }

  async function startChat() {
    const name = document.getElementById('lc-name-input')?.value.trim() || 'Guest';
    document.getElementById('lc-start-btn').textContent = 'Connecting…';
    document.getElementById('lc-start-btn').disabled = true;
    await initSession(name);
    document.getElementById('lc-name-form').style.display = 'none';
    document.getElementById('lc-input-area').classList.add('active');
    document.getElementById('lc-input').focus();
  }

  async function initSession(name) {
    try {
      const r = await fetch(API + '/session', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name })
      });
      const data = await r.json();
      sessionId = data.id;
      document.getElementById('lc-input-area').classList.add('active');

      // Load existing messages
      const msgs = await fetch(API + '/messages/' + sessionId).then(r => r.json());
      msgs.forEach(addMessage);
      if (!msgs.length) lastMsgTime = null;

      startPolling();
    } catch (e) {
      console.error('[lc] session error', e);
    }
  }

  async function sendMessage() {
    if (!sessionId) return;
    const inp = document.getElementById('lc-input');
    const text = inp.value.trim();
    if (!text) return;
    inp.value = '';
    inp.style.height = '';

    try {
      const r = await fetch(API + '/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, message: text })
      });
      if (r.status === 404) {
        const err = await r.json();
        if (err.error === 'session_deleted') {
          showChatDeleted();
          return;
        }
      }
      const msg = await r.json();
      addMessage(msg);
    } catch (e) { console.error('[lc] send error', e); }
  }

  function showChatDeleted() {
    sessionId = null;
    clearInterval(pollTimer);
    // Show system message
    const wrap = document.getElementById('lc-messages');
    if (wrap) {
      const sys = document.createElement('div');
      sys.style.cssText = 'text-align:center;padding:16px 12px;color:#94a3b8;font-size:13px;';
      sys.innerHTML = '⚠️ <b>This chat has been closed by the administrator.</b><br><br>' +
        '<button id="lc-new-chat-btn" style="padding:10px 20px;background:linear-gradient(135deg,#f0c040,#d97706);border:none;border-radius:8px;color:#0a0e1a;font-weight:700;font-size:14px;cursor:pointer;">💬 Start new chat</button>';
      wrap.appendChild(sys);
      wrap.scrollTop = wrap.scrollHeight;
    }
    // Hide reply bar
    const bar = document.getElementById('lc-input-bar') || document.querySelector('#lc-widget .lc-input-wrap');
    if (bar) bar.style.display = 'none';

    document.getElementById('lc-new-chat-btn')?.addEventListener('click', createNewChat);
  }

  async function createNewChat() {
    try {
      const storedName = localStorage.getItem('lc_name') || '';
      const storedEmail = localStorage.getItem('lc_email') || '';
      const r = await fetch(API + '/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(getAuthHeader()) },
        body: JSON.stringify({ name: storedName, email: storedEmail })
      });
      const session = await r.json();
      sessionId = session.id;
      // Reset chat UI
      const wrap = document.getElementById('lc-messages');
      if (wrap) wrap.innerHTML = '';
      const bar = document.getElementById('lc-input-bar') || document.querySelector('#lc-widget .lc-input-wrap');
      if (bar) bar.style.display = '';
      startPolling();
    } catch (e) { console.error('[lc] new chat error', e); }
  }

  function getAuthHeader() {
    try {
      const t = localStorage.getItem('auth_token');
      return t ? { 'Authorization': 'Bearer ' + t } : {};
    } catch { return {}; }
  }

  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      if (!sessionId) return;
      try {
        const since = lastMsgTime || '';
        const url = API + '/messages/' + sessionId + (since ? '?since=' + encodeURIComponent(since) : '');
        const msgs = await fetch(url).then(r => r.json());
        if (!Array.isArray(msgs)) return;
        msgs.forEach(m => {
          addMessage(m);
          if (!isOpen && m.sender === 'admin') showBadge(1);
        });
      } catch {}
    }, 3000);
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    injectStyles();
    buildWidget();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
