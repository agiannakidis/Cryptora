/* admin-entry.js — Admin UI Bootstrap
 * Loads admin scripts only on /admin paths.
 * Replaces scattered admin script tags in index.html.
 * Version: 1.0
 */
(function() {
  if (!window.location.pathname.startsWith('/admin')) return;

  var ADMIN_SCRIPTS = [
    '/admin-operator-nav.js?v=1',
    '/analytics-admin.js?v=25',
    '/admin-add-operator.js?v=1',
    '/admin-game-categories.js?v=1',
    '/jackpot-admin-ui.js?v=6',
    '/admin-create-admin.js?v=2',
    '/admin-affiliates.js?v=2',
    '/bi-dashboard.js?v=6',
    '/banner-upload.js?v=2',
    '/admin-support.js?v=23',
    '/admin-games-enhanced.js?v=8',
    '/admin-sweep.js?v=5',
    '/admin-players-wallets.js?v=1',
    '/admin-geo-block.js?v=1',
    '/admin-my-wallets.js?v=4',
  ];

  function loadScript(src, cb) {
    var s = document.createElement('script');
    s.src = src;
    s.defer = true;
    s.onload = cb || function(){};
    s.onerror = function() { console.warn('[admin-entry] Failed to load:', src); cb && cb(); };
    document.head.appendChild(s);
  }

  function loadSequential(scripts, index) {
    if (index >= scripts.length) return;
    loadScript(scripts[index], function() { loadSequential(scripts, index + 1); });
  }

  // Load admin-specific CSS
  var l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = '/admin-mobile-fix.css?v=8';
  document.head.appendChild(l);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { loadSequential(ADMIN_SCRIPTS, 0); });
  } else {
    loadSequential(ADMIN_SCRIPTS, 0);
  }
})();
