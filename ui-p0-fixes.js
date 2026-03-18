/**
 * Cryptora UI P0 Fixes
 * Fix 1: Mobile hamburger menu (BUG-001/025)
 * Fix 2: Balance decimal places (BUG-015)
 * Fix 3: "Play Now" CTA links to /Home (BUG-011)
 * Fix 4: Slider buttons aria-label (BUG-012)
 * Fix 5: Game list "Load More" pagination (BUG-003/042)
 */
(function () {
  'use strict';

  // Patch Node.prototype to prevent React removeChild crash
  if (!window._domSafePatched) {
    window._domSafePatched = true;
    var _rc = Node.prototype.removeChild;
    Node.prototype.removeChild = function(child) {
      if (child && child.parentNode !== this) return child;
      try { return _rc.call(this, child); } catch(e) { if (e.name === 'NotFoundError') return child; throw e; }
    };
    var _ib = Node.prototype.insertBefore;
    Node.prototype.insertBefore = function(node, ref) {
      if (ref && ref.parentNode !== this) return node;
      try { return _ib.call(this, node, ref); } catch(e) { if (e.name === 'NotFoundError' || e.name === 'HierarchyRequestError') return node; throw e; }
    };
  }

  /* ============================================================
     UTIL: run after DOM settles (debounced MutationObserver)
     ============================================================ */
  function onReady(cb) {
    if (document.readyState !== 'loading') { cb(); return; }
    document.addEventListener('DOMContentLoaded', cb, { once: true });
  }

  function watchDOM(selector, cb, rootEl) {
    var root = rootEl || document.body;
    function check() {
      var el = root.querySelector(selector);
      if (el) { cb(el); return true; }
      return false;
    }
    if (check()) return;
    var obs = new MutationObserver(function () {
      if (check()) obs.disconnect();
    });
    obs.observe(root, { childList: true, subtree: true });
    return obs;
  }

  /* ============================================================
     FIX 1: MOBILE HAMBURGER MENU
     On ≤768px: inject hamburger button, collapse nav to drawer
     ============================================================ */
  var BURGER_INJECTED = false;

  function isMobile() { return window.innerWidth <= 768; }

  function buildDrawer(navLinks) {
    var overlay = document.createElement('div');
    overlay.id = 'cr-burger-overlay';
    overlay.style.cssText = [
      'position:fixed;top:0;left:0;width:100%;height:100%;',
      'background:rgba(0,0,0,0.6);z-index:9998;',
      'opacity:0;transition:opacity 0.25s;pointer-events:none;'
    ].join('');

    var drawer = document.createElement('nav');
    drawer.id = 'cr-burger-drawer';
    drawer.setAttribute('aria-label', 'Mobile navigation');
    drawer.style.cssText = [
      'position:fixed;top:0;left:0;height:100%;width:280px;',
      'background:#0d1117;border-right:1px solid rgba(255,200,0,0.15);',
      'z-index:9999;transform:translateX(-100%);',
      'transition:transform 0.25s cubic-bezier(0.4,0,0.2,1);',
      'overflow-y:auto;padding:0;display:flex;flex-direction:column;'
    ].join('');

    // Drawer header
    var header = document.createElement('div');
    header.style.cssText = [
      'display:flex;align-items:center;justify-content:space-between;',
      'padding:16px 20px;border-bottom:1px solid rgba(255,200,0,0.1);',
      'background:#0a0e1a;'
    ].join('');
    var logo = document.createElement('span');
    logo.textContent = 'CRYPTORA';
    logo.style.cssText = 'font-family:Rajdhani,sans-serif;font-weight:700;font-size:22px;color:#FFB700;letter-spacing:2px;';
    var closeBtn = document.createElement('button');
    closeBtn.setAttribute('aria-label', 'Close menu');
    closeBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    closeBtn.style.cssText = 'background:none;border:none;color:#aaa;cursor:pointer;padding:4px;min-height:36px;min-width:36px;';
    closeBtn.onclick = closeDrawer;
    header.appendChild(logo);
    header.appendChild(closeBtn);
    drawer.appendChild(header);

    // Nav links
    var list = document.createElement('ul');
    list.style.cssText = 'list-style:none;margin:0;padding:8px 0;flex:1;';
    navLinks.forEach(function (item) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = item.href;
      a.textContent = item.text;
      a.style.cssText = [
        'display:flex;align-items:center;gap:12px;',
        'padding:14px 24px;color:#ccc;text-decoration:none;',
        'font-size:16px;font-weight:500;',
        'border-bottom:1px solid rgba(255,255,255,0.04);',
        'transition:background 0.15s,color 0.15s;'
      ].join('');
      a.onmouseenter = function () { a.style.background = 'rgba(255,183,0,0.08)'; a.style.color = '#FFB700'; };
      a.onmouseleave = function () { a.style.background = ''; a.style.color = '#ccc'; };
      a.onclick = function () { closeDrawer(); };
      // Active page highlight
      if (item.href && location.pathname === item.href) {
        a.style.color = '#FFB700';
        a.style.background = 'rgba(255,183,0,0.06)';
      }
      li.appendChild(a);
      list.appendChild(li);
    });
    drawer.appendChild(list);

    document.body.appendChild(overlay);
    document.body.appendChild(drawer);

    overlay.addEventListener('click', closeDrawer);
    return { overlay: overlay, drawer: drawer };
  }

  function openDrawer() {
    var overlay = document.getElementById('cr-burger-overlay');
    var drawer = document.getElementById('cr-burger-drawer');
    if (!overlay || !drawer) return;
    document.body.style.overflow = 'hidden';
    overlay.style.opacity = '1';
    overlay.style.pointerEvents = 'auto';
    drawer.style.transform = 'translateX(0)';
    var btn = document.getElementById('cr-burger-btn');
    if (btn) btn.setAttribute('aria-expanded', 'true');
  }

  function closeDrawer() {
    var overlay = document.getElementById('cr-burger-overlay');
    var drawer = document.getElementById('cr-burger-drawer');
    if (!overlay || !drawer) return;
    document.body.style.overflow = '';
    overlay.style.opacity = '0';
    overlay.style.pointerEvents = 'none';
    drawer.style.transform = 'translateX(-100%)';
    var btn = document.getElementById('cr-burger-btn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function collectNavLinks() {
    // Collect links from the top navigation bar
    var links = [];
    var seen = new Set();
    var navEls = document.querySelectorAll('nav a, header a, [class*="nav"] a');
    navEls.forEach(function (a) {
      var href = a.getAttribute('href') || '';
      var text = (a.textContent || '').trim();
      // Skip balance/avatar buttons and external links
      if (!text || text.length > 30 || seen.has(href) || href.startsWith('http')) return;
      if (text.match(/^\$[\d,]+/) ) return; // skip balance text
      if (text.length < 2) return;
      seen.add(href);
      links.push({ href: href, text: text });
    });
    return links;
  }

  function injectBurger() {
    if (BURGER_INJECTED) return;
    if (!isMobile()) return;

    // Find the top nav
    var header = document.querySelector('header') ||
                 document.querySelector('[class*="header"]') ||
                 document.querySelector('nav');
    if (!header) return;

    var links = collectNavLinks();
    if (links.length < 2) return; // not ready yet

    BURGER_INJECTED = true;

    // Build drawer
    buildDrawer(links);

    // Build burger button
    var btn = document.createElement('button');
    btn.id = 'cr-burger-btn';
    btn.setAttribute('aria-label', 'Open navigation menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'cr-burger-drawer');
    btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
    btn.style.cssText = [
      'display:flex;align-items:center;justify-content:center;',
      'background:none;border:none;color:#FFB700;',
      'cursor:pointer;padding:8px;min-height:44px;min-width:44px;',
      'position:fixed;top:8px;left:8px;z-index:9997;',
      'border-radius:8px;',
      'background:rgba(10,14,26,0.9);',
      'backdrop-filter:blur(8px);',
      '-webkit-backdrop-filter:blur(8px);',
    ].join('');
    btn.onclick = openDrawer;
    document.body.appendChild(btn);

    // On mobile, hide the nav links (keep balance + avatar visible)
    injectBurgerCSS();
  }

  function injectBurgerCSS() {
    if (document.getElementById('cr-burger-css')) return;
    var style = document.createElement('style');
    style.id = 'cr-burger-css';
    style.textContent = [
      /* Hide regular nav links on mobile — keep balance/avatar */
      '@media (max-width:768px){',
        /* Target nav links text items */
        'nav a:not([class*="logo"]):not([href*="/"]):not([class*="brand"]){',
          'display:none!important;',
        '}',
        /* Add left padding to the main content area to not overlap with burger btn */
        '#root > div > *:first-child header,',
        '#root > div > header,',
        'header.fixed,header.sticky{',
          'padding-left:56px!important;',
        '}',
      '}',
      /* Drawer open - disable page scroll */
      'body.cr-menu-open{overflow:hidden!important;}',
    ].join('');
    document.head.appendChild(style);
  }

  /* ============================================================
     FIX 2: BALANCE DECIMAL PLACES — $X.XXX → $X.XX
     ============================================================ */
  var balanceFix_lastText = '';

  function fixBalanceDecimals() {
    try {
      var walker = document.createTreeWalker(
        document.body, NodeFilter.SHOW_TEXT,
        { acceptNode: function(node) {
            return /\$[\d,]+\.\d{3,}/.test(node.nodeValue)
              ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          }
        }
      );
      var fixed = 0; var node;
      while ((node = walker.nextNode())) {
        var original = node.nodeValue;
        var newVal = original.replace(/\$[\d,]+\.\d{3,}/g, function(match) {
          var num = parseFloat(match.replace(/[$,]/g, ''));
          if (isNaN(num)) return match;
          return '$' + num.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
        });
        if (newVal !== original) { node.nodeValue = newVal; fixed++; }
      }
      return fixed;
    } catch(e) { return 0; }
  }


  function startBalanceWatcher() {
    // Run immediately and on any DOM changes (debounced)
    fixBalanceDecimals();
    var balanceObs = new MutationObserver(function () {
      fixBalanceDecimals();
    });
    balanceObs.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  /* ============================================================
     FIX 3: "PLAY NOW" CTA — should scroll to games, not /Home
     ============================================================ */
  function fixPlayNowCTA() {
    try {
    // Find <a href="/Home"> containing "Play Now" text
    var links = document.querySelectorAll('a[href="/Home"], a[href="/"], a[href="#"]');
    links.forEach(function (link) {
      var text = (link.textContent || link.innerText || '').trim().toLowerCase();
      if (text.includes('play now') || text.includes('play') && text.length < 15) {
        // Change to scroll to games section or navigate to /#games
        link.removeAttribute('href');
        link.setAttribute('role', 'button');
        link.style.cursor = 'pointer';
        link.onclick = function (e) {
          e.preventDefault();
          // Try to find games section and scroll to it
          var gamesSection =
            document.querySelector('[class*="game-grid"]') ||
            document.querySelector('[class*="GameGrid"]') ||
            document.querySelector('[class*="games-section"]') ||
            document.querySelector('.grid') ||
            document.querySelector('[id*="games"]') ||
            document.querySelector('[class*="slots"]');
          if (gamesSection) {
            gamesSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
          } else {
            // Fallback: scroll down past the hero
            window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
          }
        };
      }
    });

    // Also look for buttons with "Play Now" text that trigger navigation to /Home
    var buttons = document.querySelectorAll('button');
    buttons.forEach(function (btn) {
      var text = (btn.textContent || '').trim().toLowerCase();
      if (text === 'play now' || text === 'play') {
        // Check if it has a parent link to /Home
        var parent = btn.closest('a[href="/Home"]') || btn.closest('a[href="/"]');
        if (parent) {
          parent.removeAttribute('href');
          parent.onclick = function (e) {
            e.preventDefault();
            var gamesSection =
              document.querySelector('[class*="grid"]') ||
              document.querySelector('section') ;
            if (gamesSection) {
              gamesSection.scrollIntoView({ behavior: 'smooth' });
            }
          };
        }
      }
    });
  } catch(e) {}
  }


  var playCTAObs = null;
  function watchPlayNowCTA() {
    fixPlayNowCTA();
    if (playCTAObs) return;
    playCTAObs = new MutationObserver(function () { fixPlayNowCTA(); });
    playCTAObs.observe(document.body, { childList: true, subtree: true });
  }

  // Also intercept React Router navigation (SPA)
  (function patchHistoryForPlayNow() {
    var orig = history.pushState;
    history.pushState = function () {
      orig.apply(this, arguments);
      setTimeout(watchPlayNowCTA, 300);
    };
    var origR = history.replaceState;
    history.replaceState = function () {
      origR.apply(this, arguments);
      setTimeout(watchPlayNowCTA, 300);
    };
    window.addEventListener('popstate', function () {
      setTimeout(watchPlayNowCTA, 300);
    });
  })();

  /* ============================================================
     FIX 4: SLIDER BUTTONS ARIA-LABEL
     ============================================================ */
  function fixSliderAriaLabels() {
    try {
    // Find buttons with no text and no aria-label in slider/carousel contexts
    var buttons = document.querySelectorAll('button:not([aria-label])');
    var prevLabels = ['previous', 'prev', '<', '‹', '←', 'left'];
    var nextLabels = ['next', '>', '›', '→', 'right'];
    var idx = 0;

    buttons.forEach(function (btn) {
      var text = (btn.textContent || btn.innerText || '').trim();
      var hasText = text.length > 0;
      var hasSVG = btn.querySelector('svg');
      var hasImg = btn.querySelector('img');

      // Check if it's a slider navigation button (empty or has chevron svg)
      var parent = btn.closest('[class*="relative"]') ||
                   btn.closest('[class*="carousel"]') ||
                   btn.closest('[class*="slider"]') ||
                   btn.closest('[class*="banner"]');
      if (!parent && !hasSVG) return;

      // If button has no accessible label
      if (!hasText && hasSVG || (text.length === 0)) {
        // Determine direction from class names or position
        var cls = (btn.className || '').toLowerCase();
        if (cls.includes('left') || cls.includes('prev') || cls.includes('back')) {
          btn.setAttribute('aria-label', 'Previous slide');
        } else if (cls.includes('right') || cls.includes('next') || cls.includes('forward')) {
          btn.setAttribute('aria-label', 'Next slide');
        } else {
          // Fallback: check if it's inside a slider by looking at siblings
          var siblings = btn.parentElement ? btn.parentElement.querySelectorAll('button:not([aria-label])') : [];
          if (siblings.length === 2) {
            var arr = Array.from(siblings);
            if (arr.indexOf(btn) === 0) {
              btn.setAttribute('aria-label', 'Previous slide');
            } else {
              btn.setAttribute('aria-label', 'Next slide');
            }
          } else if (!btn.getAttribute('aria-label')) {
            // Dot/indicator button
            idx++;
            btn.setAttribute('aria-label', 'Go to slide ' + idx);
          }
        }
      }

      // Fix avatar button "A"
      if (text === 'A' || text === 'K' || (text.length === 1 && text.match(/[A-Z]/))) {
        if (!btn.getAttribute('aria-label')) {
          btn.setAttribute('aria-label', 'Profile menu');
        }
      }
    });
  } catch(e) {}
  }

  function watchAriaLabels() {
    fixSliderAriaLabels();
    var obs = new MutationObserver(function () { fixSliderAriaLabels(); });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  /* ============================================================
     FIX 5: GAME LIST PAGINATION — "Load More" button
     Show first 48 games, hide rest, show "Load More" button
     ============================================================ */
  var GAMES_PER_PAGE = 48;
  var paginationInjected = false;

  function findGameGrid() {
    // Find the main game grid (many cards in a grid layout)
    var grids = document.querySelectorAll('[class*="grid"]');
    for (var i = 0; i < grids.length; i++) {
      var grid = grids[i];
      var cards = grid.querySelectorAll('[class*="group"], [class*="card"], [class*="game"]');
      if (cards.length >= 20) return { grid: grid, cards: cards };
    }
    // Fallback: find largest grid-like container
    var allDivs = document.querySelectorAll('div');
    var best = null;
    var bestCount = 0;
    allDivs.forEach(function (div) {
      var directChildren = div.children.length;
      if (directChildren > bestCount && directChildren > 30) {
        // Check if children look like game cards (have images)
        var imgs = div.querySelectorAll(':scope > * img, :scope > * svg');
        if (imgs.length > 20) {
          bestCount = directChildren;
          best = div;
        }
      }
    });
    if (best) {
      return { grid: best, cards: best.children };
    }
    return null;
  }

  function injectPagination() {
    try {
    if (paginationInjected) return;

    var result = findGameGrid();
    if (!result) return;
    var grid = result.grid;
    var allCards = Array.from(result.cards);

    if (allCards.length < GAMES_PER_PAGE + 5) return; // not enough to paginate

    paginationInjected = true;
    var visible = GAMES_PER_PAGE;

    // Hide cards beyond first page
    allCards.forEach(function (card, i) {
      if (i >= visible) {
        card.style.display = 'none';
        card.setAttribute('data-cr-hidden', '1');
      }
    });

    // Build "Load More" container
    var container = document.createElement('div');
    container.id = 'cr-load-more-container';
    container.style.cssText = [
      'display:flex;flex-direction:column;align-items:center;',
      'padding:24px 0 40px;gap:12px;'
    ].join('');

    var countLabel = document.createElement('p');
    countLabel.id = 'cr-games-count';
    countLabel.style.cssText = 'color:#888;font-size:13px;margin:0;';
    countLabel.textContent = 'Showing ' + visible + ' of ' + allCards.length + ' games';

    var btn = document.createElement('button');
    btn.id = 'cr-load-more-btn';
    btn.textContent = 'Load More Games';
    btn.style.cssText = [
      'background:linear-gradient(135deg,#FFB700,#FF8C00);',
      'color:#000;font-weight:700;font-size:15px;',
      'border:none;border-radius:10px;',
      'padding:14px 40px;cursor:pointer;',
      'min-height:48px;letter-spacing:0.5px;',
      'transition:filter 0.15s,transform 0.1s;',
      'box-shadow:0 4px 20px rgba(255,183,0,0.25);'
    ].join('');
    btn.onmouseenter = function () { btn.style.filter = 'brightness(1.1)'; };
    btn.onmouseleave = function () { btn.style.filter = ''; };
    btn.onclick = function () {
      var newVisible = visible + GAMES_PER_PAGE;
      allCards.forEach(function (card, i) {
        if (i >= visible && i < newVisible) {
          card.style.display = '';
          card.removeAttribute('data-cr-hidden');
        }
      });
      visible = newVisible;
      countLabel.textContent = 'Showing ' + Math.min(visible, allCards.length) + ' of ' + allCards.length + ' games';
      if (visible >= allCards.length) {
        btn.style.display = 'none';
        countLabel.textContent = 'All ' + allCards.length + ' games loaded';
      }
    };

    container.appendChild(countLabel);
    container.appendChild(btn);

    // Insert after the grid
    if (grid.parentElement) grid.parentElement.insertBefore(container, grid.nextSibling);
    } catch(e) {}
  }

  /* ============================================================
     MAIN: Initialize all fixes
     ============================================================ */
  onReady(function () {
    // Fix 2: balance watcher (start immediately)
    startBalanceWatcher();

    // Fix 4: aria labels (start immediately)
    watchAriaLabels();

    // Fix 3: play now CTA (start immediately)
    watchPlayNowCTA();

    // Fix 1: hamburger menu (wait for nav to render)
    setTimeout(function () {
      if (isMobile()) {
        injectBurger();
      }
      // Re-check on resize
      window.addEventListener('resize', function () {
        if (isMobile() && !BURGER_INJECTED) {
          injectBurger();
        } else if (!isMobile()) {
          closeDrawer();
        }
      });
    }, 1500);

    // Fix 5: game pagination (wait for React to render all games)
    setTimeout(function () {
      injectPagination();
      // Re-check on route change (SPA)
      var paginationObs = new MutationObserver(function () {
        if (!paginationInjected) injectPagination();
      });
      paginationObs.observe(document.body, { childList: true, subtree: true });
    }, 2500);

    // Re-run on SPA route changes
    var origPush = history.pushState;
    history.pushState = function () {
      origPush.apply(this, arguments);
      paginationInjected = false;
      BURGER_INJECTED = false;
      var existingDrawer = document.getElementById('cr-burger-drawer');
      if (existingDrawer) existingDrawer.remove();
      var existingOverlay = document.getElementById('cr-burger-overlay');
      if (existingOverlay) existingOverlay.remove();
      var existingBtn = document.getElementById('cr-burger-btn');
      if (existingBtn) existingBtn.remove();
      var existingLM = document.getElementById('cr-load-more-container');
      if (existingLM) existingLM.remove();

      setTimeout(function () {
        fixBalanceDecimals();
        fixPlayNowCTA();
        fixSliderAriaLabels();
        if (isMobile()) injectBurger();
        setTimeout(injectPagination, 1500);
      }, 500);
    };
  });


  // Hide Community tab for unauthenticated users
  (function hideCommunityForGuests() {
    function isLoggedIn() {
      try { return !!localStorage.getItem('auth_token'); } catch { return false; }
    }
    function applyCommunityVisibility() {
      var links = Array.from(document.querySelectorAll('a, button')).filter(function(el) {
        var t = el.textContent.trim();
        return t === 'Community' || t === 'Community Chat';
      });
      var loggedIn = isLoggedIn();
      links.forEach(function(el) {
        var wrapper = el.closest('li') || el;
        wrapper.style.display = loggedIn ? '' : 'none';
      });
    }
    new MutationObserver(applyCommunityVisibility).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('storage', applyCommunityVisibility);
    applyCommunityVisibility();
  })();
})();
