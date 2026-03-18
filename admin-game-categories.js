// admin-game-categories.js
// Injects category multi-select into the "Add/Edit Game" modal in admin panel

(function () {
  'use strict';

  if (!location.pathname.startsWith('/admin')) return;

  const CATEGORIES = [
    { key: 'slots',      label: '🎲 All Slots' },
    { key: 'featured',   label: '⭐ Featured' },
    { key: 'new',        label: '🆕 New' },
    { key: 'table',      label: '🎰 Table' },
    { key: 'crash',      label: '💥 Crash' },
    { key: 'megaways',   label: '🔥 Megaways' },
    { key: 'bonus_buy',  label: '💎 Bonus Buy' },
    { key: 'jackpot',    label: '🏆 Jackpot' },
  ];

  function getToken() {
    try { return localStorage.getItem('auth_token') || localStorage.getItem('casino_token') || ''; } catch { return ''; }
  }

  // Inject styles once
  if (!document.getElementById('agc-styles')) {
    const s = document.createElement('style');
    s.id = 'agc-styles';
    s.textContent = `
      #agc-wrap { margin-top: 14px; }
      #agc-wrap label { font-size: 13px; font-weight: 600; color: #9ca3af; display: block; margin-bottom: 8px; }
      #agc-grid { display: flex; flex-wrap: wrap; gap: 6px; }
      .agc-chip {
        display: flex; align-items: center; gap: 5px;
        padding: 5px 10px; border-radius: 8px;
        border: 1px solid #252b45; background: #141829;
        cursor: pointer; font-size: 12px; color: #888;
        transition: all .15s; user-select: none;
      }
      .agc-chip.active {
        border-color: #f0c040; background: rgba(240,192,64,.1); color: #f0c040;
      }
    `;
    document.head.appendChild(s);
  }

  let selectedCats = ['slots'];
  let currentGameId = null;
  let injected = false;

  function makeChips() {
    const grid = document.createElement('div');
    grid.id = 'agc-grid';
    CATEGORIES.forEach(c => {
      const chip = document.createElement('div');
      chip.className = 'agc-chip' + (selectedCats.includes(c.key) ? ' active' : '');
      chip.dataset.key = c.key;
      chip.textContent = c.label;
      chip.addEventListener('click', () => {
        if (selectedCats.includes(c.key)) {
          selectedCats = selectedCats.filter(k => k !== c.key);
          chip.classList.remove('active');
        } else {
          selectedCats.push(c.key);
          chip.classList.add('active');
        }
      });
      grid.appendChild(chip);
    });
    return grid;
  }

  function injectCatUI(modal) {
    if (modal.querySelector('#agc-wrap')) return; // already injected

    // Reset state
    selectedCats = ['slots'];
    currentGameId = null;

    // Find the last form field in the modal to insert after
    const inputs = modal.querySelectorAll('input, select, textarea');
    if (!inputs.length) return;
    const lastInput = inputs[inputs.length - 1];
    const lastRow = lastInput.closest('[class]') || lastInput.parentElement;
    if (!lastRow) return;

    const wrap = document.createElement('div');
    wrap.id = 'agc-wrap';

    const lbl = document.createElement('label');
    lbl.textContent = 'Categories';
    wrap.appendChild(lbl);
    wrap.appendChild(makeChips());

    lastRow.after(wrap);
    injected = true;
  }

  // Intercept fetch to catch game creation/update responses
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const [url, opts] = args;
    const urlStr = typeof url === 'string' ? url : (url?.url || '');

    const resp = await origFetch.apply(this, args);

    // Check if this is a game POST (create) or PUT (update) via entities
    const isGameWrite =
      urlStr.includes('/api/entities/Game') ||
      urlStr.includes('/api/entities/game');
    const method = (opts?.method || 'GET').toUpperCase();

    if (isGameWrite && (method === 'POST' || method === 'PUT')) {
      // Clone response to read it without consuming the stream
      const clone = resp.clone();
      try {
        const data = await clone.json();
        if (data?.id && injected && selectedCats.length > 0) {
          // PATCH categories onto the newly created/updated game
          origFetch(`/api/games/${data.id}/categories`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + getToken(),
            },
            body: JSON.stringify({ categories: selectedCats }),
          }).catch(() => {});
          injected = false;
        }
      } catch {}
    }

    return resp;
  };

  // Watch for modal to appear
  const obs = new MutationObserver(() => {
    if (!location.pathname.startsWith('/admin')) return;
    const modal = document.querySelector('[role=dialog]') ||
      document.querySelector('[class*="modal"]') ||
      document.querySelector('[class*="Modal"]');
    if (modal && modal.querySelector('input')) {
      injectCatUI(modal);
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });

  // Also handle edit (pre-fill categories from existing game)
  // Intercept GET /entities/Game/:id to pre-load categories
  const _origFetch2 = window.fetch;
  // Note: we already replaced fetch above, so we capture the existing wrapper

})();
