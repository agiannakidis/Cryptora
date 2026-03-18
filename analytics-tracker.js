// analytics-tracker.js — Cryptora visit tracker v2
(function () {
  if (location.pathname.startsWith('/admin')) return;
    'use strict';

  const API = '/api/analytics/track';
  const SESSION_KEY = 'cr_sid';
  const SENT_KEY = 'cr_sent_visit';

  function getSessionId() {
    let sid = sessionStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
      sessionStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  }

  function getUTM(url) {
    const params = new URLSearchParams(url.split('?')[1] || '');
    return {
      utmSource:   params.get('utm_source'),
      utmMedium:   params.get('utm_medium'),
      utmCampaign: params.get('utm_campaign'),
      utmTerm:     params.get('utm_term'),
      utmContent:  params.get('utm_content'),
    };
  }

  function getLanding() {
    const stored = sessionStorage.getItem('cr_landing');
    if (stored) return JSON.parse(stored);
    const landing = {
      page: location.pathname + location.search,
      referrer: document.referrer || null,
      ...getUTM(location.href),
    };
    sessionStorage.setItem('cr_landing', JSON.stringify(landing));
    return landing;
  }

  // Read user ID from localStorage — try multiple key patterns used by the app
  function getCurrentUserId() {
    try {
      const keys = Object.keys(localStorage);
      for (const k of keys) {
        try {
          const v = localStorage.getItem(k);
          if (!v || v[0] !== '{') continue;
          const u = JSON.parse(v);
          if (u && typeof u === 'object') {
            const id = u.id || u.userId || u._id || u.user?.id;
            if (id && typeof id === 'string' && id.length > 6) return String(id);
          }
        } catch (e) {}
      }
    } catch (e) {}
    return null;
  }

  function send(data) {
    const payload = { sessionId: getSessionId(), userId: getCurrentUserId(), ...data };
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(API, new Blob([JSON.stringify(payload)], { type: 'application/json' }));
      } else {
        fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), keepalive: true }).catch(() => {});
      }
    } catch (e) {}
  }

  function trackVisit() {
    if (sessionStorage.getItem(SENT_KEY)) return;
    sessionStorage.setItem(SENT_KEY, '1');
    const landing = getLanding();
    send({ event: 'visit', page: landing.page, ...landing });
  }

  function trackPageview(path) {
    send({ event: 'pageview', page: path || location.pathname });
  }

  // Hook fetch to capture auth + game events
  function hookFetch() {
    const origFetch = window.fetch;
    window.fetch = function (input, init) {
      const url = (typeof input === 'string' ? input : (input?.url || ''));
      const method = ((init?.method) || 'GET').toUpperCase();

      return origFetch.apply(this, arguments).then(function (response) {
        if (!response.ok) return response;
        try {
          // ── Registration ───────────────────────────────────────────────
          if (method === 'POST' && url.includes('/api/auth/register')) {
            const clone = response.clone();
            clone.json().then(function (data) {
              // Register API returns { needsVerification: true } — no user id yet
              // Just fire register event regardless (status 201 = success)
              if (data && !data.error) {
                send({ event: 'register', page: location.pathname });
              }
            }).catch(function () {});
          }

          // ── Login ──────────────────────────────────────────────────────
          if (method === 'POST' && url.includes('/api/auth/login')) {
            const clone = response.clone();
            clone.json().then(function (data) {
              if (data && data.token && data.user) {
                send({ event: 'login', page: location.pathname, userId: data.user.id });
                // Re-send visit with user_id to link session
                setTimeout(function () {
                  send({ event: 'identify', page: location.pathname, userId: data.user.id });
                }, 300);
              }
            }).catch(function () {});
          }

          // ── Email verification (completes registration flow) ───────────
          if (method === 'POST' && (url.includes('/verify-code') || url.includes('/verify-email'))) {
            const clone = response.clone();
            clone.json().then(function (data) {
              if (data && data.token && data.user) {
                send({ event: 'verified', page: location.pathname, userId: data.user.id });
              }
            }).catch(function () {});
          }

          // ── Game launch ────────────────────────────────────────────────
          // Actual URLs: /api/functions/launchGame, /api/functions/launchNetGame
          if (method === 'POST' && (
            url.includes('launchGame') ||
            url.includes('launchNetGame') ||
            url.includes('launch-game') ||
            url.includes('/launch')
          )) {
            send({ event: 'game_start', page: location.pathname });
          }

          // ── Deposit (crypto address request) ───────────────────────────
          if (method === 'GET' && url.includes('/crypto/deposit-address')) {
            send({ event: 'deposit_intent', page: location.pathname });
          }

        } catch (e) {}
        return response;
      });
    };
  }

  // Hook SPA navigation
  function hookHistory() {
    const origPush = history.pushState;
    history.pushState = function () {
      origPush.apply(this, arguments);
      setTimeout(function () { trackPageview(location.pathname); }, 100);
    };
    window.addEventListener('popstate', function () {
      setTimeout(function () { trackPageview(location.pathname); }, 100);
    });
  }

  function init() {
    trackVisit();
    trackPageview(location.pathname);
    hookFetch();
    hookHistory();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
