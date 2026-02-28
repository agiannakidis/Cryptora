/**
 * Cryptora Admin — Add Operator button injector
 * Injects "Add Operator" button on /admin/operators page
 */
(function () {
  'use strict';

  if (!window.location.pathname.includes('/admin/operators')) return;

  const MODAL_ID = 'cr-add-op-modal';
  const BTN_ID   = 'cr-add-op-btn';

  // ── Styles ──────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #${BTN_ID} {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 18px;
      background: linear-gradient(135deg, #f59e0b, #d97706);
      color: #0a0e1a;
      border: none;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      transition: opacity .2s, transform .1s;
      white-space: nowrap;
    }
    #${BTN_ID}:hover { opacity: .9; transform: translateY(-1px); }

    #${MODAL_ID}-overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,.65);
      backdrop-filter: blur(4px);
      z-index: 9999;
      display: flex; align-items: center; justify-content: center;
      padding: 16px;
    }
    #${MODAL_ID} {
      background: #141829;
      border: 1px solid #252b45;
      border-radius: 16px;
      padding: 28px 32px;
      width: 100%;
      max-width: 480px;
      position: relative;
    }
    #${MODAL_ID} h2 {
      font-size: 18px; font-weight: 700; color: #f59e0b;
      margin-bottom: 20px;
    }
    #${MODAL_ID} .cr-field { margin-bottom: 14px; }
    #${MODAL_ID} label {
      display: block; font-size: 12px; color: #94a3b8;
      font-weight: 600; margin-bottom: 4px; letter-spacing: .04em;
    }
    #${MODAL_ID} input, #${MODAL_ID} select {
      width: 100%;
      background: #0d1224;
      border: 1px solid #252b45;
      border-radius: 8px;
      color: #e2e8f0;
      font-size: 14px;
      padding: 9px 13px;
      outline: none;
      box-sizing: border-box;
      transition: border-color .2s;
    }
    #${MODAL_ID} input:focus, #${MODAL_ID} select:focus { border-color: #f59e0b; }
    #${MODAL_ID} .cr-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    #${MODAL_ID} .cr-actions { display: flex; gap: 10px; margin-top: 20px; }
    #${MODAL_ID} .cr-btn-save {
      flex: 1; padding: 11px;
      background: linear-gradient(135deg, #f59e0b, #d97706);
      color: #0a0e1a; border: none; border-radius: 8px;
      font-size: 14px; font-weight: 700; cursor: pointer; transition: opacity .2s;
    }
    #${MODAL_ID} .cr-btn-save:hover { opacity: .9; }
    #${MODAL_ID} .cr-btn-save:disabled { opacity: .5; cursor: not-allowed; }
    #${MODAL_ID} .cr-btn-cancel {
      padding: 11px 20px;
      background: transparent;
      border: 1px solid #252b45;
      color: #64748b; border-radius: 8px;
      font-size: 14px; cursor: pointer; transition: border-color .2s, color .2s;
    }
    #${MODAL_ID} .cr-btn-cancel:hover { border-color: #94a3b8; color: #e2e8f0; }
    #${MODAL_ID} .cr-status {
      margin-top: 12px; padding: 10px 14px;
      border-radius: 8px; font-size: 13px; text-align: center;
    }
    #${MODAL_ID} .cr-status.ok { background:#052e16; color:#4ade80; border:1px solid #166534; }
    #${MODAL_ID} .cr-status.err { background:#450a0a; color:#fca5a5; border:1px solid #7f1d1d; }
    #${MODAL_ID} .cr-close {
      position: absolute; top: 14px; right: 16px;
      background: none; border: none; color: #64748b;
      font-size: 20px; cursor: pointer; line-height: 1;
    }
    #${MODAL_ID} .cr-close:hover { color: #e2e8f0; }
  `;
  document.head.appendChild(style);

  // ── Modal HTML ──────────────────────────────────────────────────────────────
  function createModal() {
    const overlay = document.createElement('div');
    overlay.id = MODAL_ID + '-overlay';
    overlay.innerHTML = `
      <div id="${MODAL_ID}">
        <button class="cr-close" onclick="document.getElementById('${MODAL_ID}-overlay').remove()">✕</button>
        <h2>➕ Add Operator</h2>

        <div class="cr-row">
          <div class="cr-field">
            <label>USERNAME</label>
            <input id="cr-op-username" type="text" placeholder="operator_name" autocomplete="off">
          </div>
          <div class="cr-field">
            <label>CURRENCY</label>
            <select id="cr-op-currency">
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="BTC">BTC</option>
              <option value="USDT">USDT</option>
            </select>
          </div>
        </div>

        <div class="cr-field">
          <label>EMAIL</label>
          <input id="cr-op-email" type="email" placeholder="operator@example.com" autocomplete="off">
        </div>

        <div class="cr-field">
          <label>PASSWORD</label>
          <input id="cr-op-password" type="password" placeholder="min 6 characters" autocomplete="new-password">
        </div>

        <div class="cr-row">
          <div class="cr-field">
            <label>INITIAL BALANCE ($)</label>
            <input id="cr-op-balance" type="number" min="0" step="0.01" placeholder="0.00">
          </div>
          <div class="cr-field">
            <label>NOTES (optional)</label>
            <input id="cr-op-notes" type="text" placeholder="e.g. VIP partner">
          </div>
        </div>

        <div class="cr-actions">
          <button class="cr-btn-cancel" onclick="document.getElementById('${MODAL_ID}-overlay').remove()">Cancel</button>
          <button class="cr-btn-save" id="cr-op-submit">Create Operator</button>
        </div>
        <div id="cr-op-status" style="display:none" class="cr-status"></div>
      </div>
    `;

    // Click outside to close
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);

    document.getElementById('cr-op-submit').addEventListener('click', submitCreate);
  }

  async function submitCreate() {
    const username      = document.getElementById('cr-op-username').value.trim();
    const email         = document.getElementById('cr-op-email').value.trim();
    const password      = document.getElementById('cr-op-password').value;
    const currency      = document.getElementById('cr-op-currency').value;
    const initialBalance = document.getElementById('cr-op-balance').value;
    const notes         = document.getElementById('cr-op-notes').value.trim();

    const statusEl = document.getElementById('cr-op-status');
    const submitEl = document.getElementById('cr-op-submit');

    function showStatus(msg, ok) {
      statusEl.textContent = msg;
      statusEl.className = 'cr-status ' + (ok ? 'ok' : 'err');
      statusEl.style.display = 'block';
    }

    if (!username || !email || !password || !currency) {
      return showStatus('Fill in username, email, password and currency', false);
    }

    submitEl.disabled = true;
    submitEl.textContent = 'Creating…';

    try {
      const token = localStorage.getItem('auth_token');
      const r = await fetch('/api/operator/admin/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ username, email, password, currency, initialBalance: parseFloat(initialBalance) || 0, notes })
      });
      const data = await r.json();
      if (!r.ok) {
        showStatus('❌ ' + (data.error || 'Failed'), false);
        submitEl.disabled = false;
        submitEl.textContent = 'Create Operator';
        return;
      }
      showStatus(`✅ Operator "${data.operator.username}" created! ID: ${data.operator.id}`, true);
      submitEl.textContent = '✓ Done';
      // Close modal after 1.5s and refresh page
      setTimeout(() => {
        document.getElementById(MODAL_ID + '-overlay')?.remove();
        window.location.reload();
      }, 1500);
    } catch(e) {
      showStatus('Network error', false);
      submitEl.disabled = false;
      submitEl.textContent = 'Create Operator';
    }
  }

  // ── Inject button into page header ─────────────────────────────────────────
  function injectButton() {
    if (document.getElementById(BTN_ID)) return;

    // Find the page header area — look for h1/h2 with "Operator"
    const headers = document.querySelectorAll('h1, h2, h3');
    let target = null;
    for (const h of headers) {
      if (/operator/i.test(h.textContent)) { target = h; break; }
    }

    if (!target) {
      // Fallback: find main content area
      target = document.querySelector('main h1, main h2, [class*="admin"] h1, [class*="admin"] h2');
    }

    if (!target) return; // Page not loaded yet

    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.innerHTML = '＋ Add Operator';
    btn.onclick = createModal;

    // Insert button next to the heading
    const parent = target.parentElement;
    parent.style.display = 'flex';
    parent.style.alignItems = 'center';
    parent.style.flexWrap = 'wrap';
    parent.style.gap = '12px';
    parent.appendChild(btn);
  }

  // Wait for React to render the page
  let attempts = 0;
  const interval = setInterval(() => {
    injectButton();
    if (document.getElementById(BTN_ID) || ++attempts > 40) clearInterval(interval);
  }, 300);

  // Also re-inject on SPA route changes
  const origPushState = history.pushState.bind(history);
  history.pushState = function (...args) {
    origPushState(...args);
    if (window.location.pathname.includes('/admin/operators')) {
      attempts = 0;
      setInterval(() => {
        injectButton();
        if (document.getElementById(BTN_ID) || ++attempts > 40) clearInterval(interval);
      }, 300);
    }
  };

})();
