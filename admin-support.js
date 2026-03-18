// admin-support.js — Admin live chat support panel v2
(function () {
  'use strict';

  const API = '/api/chat';
  let sessions = [];
  let activeSessionId = null;
  let lastMsgTime = null;
  let pollTimer = null;
  let sessionPollTimer = null;
  const seenMsgIds = new Set();
  const localReadSessions = new Set(); // sessions admin has opened/read locally

  function getToken() {
    try { return localStorage.getItem('auth_token') || ''; } catch { return ''; }
  }

  function findSupportNavBtn() {
    return Array.from(document.querySelectorAll('aside nav button, aside button, nav button'))
      .find(b => {
        const t = b.textContent.replace(/[\d+]/g, '').trim();
        return t === 'Support' || t === '💬 Support' || t === 'Support ›' || t === 'Support›';
      });
  }
  function authHeaders() {
    const t = getToken();
    return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t };
  }
  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
  }
  function timeAgo(iso) {
    const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (diff < 60) return diff + 's ago';
    if (diff < 3600) return Math.floor(diff/60) + 'm ago';
    if (diff < 86400) return Math.floor(diff/3600) + 'h ago';
    return Math.floor(diff/86400) + 'd ago';
  }
  function formatTime(iso) {
    return new Date(iso).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  }

  const CSS = `
    #as-wrap { display:flex; flex-direction:column; height:calc(100vh - 120px); min-height:500px; gap:0; }
    #as-panel {
      display:flex; flex:1; min-height:0;
      background:#080c18; border-radius:16px; border:1px solid #1e2440;
      overflow:hidden; font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;
    }
    #as-sidebar {
      width:280px; flex-shrink:0; border-right:1px solid #1e2440;
      display:flex; flex-direction:column; background:#0d1220;
    }
    #as-sidebar-header {
      padding:14px 16px; border-bottom:1px solid #1e2440;
      display:flex; align-items:center; justify-content:space-between;
    }
    #as-sidebar-title { font-size:18px; font-weight:700; color:#fff; }
    #as-count {
      background:#f0c040; color:#0a0e1a; font-size:11px; font-weight:700;
      border-radius:10px; padding:2px 7px;
    }
    #as-session-list { flex:1; overflow-y:auto; }
    #as-session-list::-webkit-scrollbar { width:4px; }
    #as-session-list::-webkit-scrollbar-thumb { background:#252b45; border-radius:2px; }
    .as-item {
      padding:11px 14px; border-bottom:1px solid #141829; cursor:pointer;
      transition:background .15s; position:relative;
    }
    .as-item:hover { background:#141829; }
    .as-item.active { background:#141829; border-left:3px solid #f0c040; padding-left:11px; }
    .as-item-name { font-size:16px; font-weight:700; color:#e2e8f0; display:flex; align-items:center; gap:5px; }
    .as-dot { width:7px; height:7px; border-radius:50%; flex-shrink:0; }
    .as-dot.open { background:#22c55e; }
    .as-item-preview { font-size:14px; color:#64748b; margin-top:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .as-item-time { font-size:13px; color:#334155; margin-top:2px; }
    .as-unread {
      position:absolute; top:11px; right:12px;
      background:#ef4444; color:#fff; font-size:10px; font-weight:700;
      border-radius:50%; width:16px; height:16px;
      display:flex; align-items:center; justify-content:center;
    }
    #as-empty { padding:28px; text-align:center; color:#475569; font-size:13px; }
    #as-main { flex:1; display:flex; flex-direction:column; min-width:0; }
    #as-chat-header {
      padding:13px 18px; border-bottom:1px solid #1e2440;
      display:flex; align-items:center; justify-content:space-between;
      background:#0d1220;
    }
    #as-chat-title { font-size:20px; font-weight:700; color:#fff; }
    #as-chat-meta { font-size:11px; color:#64748b; margin-top:2px; }
    #as-delete-btn {
      padding:5px 12px; border-radius:8px;
      background:transparent; border:1px solid #334155; color:#94a3b8;
      font-size:11px; cursor:pointer; transition:all .2s;
    }
    #as-delete-btn:hover { border-color:#ef4444; background:#ef4444; color:#fff; }
    #as-messages { flex:1; overflow-y:auto; padding:14px; display:flex; flex-direction:column; gap:8px; }
    #as-messages::-webkit-scrollbar { width:4px; }
    #as-messages::-webkit-scrollbar-thumb { background:#252b45; border-radius:2px; }
    .as-msg { max-width:78%; padding:12px 16px; border-radius:14px; font-size:15px; line-height:1.55; word-break:break-word; }
    .as-msg.user { align-self:flex-start; background:#141829; border:1px solid #252b45; color:#e2e8f0; border-radius:12px 12px 12px 2px; }
    .as-msg.admin { align-self:flex-end; background:linear-gradient(135deg,rgba(240,192,64,.12),rgba(217,119,6,.08)); border:1px solid rgba(240,192,64,.2); color:#fde68a; border-radius:12px 12px 2px 12px; }
    .as-msg-meta { font-size:12px; opacity:.55; margin-top:4px; }
    .as-msg.admin .as-msg-meta { text-align:right; }
    #as-placeholder { flex:1; display:flex; align-items:center; justify-content:center; color:#334155; font-size:15px; flex-direction:column; gap:10px; }
    #as-placeholder-icon { font-size:40px; }
    #as-reply-area {
      padding:10px 14px; border-top:1px solid #1e2440;
      display:none; gap:8px; align-items:flex-end; background:#0d1220;
    }
    #as-reply-area.active { display:flex; }
    #as-reply-input {
      flex:1; padding:9px 13px; border-radius:10px;
      background:#141829; border:1px solid #252b45; color:#fff;
      font-size:13px; outline:none; resize:none; max-height:100px;
      font-family:inherit; line-height:1.4;
    }
    #as-reply-input:focus { border-color:#f0c040; }
    #as-reply-btn {
      padding:9px 18px; border-radius:10px;
      background:linear-gradient(135deg,#f0c040,#d97706);
      border:none; color:#0a0e1a; font-weight:700; font-size:13px;
      cursor:pointer; flex-shrink:0; transition:opacity .2s;
    }
    #as-reply-btn:hover { opacity:.9; }
    #as-reply-btn:disabled { opacity:.5; }
  `;

  function injectStyles() {
    if (document.getElementById('as-styles')) return;
    const s = document.createElement('style');
    s.id = 'as-styles';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function renderPanel(main) {
    injectStyles();
    // Overlay approach — never touch React DOM
    document.getElementById('as-body-overlay')?.remove();
    const rect = main.getBoundingClientRect();
    const overlay = document.createElement('div');
    overlay.id = 'as-body-overlay';
    overlay.style.cssText = 'position:fixed;top:' + Math.round(rect.top) + 'px;left:' + Math.round(rect.left) + 'px;right:0;bottom:0;background:#080c18;z-index:50;overflow:auto;box-sizing:border-box;';
    document.body.appendChild(overlay);
    overlay.innerHTML = `
      <div id="as-wrap">
        <div id="as-panel">
          <div id="as-sidebar">
            <div id="as-sidebar-header">
              <span id="as-sidebar-title">💬 Live Support</span>
              <span id="as-count">0</span>
            </div>
            <div id="as-session-list"><div id="as-empty">Loading…</div></div>
          </div>
          <div id="as-main">
            <div id="as-placeholder">
              <div id="as-placeholder-icon">💬</div>
              <span>Select a conversation</span>
            </div>
          </div>
        </div>
      </div>
    `;
    loadSessionList();
    clearInterval(sessionPollTimer);
    sessionPollTimer = setInterval(loadSessionList, 5000);
  }

  function renderSessions(list) {
    const el = document.getElementById('as-session-list');
    if (!el) return;
    document.getElementById('as-count').textContent = list.length;
    if (!list.length) {
      el.innerHTML = '<div id="as-empty">No conversations yet</div>';
      return;
    }
    el.innerHTML = list.map(s => `
      <div class="as-item${s.id === activeSessionId ? ' active' : ''}" data-id="${s.id}">
        <div class="as-item-name"><span class="as-dot ${s.status}"></span>${escHtml(s.user_name || 'Guest')}</div>
        ${s.unread_admin > 0 ? `<span class="as-unread">${s.unread_admin > 9 ? '9+' : s.unread_admin}</span>` : ''}
        <div class="as-item-preview">${s.last_message ? escHtml(s.last_message.slice(0,50)) : '—'}</div>
        <div class="as-item-time">${timeAgo(s.last_message_at)}</div>
      </div>
    `).join('');
    el.querySelectorAll('.as-item').forEach(item => {
      item.addEventListener('click', () => openSession(item.dataset.id));
    });
  }

  async function openSession(id) {
    activeSessionId = id;
    lastMsgTime = null;
    clearInterval(pollTimer);

    const s = sessions.find(x => x.id === id);
    const main = document.getElementById('as-main');
    if (!main) return;

    main.innerHTML = `
      <div id="as-chat-header">
        <div>
          <div id="as-chat-title">${escHtml(s?.user_name || 'Guest')}${s?.user_email ? ' <span style="font-size:11px;font-weight:400;color:#64748b">— ' + escHtml(s.user_email) + '</span>' : ''}</div>
          <div id="as-chat-meta">Started ${timeAgo(s?.created_at || '')} · ${s?.status}</div>
        </div>
        <button id="as-delete-btn" title="Permanently delete this chat">🗑 Delete</button>
      </div>
      <div id="as-messages"></div>
      ${s?.status === 'open' ? `
        <div id="as-reply-area active" style="display:flex;padding:10px 14px;border-top:1px solid #1e2440;gap:8px;align-items:flex-end;background:#0d1220;">
          <textarea id="as-reply-input" placeholder="Type your reply… (Enter to send)" rows="1" maxlength="2000" style="flex:1;padding:9px 13px;border-radius:10px;background:#141829;border:1px solid #252b45;color:#fff;font-size:15px;outline:none;resize:none;max-height:120px;font-family:inherit;line-height:1.6;"></textarea>
          <button id="as-reply-btn" style="padding:9px 18px;border-radius:10px;background:linear-gradient(135deg,#f0c040,#d97706);border:none;color:#0a0e1a;font-weight:700;font-size:13px;cursor:pointer;">Send</button>
        </div>` : ''}
    `;

    document.getElementById('as-delete-btn')?.addEventListener('click', deleteSession);
    document.getElementById('as-reply-btn')?.addEventListener('click', sendReply);
    document.getElementById('as-reply-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); }
    });

    renderSessions(sessions);
    await loadMessages(id, false);
    pollTimer = setInterval(() => loadMessages(id, true), 3000);
  }

  async function loadMessages(id, pollMode) {
    try {
      const since = pollMode && lastMsgTime ? '?since=' + encodeURIComponent(lastMsgTime) : '';
      const msgs = await fetch(`${API}/messages/${id}${since}`, { headers: authHeaders() }).then(r => r.json());
      if (!Array.isArray(msgs) || !msgs.length) {
        // Even if no new messages, clear unread if panel is visible
        const container = document.getElementById('as-messages');
        if (container) {
          // Always mark read when panel is open
        localReadSessions.add(id);
        const s0 = sessions.find(x => x.id === id);
        if (s0) s0.unread_admin = 0;
        fetch(`${API}/admin/sessions/${id}/read`, { method:'PUT', headers: authHeaders() }).catch(()=>{});
        renderSessions(sessions);
        updateSidebarBadge();
        }
        return;
      }

      const container = document.getElementById('as-messages');
      if (!container) {
        // Panel not visible — just track time
        msgs.forEach(m => { if (m.created_at > (lastMsgTime||'')) lastMsgTime = m.created_at; });
        return;
      }

      const s = sessions.find(x => x.id === id);
      msgs.forEach(msg => {
        if (seenMsgIds.has(msg.id)) return;
        seenMsgIds.add(msg.id);
        // If it's a user message coming in while panel is NOT active, re-enable badge
        if (msg.sender !== 'admin' && msg.session_id !== activeSessionId) {
          localReadSessions.delete(msg.session_id || id);
        }
        const el = document.createElement('div');
        el.className = 'as-msg ' + msg.sender;
        const who = msg.sender === 'admin' ? 'You (Support)' : (s?.user_name || 'User');
        el.innerHTML = `<div>${escHtml(msg.message)}</div><div class="as-msg-meta">${escHtml(who)} · ${formatTime(msg.created_at)}</div>`;
        container.appendChild(el);
        if (msg.created_at > (lastMsgTime||'')) lastMsgTime = msg.created_at;
      });
      container.scrollTop = container.scrollHeight;

      // Always mark read when panel is open
      localReadSessions.add(id);
      const s2 = sessions.find(x => x.id === id);
      if (s2) s2.unread_admin = 0;
      fetch(`${API}/admin/sessions/${id}/read`, { method:'PUT', headers: authHeaders() }).catch(()=>{});
      renderSessions(sessions);
      updateSidebarBadge();
    } catch {}
  }

  async function sendReply() {
    if (!activeSessionId) return;
    const inp = document.getElementById('as-reply-input');
    const text = inp?.value.trim();
    if (!text) return;
    inp.value = '';
    const btn = document.getElementById('as-reply-btn');
    if (btn) btn.disabled = true;

    try {
      const r = await fetch(API + '/admin/reply', {
        method:'POST', headers: authHeaders(),
        body: JSON.stringify({ session_id: activeSessionId, message: text })
      });
      const msg = await r.json();
      const container = document.getElementById('as-messages');
      if (container) {
        const el = document.createElement('div');
        el.className = 'as-msg admin';
        el.innerHTML = `<div>${escHtml(msg.message)}</div><div class="as-msg-meta">You (Support) · ${formatTime(msg.created_at)}</div>`;
        container.appendChild(el);
        container.scrollTop = container.scrollHeight;
        if (msg.created_at > (lastMsgTime||'')) lastMsgTime = msg.created_at;
      }
    } catch (e) { console.error('[as] reply', e); }
    if (btn) btn.disabled = false;
  }

  async function deleteSession() {
    if (!activeSessionId) return;
    if (!confirm('Delete this chat permanently?')) return;
    await fetch(`${API}/admin/sessions/${activeSessionId}`, {
      method: 'DELETE', headers: authHeaders()
    }).catch(() => {});
    localReadSessions.delete(activeSessionId);
    sessions = sessions.filter(s => s.id !== activeSessionId);
    activeSessionId = null;
    lastMsgTime = null;
    clearInterval(pollTimer);
    pollTimer = null;
    renderSessions(sessions);
    updateSidebarBadge();
    // Reset main area to placeholder (do NOT call renderPanel — it destroys the overlay)
    const main = document.getElementById('as-main');
    if (main) {
      main.innerHTML = `
        <div id="as-placeholder">
          <div id="as-placeholder-icon">💬</div>
          <span>Select a conversation</span>
        </div>`;
    }
  }

  function updateSidebarBadge() {
    const total = sessions.reduce((s, x) => s + (x.unread_admin || 0), 0);

    // 1. Sidebar nav badge
    const btn = findSupportNavBtn();
    if (btn) {
      let badge = btn.querySelector('.as-nav-badge');
      if (total > 0) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'as-nav-badge';
          badge.style.cssText = 'display:inline-block;background:#ef4444;color:#fff;font-size:10px;font-weight:800;border-radius:10px;padding:1px 6px;margin-left:6px;vertical-align:middle;min-width:18px;text-align:center;';
          btn.appendChild(badge);
        }
        badge.textContent = total > 99 ? '99+' : total;
      } else if (badge) {
        badge.remove();
      }
    }

    // 2. Floating notification button (always visible anywhere in admin)
    let floatBtn = document.getElementById('as-float-btn');
    if (total > 0) {
      if (!floatBtn) {
        floatBtn = document.createElement('div');
        floatBtn.id = 'as-float-btn';
        floatBtn.innerHTML = `
          <style>
            #as-float-btn {
              position:fixed; bottom:24px; right:24px; z-index:9999;
              cursor:pointer; user-select:none;
            }
            #as-float-inner {
              background:linear-gradient(135deg,#f0c040,#d97706);
              border-radius:50px; padding:12px 20px;
              display:flex; align-items:center; gap:10px;
              box-shadow:0 4px 24px rgba(240,192,64,0.4), 0 2px 8px rgba(0,0,0,0.4);
              transition:transform .15s, box-shadow .15s;
              animation:as-pulse 2s ease-in-out infinite;
            }
            #as-float-inner:hover {
              transform:scale(1.05);
              box-shadow:0 6px 32px rgba(240,192,64,0.6), 0 2px 12px rgba(0,0,0,0.5);
            }
            @keyframes as-pulse {
              0%,100%{box-shadow:0 4px 24px rgba(240,192,64,0.4),0 2px 8px rgba(0,0,0,0.4);}
              50%{box-shadow:0 4px 32px rgba(240,192,64,0.8),0 2px 12px rgba(0,0,0,0.5);}
            }
            #as-float-icon { font-size:20px; line-height:1; }
            #as-float-text { font-size:13px; font-weight:800; color:#0a0e1a; line-height:1.2; }
            #as-float-count { font-size:11px; color:#78350f; font-weight:700; }
          </style>
          <div id="as-float-inner">
            <div id="as-float-icon">💬</div>
            <div id="as-float-text">
              New messages
              <div id="as-float-count"></div>
            </div>
          </div>
        `;
        document.body.appendChild(floatBtn);
        floatBtn.addEventListener('click', () => {
          // Click the Support nav button to open panel
          const supportBtn = findSupportNavBtn();
          if (supportBtn) supportBtn.click();
        });
      }
      const countEl = floatBtn.querySelector('#as-float-count');
      if (countEl) {
        countEl.textContent = total === 1 ? '1 unread' : total + ' unread';
      }
    } else if (floatBtn) {
      floatBtn.remove();
    }
  }

  async function loadSessionList() {
    try {
      const data = await fetch(API + '/admin/sessions', { headers: authHeaders() }).then(r => r.json());
      if (!Array.isArray(data)) return;
      sessions = data;
      // Override: keep unread=0 for sessions admin has read UNLESS new messages arrived
      sessions.forEach(s => {
        if (localReadSessions.has(s.id)) {
          // If status changed back to open and there are new unread — show notification
          if (s.status === 'open' && s.unread_admin > 0) {
            // New message in previously-read session — re-notify
            localReadSessions.delete(s.id);
          } else {
            s.unread_admin = 0;
          }
        }
      });
      if (document.getElementById('as-session-list')) renderSessions(sessions);
      updateSidebarBadge();
    } catch {}
  }

  // ── Background poll for badge (even when panel closed) ─────────────────────
  setInterval(async () => {
    try {
      const data = await fetch(API + '/admin/sessions', { headers: authHeaders() }).then(r => r.json());
      if (!Array.isArray(data)) return;
      sessions = data;
      sessions.forEach(s => {
        if (localReadSessions.has(s.id)) {
          if (s.status === 'open' && s.unread_admin > 0) {
            localReadSessions.delete(s.id); // new message — re-notify
          } else {
            s.unread_admin = 0;
          }
        }
      });
      updateSidebarBadge();
    } catch {}
  }, 5000); // every 5s

  // ── Event delegation — survives React re-renders ─────────────────────────
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const supportNavBtn = findSupportNavBtn();
    if (!btn || btn !== supportNavBtn) return;
    const nav = document.querySelector('aside nav, aside');
    if (!nav || !nav.contains(btn)) return;

    // Admin Support nav button clicked
    document.getElementById('age-body-overlay')?.remove(); // close Games overlay if open
    setTimeout(() => {
      const main = document.querySelector('[class*="ml-60"] main') ||
                   document.querySelector('main.flex-1') ||
                   document.querySelector('main');
      if (main) renderPanel(main);
    }, 80);
  }, true); // capture phase — before React
})();
