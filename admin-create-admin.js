// admin-create-admin.js — Manage admin accounts from /admin sidebar
(function() {
  if (!window.location.pathname.startsWith('/admin')) return;

  function getToken() {
    try { return localStorage.getItem('auth_token') || localStorage.getItem('casino_token') || ''; } catch(e) { return ''; }
  }

  let _openModal = null;

  function buildModal() {
    if (document.getElementById('ca-modal')) return _openModal && _openModal();

    const modal = document.createElement('div');
    modal.id = 'ca-modal';
    modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.75);align-items:center;justify-content:center;';
    modal.innerHTML = `
      <div style="background:#1a1f2e;border-radius:12px;padding:28px;width:560px;max-width:95vw;color:#fff;box-shadow:0 8px 32px rgba(0,0,0,0.6);border:1px solid #2d3448;max-height:90vh;overflow-y:auto;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
          <h2 style="margin:0;font-size:18px;font-weight:700">👤 Admin Accounts</h2>
          <button id="ca-close" style="background:none;border:none;color:#9ca3af;font-size:22px;cursor:pointer">×</button>
        </div>

        <!-- Admin list -->
        <div id="ca-list" style="margin-bottom:20px;background:#0d1117;border-radius:8px;overflow:hidden">
          <div style="padding:10px 14px;font-size:12px;color:#6b7280;font-weight:600;border-bottom:1px solid #1e2433">CURRENT ADMINS</div>
          <div id="ca-list-body" style="padding:8px 0">Loading...</div>
        </div>

        <!-- Create form -->
        <div style="border-top:1px solid #2d3448;padding-top:16px">
          <div style="font-size:13px;font-weight:600;color:#9ca3af;margin-bottom:12px">CREATE NEW ADMIN</div>
          <div style="display:grid;gap:10px">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <div>
                <label style="display:block;font-size:11px;color:#6b7280;margin-bottom:3px">Email</label>
                <input id="ca-email" type="email" placeholder="admin@example.com"
                  style="width:100%;padding:9px 11px;background:#0d1117;border:1px solid #2d3448;border-radius:6px;color:#fff;font-size:13px;box-sizing:border-box"/>
              </div>
              <div>
                <label style="display:block;font-size:11px;color:#6b7280;margin-bottom:3px">Name (optional)</label>
                <input id="ca-username" type="text" placeholder="John"
                  style="width:100%;padding:9px 11px;background:#0d1117;border:1px solid #2d3448;border-radius:6px;color:#fff;font-size:13px;box-sizing:border-box"/>
              </div>
            </div>
            <div>
              <label style="display:block;font-size:11px;color:#6b7280;margin-bottom:3px">Password (min 6)</label>
              <input id="ca-password" type="password" placeholder="••••••••"
                style="width:100%;padding:9px 11px;background:#0d1117;border:1px solid #2d3448;border-radius:6px;color:#fff;font-size:13px;box-sizing:border-box"/>
            </div>
          </div>
          <div id="ca-msg" style="min-height:18px;margin-top:10px;font-size:13px;text-align:center"></div>
          <div style="display:flex;gap:10px;margin-top:12px">
            <button id="ca-submit" style="flex:1;padding:10px;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;border:none;border-radius:8px;font-weight:600;font-size:13px;cursor:pointer">
              + Create Admin
            </button>
            <button id="ca-cancel" style="padding:10px 16px;background:#2d3448;color:#fff;border:none;border-radius:8px;cursor:pointer">Close</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    async function loadAdmins() {
      const listBody = document.getElementById('ca-list-body');
      try {
        const r = await fetch('/api/auth/admin/list-admins', { headers: { Authorization: 'Bearer ' + getToken() } });
        const d = await r.json();
        if (!d.admins || d.admins.length === 0) { listBody.innerHTML = '<div style="padding:12px 14px;color:#6b7280;font-size:13px">No admins found</div>'; return; }
        listBody.innerHTML = d.admins.map(a => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 14px;border-bottom:1px solid #1a2030">
            <div>
              <div style="font-size:13px;font-weight:500;color:#e2e8f0">${a.name || '—'} <span style="color:#6b7280;font-size:12px">${a.email}</span></div>
              <div style="font-size:11px;color:#4b5563;margin-top:1px">${new Date(a.created_date).toLocaleDateString()}</div>
            </div>
            <button onclick="deleteAdmin('${a.id}','${a.email}')"
              style="padding:4px 10px;background:#7f1d1d;color:#fca5a5;border:none;border-radius:5px;font-size:11px;cursor:pointer">
              Delete
            </button>
          </div>
        `).join('');
      } catch(e) { listBody.innerHTML = '<div style="padding:12px;color:#ef4444;font-size:13px">Error loading</div>'; }
    }

    window.deleteAdmin = async function(id, email) {
      if (!confirm('Delete admin ' + email + '?')) return;
      try {
        const r = await fetch('/api/auth/admin/delete-user/' + id, {
          method: 'DELETE',
          headers: { Authorization: 'Bearer ' + getToken() }
        });
        const d = await r.json();
        if (d.ok || d.message) { loadAdmins(); }
        else alert(d.error || 'Error');
      } catch(e) { alert(e.message); }
    };

    function openModal() {
      modal.style.display = 'flex';
      document.getElementById('ca-email').value = '';
      document.getElementById('ca-username').value = '';
      document.getElementById('ca-password').value = '';
      document.getElementById('ca-msg').textContent = '';
      loadAdmins();
    }
    function closeModal() { modal.style.display = 'none'; }
    _openModal = openModal;

    document.getElementById('ca-close').addEventListener('click', closeModal);
    document.getElementById('ca-cancel').addEventListener('click', closeModal);
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

    document.getElementById('ca-submit').addEventListener('click', async () => {
      const btn = document.getElementById('ca-submit');
      const msg = document.getElementById('ca-msg');
      const email = document.getElementById('ca-email').value.trim();
      const username = document.getElementById('ca-username').value.trim();
      const password = document.getElementById('ca-password').value;
      if (!email || !password) { msg.style.color='#ef4444'; msg.textContent='Email and password required'; return; }
      btn.disabled = true; btn.textContent = 'Creating...'; msg.textContent = '';
      try {
        const r = await fetch('/api/auth/admin/create-admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
          body: JSON.stringify({ email, username, password }),
        });
        const d = await r.json();
        if (d.ok) {
          msg.style.color = '#10b981';
          msg.textContent = '✓ Admin created: ' + d.admin.email;
          document.getElementById('ca-email').value = '';
          document.getElementById('ca-username').value = '';
          document.getElementById('ca-password').value = '';
          loadAdmins();
        } else {
          msg.style.color = '#ef4444'; msg.textContent = d.error || 'Error';
        }
      } catch(e) {
        msg.style.color = '#ef4444'; msg.textContent = e.message;
      } finally {
        btn.disabled = false; btn.textContent = '+ Create Admin';
      }
    });

    openModal();
  }

  function injectSidebarItem() {
    if (document.getElementById('ca-sidebar-btn')) return;
    const nav = document.querySelector('nav, aside');
    if (!nav) return;
    const buttons = nav.querySelectorAll('button');
    let insertBefore = null;
    for (const btn of buttons) {
      if (btn.textContent.trim() === 'Support') { insertBefore = btn; break; }
    }
    if (!insertBefore) return;

    const navBtn = document.createElement('button');
    navBtn.id = 'ca-sidebar-btn';
    navBtn.className = 'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all text-slate-400 hover:text-white hover:bg-white/5';
    navBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 shrink-0">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <line x1="19" y1="8" x2="19" y2="14"/>
        <line x1="22" y1="11" x2="16" y2="11"/>
      </svg>
      Admins
    `;
    navBtn.addEventListener('click', () => {
      nav.querySelectorAll('button').forEach(b => b.classList.remove('bg-indigo-500/15', 'text-indigo-400'));
      navBtn.classList.add('bg-indigo-500/15', 'text-indigo-400');
      navBtn.classList.remove('text-slate-400');
      buildModal();
    });
    insertBefore.parentNode.insertBefore(navBtn, insertBefore);
  }

  function init() {
    injectSidebarItem();
    const observer = new MutationObserver(() => {
      if (window.location.pathname.startsWith('/admin') && !document.getElementById('ca-sidebar-btn')) {
        injectSidebarItem();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 100));
  } else {
    setTimeout(init, 100);
  }
})();
