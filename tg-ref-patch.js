// Patch: Telegram init should also pass ref_code from localStorage
(function patchTgRef() {
  const _fetch = window.fetch;
  window.fetch = function(url, opts) {
    if (typeof url === 'string' && url.includes('/api/auth/telegram/init')) {
      try {
        // If ref_code not in URL but in localStorage, add it
        if (!url.includes('ref_code=')) {
          const ref = localStorage.getItem('affiliate_ref');
          if (ref) {
            url = url + (url.includes('?') ? '&' : '?') + 'ref_code=' + encodeURIComponent(ref);
          }
        }
      } catch(e) {}
    }
    return _fetch.call(this, url, opts);
  };
})();
