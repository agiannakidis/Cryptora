/**
 * Cryptora BI Dashboard — GGR / NGR / ARPU
 * Injected into admin pages only.
 * Adds a "BI" button to admin sidebar and renders a full dashboard.
 */
(function () {
  'use strict';

  if (!location.pathname.startsWith('/admin')) return;

  var API = '/api/analytics/bi';
  var token = function () { return localStorage.getItem('auth_token') || ''; };

  /* ── Inject nav button ── */
  function injectNavBtn() {
    try {
    if (document.getElementById('bi-nav-btn')) return true;
    var nav = document.querySelector('aside nav');
    if (!nav) return false;
    var btns = nav.querySelectorAll('button');
    if (!btns || !btns.length) return false;

    var src = btns[btns.length - 1];
    var btn = src.cloneNode(true);
    btn.id = 'bi-nav-btn';
    btn.classList.remove('bg-amber-500/15', 'text-amber-400');
    btn.classList.add('text-slate-400', 'hover:bg-white/5', 'hover:text-white');
    btn.innerHTML = '<span style="font-size:16px">📈</span><span>BI Dashboard</span>';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      nav.querySelectorAll('button').forEach(function (b) {
        b.classList.remove('bg-amber-500/15', 'text-amber-400');
        b.classList.add('text-slate-400');
      });
      btn.classList.remove('text-slate-400');
      btn.classList.add('bg-amber-500/15', 'text-amber-400');
      renderBI();
    });
    nav.appendChild(btn);

    // Capture clicks on any sidebar button (except BI) to close overlay
    if (!nav.__biCaptureAttached) {
      nav.__biCaptureAttached = true;
      nav.addEventListener('click', function(e) {
        var b = e.target.closest ? e.target.closest('button') : null;
        if (b && b.id !== 'bi-nav-btn') {
          var ov = document.getElementById('bi-overlay');
          if (ov) ov.remove();
          if (window.closeAnalyticsOverlay) window.closeAnalyticsOverlay();
        }
      }, true);
    }
    return true;
    } catch(e) { return false; }
  }

  /* ── Render BI Page ── */
  var currentPeriod = '30d';
  var biData = null;

  function renderBI() {
    try {
    // Remove existing overlay
    var existing = document.getElementById('bi-overlay');
    if (existing) existing.remove();
    // Use overlay to avoid breaking React sidebar navigation
    var overlay = document.createElement('div');
    overlay.id = 'bi-overlay';
    var aside = document.querySelector('aside');
    var sidebarW = aside ? aside.offsetWidth : 240;
    overlay.style.cssText = 'position:fixed;top:0;left:' + sidebarW + 'px;right:0;bottom:0;z-index:40;overflow-y:auto;background:#0a0e1a;';
    document.body.appendChild(overlay);
    var main = overlay;

    main.innerHTML = '<div id="bi-page" style="padding:24px;min-height:100vh;background:#0a0e1a;color:#f1f5f9;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px;">' +
        '<h1 style="font-size:24px;font-weight:700;color:#f59e0b;margin:0;">📈 BI Dashboard</h1>' +
        '<div style="display:flex;gap:8px;">' +
          ['1d','7d','30d','90d'].map(function(p) {
            return '<button onclick="window._biSetPeriod(\'' + p + '\')" id="bi-period-' + p + '" style="padding:7px 16px;border-radius:8px;border:1px solid ' +
              (p === currentPeriod ? '#f59e0b' : '#1e2d45') + ';background:' +
              (p === currentPeriod ? 'rgba(245,158,11,0.15)' : 'transparent') +
              ';color:' + (p === currentPeriod ? '#f59e0b' : '#64748b') +
              ';cursor:pointer;font-size:13px;font-weight:600;">' + p + '</button>';
          }).join('') +
        '</div>' +
      '</div>' +
      '<div id="bi-content" style="display:grid;gap:20px;">' +
        '<div style="text-align:center;padding:60px;color:#64748b;">Loading...</div>' +
      '</div>' +
    '</div>';

    window._biSetPeriod = function (p) {
      currentPeriod = p;
      renderBI();
    };

    loadBI();
    } catch(e) { console.warn('[bi] render error:', e.message); }
  }

  function loadBI() {
    var contentEl = document.getElementById('bi-content');
    if (!contentEl) return;
    contentEl.innerHTML = '<div style="text-align:center;padding:60px;color:#64748b;">⏳ Loading BI data...</div>';

    fetch(API + '?period=' + currentPeriod, {
      headers: { 'Authorization': 'Bearer ' + token() }
    })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      biData = d;
      renderBIContent(d);
    })
    .catch(function (e) {
      var el = document.getElementById('bi-content');
      if (el) el.innerHTML = '<div style="color:#ef4444;padding:40px;">Error loading BI data: ' + e.message + '</div>';
    });
  }

  function fmt(n) {
    return '$' + parseFloat(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtN(n) {
    return parseInt(n || 0).toLocaleString('en-US');
  }
  function fmtPct(a, b) {
    if (!b || parseFloat(b) === 0) return '0%';
    return (parseFloat(a) / parseFloat(b) * 100).toFixed(1) + '%';
  }

  function kpiCard(label, value, sub, color) {
    return '<div style="background:#111827;border:1px solid #1e2d45;border-radius:12px;padding:20px;min-width:150px;">' +
      '<div style="font-size:12px;color:#64748b;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">' + label + '</div>' +
      '<div style="font-size:26px;font-weight:800;color:' + (color || '#f1f5f9') + ';line-height:1.2;">' + value + '</div>' +
      (sub ? '<div style="font-size:12px;color:#64748b;margin-top:4px;">' + sub + '</div>' : '') +
    '</div>';
  }

  function renderBIContent(d) {
    var el = document.getElementById('bi-content');
    if (!el) return;
    var s = d.summary || {};

    // RTP%
    var rtpPct = s.totalBets > 0 ? (s.totalWins / s.totalBets * 100).toFixed(1) + '%' : '—';
    // Deposit → GGR ratio
    var depRatio = s.depositVolume > 0 ? (s.ggr / s.depositVolume * 100).toFixed(1) + '%' : '—';

    var html = '';

    // KPI row
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;">';
    html += kpiCard('GGR', fmt(s.ggr), 'Gross Gaming Revenue', '#f59e0b');
    html += kpiCard('NGR', fmt(s.ngr), 'After bonus costs', s.ngr >= 0 ? '#10b981' : '#ef4444');
    html += kpiCard('ARPU', fmt(s.arpu), 'Per active player', '#3b82f6');
    html += kpiCard('Active Players', fmtN(s.activePlayers), 'Played in period', '#8b5cf6');
    html += kpiCard('New Players', fmtN(s.newPlayers), 'Registered in period', '#06b6d4');
    html += kpiCard('Deposit Vol', fmt(s.depositVolume), fmtN(s.deposits) + ' deposits', '#f59e0b');
    html += kpiCard('Total Bets', fmt(s.totalBets), fmtN(s.totalRounds) + ' rounds', '#64748b');
    html += kpiCard('RTP', rtpPct, 'Return to player', '#64748b');
    html += kpiCard('Bonus Cost', fmt(s.bonusCost), 'GGR → NGR diff', '#ef4444');
    html += '</div>';

    // Daily GGR chart (simple bar chart with CSS)
    if (d.dailyGgr && d.dailyGgr.length > 0) {
      var maxGgr = Math.max.apply(null, d.dailyGgr.map(function(r) { return parseFloat(r.ggr || 0); }));
      if (maxGgr <= 0) maxGgr = 1;

      html += '<div style="background:#111827;border:1px solid #1e2d45;border-radius:12px;padding:20px;">';
      html += '<h3 style="font-size:15px;font-weight:700;color:#f1f5f9;margin:0 0 16px;">Daily GGR</h3>';
      html += '<div style="display:flex;align-items:flex-end;gap:4px;height:120px;overflow-x:auto;">';
      d.dailyGgr.forEach(function (row) {
        var ggr = parseFloat(row.ggr || 0);
        var pct = Math.max(2, (ggr / maxGgr) * 100);
        var dayStr = (row.day || '').slice(5); // MM-DD
        html += '<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;min-width:24px;" title="' + row.day + ': ' + fmt(ggr) + '">' +
          '<div style="background:' + (ggr >= 0 ? '#f59e0b' : '#ef4444') + ';width:100%;border-radius:3px 3px 0 0;height:' + pct + '%;min-height:3px;transition:height 0.3s;"></div>' +
          '<div style="font-size:9px;color:#64748b;transform:rotate(-45deg);white-space:nowrap;">' + dayStr + '</div>' +
        '</div>';
      });
      html += '</div></div>';
    }

    // 2-col: Top Games + Top Providers
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">';

    // Top Games
    html += '<div style="background:#111827;border:1px solid #1e2d45;border-radius:12px;padding:20px;">';
    html += '<h3 style="font-size:15px;font-weight:700;color:#f1f5f9;margin:0 0 14px;">Top Games by GGR</h3>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
    html += '<thead><tr style="color:#64748b;border-bottom:1px solid #1e2d45;">';
    html += '<th style="text-align:left;padding:6px 8px;">Game</th>';
    html += '<th style="text-align:right;padding:6px 8px;">GGR</th>';
    html += '<th style="text-align:right;padding:6px 8px;">Rounds</th>';
    html += '<th style="text-align:right;padding:6px 8px;">RTP</th>';
    html += '</tr></thead><tbody>';
    (d.topGames || []).forEach(function (g, i) {
      var rtp = parseFloat(g.bets) > 0 ? (parseFloat(g.wins) / parseFloat(g.bets) * 100).toFixed(1) + '%' : '—';
      var ggrColor = parseFloat(g.ggr) >= 0 ? '#10b981' : '#ef4444';
      html += '<tr style="border-bottom:1px solid rgba(30,45,69,0.5);">';
      html += '<td style="padding:7px 8px;"><div style="font-weight:600;color:#f1f5f9;">' + (g.game_title || '').slice(0, 22) + '</div><div style="font-size:11px;color:#64748b;">' + (g.provider || '') + '</div></td>';
      html += '<td style="text-align:right;padding:7px 8px;color:' + ggrColor + ';font-weight:700;">' + fmt(g.ggr) + '</td>';
      html += '<td style="text-align:right;padding:7px 8px;color:#64748b;">' + fmtN(g.rounds) + '</td>';
      html += '<td style="text-align:right;padding:7px 8px;color:#64748b;">' + rtp + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';

    // Top Providers
    html += '<div style="background:#111827;border:1px solid #1e2d45;border-radius:12px;padding:20px;">';
    html += '<h3 style="font-size:15px;font-weight:700;color:#f1f5f9;margin:0 0 14px;">Providers by GGR</h3>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
    html += '<thead><tr style="color:#64748b;border-bottom:1px solid #1e2d45;">';
    html += '<th style="text-align:left;padding:6px 8px;">Provider</th>';
    html += '<th style="text-align:right;padding:6px 8px;">GGR</th>';
    html += '<th style="text-align:right;padding:6px 8px;">Share</th>';
    html += '<th style="text-align:right;padding:6px 8px;">Players</th>';
    html += '</tr></thead><tbody>';
    var totalProvGgr = (d.topProviders || []).reduce(function(sum, p) { return sum + parseFloat(p.ggr || 0); }, 0);
    (d.topProviders || []).forEach(function (p) {
      var share = totalProvGgr > 0 ? (parseFloat(p.ggr) / totalProvGgr * 100).toFixed(1) + '%' : '—';
      var ggrColor = parseFloat(p.ggr) >= 0 ? '#10b981' : '#ef4444';
      html += '<tr style="border-bottom:1px solid rgba(30,45,69,0.5);">';
      html += '<td style="padding:7px 8px;font-weight:600;color:#f1f5f9;">' + (p.provider || 'Unknown') + '</td>';
      html += '<td style="text-align:right;padding:7px 8px;color:' + ggrColor + ';font-weight:700;">' + fmt(p.ggr) + '</td>';
      html += '<td style="text-align:right;padding:7px 8px;color:#64748b;">' + share + '</td>';
      html += '<td style="text-align:right;padding:7px 8px;color:#64748b;">' + fmtN(p.players) + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';

    html += '</div>'; // end 2-col

    // Top Players
    html += '<div style="background:#111827;border:1px solid #1e2d45;border-radius:12px;padding:20px;">';
    html += '<h3 style="font-size:15px;font-weight:700;color:#f1f5f9;margin:0 0 14px;">Top Players by GGR</h3>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
    html += '<thead><tr style="color:#64748b;border-bottom:1px solid #1e2d45;">';
    html += '<th style="text-align:left;padding:6px 8px;">#</th>';
    html += '<th style="text-align:left;padding:6px 8px;">Player</th>';
    html += '<th style="text-align:right;padding:6px 8px;">GGR</th>';
    html += '<th style="text-align:right;padding:6px 8px;">Bets</th>';
    html += '<th style="text-align:right;padding:6px 8px;">Rounds</th>';
    html += '<th style="text-align:right;padding:6px 8px;">RTP</th>';
    html += '</tr></thead><tbody>';
    (d.topPlayers || []).forEach(function (p, i) {
      var rtp = parseFloat(p.bets) > 0 ? (parseFloat(p.wins) / parseFloat(p.bets) * 100).toFixed(1) + '%' : '—';
      var ggrColor = parseFloat(p.ggr) >= 0 ? '#10b981' : '#ef4444';
      html += '<tr style="border-bottom:1px solid rgba(30,45,69,0.5);">';
      html += '<td style="padding:7px 8px;color:#64748b;">' + (i + 1) + '</td>';
      html += '<td style="padding:7px 8px;font-weight:600;color:#f1f5f9;">' + (p.user_email || '—') + '</td>';
      html += '<td style="text-align:right;padding:7px 8px;color:' + ggrColor + ';font-weight:700;">' + fmt(p.ggr) + '</td>';
      html += '<td style="text-align:right;padding:7px 8px;color:#64748b;">' + fmt(p.bets) + '</td>';
      html += '<td style="text-align:right;padding:7px 8px;color:#64748b;">' + fmtN(p.rounds) + '</td>';
      html += '<td style="text-align:right;padding:7px 8px;color:#64748b;">' + rtp + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';

    el.innerHTML = html;

    // Update period button styles
    ['1d','7d','30d','90d'].forEach(function(p) {
      var btn = document.getElementById('bi-period-' + p);
      if (!btn) return;
      var active = p === currentPeriod;
      btn.style.borderColor = active ? '#f59e0b' : '#1e2d45';
      btn.style.background = active ? 'rgba(245,158,11,0.15)' : 'transparent';
      btn.style.color = active ? '#f59e0b' : '#64748b';
    });
  }

  /* ── Boot ── */
  var _biObs = null;

  function startBiObserver() {
    if (_biObs) return;
    _biObs = new MutationObserver(function() {
      if (location.pathname.startsWith('/admin') && !document.getElementById('bi-nav-btn')) {
        injectNavBtn();
      }
    });
    _biObs.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    if (!location.pathname.startsWith('/admin')) return;
    var attempts = 0;
    var interval = setInterval(function () {
      var ok = injectNavBtn();
      attempts++;
      if (ok || attempts > 60) clearInterval(interval);
    }, 300);
    startBiObserver();
  }

  function closeBiOverlay() {
    var ov = document.getElementById('bi-overlay');
    if (ov) ov.remove();
    var btn = document.getElementById('bi-nav-btn');
    if (btn) {
      btn.classList.remove('bg-amber-500/15', 'text-amber-400');
      btn.classList.add('text-slate-400');
    }
  }
  window.closeBiOverlay = closeBiOverlay;

  var origPush = history.pushState;
  history.pushState = function () {
    closeBiOverlay();
    origPush.apply(this, arguments);
    if (location.pathname.startsWith('/admin')) setTimeout(init, 300);
  };

  window.addEventListener('popstate', function() {
    closeBiOverlay();
    if (location.pathname.startsWith('/admin')) setTimeout(init, 300);
  });

  window.addEventListener('popstate', function() {
    if (location.pathname.startsWith('/admin')) setTimeout(init, 300);
  });

  if (document.readyState !== 'loading') {
    setTimeout(init, 800);
  } else {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 800); });
  }
})();
