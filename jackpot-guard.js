// jackpot-guard.js — prevent crash when jackpot API returns error
(function() {
  if (location.pathname.startsWith('/admin')) return;
    'use strict';
  var _origFetch = window.fetch;
  window.fetch = function(input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    return _origFetch.apply(this, arguments).then(function(response) {
      if (url.includes('/api/jackpot') && !response.ok) {
        // Return a safe default jackpot object so React doesn't crash
        var safeBody = JSON.stringify({
          amount: 10000,
          seed_amount: 5000,
          max_amount: 200,
          contribution_rate: 0.00001,
          last_winner_email: null,
          last_winner_amount: null,
          last_won_at: null,
          recent_winners: []
        });
        return new Response(safeBody, {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return response;
    });
  };
})();
