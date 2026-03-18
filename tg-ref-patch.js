/**
 * Cryptora — Telegram Ref Patch v1
 * Ensures affiliate ref_code stored in localStorage is forwarded
 * with Telegram auth init requests, even if not present in the URL.
 * Required because Telegram mini-app deeplinks strip query params on reload.
 */
(function patchTgRef() {
  const _fetch = window.fetch;
  window.fetch = function(url, opts) {
    if (typeof url === "string" && url.includes("/api/auth/telegram/init")) {
      try {
        // If ref_code not in URL but in localStorage, add it
        if (!url.includes("ref_code=")) {
          const ref = localStorage.getItem("affiliate_ref");
          if (ref) {
            url = url + (url.includes("?") ? "&" : "?") + "ref_code=" + encodeURIComponent(ref);
          }
        }
      } catch(e) {}
    }
    return _fetch.call(this, url, opts);
  };
})();
