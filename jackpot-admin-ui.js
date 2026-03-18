// jackpot-admin-ui.js — Jackpot settings in admin sidebar
(function() {
  if (!window.location.pathname.startsWith('/admin')) return;

  function getToken() {
    try {
      return localStorage.getItem('auth_token') || localStorage.getItem('casino_token') || '';
    } catch(e) { return ''; }
  }

  // ── Modal ────────────────────────────────────────────────────────────────────
  let _openModal = null;

  function buildModal() {
    if (document.getElementById('jackpot-admin-section')) return _openModal && _openModal();

    const modal = document.createElement('div');
    modal.id = 'jackpot-admin-section';
    modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.7);align-items:center;justify-content:center;';
    modal.innerHTML = `
      <div style="background:#1a1f2e;border-radius:12px;padding:28px;width:480px;max-width:95vw;color:#fff;box-shadow:0 8px 32px rgba(0,0,0,0.6);border:1px solid #2d3448">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
          <h2 style="margin:0;font-size:20px;font-weight:700">🎰 Jackpot Settings</h2>
          <button id="jp-modal-close" style="background:none;border:none;color:#9ca3af;font-size:22px;cursor:pointer">×</button>
        </div>
        <div id="jp-current-info" style="background:#0d1117;border-radius:8px;padding:12px;margin-bottom:20px;font-size:13px;color:#9ca3af">Loading...</div>
        <div style="display:grid;gap:14px">
          <div>
            <label style="display:block;font-size:12px;color:#9ca3af;margin-bottom:4px">Max Jackpot Amount ($)</label>
            <input id="jp-max-amount" type="number" min="1000" step="1000"
              style="width:100%;padding:10px 12px;background:#0d1117;border:1px solid #2d3448;border-radius:6px;color:#fff;font-size:14px;box-sizing:border-box"/>
          </div>
          <div>
            <label style="display:block;font-size:12px;color:#9ca3af;margin-bottom:4px">Base Win Chance (e.g. 0.00001 = 0.001% per $1 bet at 10% fill)</label>
            <input id="jp-base-chance" type="number" min="0.000001" step="0.000001"
              style="width:100%;padding:10px 12px;background:#0d1117;border:1px solid #2d3448;border-radius:6px;color:#fff;font-size:14px;box-sizing:border-box"/>
          </div>
          <div>
            <label style="display:block;font-size:12px;color:#9ca3af;margin-bottom:4px">Contribution Rate (e.g. 0.0001 = 0.01% of each bet)</label>
            <input id="jp-contrib-rate" type="number" min="0" step="0.0001"
              style="width:100%;padding:10px 12px;background:#0d1117;border:1px solid #2d3448;border-radius:6px;color:#fff;font-size:14px;box-sizing:border-box"/>
          </div>
        </div>
        <div style="margin-top:8px;padding:10px;background:#1e2433;border-radius:6px;font-size:12px;color:#9ca3af">
          💡 <strong style="color:#f59e0b">Seed on win</strong> = 1% of jackpot amount (auto-calculated)<br>
          💡 <strong style="color:#f59e0b">Win chance formula:</strong> base × bet$ × (current / max)
        </div>
        <div id="jp-save-msg" style="min-height:20px;margin-top:10px;font-size:13px;text-align:center"></div>
        <div style="display:flex;gap:10px;margin-top:16px">
          <button id="jp-save-btn" style="flex:1;padding:11px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border:none;border-radius:8px;font-weight:600;font-size:14px;cursor:pointer">Save Settings</button>
          <button id="jp-modal-close2" style="padding:11px 18px;background:#2d3448;color:#fff;border:none;border-radius:8px;cursor:pointer">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    function formatMoney(n) { return '$' + parseFloat(n).toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2}); }

    async function loadSettings() {
      try {
        const r = await fetch('/api/jackpot/admin/settings', { headers: { Authorization: 'Bearer ' + getToken() } });
        if (!r.ok) { document.getElementById('jp-current-info').textContent = 'Failed to load'; return; }
        const d = await r.json();
        document.getElementById('jp-current-info').innerHTML = `
          <span style="color:#f59e0b;font-weight:600">Current Jackpot:</span> ${formatMoney(d.amount)} &nbsp;|&nbsp;
          <span style="color:#fff">Max:</span> ${formatMoney(d.max_amount)}<br>
          <span style="color:#fff">Contribution:</span> ${(d.contribution_rate*100).toFixed(4)}% per bet &nbsp;|&nbsp;
          <span style="color:#fff">Total collected:</span> ${formatMoney(d.total_contributed)}<br>
          ${d.last_winner_email ? `<span style="color:#10b981">Last winner:</span> ${d.last_winner_email} — ${formatMoney(d.last_winner_amount)}` : '<span style="color:#6b7280">No winners yet</span>'}
        `;
        document.getElementById('jp-max-amount').value = d.max_amount;
        document.getElementById('jp-base-chance').value = d.win_chance_base;
        document.getElementById('jp-contrib-rate').value = d.contribution_rate;
      } catch(e) { document.getElementById('jp-current-info').textContent = 'Error: ' + e.message; }
    }

    function openModal() { modal.style.display = 'flex'; loadSettings(); }
    function closeModal() { modal.style.display = 'none'; }
    _openModal = openModal;

    document.getElementById('jp-modal-close').addEventListener('click', closeModal);
    document.getElementById('jp-modal-close2').addEventListener('click', closeModal);
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

    document.getElementById('jp-save-btn').addEventListener('click', async () => {
      const saveBtn = document.getElementById('jp-save-btn');
      const msg = document.getElementById('jp-save-msg');
      saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; msg.textContent = '';
      try {
        const body = {
          max_amount: parseFloat(document.getElementById('jp-max-amount').value),
          win_chance_base: parseFloat(document.getElementById('jp-base-chance').value),
          contribution_rate: parseFloat(document.getElementById('jp-contrib-rate').value),
        };
        if (isNaN(body.max_amount) || body.max_amount < 100) { msg.style.color='#ef4444'; msg.textContent='Max amount must be >= $100'; return; }
        const r = await fetch('/api/jackpot/admin/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
          body: JSON.stringify(body),
        });
        const d = await r.json();
        if (d.ok) { msg.style.color='#10b981'; msg.textContent='✓ Settings saved'; loadSettings(); }
        else { msg.style.color='#ef4444'; msg.textContent=d.error||'Save failed'; }
      } catch(e) { msg.style.color='#ef4444'; msg.textContent=e.message; }
      finally { saveBtn.disabled=false; saveBtn.textContent='Save Settings'; }
    });

    return { open: openModal, close: closeModal };
  }

  // ── Sidebar nav item ─────────────────────────────────────────────────────────
  function injectSidebarItem() {
    if (document.getElementById('jp-sidebar-btn')) return;

    const nav = document.querySelector('nav, aside');
    if (!nav) return;

    const buttons = nav.querySelectorAll('button');
    // Find "Withdrawals" or "Banner" button to insert before
    let insertBefore = null;
    for (const btn of buttons) {
      const text = btn.textContent.trim();
      if (text === 'Banner' || text === 'Support') { insertBefore = btn; break; }
    }
    if (!insertBefore) return;

    const navBtn = document.createElement('button');
    navBtn.id = 'jp-sidebar-btn';
    navBtn.className = 'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all text-slate-400 hover:text-white hover:bg-white/5';
    navBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 shrink-0">
        <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/>
        <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
        <path d="M4 22h16"/>
        <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>
        <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>
        <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>
      </svg>
      Jackpot
    `;

    navBtn.addEventListener('click', () => {
      // Highlight active state
      nav.querySelectorAll('button').forEach(b => {
        b.classList.remove('bg-amber-500/15', 'text-amber-400');
        if (!b.id || b.id !== 'jp-sidebar-btn') {
          b.classList.add('text-slate-400');
        }
      });
      navBtn.classList.remove('text-slate-400');
      navBtn.classList.add('bg-amber-500/15', 'text-amber-400');

      buildModal();
    });

    insertBefore.parentNode.insertBefore(navBtn, insertBefore);
  }

  // ── Init ─────────────────────────────────────────────────────────────────────
  function init() {
    buildModal();
    injectSidebarItem();

    // MutationObserver — re-inject whenever React re-renders the sidebar
    const observer = new MutationObserver(() => {
      if (!window.location.pathname.startsWith('/admin')) return;
      if (!document.getElementById('jp-sidebar-btn')) {
        injectSidebarItem();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Re-inject on route changes (React SPA)
  const origPush = history.pushState.bind(history);
  history.pushState = function() {
    origPush.apply(history, arguments);
    if (window.location.pathname.startsWith('/admin')) setTimeout(injectSidebarItem, 50);
  };
  window.addEventListener('popstate', () => {
    if (window.location.pathname.startsWith('/admin')) setTimeout(injectSidebarItem, 50);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 100));
  } else {
    setTimeout(init, 100);
  }
})();
