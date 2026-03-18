/* crypto-capability.js v1
 * Client-side guard matching backend capability matrix.
 * Prevents UX confusion when disabled chains/tokens slip through.
 */
(function() {
  if (location.pathname.startsWith('/admin')) return;
  
  var DISABLED_COMBOS = [
    { chain: 'ARBITRUM' },
    { chain: 'TON', type: 'deposit' },
    { chain: 'SOL', token: 'USDC' },
  ];
  
  // This is a safety net — the primary guards are on the backend.
  // This script prevents confusing "sending..." states in the UI.
  window._isCryptoDisabled = function(chain, token, type) {
    return DISABLED_COMBOS.some(function(c) {
      if (c.chain !== chain) return false;
      if (c.token && c.token !== token) return false;
      if (c.type && c.type !== type) return false;
      return true;
    });
  };
})();
