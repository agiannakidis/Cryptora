// wallet-tx-filter.js v2 — filter transactions by page via backend query param
(function() {
  const _fetch = window.fetch;
  window.fetch = function(url, opts) {
    if (typeof url === 'string' && url.includes('/api/entities/Transaction')) {
      const path = window.location.pathname;
      const [base, qs] = url.split('?');
      const params = new URLSearchParams(qs || '');

      // Wallet page: show only deposit + withdraw
      if (path.includes('/Wallet') || path === '/') {
        params.set('type__in', 'deposit,withdrawal,withdraw');
        return _fetch.call(this, base + '?' + params.toString(), opts);
      }

      // Transactions page: show bet + win + bonus (no deposit/withdraw)
      if (path.includes('/Transactions')) {
        params.set('type__in', 'bet,win,wager,result,bonus');
        return _fetch.call(this, base + '?' + params.toString(), opts);
      }
    }
    return _fetch.call(this, url, opts);
  };
})();
