(function () {
  if (!location.pathname.startsWith('/admin')) return;

  const API = '/api';

  function getToken() {
    return localStorage.getItem('auth_token') || '';
  }

  // ── Wallet panel HTML ─────────────────────────────────────────────────────
  function createWalletPanel() {
    const el = document.createElement('div');
    el.id = 'player-wallets-panel';
    el.style.cssText = `
      position:fixed;right:20px;top:80px;width:360px;max-height:calc(100vh - 100px);
      background:#141829;border:1px solid #1e2a45;border-radius:14px;
      z-index:500;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,0.6);
      display:none;
    `;
    el.innerHTML = `
      <style>
        #player-wallets-panel .pw-row{display:flex;justify-content:space-between;align-items:center;padding:9px 14px;border-bottom:1px solid #0d1220;font-size:12px;}
        #player-wallets-panel .pw-addr{font-family:monospace;font-size:10px;color:#64748b;word-break:break-all;padding:4px 14px 8px;}
        #player-wallets-panel .pw-copy{cursor:pointer;color:#6366f1;font-size:10px;margin-left:6px;}
        #player-wallets-panel .pw-copy:hover{color:#818cf8;}
        #player-wallets-panel .pw-spin{width:14px;height:14px;border:2px solid #1e2a45;border-top-color:#6366f1;border-radius:50%;animation:pw-rot .7s linear infinite;display:inline-block;}
        @keyframes pw-rot{to{transform:rotate(360deg)}}
      </style>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid #1e2a45;">
        <div>
          <div style="color:#f1f5f9;font-size:14px;font-weight:700;">💳 Player Wallets</div>
          <div id="pw-player-name" style="color:#64748b;font-size:11px;margin-top:2px;"></div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <button id="pw-refresh" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:16px;" title="Refresh">↻</button>
          <button id="pw-close" style="background:none;border:none;color:#64748b;font-size:18px;cursor:pointer;">✕</button>
        </div>
      </div>
      <div id="pw-total" style="padding:10px 14px;border-bottom:1px solid #1e2a45;font-size:12px;color:#94a3b8;display:none;">
        Total on-chain: <span id="pw-total-val" style="color:#10b981;font-weight:700;"></span>
      </div>
      <div id="pw-body" style="padding:10px 0;">
        <div style="text-align:center;color:#64748b;font-size:13px;padding:20px;">
          Click on a player to load their wallets
        </div>
      </div>
    `;

    document.body.appendChild(el);

    document.getElementById('pw-close').addEventListener('click', () => { el.style.display = 'none'; });
    document.getElementById('pw-refresh').addEventListener('click', () => {
      if (el._currentUserId) loadWallets(el._currentUserId, el._currentUserName);
    });

    return el;
  }

  let panel = null;
  function getPanel() {
    if (!panel) panel = createWalletPanel();
    return panel;
  }

  async function loadWallets(userId, userName) {
    const p = getPanel();
    p._currentUserId = userId;
    p._currentUserName = userName;
    p.style.display = 'block';

    document.getElementById('pw-player-name').textContent = userName || userId;
    document.getElementById('pw-total').style.display = 'none';

    const body = document.getElementById('pw-body');
    body.innerHTML = `<div style="text-align:center;padding:28px 0;"><span class="pw-spin"></span><div style="color:#64748b;font-size:12px;margin-top:10px;">Loading wallets…</div></div>`;

    try {
      const r = await fetch(`${API}/crypto/admin/user-wallets/${userId}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      const data = await r.json();

      if (!data.ok) {
        body.innerHTML = `<div style="color:#f87171;padding:14px;font-size:12px;">❌ ${data.error || 'Error'}</div>`;
        return;
      }

      if (!data.wallets || !data.wallets.length) {
        body.innerHTML = `<div style="text-align:center;color:#64748b;font-size:13px;padding:24px;">No wallets found for this player</div>`;
        return;
      }

      // Show total
      if (data.totalUsd > 0) {
        document.getElementById('pw-total').style.display = 'block';
        document.getElementById('pw-total-val').textContent = `$${data.totalUsd.toFixed(2)}`;
      }

      // Group by chain
      const byChain = {};
      data.wallets.forEach(w => {
        if (!byChain[w.chain]) byChain[w.chain] = [];
        byChain[w.chain].push(w);
      });

      body.innerHTML = Object.entries(byChain).map(([chain, wallets]) => `
        <div style="padding:8px 14px 2px;font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.08em;font-weight:700;">
          ${chain}
        </div>
        ${wallets.map(w => `
          <div class="pw-row">
            <div>
              <span style="color:#f1f5f9;font-weight:600;">${w.token}</span>
              ${w.balanceUsd > 0
                ? `<span style="margin-left:6px;color:#10b981;font-weight:700;">$${w.balanceUsd.toFixed(2)}</span>`
                : `<span style="margin-left:6px;color:#334155;">$0.00</span>`
              }
              ${w.balance > 0 ? `<span style="margin-left:4px;color:#475569;font-size:10px;">(${w.balance.toFixed(4)})</span>` : ''}
            </div>
            <span class="pw-copy" onclick="navigator.clipboard.writeText('${w.address}');this.textContent='✓';setTimeout(()=>this.textContent='copy',1200);">copy</span>
          </div>
          <div class="pw-addr">${w.address}</div>
        `).join('')}
      `).join('<div style="height:4px;"></div>');

    } catch (e) {
      body.innerHTML = `<div style="color:#f87171;padding:14px;font-size:12px;">❌ ${e.message}</div>`;
    }
  }

  // ── Detect player clicks in admin Players tab ─────────────────────────────
  function findPlayerRows() {
    const main = document.querySelector('main');
    if (!main) return;

    // Look for elements containing user email patterns
    const allDivs = main.querySelectorAll('div[class*="cursor"], button, tr');
    allDivs.forEach(el => {
      if (el._pwBound) return;

      // Check if looks like a player row (has email pattern)
      const text = el.textContent;
      const emailMatch = text.match(/[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      if (!emailMatch) return;

      // Avoid binding to huge containers
      if (text.length > 500) return;

      el._pwBound = true;
      el.addEventListener('click', async (e) => {
        // Get user id from closest data attribute or find via API
        const email = emailMatch[0];
        if (!email || email.includes('cryptora')) {
          // Might be internal email — fetch user by email
        }

        // Fetch user id by email
        try {
          const r = await fetch(`/api/entities/User/filter?email=${encodeURIComponent(email)}&_limit=1`, {
            headers: { Authorization: `Bearer ${getToken()}` }
          });
          const users = await r.json();
          const user = Array.isArray(users) ? users[0] : null;
          if (user && user.id) {
            loadWallets(user.id, user.name || user.email);
          }
        } catch {}
      });
    });
  }

  // Also intercept API calls to users list to capture IDs
  // Better approach: watch for the expanded player detail
  function watchPlayerDetail() {
    const observer = new MutationObserver(() => {
      // Check if Players tab is active
      const activeBtn = document.querySelector('nav button.bg-amber-500\\/15, aside button.bg-amber-500\\/15');
      if (activeBtn && activeBtn.textContent.trim() !== 'Players') return;

      findPlayerRows();

      // Look for balance adjustment panel (sign of selected player)
      const balanceForm = document.querySelector('input[placeholder="Amount"]');
      if (!balanceForm) return;

      // Find the email near the form
      const formContainer = balanceForm.closest('div[class*="space"], div[class*="bg-"]');
      if (!formContainer || formContainer._walletBtnAdded) return;

      const emailEl = formContainer.querySelector('p, span, div');
      if (!emailEl) return;
      const emailMatch = formContainer.textContent.match(/[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      if (!emailMatch) return;

      formContainer._walletBtnAdded = true;

      const btn = document.createElement('button');
      btn.textContent = '💳 View Wallets';
      btn.style.cssText = 'width:100%;margin-top:8px;background:#1e2a45;border:1px solid #334155;border-radius:8px;padding:8px;color:#94a3b8;font-size:12px;cursor:pointer;text-align:left;';
      btn.addEventListener('mouseenter', () => btn.style.color = '#f1f5f9');
      btn.addEventListener('mouseleave', () => btn.style.color = '#94a3b8');
      btn.addEventListener('click', async () => {
        const email = emailMatch[0];
        try {
          const r = await fetch(`/api/entities/User/filter?email=${encodeURIComponent(email)}&_limit=1`, {
            headers: { Authorization: `Bearer ${getToken()}` }
          });
          const users = await r.json();
          const user = Array.isArray(users) ? users[0] : null;
          if (user) loadWallets(user.id, user.name || user.email);
        } catch {}
      });

      formContainer.appendChild(btn);
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Direct click interception on player list
  document.addEventListener('click', async (e) => {
    // Look for click on a player row in admin
    const row = e.target.closest('div, tr, li');
    if (!row) return;

    const text = row.textContent || '';
    if (text.length > 800) return; // skip large containers

    const emailMatch = text.match(/tg_[0-9]+@[a-zA-Z0-9.]+|[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (!emailMatch) return;

    const nav = document.querySelector('aside nav, nav');
    const activeBtn = nav && Array.from(nav.querySelectorAll('button')).find(b => b.classList.toString().includes('amber'));
    if (!activeBtn || activeBtn.textContent.trim() !== 'Players') return;

    const email = emailMatch[0];
    if (row._lastLoadedEmail === email) return;
    row._lastLoadedEmail = email;

    try {
      const r = await fetch(`/api/entities/User/filter?email=${encodeURIComponent(email)}&_limit=1`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      const users = await r.json();
      const user = Array.isArray(users) ? users[0] : null;
      if (user && user.id) {
        loadWallets(user.id, user.name || user.email);
      }
    } catch {}
  }, true);

  watchPlayerDetail();
})();
