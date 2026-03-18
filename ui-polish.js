/**
 * Cryptora UI Polish v2 — safe rewrite
 * All MutationObserver callbacks wrapped in try-catch
 * No getComputedStyle in loops
 * No optional chaining (?.) for compatibility
 */
(function () {
  'use strict';

  /* ── Safe helpers ── */
  function safeGet(fn) {
    try { return fn(); } catch(e) { return null; }
  }
  function qs(selector, root) {
    return safeGet(function() { return (root || document).querySelector(selector); });
  }
  function qsAll(selector, root) {
    return safeGet(function() { return Array.from((root || document).querySelectorAll(selector)); }) || [];
  }

  /* ══════════════════════════════════════════════
     1. CSS — shimmer skeleton
  ══════════════════════════════════════════════ */
  function injectCSS() {
    if (document.getElementById('cr-polish-css')) return;
    var s = document.createElement('style');
    s.id = 'cr-polish-css';
    s.textContent =
      '@keyframes cr-shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}' +
      '.shimmer{background:linear-gradient(90deg,#1a2235 25%,#252b45 50%,#1a2235 75%);' +
      'background-size:400px 100%;animation:cr-shimmer 1.4s infinite linear;border-radius:8px;}' +
      '.cr-tc-content{max-height:0;overflow:hidden;transition:max-height 0.3s ease;' +
      'padding:0 16px;font-size:12px;color:#94a3b8;line-height:1.6;}' +
      '.cr-tc-content.open{max-height:200px;padding:12px 16px;background:rgba(0,0,0,0.2);border-radius:0 0 8px 8px;}' +
      '.cr-tc-btn{cursor:pointer;font-size:11px;color:#64748b;background:none;border:none;' +
      'padding:5px 0;display:flex;align-items:center;gap:4px;user-select:none;}' +
      '.cr-tc-btn:hover{color:#f59e0b;}' +
      '.cr-tc-arrow{display:inline-block;transition:transform 0.2s;}' +
      '.cr-tc-btn.open .cr-tc-arrow{transform:rotate(180deg);}';
    document.head.appendChild(s);
  }

  /* ══════════════════════════════════════════════
     2. GAME TITLE FORMATTER
  ══════════════════════════════════════════════ */
  var titleFormatted = [];  // array of DOM nodes already processed

  function hasBeenFormatted(el) {
    for (var i = 0; i < titleFormatted.length; i++) {
      if (titleFormatted[i] === el) return true;
    }
    return false;
  }

  function formatTitle(raw) {
    if (!raw || raw.length < 2 || raw.indexOf(' ') !== -1) return null;
    // PascalCase / camelCase → spaced
    var result = raw
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/_+/g, ' ')
      .trim();
    if (result === raw) return null; // no change needed
    // Title case
    return result.replace(/\b\w/g, function(c) { return c.toUpperCase(); });
  }

  var SKIP_TEXT = /^[$€£¥\d]|^(Home|Promo|VIP|Wallet|Login|Register|Play|Deposit|Withdraw|Cancel|Save|Slots|Casino|Live|Search|Back|Close|Next|Prev)/i;

  function fixGameTitles() {
    try {
      var els = qsAll(
        '[class*="game"] h3, [class*="game"] p.text-xs,' +
        '.group h3, .group p.text-xs,' +
        '[class*="card"] h3'
      );
      els.forEach(function(el) {
        if (hasBeenFormatted(el)) return;
        if (el.children.length > 0) return;
        var text = (el.textContent || '').trim();
        if (!text || text.length < 3 || text.length > 50) return;
        if (SKIP_TEXT.test(text)) return;
        var formatted = formatTitle(text);
        if (formatted) {
          el.textContent = formatted;
          titleFormatted.push(el);
        }
      });
    } catch(e) {}
  }

  /* ══════════════════════════════════════════════
     4. PROMOTIONS T&C INLINE
  ══════════════════════════════════════════════ */
  var tcDone = [];

  var TC_MAP = {
    'welcome':   'Min. deposit $10. 35× wagering on bonus. Valid 7 days. Slots only. Max bet $5.',
    'cashback':  'Cashback credited Mondays. Based on net losses Mon–Sun. No wagering. Max $500.',
    'reload':    'Min. deposit $20. 30× wagering. Valid 3 days. Max bonus $200.',
    'free spin': 'Free spin winnings: 25× wagering. Valid 24h. Max withdrawal $100.',
    'vip':       'VIP Gold+ only. 1× wagering. Credited manually.',
    '_default':  'Wagering requirements apply. Full terms at cryptora.live/terms.',
  };

  function getTcText(cardText) {
    var t = (cardText || '').toLowerCase();
    var keys = Object.keys(TC_MAP);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] !== '_default' && t.indexOf(keys[i]) !== -1) return TC_MAP[keys[i]];
    }
    return TC_MAP['_default'];
  }

  function injectPromoTCs() {
    try {
      var cards = qsAll('[class*="rounded-2xl"][class*="border"], [class*="promo"] [class*="rounded"]');
      cards.forEach(function(card) {
        // Already processed?
        for (var i = 0; i < tcDone.length; i++) { if (tcDone[i] === card) return; }
        if (!card.querySelector('button')) return;
        var ct = card.textContent || '';
        if (!ct.match(/bonus|cashback|spin|deposit|reload/i)) return;
        if (ct.match(/withdraw|network|chain/i)) return;
        if (card.querySelector('.cr-tc-btn')) return;

        tcDone.push(card);
        var tc = getTcText(ct);

        var btn = document.createElement('button');
        btn.className = 'cr-tc-btn';
        btn.innerHTML = '<span class="cr-tc-arrow">▾</span> Terms & Conditions';

        var div = document.createElement('div');
        div.className = 'cr-tc-content';
        div.textContent = tc;

        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          var open = div.classList.contains('open');
          div.classList.toggle('open', !open);
          btn.classList.toggle('open', !open);
        });

        card.appendChild(btn);
        card.appendChild(div);
      });
    } catch(e) {}
  }

  /* ══════════════════════════════════════════════
     5. BUTTON COLOR UNIFICATION
     Only via CSS class overrides — no getComputedStyle
  ══════════════════════════════════════════════ */
  function injectButtonCSS() {
    if (document.getElementById('cr-btn-css')) return;
    var s = document.createElement('style');
    s.id = 'cr-btn-css';
    // Safely override blue CTA buttons that should be gold
    // Target by class pattern, not computed style
    s.textContent =
      // bg-blue-* primary buttons → gold
      'button.bg-blue-600:not([class*="outline"]):not([class*="ghost"]),' +
      'button.bg-blue-500:not([class*="outline"]):not([class*="ghost"]),' +
      'button[class*="bg-blue-600"][class*="w-full"],' +
      'button[class*="bg-blue-500"][class*="w-full"]{' +
        'background:linear-gradient(135deg,#FFB700,#FF8C00)!important;' +
        'color:#000!important;' +
      '}';
    document.head.appendChild(s);
  }

  /* ══════════════════════════════════════════════
     MAIN — debounced observer
  ══════════════════════════════════════════════ */
  var debounceTimer = null;

  function runAll() {
    fixGameTitles();
    injectPromoTCs();
  }

  function debouncedRun() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runAll, 400);
  }

  function init() {
    try {
      injectCSS();
      injectButtonCSS();
      runAll();

      var obs = new MutationObserver(debouncedRun);
      obs.observe(document.body, { childList: true, subtree: true });

      // SPA route changes
      var origPush = history.pushState;
      history.pushState = function() {
        try { origPush.apply(this, arguments); } catch(e) {}
          setTimeout(runAll, 500);
      };
      window.addEventListener('popstate', function() {
          setTimeout(runAll, 500);
      });
    } catch(e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
