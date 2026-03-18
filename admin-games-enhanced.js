// admin-games-enhanced.js — Enhanced Games tab with provider filter + edit v1
(function () {
  'use strict';

  const API = '/api/games';
  let allGames = [];
  let providers = [];
  let currentProvider = 'all';
  let currentSearch = '';
  let editingGame = null;

  function getToken() {
    try { return localStorage.getItem('auth_token') || ''; } catch { return ''; }
  }
  function authHeaders() {
    return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() };
  }
  function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── CSS ───────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('age-styles')) return;
    const s = document.createElement('style');
    s.id = 'age-styles';
    s.textContent = `
      #age-wrap { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
      #age-toolbar {
        display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
        margin-bottom: 16px; padding: 14px 16px;
        background: #0d1220; border: 1px solid #1e2440; border-radius: 12px;
      }
      #age-provider-select {
        padding: 8px 12px; border-radius: 8px;
        background: #141829; border: 1px solid #252b45; color: #fff;
        font-size: 13px; outline: none; cursor: pointer; min-width: 170px;
      }
      #age-provider-select:focus { border-color: #f0c040; }
      #age-search {
        flex: 1; min-width: 180px; padding: 8px 12px; border-radius: 8px;
        background: #141829; border: 1px solid #252b45; color: #fff;
        font-size: 13px; outline: none;
      }
      #age-search:focus { border-color: #f0c040; }
      #age-count { color: #64748b; font-size: 13px; margin-left: auto; }
      #age-table-wrap { overflow-x: auto; border-radius: 12px; border: 1px solid #1e2440; }
      #age-table {
        width: 100%; border-collapse: collapse; font-size: 13px;
        background: #0d1220;
      }
      #age-table thead th {
        padding: 10px 12px; text-align: left; color: #64748b;
        font-size: 11px; font-weight: 600; text-transform: uppercase;
        border-bottom: 1px solid #1e2440; white-space: nowrap; cursor: pointer;
        user-select: none;
      }
      #age-table thead th:hover { color: #f0c040; }
      #age-table thead th.sort-asc::after { content: ' ↑'; color: #f0c040; }
      #age-table thead th.sort-desc::after { content: ' ↓'; color: #f0c040; }
      #age-table tbody tr { border-bottom: 1px solid #1a2035; transition: background .12s; }
      #age-table tbody tr:hover { background: rgba(255,255,255,.03); }
      #age-table td { padding: 9px 12px; vertical-align: middle; }
      .age-thumb {
        width: 38px; height: 38px; border-radius: 6px; object-fit: cover;
        background: #252b45; display: block;
      }
      .age-thumb-placeholder {
        width: 38px; height: 38px; border-radius: 6px;
        background: #1a2035; display: flex; align-items: center; justify-content: center;
        font-size: 16px;
      }
      .age-title { font-weight: 600; color: #e2e8f0; max-width: 180px; }
      .age-provider { color: #94a3b8; }
      .age-badge {
        display: inline-block; padding: 2px 7px; border-radius: 6px;
        font-size: 10px; font-weight: 700;
      }
      .age-badge.on { background: rgba(34,197,94,.15); color: #22c55e; }
      .age-badge.off { background: rgba(100,116,139,.15); color: #64748b; }
      .age-badge.feat { background: rgba(240,192,64,.15); color: #f0c040; }
      .age-sort-input {
        width: 60px; padding: 4px 7px; border-radius: 6px;
        background: #141829; border: 1px solid #252b45; color: #fff;
        font-size: 12px; text-align: center; outline: none;
      }
      .age-sort-input:focus { border-color: #f0c040; }
      .age-edit-btn {
        padding: 5px 10px; border-radius: 7px;
        background: rgba(240,192,64,.12); border: 1px solid rgba(240,192,64,.25);
        color: #f0c040; font-size: 11px; font-weight: 600; cursor: pointer;
        transition: all .2s;
      }
      .age-edit-btn:hover { background: rgba(240,192,64,.2); }
      .age-toggle-btn {
        padding: 5px 10px; border-radius: 7px;
        font-size: 11px; font-weight: 600; cursor: pointer; transition: all .2s; border: 1px solid;
      }
      .age-toggle-btn.on { background: rgba(239,68,68,.1); border-color: rgba(239,68,68,.3); color: #ef4444; }
      .age-toggle-btn.off { background: rgba(34,197,94,.1); border-color: rgba(34,197,94,.3); color: #22c55e; }

      /* Modal */
      #age-modal-bg {
        display: none; position: fixed; inset: 0; z-index: 9999;
        background: rgba(0,0,0,.7); align-items: center; justify-content: center;
      }
      #age-modal-bg.open { display: flex; }
      #age-modal {
        background: #0d1220; border: 1px solid #1e2440; border-radius: 16px;
        width: 560px; max-width: calc(100vw - 32px); max-height: 90vh;
        overflow-y: auto; padding: 24px;
      }
      #age-modal h3 { font-size: 16px; font-weight: 700; color: #fff; margin: 0 0 20px; }
      .age-field { margin-bottom: 14px; }
      .age-label { font-size: 12px; color: #64748b; margin-bottom: 5px; display: block; }
      .age-input {
        width: 100%; padding: 9px 12px; border-radius: 8px;
        background: #141829; border: 1px solid #252b45; color: #fff;
        font-size: 13px; outline: none; box-sizing: border-box;
      }
      .age-input:focus { border-color: #f0c040; }
      .age-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .age-checkbox-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
      .age-checkbox-row input[type=checkbox] { width: 16px; height: 16px; cursor: pointer; accent-color: #f0c040; }
      .age-checkbox-row label { font-size: 13px; color: #e2e8f0; cursor: pointer; }
      .age-modal-footer { display: flex; gap: 10px; margin-top: 20px; justify-content: flex-end; }
      .age-save-btn {
        padding: 9px 22px; border-radius: 9px;
        background: linear-gradient(135deg,#f0c040,#d97706);
        border: none; color: #0a0e1a; font-weight: 700; font-size: 13px; cursor: pointer;
      }
      .age-cancel-btn {
        padding: 9px 18px; border-radius: 9px;
        background: transparent; border: 1px solid #334155; color: #94a3b8;
        font-size: 13px; cursor: pointer;
      }
      .age-thumb-preview {
        width: 60px; height: 60px; border-radius: 8px; object-fit: cover;
        margin-top: 8px; display: none; border: 1px solid #252b45;
      }
      #age-loading { text-align: center; padding: 40px; color: #475569; }
    `;
    document.head.appendChild(s);
  }

  // ── Load data ─────────────────────────────────────────────────────────────
  async function loadProviders() {
    try {
      const data = await fetch(API + '/providers-list', { headers: authHeaders() }).then(r => r.json());
      providers = Array.isArray(data) ? data : [];
    } catch {}
  }

  async function loadGames(provider) {
    const wrap = document.getElementById('age-table-wrap');
    if (wrap) wrap.innerHTML = '<div id="age-loading">Loading…</div>';
    try {
      const qs = provider && provider !== 'all'
        ? `?provider=${encodeURIComponent(provider)}&limit=500`
        : '?limit=500';
      const data = await fetch(API + '/list' + qs, { headers: authHeaders() }).then(r => r.json());
      allGames = Array.isArray(data) ? data : [];
    } catch { allGames = []; }
    renderTable();
  }

  // ── Sort state ────────────────────────────────────────────────────────────
  let sortCol = 'sort_order';
  let sortDir = 'desc';

  function sortedGames(games) {
    const q = currentSearch.toLowerCase();
    let filtered = q ? games.filter(g => (g.title || '').toLowerCase().includes(q) || (g.provider || '').toLowerCase().includes(q)) : games;
    return filtered.sort((a, b) => {
      let va = a[sortCol], vb = b[sortCol];
      if (sortCol === 'sort_order') { va = va || 0; vb = vb || 0; }
      if (sortCol === 'play_count') { va = va || 0; vb = vb || 0; }
      if (va === null || va === undefined) va = '';
      if (vb === null || vb === undefined) vb = '';
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }

  function setSort(col) {
    if (sortCol === col) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    else { sortCol = col; sortDir = col === 'sort_order' ? 'desc' : 'asc'; }
    renderTable();
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function renderTable() {
    const wrap = document.getElementById('age-table-wrap');
    if (!wrap) return;
    const games = sortedGames(allGames);
    const cnt = document.getElementById('age-count');
    if (cnt) cnt.textContent = games.length + ' games';

    const cols = [
      { key: 'thumbnail', label: '🖼', sortable: false },
      { key: 'title', label: 'Title', sortable: true },
      { key: 'provider', label: 'Provider', sortable: true },
      { key: 'sort_order', label: 'Order ↕', sortable: true },
      { key: 'play_count', label: 'Plays', sortable: true },
      { key: 'rtp', label: 'RTP', sortable: true },
      { key: 'is_enabled', label: 'Status', sortable: false },
      { key: 'is_featured', label: 'Featured', sortable: false },
      { key: '_actions', label: '', sortable: false },
    ];

    wrap.innerHTML = '';
    const table = document.createElement('table');
    table.id = 'age-table';

    // Header
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    cols.forEach(c => {
      const th = document.createElement('th');
      th.textContent = c.label;
      if (c.sortable) {
        th.style.cursor = 'pointer';
        if (sortCol === c.key) th.className = sortDir === 'asc' ? 'sort-asc' : 'sort-desc';
        th.addEventListener('click', () => setSort(c.key));
      }
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement('tbody');
    games.forEach(game => {
      const row = document.createElement('tr');
      row.dataset.id = game.id;

      // Thumbnail
      const tdThumb = document.createElement('td');
      if (game.thumbnail) {
        const img = document.createElement('img');
        img.src = game.thumbnail;
        img.className = 'age-thumb';
        img.onerror = function() { this.style.display='none'; };
        tdThumb.appendChild(img);
      } else {
        tdThumb.innerHTML = '<div class="age-thumb-placeholder">🎮</div>';
      }
      row.appendChild(tdThumb);

      // Title
      const tdTitle = document.createElement('td');
      tdTitle.innerHTML = `<div class="age-title" title="${escHtml(game.title)}">${escHtml((game.title||'').slice(0,28))}${(game.title||'').length>28?'…':''}</div>`;
      row.appendChild(tdTitle);

      // Provider
      const tdProv = document.createElement('td');
      tdProv.innerHTML = `<span class="age-provider">${escHtml(game.provider||'')}</span>`;
      row.appendChild(tdProv);

      // Sort order (inline editable)
      const tdSort = document.createElement('td');
      const sortInput = document.createElement('input');
      sortInput.type = 'number';
      sortInput.className = 'age-sort-input';
      sortInput.value = game.sort_order || 0;
      sortInput.title = 'Higher = shows first';
      const saveSortOrder = async () => {
        const val = parseInt(sortInput.value) || 0;
        game.sort_order = val;
        sortInput.style.borderColor = '#f0c040';
        await saveField(game.id, { sort_order: val });
        sortInput.style.borderColor = '#22c55e';
        setTimeout(() => { sortInput.style.borderColor = ''; }, 1200);
      };
      sortInput.addEventListener('change', saveSortOrder);
      sortInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveSortOrder(); } });
      tdSort.appendChild(sortInput);
      row.appendChild(tdSort);

      // Play count
      const tdPlays = document.createElement('td');
      tdPlays.style.color = '#94a3b8';
      tdPlays.textContent = game.play_count || 0;
      row.appendChild(tdPlays);

      // RTP
      const tdRtp = document.createElement('td');
      tdRtp.style.color = '#94a3b8';
      tdRtp.textContent = game.rtp ? game.rtp + '%' : '—';
      row.appendChild(tdRtp);

      // Status toggle
      const tdStatus = document.createElement('td');
      const statusBtn = document.createElement('button');
      statusBtn.className = 'age-toggle-btn ' + (game.is_enabled !== false ? 'on' : 'off');
      statusBtn.textContent = game.is_enabled !== false ? 'Enabled' : 'Disabled';
      statusBtn.addEventListener('click', async () => {
        game.is_enabled = !game.is_enabled;
        statusBtn.className = 'age-toggle-btn ' + (game.is_enabled ? 'on' : 'off');
        statusBtn.textContent = game.is_enabled ? 'Enabled' : 'Disabled';
        await saveField(game.id, { is_enabled: game.is_enabled });
      });
      tdStatus.appendChild(statusBtn);
      row.appendChild(tdStatus);

      // Featured toggle
      const tdFeat = document.createElement('td');
      const featBadge = document.createElement('span');
      featBadge.className = 'age-badge ' + (game.is_featured ? 'feat' : 'off');
      featBadge.textContent = game.is_featured ? '★ Featured' : '—';
      featBadge.style.cursor = 'pointer';
      featBadge.addEventListener('click', async () => {
        game.is_featured = !game.is_featured;
        featBadge.className = 'age-badge ' + (game.is_featured ? 'feat' : 'off');
        featBadge.textContent = game.is_featured ? '★ Featured' : '—';
        await saveField(game.id, { is_featured: game.is_featured });
      });
      tdFeat.appendChild(featBadge);
      row.appendChild(tdFeat);

      // Actions
      const tdAct = document.createElement('td');
      const editBtn = document.createElement('button');
      editBtn.className = 'age-edit-btn';
      editBtn.textContent = '✏ Edit';
      editBtn.addEventListener('click', () => openEditModal(game));
      tdAct.appendChild(editBtn);
      row.appendChild(tdAct);

      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    wrap.appendChild(table);
  }

  // ── Save single field ─────────────────────────────────────────────────────
  async function saveField(id, fields) {
    try {
      await fetch(`${API}/${id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(fields)
      });
    } catch (e) { console.error('[age] save', e); }
  }

  // ── Edit modal ────────────────────────────────────────────────────────────
  function openEditModal(game) {
    editingGame = { ...game };
    const modal = document.getElementById('age-modal-bg');
    if (!modal) return;

    document.getElementById('age-m-title').value = game.title || '';
    document.getElementById('age-m-provider').value = game.provider || '';
    document.getElementById('age-m-thumbnail').value = game.thumbnail || '';
    document.getElementById('age-m-sort').value = game.sort_order || 0;
    document.getElementById('age-m-rtp').value = game.rtp || '';
    document.getElementById('age-m-minbet').value = game.min_bet || '';
    document.getElementById('age-m-maxbet').value = game.max_bet || '';
    document.getElementById('age-m-launch').value = game.launch_url || '';
    document.getElementById('age-m-categories').value = (game.categories || []).join(', ');
    document.getElementById('age-m-enabled').checked = game.is_enabled !== false;
    document.getElementById('age-m-featured').checked = !!game.is_featured;
    document.getElementById('age-m-jackpot').checked = !!game.has_jackpot;

    const preview = document.getElementById('age-m-thumb-preview');
    if (game.thumbnail) { preview.src = game.thumbnail; preview.style.display = 'block'; }
    else { preview.style.display = 'none'; }

    document.getElementById('age-modal-title').textContent = '✏ Edit: ' + (game.title || '');
    modal.classList.add('open');
  }

  function closeModal() {
    const modal = document.getElementById('age-modal-bg');
    if (modal) modal.classList.remove('open');
    editingGame = null;
  }

  async function saveModal() {
    if (!editingGame) return;
    const fields = {
      title: document.getElementById('age-m-title').value.trim(),
      provider: document.getElementById('age-m-provider').value.trim(),
      thumbnail: document.getElementById('age-m-thumbnail').value.trim(),
      sort_order: parseInt(document.getElementById('age-m-sort').value) || 0,
      rtp: parseFloat(document.getElementById('age-m-rtp').value) || null,
      min_bet: parseFloat(document.getElementById('age-m-minbet').value) || null,
      max_bet: parseFloat(document.getElementById('age-m-maxbet').value) || null,
      launch_url: document.getElementById('age-m-launch').value.trim(),
      categories: document.getElementById('age-m-categories').value.split(',').map(s => s.trim()).filter(Boolean),
      is_enabled: document.getElementById('age-m-enabled').checked,
      is_featured: document.getElementById('age-m-featured').checked,
      has_jackpot: document.getElementById('age-m-jackpot').checked,
    };
    const btn = document.getElementById('age-m-save');
    btn.textContent = 'Saving…'; btn.disabled = true;
    try {
      await fetch(`${API}/${editingGame.id}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(fields) });
      // Update local data
      const idx = allGames.findIndex(g => g.id === editingGame.id);
      if (idx !== -1) allGames[idx] = { ...allGames[idx], ...fields };
      closeModal();
      renderTable();
    } catch (e) { console.error('[age] save modal', e); }
    btn.textContent = 'Save'; btn.disabled = false;
  }

  // ── Build UI ──────────────────────────────────────────────────────────────
  function buildUI(container) {
    injectStyles();
    // Never touch React DOM — use overlay appended to body
    document.getElementById('age-body-overlay')?.remove();
    const _ageRect = container.getBoundingClientRect();
    const _ageOverlay = document.createElement('div');
    _ageOverlay.id = 'age-body-overlay';
    _ageOverlay.style.cssText = 'position:fixed;top:' + Math.round(_ageRect.top) + 'px;left:' + Math.round(_ageRect.left) + 'px;right:0;bottom:0;background:#0d1117;z-index:50;overflow:auto;box-sizing:border-box;padding:20px;';
    document.body.appendChild(_ageOverlay);
    _ageOverlay.innerHTML = `
      <div id="age-wrap">
        <div id="age-toolbar">
          <select id="age-provider-select">
            <option value="all">All Providers</option>
          </select>
          <input id="age-search" type="text" placeholder="Search by title or provider…" />
          <span id="age-count">—</span>
        </div>
        <div id="age-table-wrap"><div id="age-loading">Loading…</div></div>
      </div>

      <div id="age-modal-bg">
        <div id="age-modal">
          <h3 id="age-modal-title">Edit Game</h3>
          <div class="age-field">
            <label class="age-label">Title</label>
            <input id="age-m-title" class="age-input" type="text" />
          </div>
          <div class="age-row2">
            <div class="age-field">
              <label class="age-label">Provider</label>
              <input id="age-m-provider" class="age-input" type="text" />
            </div>
            <div class="age-field">
              <label class="age-label">Sort Order (higher = first)</label>
              <input id="age-m-sort" class="age-input" type="number" />
            </div>
          </div>
          <div class="age-field">
            <label class="age-label">Thumbnail URL</label>
            <input id="age-m-thumbnail" class="age-input" type="text" oninput="document.getElementById('age-m-thumb-preview').src=this.value;document.getElementById('age-m-thumb-preview').style.display=this.value?'block':'none'" />
            <img id="age-m-thumb-preview" class="age-thumb-preview" />
          </div>
          <div class="age-field">
            <label class="age-label">Launch URL</label>
            <input id="age-m-launch" class="age-input" type="text" />
          </div>
          <div class="age-row2">
            <div class="age-field">
              <label class="age-label">RTP %</label>
              <input id="age-m-rtp" class="age-input" type="number" step="0.1" />
            </div>
            <div class="age-field">
              <label class="age-label">Min Bet / Max Bet</label>
              <div style="display:flex;gap:6px">
                <input id="age-m-minbet" class="age-input" type="number" step="0.01" placeholder="Min" />
                <input id="age-m-maxbet" class="age-input" type="number" step="0.01" placeholder="Max" />
              </div>
            </div>
          </div>
          <div class="age-field">
            <label class="age-label">Categories (comma-separated: slots, featured, top, jackpot…)</label>
            <input id="age-m-categories" class="age-input" type="text" placeholder="slots, featured" />
          </div>
          <div class="age-checkbox-row">
            <input type="checkbox" id="age-m-enabled" />
            <label for="age-m-enabled">Enabled (visible on site)</label>
          </div>
          <div class="age-checkbox-row">
            <input type="checkbox" id="age-m-featured" />
            <label for="age-m-featured">Featured</label>
          </div>
          <div class="age-checkbox-row">
            <input type="checkbox" id="age-m-jackpot" />
            <label for="age-m-jackpot">Has Jackpot</label>
          </div>
          <div class="age-modal-footer">
            <button class="age-cancel-btn" id="age-m-cancel">Cancel</button>
            <button class="age-save-btn" id="age-m-save">Save Changes</button>
          </div>
        </div>
      </div>
    `;

    // Populate provider dropdown
    const sel = document.getElementById('age-provider-select');
    providers.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.provider;
      opt.textContent = `${p.provider} (${p.count})`;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => {
      currentProvider = sel.value;
      loadGames(currentProvider);
    });

    // Search
    let searchTimer;
    document.getElementById('age-search').addEventListener('input', e => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { currentSearch = e.target.value.trim(); renderTable(); }, 250);
    });

    // Modal events
    document.getElementById('age-m-cancel').addEventListener('click', closeModal);
    document.getElementById('age-m-save').addEventListener('click', saveModal);
    document.getElementById('age-modal-bg').addEventListener('click', e => {
      if (e.target === document.getElementById('age-modal-bg')) closeModal();
    });

    // Load games
    loadGames('all');
  }

  // ── Mount via event delegation (survives React re-renders) ──────────────
  let buildTimeout = null;

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const nav = document.querySelector('aside nav');
    if (!nav || !nav.contains(btn)) return;

    const label = btn.textContent.trim();

    if (label !== 'Games') {
      // Navigating away — cancel pending build, remove all overlays
      if (buildTimeout) { clearTimeout(buildTimeout); buildTimeout = null; }
      document.getElementById('age-body-overlay')?.remove();
      // Also remove support overlay if navigating away
      if (label !== 'Support') {
        document.getElementById('as-body-overlay')?.remove();
      }
      return; // React renders its page normally
    }
    // Navigating TO Games — remove support overlay if open
    document.getElementById('as-body-overlay')?.remove();

    // It is the admin Games nav button
    if (buildTimeout) clearTimeout(buildTimeout);
    buildTimeout = setTimeout(async () => {
      buildTimeout = null;
      const main = document.querySelector('[class*=ml-60] main') ||
                   document.querySelector('main.flex-1') ||
                   document.querySelector('main');
      if (!main) return;
      await loadProviders();
      buildUI(main);
    }, 80);
  }, true); // capture — runs before React
})();
