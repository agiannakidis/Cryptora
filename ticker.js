/**
 * Cryptora — Live Wins Ticker v1
 * Injected between main banner and jackpot section
 */
(function () {
  if (/\/admin/.test(window.location.pathname)) return;
  window.addEventListener('popstate', function() { var el=document.getElementById('cr-ticker'); if(el)el.remove(); });
  var _op=history.pushState; history.pushState=function(){ _op.apply(history,arguments); var el=document.getElementById('cr-ticker'); if(el&&/\/admin/.test(location.pathname))el.remove(); };
  'use strict';

  // ─── Admin guard (SPA-aware) ──────────────────────────────────────────────
  let _iv = null;
  function isAdmin() { return window.location.pathname.startsWith('/admin'); }
  function removeTicker() { var el = document.getElementById('cr-ticker'); if (el) el.remove(); }
  function killAdmin() { if (!isAdmin()) return; removeTicker(); if (_iv) { clearInterval(_iv); _iv = null; } }
  // Intercept SPA navigation
  (function() {
    var _push = history.pushState.bind(history);
    history.pushState = function() { _push.apply(history, arguments); setTimeout(killAdmin, 30); };
    var _replace = history.replaceState.bind(history);
    history.replaceState = function() { _replace.apply(history, arguments); setTimeout(killAdmin, 30); };
    window.addEventListener('popstate', function() { setTimeout(killAdmin, 30); });
  })();


  const TICKER_ID = 'cr-ticker';
  const POLL_MS = 30000;
  let tickerData = null;
  let injected = false;

  // ─── Styles ─────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #${TICKER_ID} {
      position: relative;
      width: 100%;
      overflow: hidden;
      height: 40px;
      display: flex;
      align-items: center;
      background: linear-gradient(90deg, #0f172a 0%, #1e1b4b 40%, #0f172a 100%);
      border-top: 1px solid rgba(139,92,246,.35);
      border-bottom: 1px solid rgba(139,92,246,.35);
      z-index: 10;
    }

    /* Announcement mode — bright red */
    #${TICKER_ID}.cr-announce {
      background: linear-gradient(90deg, #450a0a 0%, #7f1d1d 35%, #991b1b 65%, #450a0a 100%);
      border-top: 1px solid rgba(239,68,68,.7);
      border-bottom: 1px solid rgba(239,68,68,.7);
      animation: cr-pulse-border 1.5s ease-in-out infinite;
    }

    @keyframes cr-pulse-border {
      0%, 100% { box-shadow: 0 0 8px rgba(239,68,68,.4); }
      50%       { box-shadow: 0 0 18px rgba(239,68,68,.85); }
    }

    /* Left label */
    #${TICKER_ID} .cr-label {
      flex-shrink: 0;
      padding: 0 14px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .06em;
      text-transform: uppercase;
      white-space: nowrap;
      border-right: 1px solid rgba(255,255,255,.12);
      height: 100%;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    #${TICKER_ID}:not(.cr-announce) .cr-label {
      color: #fbbf24;
      background: rgba(0,0,0,.25);
    }

    #${TICKER_ID}.cr-announce .cr-label {
      color: #fca5a5;
      background: rgba(0,0,0,.3);
    }

    /* Scrolling track */
    #${TICKER_ID} .cr-track-wrap {
      flex: 1;
      overflow: hidden;
      height: 100%;
      display: flex;
      align-items: center;
      mask-image: linear-gradient(90deg, transparent 0%, black 4%, black 96%, transparent 100%);
      -webkit-mask-image: linear-gradient(90deg, transparent 0%, black 4%, black 96%, transparent 100%);
    }

    #${TICKER_ID} .cr-track {
      display: flex;
      align-items: center;
      white-space: nowrap;
      animation: cr-scroll 40s linear infinite;
      will-change: transform;
    }

    #${TICKER_ID}.cr-announce .cr-track {
      animation-duration: 25s;
    }

    @keyframes cr-scroll {
      0%   { transform: translateX(0); }
      100% { transform: translateX(-50%); }
    }

    /* Individual win item */
    #${TICKER_ID} .cr-item {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 0 24px 0 0;
      font-size: 12.5px;
      color: #e2e8f0;
    }

    #${TICKER_ID} .cr-item .cr-player {
      color: #a78bfa;
      font-weight: 600;
    }

    #${TICKER_ID} .cr-item .cr-amount {
      color: #4ade80;
      font-weight: 700;
    }

    #${TICKER_ID} .cr-item .cr-multi {
      background: rgba(251,191,36,.15);
      color: #fbbf24;
      font-weight: 700;
      font-size: 11px;
      padding: 1px 5px;
      border-radius: 4px;
    }

    #${TICKER_ID} .cr-sep {
      color: rgba(255,255,255,.2);
      padding: 0 8px 0 0;
      font-size: 14px;
    }

    /* Announce item */
    #${TICKER_ID}.cr-announce .cr-item {
      color: #fecaca;
      font-size: 13px;
      font-weight: 600;
    }
  `;
  document.head.appendChild(style);

  // ─── Build track items ────────────────────────────────────────────────────────
  function buildWinItems(wins) {
    return wins.map(w => {
      const amt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(w.amount);
      return `
        <span class="cr-item">
          🏆&nbsp;<span class="cr-player">${escHtml(w.player)}</span>
          <span style="color:#94a3b8">won</span>
          <span class="cr-amount">${amt}</span>
          <span class="cr-multi">x${w.multiplier}</span>
          <span style="color:#64748b">in</span>
          ${escHtml(w.game)}
        </span>
        <span class="cr-sep">•</span>
      `;
    }).join('');
  }

  function buildAnnounceItems(text) {
    const repeated = Array(6).fill(
      `<span class="cr-item">📢&nbsp;${escHtml(text)}</span><span class="cr-sep" style="color:rgba(239,68,68,.5)">●</span>`
    ).join('');
    return repeated;
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── Create or update ticker DOM ─────────────────────────────────────────────
  function createTicker(data) {
    const isAnnounce = data.mode === 'announcement' && data.announcement;

    // Build inner track HTML (duplicated for seamless loop)
    const itemsHtml = isAnnounce
      ? buildAnnounceItems(data.announcement)
      : buildWinItems(data.wins || []);
    const trackHtml = itemsHtml + itemsHtml; // duplicate for loop

    const labelIcon = isAnnounce ? '📢' : '🔴';
    const labelText = isAnnounce ? 'ANNOUNCEMENT' : 'WINNERS';

    const el = document.getElementById(TICKER_ID);
    if (el) {
      el.className = isAnnounce ? 'cr-announce' : '';
      el.querySelector('.cr-label').innerHTML = `${labelIcon} ${labelText}`;
      el.querySelector('.cr-track').innerHTML = trackHtml;
    } else {
      const div = document.createElement('div');
      div.id = TICKER_ID;
      if (isAnnounce) div.className = 'cr-announce';
      div.innerHTML = `
        <div class="cr-label">${labelIcon} ${labelText}</div>
        <div class="cr-track-wrap">
          <div class="cr-track">${trackHtml}</div>
        </div>
      `;
      return div;
    }
    return null;
  }

  // ─── Find injection point & inject ───────────────────────────────────────────
  function findBannerEnd() {
    // The banner carousel container: class contains "overflow-hidden" + "rounded-2xl"
    // It's the first large div inside main with a "Play Now" button inside
    const candidates = document.querySelectorAll('main div[class*="overflow-hidden"][class*="rounded-2xl"]');
    for (const d of candidates) {
      if (d.offsetHeight > 100 && d.querySelector('button')) {
        return d;
      }
    }
    // Fallback: first main child div taller than 150px with a button
    const mainEl = document.querySelector('main');
    if (mainEl) {
      for (const child of mainEl.children) {
        if (child.offsetHeight > 100 && child.querySelector('button')) {
          return child;
        }
      }
    }
    return null;
  }

  function tryInject(data) {
    if (!data || !data.enabled) return;

    // If already injected, just update
    if (document.getElementById(TICKER_ID)) {
      createTicker(data);
      return;
    }

    const banner = findBannerEnd();
    if (!banner) return;

    if (isAdmin()) { removeTicker(); return; }
    const tickerEl = createTicker(data);
    if (tickerEl) {
      banner.parentNode.insertBefore(tickerEl, banner.nextSibling);
      injected = true;
    }
  }

  // ─── Fetch & poll ─────────────────────────────────────────────────────────────
  async function fetchTicker() {
    if (isAdmin()) { removeTicker(); return; }
    try {
      const r = await fetch('/api/ticker');
      if (!r.ok) return;
      tickerData = await r.json();
      tryInject(tickerData);
    } catch {}
  }

  // Wait for DOM to be ready with key content
  function waitAndInject() {
    if (isAdmin()) return;
    const check = setInterval(() => {
      const hasContent = document.querySelector('[class*="banner"], [class*="hero"], [class*="slider"]')
        || document.querySelectorAll('button').length > 5;
      if (hasContent) {
        clearInterval(check);
        fetchTicker();
      }
    }, 300);
    // Give up after 10s
    setTimeout(() => clearInterval(check), 10000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitAndInject);
  } else {
    waitAndInject();
  }

  // Re-poll every 30s for live updates
  if (!isAdmin()) _iv = setInterval(fetchTicker, POLL_MS);

})();
