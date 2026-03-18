
// ── Helper: hide/show React game grid from outside IIFE ─────────────────────
(function() {
  function findReactGrid() {
    // Look for the game grid by known patterns
    var selectors = [
      '[class*="GameGrid"]', '[class*="game-grid"]', '[class*="games-grid"]',
      '[class*="GamesList"]', '[class*="games-list"]',
    ];
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el) return el.parentElement || el;
    }
    // Fallback: find by "Showing X of Y games" text
    var all = document.querySelectorAll('*');
    for (var j = 0; j < all.length; j++) {
      var t = all[j];
      if (t.children.length === 0 && t.textContent && /Showing \d+ of \d+ games/.test(t.textContent)) {
        // Walk up to find a suitable container
        var p = t.parentElement;
        for (var k = 0; k < 5 && p; k++) {
          if (p.querySelectorAll('img').length > 3) return p;
          p = p.parentElement;
        }
      }
    }
    return null;
  }

  window._hideReactGrid = function() {
    var el = findReactGrid();
    if (el) { el.style.display = 'none'; window._reactGridEl = el; }
  };
  window._showReactGrid = function() {
    if (window._reactGridEl) window._reactGridEl.style.display = '';
  };
})();

/* game-card-placeholder.js — v1 */
/* Applies gradient placeholder to ALL broken game card images site-wide */
(function() {
  if (window.location.pathname.indexOf('/admin') === 0) return;

  var COLORS = [
    ['#1a1a2e','#16213e'], ['#0d1b2a','#1b2838'], ['#1a0a2e','#2d1b69'],
    ['#0a1628','#132743'], ['#1e0a0a','#400a0a'], ['#0a1a0a','#0a3a0a'],
    ['#1a150a','#3a2a0a'], ['#0a1a1a','#0a3a3a'],
  ];

  function getColors(text) {
    var hash = 0;
    for (var i = 0; i < text.length; i++) hash = (hash + text.charCodeAt(i)) & 0xff;
    return COLORS[hash % COLORS.length];
  }

  function makeSVG(title, provider) {
    var c = getColors((title||'') + (provider||''));
    var words = (title||'Game').split(' ');
    var lines = []; var line = '';
    words.forEach(function(w) {
      if ((line + ' ' + w).trim().length > 13 && line.length > 0) {
        lines.push(line.trim()); line = w;
      } else { line = (line + ' ' + w).trim(); }
    });
    if (line) lines.push(line.trim());
    lines = lines.slice(0, 3);
    var cy = lines.length === 1 ? 52 : lines.length === 2 ? 46 : 40;
    var enc = encodeURIComponent;
    var textLines = lines.map(function(l, i) {
      var esc = l.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      return '<text x="50" y="' + (cy + i*14) + '" text-anchor="middle" fill="#b8c8d8" font-size="10" font-family="sans-serif" font-weight="600">' + esc + '</text>';
    }).join('');
    var provLine = (provider && provider.length > 0)
      ? '<text x="50" y="82" text-anchor="middle" fill="#445566" font-size="8.5" font-family="sans-serif">' + provider.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</text>'
      : '';
    var svgStr = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="133">'
      + '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
      + '<stop offset="0" stop-color="' + c[0] + '"/><stop offset="1" stop-color="' + c[1] + '"/>'
      + '</linearGradient></defs>'
      + '<rect width="100" height="133" fill="url(#g)"/>'
      + '<rect x="10" y="10" width="80" height="80" rx="10" fill="rgba(255,255,255,0.05)"/>'
      + textLines + provLine
      + '</svg>';
    return 'data:image/svg+xml,' + enc(svgStr);
  }

  function patchImage(img) {
    if (img._phApplied) return;
    if (img.naturalWidth > 0 && img.complete) return;
    img._phApplied = true;
    var card = (img.closest && img.closest('[class*="card"],[class*="Card"],[class*="game"],[class*="Game"]')) || img.parentElement;
    var title = img.alt || '', provider = '';
    if (card) {
      var titleEl = card.querySelector('[class*="title"],[class*="Title"],[class*="name"],[class*="Name"]');
      var provEl  = card.querySelector('[class*="provider"],[class*="Provider"],[class*="prov"]');
      if (titleEl && titleEl.textContent) title = titleEl.textContent.trim();
      if (provEl  && provEl.textContent)  provider = provEl.textContent.trim();
    }
    img.src = makeSVG(title, provider);
    img.style.objectFit = 'cover';
  }

  function scanImages() {
    document.querySelectorAll('img').forEach(function(img) {
      if (!img.src || img._phApplied) return;
      if (img.src.startsWith('data:') || img.src.indexOf('logo') >= 0 || img.src.indexOf('banner') >= 0) return;
      if (!img.complete || img.naturalWidth === 0) patchImage(img);
    });
  }

  setTimeout(scanImages, 1500);
  setTimeout(scanImages, 3500);
  setTimeout(scanImages, 7000);

  var obs = new MutationObserver(function(muts) {
    var found = [];
    muts.forEach(function(m) {
      m.addedNodes.forEach(function(n) {
        if (n.tagName === 'IMG') found.push(n);
        else if (n.querySelectorAll) n.querySelectorAll('img').forEach(function(i){found.push(i);});
      });
    });
    if (found.length) setTimeout(function() {
      found.forEach(function(img) {
        if (!img._phApplied && (!img.complete || img.naturalWidth === 0)) patchImage(img);
      });
    }, 1500);
  });
  if (document.body) obs.observe(document.body, {childList:true, subtree:true});
  else document.addEventListener('DOMContentLoaded', function(){obs.observe(document.body,{childList:true,subtree:true});});
})();


// ── Inject RGS provider buttons + direct React grid filter ─────────────────────
(function() {
  var RGS_PROVIDERS = [
    'Pragmatic Play RGS', 'NetEnt RGS', 'EGT RGS', 'Novomatic RGS',
    'Amatic RGS', 'Quickspin RGS', 'Merkur RGS', 'EGT Digital RGS'
  ];
  var ALL_RGS = new Set(RGS_PROVIDERS);
  var activeRgsFilter = null;

  // Find game cards in React grid
  function findGameCards() {
    // Each card typically has a provider label as the last text child
    var candidates = document.querySelectorAll('[class*="grid"] > *, [class*="GameGrid"] > *, [class*="games"] > *');
    if (!candidates.length) {
      // Fallback: find elements that contain provider text
      candidates = document.querySelectorAll('a[href*="game"], div[class*="game"]');
    }
    return candidates;
  }

  function getCardProvider(card) {
    // Look for provider text in small elements
    var smalls = card.querySelectorAll('p, span, div');
    for (var i = 0; i < smalls.length; i++) {
      var t = smalls[i].textContent.trim();
      if (t.length > 3 && t.length < 60 && !t.match(/^\d/) && smalls[i].children.length === 0) {
        return t;
      }
    }
    return '';
  }

  function applyRgsFilter(prov) {
    activeRgsFilter = prov;
    // Remove previous style tag
    var styleId = 'rgs-active-filter';
    var existing = document.getElementById(styleId);
    if (existing) existing.remove();
    if (!prov) return;

    // Tag and filter cards
    var cards = findGameCards();
    var shown = 0;
    cards.forEach(function(card) {
      var cardProv = getCardProvider(card);
      card.setAttribute('data-rgs-prov', cardProv || 'unknown');
      if (cardProv === prov) {
        // Show: override React inline display:none
        card.style.setProperty('display', 'block', 'important');
        card.style.removeProperty('visibility');
        shown++;
      } else {
        // Hide
        card.style.setProperty('display', 'none', 'important');
      }
    });

    // Fix grid container height after hiding cards
    setTimeout(function() {
      var grid = document.querySelector('[class*=grid]:not([class*=grid-cols-1])');
      // Find the right grid (the game grid, not nav/buttons)
      var grids = document.querySelectorAll('[class*=grid]');
      var gameGrid = null;
      grids.forEach(function(g) { if(g.children.length > 10) gameGrid = g; });
      if (gameGrid) {
        // Count visible children
        var visible = 0;
        Array.from(gameGrid.children).forEach(function(c) {
          if (window.getComputedStyle(c).display !== 'none') visible++;
        });
        // Set container heights to fit visible content only
        var colCount = window.innerWidth < 640 ? 2 : window.innerWidth < 1024 ? 3 : 4;
        var rows = Math.ceil(visible / colCount);
        var cardH = 350; // approximate card height px
        var newH = (rows * cardH + 40) + 'px';
        gameGrid.style.maxHeight = newH;
        // Also constrain parent containers
        var p = gameGrid.parentElement;
        for (var i=0; i<4 && p; i++) {
          p.style.maxHeight = (parseInt(newH) + 100) + 'px';
          p.style.overflow = 'hidden';
          p = p.parentElement;
        }
      }
    }, 300);

    // Watch for React re-renders and reapply
    if (window._rgsFilterObs) window._rgsFilterObs.disconnect();
    window._rgsFilterObs = new MutationObserver(function() {
      if (activeRgsFilter) {
        document.querySelectorAll('[data-rgs-prov]').forEach(function(card) {
          var p = card.getAttribute('data-rgs-prov');
          if (p === activeRgsFilter) {
            card.style.setProperty('display', 'block', 'important');
          } else {
            card.style.setProperty('display', 'none', 'important');
          }
        });
      }
    });
    var grid = document.querySelector('[class*="grid"]');
    if (grid) window._rgsFilterObs.observe(grid, {attributes: true, subtree: true, attributeFilter: ['style']});
  }

  function clearRgsFilter() {
    activeRgsFilter = null;
    if (window._rgsFilterObs) { window._rgsFilterObs.disconnect(); window._rgsFilterObs = null; }
    var style = document.getElementById('rgs-active-filter');
    if (style) style.remove();
    document.querySelectorAll('[data-rgs-prov]').forEach(function(el) {
      el.style.removeProperty('display');
      el.removeAttribute('data-rgs-prov');
    });
    // Restore grid heights
    var grids = document.querySelectorAll('[class*=grid]');
    grids.forEach(function(g) {
      g.style.removeProperty('max-height');
      var p = g.parentElement;
      for (var i=0; i<4 && p; i++) {
        p.style.removeProperty('max-height');
        p.style.removeProperty('overflow');
        p = p.parentElement;
      }
    });
  }

  function injectRgs() {
    var allProvBtn = null;
    var buttons = document.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      if (buttons[i].textContent.trim() === 'All Providers') {
        allProvBtn = buttons[i];
        break;
      }
    }
    if (!allProvBtn) return false;
    var container = allProvBtn.parentElement;
    if (!container) return false;
    if (container.querySelector('[data-rgs-injected]')) return true;

    // Separator
    var sep = document.createElement('span');
    sep.setAttribute('data-rgs-injected', '1');
    sep.style.cssText = 'display:inline-flex;align-items:center;color:#475569;font-size:11px;font-weight:700;padding:0 6px;white-space:nowrap;user-select:none;pointer-events:none';
    sep.textContent = '|';
    container.appendChild(sep);

    // Get ref button for styling
    var refBtn = null;
    var existingBtns = container.querySelectorAll('button');
    for (var j = 0; j < existingBtns.length; j++) {
      if (existingBtns[j].textContent.trim() !== 'All Providers') {
        refBtn = existingBtns[j];
        break;
      }
    }

    RGS_PROVIDERS.forEach(function(prov) {
      var btn = document.createElement('button');
      btn.setAttribute('data-rgs-injected', '1');
      btn.textContent = prov;
      if (refBtn) btn.className = refBtn.className;
      btn.style.cursor = 'pointer';
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        // Remove active from all React buttons
        container.querySelectorAll('button').forEach(function(b) {
          b.classList.remove('active');
          // React uses data attributes too
        });
        // Remove active from all RGS buttons
        container.querySelectorAll('[data-rgs-injected]').forEach(function(b) {
          b.classList && b.classList.remove('active');
        });
        btn.classList.add('active');
        // Small delay to let React load cards first
        setTimeout(function() { applyRgsFilter(prov); }, 400);
      });
      container.appendChild(btn);
    });

    // When All Providers or any non-RGS button clicked: clear RGS filter + remove cr-filtered
    container.querySelectorAll('button:not([data-rgs-injected])').forEach(function(b) {
      b.addEventListener('click', function() {
        // Remove active from all RGS buttons
        container.querySelectorAll('[data-rgs-injected]').forEach(function(rb) {
          rb.classList && rb.classList.remove('active');
        });
        // Clear RGS card filter
        clearRgsFilter();
        // Remove our cr-filtered div (left over from category filtering)
        var crFiltered = document.getElementById('cr-filtered');
        if (crFiltered) crFiltered.remove();
        // Remove cr-categories too
        var crCats = document.getElementById('cr-categories');
        if (crCats) crCats.remove();
        // Show React grid back
        if (window._reactGridEl) {
          window._reactGridEl.style.display = '';
        }
        // Show hiddenTarget back
        if (window._crHiddenTarget) {
          window._crHiddenTarget.style.display = '';
        }
      });
    });

    return true;
  }

  // Re-apply filter when React re-renders cards
  var filterObs = new MutationObserver(function() {
    if (activeRgsFilter) {
      setTimeout(function() { applyRgsFilter(activeRgsFilter); }, 100);
    }
  });
  // Observe the game grid area
  setTimeout(function() {
    var grid = document.querySelector('[class*="grid"]');
    if (grid && grid.parentElement) filterObs.observe(grid.parentElement, { childList: true, subtree: false });
  }, 2000);

  var attempts = 0;
  function tryInject() {
    if (injectRgs()) return;
    attempts++;
    if (attempts < 30) setTimeout(tryInject, 500);
  }
  setTimeout(tryInject, 800);

  // Re-inject after SPA navigation (React router)
  var lastUrl = location.href;
  setInterval(function() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      attempts = 0;
      // Remove stale injected buttons
      document.querySelectorAll('[data-rgs-injected]').forEach(function(el) { el.remove(); });
      setTimeout(tryInject, 1000);
    }
    // Also re-inject if All Providers bar is re-rendered without our buttons
    var allProv = Array.from(document.querySelectorAll('button')).find(function(b) { return b.textContent.trim() === 'All Providers'; });
    if (allProv && !allProv.parentElement.querySelector('[data-rgs-injected]')) {
      injectRgs();
    }
  }, 1000);
})();


// ── Force eager loading for RGS game card images ─────────────────────────────
(function() {
  function forceLoadImages() {
    document.querySelectorAll('img[loading="lazy"]').forEach(function(img) {
      if (img.src && img.src.includes('rgs-icons')) {
        img.loading = 'eager';
      }
    });
    // Also find cards where React uses IntersectionObserver placeholder
    // Force render by triggering scroll events
    var grid = document.querySelector('[class*="grid"]');
    if (grid) {
      // Temporarily set all images to visible
      grid.querySelectorAll('[class*="game"], [class*="card"], li, article').forEach(function(card) {
        var imgs = card.querySelectorAll('img');
        if (imgs.length === 0) {
          // Card has no img yet - React hasn't rendered it
          // Scroll it into view briefly
          card.style.visibility = 'hidden'; // don't flash
          card.scrollIntoView({behavior: 'instant'});
          card.style.visibility = '';
        }
      });
    }
  }
  setTimeout(forceLoadImages, 500);
  setTimeout(forceLoadImages, 1500);
  setTimeout(forceLoadImages, 3000);
})();

// Force React game card img containers to be visible (fix IntersectionObserver lazy)
(function() {
  var style = document.createElement('style');
  style.id = 'rgs-img-fix';
  style.textContent = '[class*=grid] > * .relative[class*=aspect] { min-height: 150px !important; } [class*=grid] > *:not([style*=position: absolute]) .relative[class*=aspect] img { visibility: visible !important; }';
  document.head.appendChild(style);
})();

// Force all RGS card images to display (React hides them with display:none until viewport)
(function() {
  var styleId = 'rgs-img-show';
  var existing = document.getElementById(styleId);
  if (existing) existing.remove();
  var style = document.createElement('style');
  style.id = styleId;
  // Override React's display:none on img elements inside active RGS cards
  style.textContent = '[data-rgs-prov] img { display: block !important; opacity: 1 !important; }';
  document.head.appendChild(style);
})();
