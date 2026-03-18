/**
 * Cryptora — Wallet TX Filter v2
 * Intercepts /api/entities/Transaction requests and appends type filters
 * based on the current page:
 *   - Wallet / Home: show only deposit + withdrawal transactions
 *   - Transactions: show bet, win, wager, result, bonus (no deposits)
 * Cannot be done in CSS — filters the API query before data is fetched.
 */
(function() {
  const _fetch = window.fetch;
  window.fetch = function(url, opts) {
    if (typeof url === "string" && url.includes("/api/entities/Transaction")) {
      const path = window.location.pathname;
      const [base, qs] = url.split("?");
      const params = new URLSearchParams(qs || "");

      // Wallet page: show only deposit + withdraw
      if (path.includes("/Wallet") || path === "/") {
        params.set("type__in", "deposit,withdrawal,withdraw");
        return _fetch.call(this, base + "?" + params.toString(), opts);
      }

      // Transactions page: show bet + win + bonus (no deposit/withdraw)
      if (path.includes("/Transactions")) {
        params.set("type__in", "bet,win,wager,result,bonus");
        return _fetch.call(this, base + "?" + params.toString(), opts);
      }
    }
    return _fetch.call(this, url, opts);
  };
})();
