/* affiliate-tracker.js — v1 — Referral click & registration tracking */
(function () {
  if (window.location.pathname.indexOf('/admin') === 0) return;

  // ── 1. Read ?ref= from URL, store in localStorage ─────────────────────────
  const urlParams = new URLSearchParams(window.location.search);
  const ref = urlParams.get('ref') || urlParams.get('ref_code');
  const sub1 = urlParams.get('sub') || urlParams.get('sub1') || '';
  const sub2 = urlParams.get('sub2') || '';

  if (ref) {
    // Only save if new or different ref
    const stored = localStorage.getItem('aff_ref');
    if (stored !== ref) {
      localStorage.setItem('aff_ref', ref);
      localStorage.setItem('aff_sub1', sub1);
      localStorage.setItem('aff_sub2', sub2);
      localStorage.setItem('aff_landed_at', new Date().toISOString());
      // Track click
      fetch('/api/affiliate/click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ref: ref,
          sub1: sub1 || null,
          sub2: sub2 || null,
          landing_url: window.location.href,
        }),
      }).catch(function () {});
    }
  }

  // ── 2. Intercept fetch → inject ref into auth endpoints ──────────────────
  var _origFetch = window.fetch;
  window.fetch = function (url, opts) {
    var storedRef = localStorage.getItem('aff_ref');
    if (!storedRef) return _origFetch.apply(this, arguments);

    var urlStr = (typeof url === 'string') ? url : (url && url.url ? url.url : '');

    // GET /api/auth/telegram/init → append ?ref=CODE
    if (urlStr && urlStr.indexOf('/auth/telegram/init') !== -1 && urlStr.indexOf('ref=') === -1) {
      var sep = urlStr.indexOf('?') !== -1 ? '&' : '?';
      url = urlStr + sep + 'ref=' + encodeURIComponent(storedRef);
      if (sub1) url += '&sub1=' + encodeURIComponent(localStorage.getItem('aff_sub1') || '');
    }

    // POST /api/auth/register or /api/auth/sms/send → inject ref into body
    if (opts && opts.body && typeof opts.body === 'string' &&
        urlStr && (urlStr.indexOf('/auth/register') !== -1 || urlStr.indexOf('/auth/sms/send') !== -1 || urlStr.indexOf('/auth/login') !== -1)) {
      try {
        var body = JSON.parse(opts.body);
        if (!body.ref && !body.ref_code) {
          body.ref = storedRef;
          if (localStorage.getItem('aff_sub1')) body.sub1 = localStorage.getItem('aff_sub1');
          opts = Object.assign({}, opts, { body: JSON.stringify(body) });
        }
      } catch (e) {}
    }

    return _origFetch.call(this, url, opts);
  };

  // ── 3. Also intercept XMLHttpRequest (fallback) ───────────────────────────
  var _origXHROpen = XMLHttpRequest.prototype.open;
  var _xhrUrls = {};
  XMLHttpRequest.prototype.open = function (method, xhrUrl) {
    this._affUrl = xhrUrl;
    var storedRef = localStorage.getItem('aff_ref');
    if (storedRef && typeof xhrUrl === 'string' && xhrUrl.indexOf('/auth/telegram/init') !== -1 && xhrUrl.indexOf('ref=') === -1) {
      var sep = xhrUrl.indexOf('?') !== -1 ? '&' : '?';
      xhrUrl = xhrUrl + sep + 'ref=' + encodeURIComponent(storedRef);
    }
    return _origXHROpen.apply(this, [method, xhrUrl].concat(Array.prototype.slice.call(arguments, 2)));
  };

  // ── 4. After successful registration, clear ref from URL bar (optional) ───
  // Keep ref in localStorage for 30 days (cookie lifespan)
  var landedAt = localStorage.getItem('aff_landed_at');
  if (landedAt) {
    var age = Date.now() - new Date(landedAt).getTime();
    var days30 = 30 * 24 * 60 * 60 * 1000;
    if (age > days30) {
      localStorage.removeItem('aff_ref');
      localStorage.removeItem('aff_sub1');
      localStorage.removeItem('aff_sub2');
      localStorage.removeItem('aff_landed_at');
    }
  }

  // ── 5. Debug: log in console ──────────────────────────────────────────────
  if (ref || localStorage.getItem('aff_ref')) {
    console.log('[Cryptora Affiliate] ref=' + (ref || localStorage.getItem('aff_ref')) + ' sub1=' + (sub1 || localStorage.getItem('aff_sub1')));
  }

})();
