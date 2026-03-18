// category-rows.js — Cryptora homepage category layout v2
(function () {
  if (location.pathname.startsWith('/admin')) return;
  'use strict';

  // Patch: prevent React removeChild/insertBefore crash when we manipulate DOM
  if (!window._crDomPatched) {
    window._crDomPatched = true;
    const origRemove = Node.prototype.removeChild;
    Node.prototype.removeChild = function(child) {
      if (child && child.parentNode !== this) return child;
      try { return origRemove.call(this, child); } catch(e) {
        if (e.name === 'NotFoundError') return child; throw e;
      }
    };
    const origInsert = Node.prototype.insertBefore;
    Node.prototype.insertBefore = function(node, ref) {
      if (ref && ref.parentNode !== this) return node;
      try { return origInsert.call(this, node, ref); } catch(e) {
        if (e.name === 'NotFoundError' || e.name === 'HierarchyRequestError') return node; throw e;
      }
    };
  }

  function crAuthHeaders() {
    try { var t = localStorage.getItem('auth_token'); return t ? { 'Authorization': 'Bearer ' + t } : {}; } catch(e) { return {}; }
  }
    const API_BASE = '/api/games';
  const SCROLL_AMT = 320;
  const PAGE_SIZE = 21;

  function getToken() {
    try { return localStorage.getItem('casino_token') || sessionStorage.getItem('casino_token') || ''; } catch { return ''; }
  }
  function getUserId() {
    try {
      const t = getToken();
      if (!t) return null;
      const p = JSON.parse(atob(t.split('.')[1]));
      return p.id || null;
    } catch { return null; }
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('cr-cat-styles')) return;
    const s = document.createElement('style');
    s.id = 'cr-cat-styles';
    s.textContent = `
      #cr-categories { padding: 0 0 32px 0; }
      .cr-section { margin-bottom: 28px; }
      .cr-section-header { display:flex; align-items:center; justify-content:space-between; padding:0 16px; margin-bottom:10px; }
      .cr-section-title { font-size:18px; font-weight:700; color:#fff; display:flex; align-items:center; gap:8px; }
      .cr-see-all { font-size:13px; color:#888; cursor:pointer; transition:color .2s; }
      .cr-see-all:hover { color:#f0c040; }
      .cr-scroll-wrap { position:relative; overflow:hidden; }
      .cr-row {
        display:flex; gap:10px;
        overflow-x:auto; padding:4px 16px 8px;
        scroll-behavior:smooth; -webkit-overflow-scrolling:touch;
        scrollbar-width:thin; scrollbar-color:#252b45 transparent;
      }
      .cr-row::-webkit-scrollbar { height:4px; }
      .cr-row::-webkit-scrollbar-track { background:transparent; }
      .cr-row::-webkit-scrollbar-thumb { background:#252b45; border-radius:2px; }
      .cr-arrow {
        position:absolute; top:50%; transform:translateY(-50%);
        width:36px; height:64px;
        background:rgba(10,14,26,.9); border:1px solid #353d5a; border-radius:8px;
        color:#fff; font-size:22px; display:flex; align-items:center; justify-content:center;
        cursor:pointer; z-index:20; opacity:0.5; transition:opacity .15s;
        user-select:none; pointer-events:all;
      }
      .cr-scroll-wrap:hover .cr-arrow { opacity:1; }
      .cr-arrow.left  { left:2px; }
      .cr-arrow.right { right:2px; }
      .cr-arrow:hover { background:rgba(240,192,64,.2); border-color:#f0c040; opacity:1; }
      @media(max-width:768px) { .cr-arrow { opacity:0.7; width:28px; height:48px; font-size:18px; } }
      .cr-card {
        flex:0 0 150px; width:150px; border-radius:12px; overflow:hidden;
        background:#141829; border:1px solid #252b45;
        cursor:pointer; transition:all .25s; position:relative;
      }
      @media(max-width:600px){ .cr-card{flex:0 0 120px;width:120px;} }
      .cr-card:hover { border-color:rgba(240,192,64,.4); transform:translateY(-3px); box-shadow:0 8px 20px rgba(240,192,64,.08); }
      .cr-card img { width:100%; aspect-ratio:216/288; object-fit:cover; display:block; }
      .cr-card-body { padding:6px 8px 8px; }
      .cr-card-title { font-size:11px; font-weight:600; color:#ccc; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .cr-card-prov  { font-size:10px; color:#555; margin-top:1px; }
      .cr-jackpot-badge {
        position:absolute; top:6px; left:6px;
        background:#f0c040; color:#0a0e1a;
        font-size:9px; font-weight:700; border-radius:4px; padding:1px 5px;
      }
      /* Filtered flat grid */
      #cr-filtered { padding: 0 16px 32px; }
      #cr-filtered-title { font-size:18px; font-weight:700; color:#fff; margin-bottom:14px; display:flex; align-items:center; gap:8px; }
      #cr-filtered-grid {
        display:grid;
        grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
        gap:10px;
      }
      #cr-filtered-grid .cr-card { width:100%; flex:none; aspect-ratio:3/4; }
      /* Load more button */
      #cr-load-more {
        display:block; margin:24px auto 0;
        padding:12px 40px;
        background:transparent; border:1px solid #f0c040;
        color:#f0c040; font-size:14px; font-weight:600;
        border-radius:12px; cursor:pointer;
        transition:all .2s;
      }
      #cr-load-more:hover { background:rgba(240,192,64,.12); }
      #cr-load-more:disabled { opacity:0.5; cursor:default; }
    `;
    document.head.appendChild(s);
  }

  // ── Card ──────────────────────────────────────────────────────────────────
  function makeCard(game) {
    const card = document.createElement('a');
    card.className = 'cr-card';
    card.href = '/GamePlay?id=' + encodeURIComponent(game.id);
    card.style.textDecoration = 'none';
    const img = document.createElement('img');
    img.alt = game.title || '';
    img.loading = 'lazy';
    // Gradient placeholder with game name
    img.onerror = function () {
      const title = game.title || '';
      const provider = game.provider || '';
      const colors = [
        ['%231a1a2e','%2316213e'],
        ['%230d1b2a','%231b2838'],
        ['%231a0a2e','%232d1b69'],
        ['%230a1628','%23132743'],
        ['%231e0a0a','%23400a0a'],
        ['%230a1e0a','%230a400a'],
      ];
      const hash = (title + provider).split('').reduce((a,c) => a + c.charCodeAt(0), 0);
      const [c1, c2] = colors[hash % colors.length];
      const lines = [];
      const words = title.split(' ');
      let line = '', lineCount = 0;
      words.forEach(w => {
        if ((line + ' ' + w).trim().length > 12 && line.length > 0) {
          lines.push(line.trim()); line = w; lineCount++;
        } else { line = (line + ' ' + w).trim(); }
        if (lineCount > 2) return;
      });
      if (line) lines.push(line.trim());
      const textY = lines.length === 1 ? 52 : lines.length === 2 ? 46 : 40;
      const textLines = lines.slice(0,3).map((l,i) =>
        `<text x="50" y="${textY + i*14}" text-anchor="middle" fill="%23c8d4e3" font-size="11" font-family="sans-serif" font-weight="600">${l.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</text>`
      ).join('');
      const provText = provider.length > 0 ? `<text x="50" y="80" text-anchor="middle" fill="%23556677" font-size="9" font-family="sans-serif">${provider.replace(/&/g,'&amp;')}</text>` : '';
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="133"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="100" height="133" fill="url(%23g)"/><rect x="8" y="8" width="84" height="84" rx="8" fill="%23ffffff08"/><text x="50" y="38" text-anchor="middle" font-size="22">🎮</text>${textLines}${provText}</svg>`;
      this.src = 'data:image/svg+xml,' + svg;
      this.style.objectFit = 'cover';
      this.onerror = null;
    };
    // Set src AFTER onerror is registered
    if (game.thumbnail) {
      img.src = game.thumbnail;
      // Fallback for broken URLs that don't fire onerror (cross-origin, lazy)
      setTimeout(function() {
        if (!img.complete || img.naturalWidth === 0) {
          img.onerror && img.onerror.call(img);
        }
      }, 2500);
    } else {
      // No thumbnail — apply placeholder immediately
      img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      setTimeout(function() { img.onerror && img.onerror.call(img); }, 50);
    }
    const body = document.createElement('div');
    body.className = 'cr-card-body';
    const title = document.createElement('div');
    title.className = 'cr-card-title';
    title.textContent = game.title || '';
    const prov = document.createElement('div');
    prov.className = 'cr-card-prov';
    prov.textContent = game.provider || '';
    body.appendChild(title);
    body.appendChild(prov);
    card.appendChild(img);
    card.appendChild(body);
    if (game.has_jackpot) {
      const b = document.createElement('div');
      b.className = 'cr-jackpot-badge';
      b.textContent = 'JP';
      card.appendChild(b);
    }
    return card;
  }

  // ── Category row ──────────────────────────────────────────────────────────
  const CAT_ICONS = { last_played:'🕐', jackpot:'🏆', top:'🔥', featured:'⭐', new:'🆕', slots:'🎲', crash:'💥', megaways:'⚡', bonus_buy:'💎', table:'🎰',  'provider:Pragmatic Play RGS': '🔴',
  'provider:NetEnt RGS': '🟢',
  'provider:EGT RGS': '🟡',
  'provider:Novomatic RGS': '🔵',
  'provider:Amatic RGS': '🟠',
  'provider:Quickspin RGS': '⚡',
  'provider:Merkur RGS': '💎',
};

  function makeRow(cat) {
    const section = document.createElement('div');
    section.className = 'cr-section';
    const header = document.createElement('div');
    header.className = 'cr-section-header';
    const titleEl = document.createElement('div');
    titleEl.className = 'cr-section-title';
    titleEl.innerHTML = `<span>${CAT_ICONS[cat.key] || '🎮'}</span><span>${cat.label}</span>`;
    const seeAll = document.createElement('span');
    seeAll.className = 'cr-see-all';
    seeAll.textContent = 'See all →';
    seeAll.addEventListener('click', () => {
      if (cat.key.startsWith('provider:')) {
        showFiltered(cat.label, { provider: cat.label });
      } else {
        showFiltered(cat.label, { category: cat.key });
      }
    });
    header.appendChild(titleEl);
    header.appendChild(seeAll);
    const wrap = document.createElement('div');
    wrap.className = 'cr-scroll-wrap';
    const row = document.createElement('div');
    row.className = 'cr-row';
    const btnL = document.createElement('div');
    btnL.className = 'cr-arrow left';
    btnL.innerHTML = '&#8249;';
    btnL.addEventListener('click', () => { row.scrollLeft -= SCROLL_AMT; });
    const btnR = document.createElement('div');
    btnR.className = 'cr-arrow right';
    btnR.innerHTML = '&#8250;';
    btnR.addEventListener('click', () => { row.scrollLeft += SCROLL_AMT; });
    cat.games.forEach(g => row.appendChild(makeCard(g)));
    wrap.appendChild(btnL);
    wrap.appendChild(row);
    wrap.appendChild(btnR);
    section.appendChild(header);
    section.appendChild(wrap);
    return section;
  }

  // ── State ─────────────────────────────────────────────────────────────────
  let categoriesData = null;
  let hiddenTarget = null;
  let crContainer = null;

  // ── Show category view ────────────────────────────────────────────────────

  function insertOutsideReact(el, anchor) {
    // Insert adjacent to hiddenTarget — removeChild patch prevents React crash
    if (anchor && anchor.parentElement) {
      anchor.parentElement.insertBefore(el, anchor);
    } else {
      document.body.appendChild(el);
    }
  }

  async function showCategories() {
    const existing = document.getElementById('cr-filtered');
    if (existing) existing.remove();

    if (crContainer) {
      crContainer.style.display = '';
      return;
    }

    const userId = getUserId();
    const url = userId ? `${API_BASE}/by-category?userId=${userId}` : `${API_BASE}/by-category`;
    let categories;
    try {
      const r = await fetch(url, { headers: crAuthHeaders() });
      categories = await r.json();
      categoriesData = categories;
    } catch { if (hiddenTarget) hiddenTarget.style.visibility = 'visible'; return; }

    if (!Array.isArray(categories) || !categories.length) { if (hiddenTarget) hiddenTarget.style.visibility = 'visible'; return; }

    const wrapper = document.createElement('div');
    wrapper.id = 'cr-categories';
    categories.forEach(cat => {
      if (cat.games && cat.games.length > 0) wrapper.appendChild(makeRow(cat));
    });

    crContainer = wrapper;
    if (hiddenTarget) {
      hiddenTarget.style.display = 'none';
      insertOutsideReact(wrapper, hiddenTarget);
    }
  }

  // ── Show filtered view with pagination ────────────────────────────────────
  async function showFiltered(label, params) {
    // Hide category rows
    if (crContainer) crContainer.style.display = 'none';
    // Only hide React grid for category filters (slots, featured etc)
    // Provider filters: React handles OGS providers itself
    const isProviderOnly = params && params.provider && !params.category;
    if (!isProviderOnly) {
      const _rgsGridEl = hiddenTarget || window._reactGridEl || (findGameGrid() && (findGameGrid().parentElement || findGameGrid()));
      if (_rgsGridEl) { _rgsGridEl.style.display = 'none'; if (!hiddenTarget) hiddenTarget = _rgsGridEl; }
    }

    // Remove existing filtered view
    const existing = document.getElementById('cr-filtered');
    if (existing) existing.remove();

    // Build container
    const wrap = document.createElement('div');
    wrap.id = 'cr-filtered';

    const titleEl = document.createElement('div');
    titleEl.id = 'cr-filtered-title';
    titleEl.textContent = label + ' (loading…)';

    const grid = document.createElement('div');
    grid.id = 'cr-filtered-grid';

    const loadMoreBtn = document.createElement('button');
    loadMoreBtn.id = 'cr-load-more';
    loadMoreBtn.textContent = 'Load more';
    loadMoreBtn.style.display = 'none';

    wrap.appendChild(titleEl);
    wrap.appendChild(grid);
    wrap.appendChild(loadMoreBtn);

    if (hiddenTarget) {
      insertOutsideReact(wrap, hiddenTarget);
    } else {
      // Fallback: find game grid and insert before it
      const gGrid = window._reactGridEl || findGameGrid();
      const gParent = gGrid && (gGrid.parentElement || gGrid);
      if (gParent) {
        gParent.style.display = 'none';
        hiddenTarget = gParent;
        insertOutsideReact(wrap, gParent);
      } else {
        // Last resort: append to body after game section
        document.body.appendChild(wrap);
      }
    }

    // Pagination state
    let offset = 0;
    let totalLoaded = 0;
    let isLoading = false;

    async function loadPage() {
      if (isLoading) return;
      isLoading = true;
      loadMoreBtn.disabled = true;
      loadMoreBtn.textContent = 'Loading…';

      let games;
      try {
        const qs = new URLSearchParams({ ...params, limit: PAGE_SIZE, offset });
        const r = await fetch(`${API_BASE}/list?${qs}`, { headers: crAuthHeaders() });
        games = await r.json();
      } catch {
        loadMoreBtn.disabled = false;
        loadMoreBtn.textContent = 'Load more';
        isLoading = false;
        return;
      }

      if (!Array.isArray(games)) { isLoading = false; return; }

      games.forEach(g => grid.appendChild(makeCard(g)));
      offset += games.length;
      totalLoaded += games.length;

      // Update title with count so far
      titleEl.textContent = label + ` (${totalLoaded})`;

      // Show/hide load more
      if (games.length < PAGE_SIZE) {
        // Got fewer than PAGE_SIZE — full list loaded
        loadMoreBtn.style.display = 'none';
      } else {
        loadMoreBtn.style.display = 'block';
        loadMoreBtn.disabled = false;
        loadMoreBtn.textContent = 'Load more';
      }

      isLoading = false;
    }

    loadMoreBtn.addEventListener('click', loadPage);

    // Load first page
    await loadPage();
  }

  // ── Map React tab text → filter params ───────────────────────────────────
  const CAT_TAB_MAP = {
    'All Games': null,            // show category rows
    'Popular':   { category: 'featured' },
    'New':       { category: 'new' },
    'Slots':     { category: 'slots' },
    'Crash Game':{ category: 'crash' },
    'Crash':     { category: 'crash' },
    'Megaways':  { category: 'megaways' },
    'Table':     { category: 'table' },
  };

  // ── Intercept tab clicks ──────────────────────────────────────────────────
  function attachTabListeners() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.hasAttribute('data-rgs-injected')) return; // RGS buttons handle themselves

      const text = btn.textContent.trim();

      // Provider tabs
      if (text === 'All Providers') {
        showCategories();
        return;
      }
      // Any non-RGS provider click: remove cr-filtered, show React grid
      const allProvBtn2 = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'All Providers');
      if (allProvBtn2 && btn.parentElement === allProvBtn2.parentElement) {
        // Provider tab clicked — remove our overlays, let React handle
        const crF = document.getElementById('cr-filtered'); if (crF) crF.remove();
        const crC = document.getElementById('cr-categories'); if (crC) crC.style.display = 'none';
        if (hiddenTarget) { hiddenTarget.style.display = ''; }
      }
      // Dynamic provider detection: any button in the same row as 'All Providers'
      const allProvBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'All Providers');
      if (allProvBtn && btn.parentElement === allProvBtn.parentElement) {
        showFiltered(text, { provider: text });
        return;
      }

      // Category tabs
      if (text in CAT_TAB_MAP) {
        const params = CAT_TAB_MAP[text];
        if (params === null) {
          showCategories();
        } else {
          showFiltered(text, params);
        }
        return;
      }

      // Search box — let React handle, but restore grid if category rows are hidden
    }, true); // capture phase so we run first
  }

  // ── Search ───────────────────────────────────────────────────────────────
  let searchTimer = null;
  let currentSearch = '';

  function attachSearchListener() {
    // Use event delegation — survives React re-mounts
    document.addEventListener('input', (e) => {
      const inp = e.target;
      if (!inp || inp.placeholder !== 'Search games...') return;
      const q = inp.value.trim();
      if (q === currentSearch) return;
      currentSearch = q;
      clearTimeout(searchTimer);

      if (!q) {
        showCategories();
        return;
      }
      searchTimer = setTimeout(() => {
        showFiltered('' + q + ' results', { search: q });
      }, 350);
    }, true); // capture phase
  }

  // ── Find and hide React game grid ─────────────────────────────────────────
  function findGameGrid() {
    const grids = document.querySelectorAll('[class]');
    return Array.from(grids).find(el =>
      el.className && typeof el.className === 'string' &&
      el.className.includes('grid-cols') &&
      el.querySelectorAll('img').length > 3
    );
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    injectStyles();
    const path = window.location.pathname;
    const HOME_PATHS = ['/', '/Home', '/home'];
    const isHome = HOME_PATHS.includes(path) || path === '/';
    if (!isHome) return;

    attachTabListeners();
    attachSearchListener();

    const grid = findGameGrid();
    if (grid) {
      hiddenTarget = grid.parentElement || grid;
      hiddenTarget.style.visibility = "hidden"; // hide immediately to prevent flash
      showCategories();
      return;
    }

    const obs = new MutationObserver(() => {
      const g = findGameGrid();
      if (g) {
        obs.disconnect();
        hiddenTarget = g.parentElement || g;
        hiddenTarget.style.visibility = "hidden"; // hide immediately to prevent flash
        showCategories();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 15000);
  }

  // SPA navigation
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      crContainer = null;
      hiddenTarget = null;
      categoriesData = null;
      currentSearch = '';
      const old = document.getElementById('cr-categories');
      if (old) old.remove();
      const oldF = document.getElementById('cr-filtered');
      if (oldF) oldF.remove();
      setTimeout(init, 500);
    }
  }, 300);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ── Inject RGS provider buttons after React renders provider bar ────────
  const RGS_PROVIDERS = [
    'Pragmatic Play RGS', 'NetEnt RGS', 'EGT RGS', 'Novomatic RGS',
    'Amatic RGS', 'Quickspin RGS', 'Merkur RGS', 'EGT Digital RGS'
  ];

  function injectRgsProviders() {
    const allProvBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'All Providers');
    if (!allProvBtn) return;
    const container = allProvBtn.parentElement;
    if (!container || container.querySelector('[data-rgs-injected]')) return;

    // Add separator
    const sep = document.createElement('span');
    sep.setAttribute('data-rgs-injected', '1');
    sep.style.cssText = 'display:inline-flex;align-items:center;color:#334155;margin:0 4px;font-size:11px;font-weight:600;letter-spacing:.05em;white-space:nowrap;padding:0 4px';
    sep.textContent = '· RGS ·';
    container.appendChild(sep);

    RGS_PROVIDERS.forEach(prov => {
      const btn = document.createElement('button');
      btn.setAttribute('data-rgs-injected', '1');
      btn.textContent = prov;
      // Copy styles from an existing provider button
      const ref = Array.from(container.querySelectorAll('button')).find(b => b.textContent.trim() !== 'All Providers');
      if (ref) {
        btn.className = ref.className;
        btn.style.cssText = ref.style.cssText;
      }
      btn.addEventListener('click', function() {
        // Remove active from all
        container.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        showFiltered(prov, { provider: prov });
      });
      container.appendChild(btn);
    });
  }

  // Run after React renders, keep watching for re-renders
  setTimeout(injectRgsProviders, 1200);
  setTimeout(injectRgsProviders, 3000);
  const _rgsObs = new MutationObserver(function() {
    const allProvBtn = document.querySelector('button');
    if (allProvBtn) {
      const c = Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='All Providers');
      if (c && !c.parentElement.querySelector('[data-rgs-injected]')) injectRgsProviders();
    }
  });
  _rgsObs.observe(document.body, { childList: true, subtree: true });


  // Expose for external scripts
  window._crShowFiltered = showFiltered;
  // Expose hiddenTarget ref for external cleanup
  Object.defineProperty(window, '_crHiddenTarget', { get: function() { return hiddenTarget; }, set: function(v) { hiddenTarget = v; } });
  document.addEventListener('cr:showFiltered', function(e) {
    if (e.detail) showFiltered(e.detail.label, e.detail.params);
  });
})();
