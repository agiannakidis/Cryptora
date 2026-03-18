// analytics-admin.js — Admin Analytics Dashboard for Cryptora
(function () {
  'use strict';

  const ROUTE = '/admin/analytics';

  // ── Inject nav button into admin sidebar ────────────────────────────────
  function injectNavLink() {
    if (document.getElementById('analytics-nav-link')) return true;

    // Nav is inside <aside> > <nav> and uses <button> elements (not <a> tags)
    const nav = document.querySelector('aside nav');
    if (!nav) return false;

    const buttons = nav.querySelectorAll('button');
    if (!buttons.length) return false;

    // Clone the last button (most neutral, e.g. Support/Admins)
    const srcBtn = buttons[buttons.length - 1];
    const newBtn = srcBtn.cloneNode(true);
    newBtn.id = 'analytics-nav-link';

    // Remove active highlight classes if present
    newBtn.classList.remove('bg-amber-500/15', 'text-amber-400');
    newBtn.classList.add('text-slate-400', 'hover:bg-white/5', 'hover:text-white');

    // Set content directly — most reliable (avoids text node / span structure issues)
    newBtn.innerHTML = '<span style="font-size:16px;line-height:1">📊</span><span>Analytics</span>';

    newBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      nav.querySelectorAll('button').forEach(b => {
        b.classList.remove('bg-amber-500/15', 'text-amber-400');
        b.classList.add('text-slate-400');
      });
      newBtn.classList.remove('text-slate-400');
      newBtn.classList.add('bg-amber-500/15', 'text-amber-400');
      renderAnalyticsPage();
    });

    nav.appendChild(newBtn);

    // Capture clicks on any sidebar button (except Analytics itself) to close overlay
    if (!nav.__analyticsCaptureAttached) {
      nav.__analyticsCaptureAttached = true;
      nav.addEventListener('click', function(e) {
        const btn = e.target.closest('button');
        if (btn && btn.id !== 'analytics-nav-link' && window.__analyticsActive) {
          window.closeAnalyticsOverlay && window.closeAnalyticsOverlay();
        }
      }, true);
    }
    return true;
  }

  // ── Render the full analytics page ──────────────────────────────────────
  function renderAnalyticsPage() {
    window.__analyticsActive = true;

    // Remove existing overlay
    const existing = document.getElementById('analytics-overlay');
    if (existing) existing.remove();

    // Use overlay instead of replacing main content (avoids breaking React navigation)
    const overlay = document.createElement('div');
    overlay.id = 'analytics-overlay';
    const aside = document.querySelector('aside');
    const sidebarW = aside ? aside.offsetWidth : 240;
    overlay.style.cssText = 'position:fixed;top:0;left:' + sidebarW + 'px;right:0;bottom:0;z-index:40;overflow-y:auto;background:#0a0e1a;';
    document.body.appendChild(overlay);
    const main = overlay;

    if (window.__crObserver) { window.__crObserver.disconnect(); window.__crObserver = null; }

    const period = sessionStorage.getItem('cr_admin_period') || '7d';

    // Inject styles once
    if (!document.getElementById('cr-analytics-style')) {
      const style = document.createElement('style');
      style.id = 'cr-analytics-style';
      style.textContent = `
        #cr-analytics * { box-sizing: border-box; }
        .cr-card { background:#1a1f2e; border-radius:12px; padding:20px; border:1px solid #252d40; }
        .cr-skeleton { background:linear-gradient(90deg,#1a1f2e 25%,#252a3a 50%,#1a1f2e 75%); background-size:200% 100%; animation:cr-shimmer 1.5s infinite; border-radius:12px; }
        @keyframes cr-shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        .cr-label { font-size:11px; font-weight:700; color:#6b7280; text-transform:uppercase; letter-spacing:.06em; margin:0 0 14px; }
        .cr-row { display:flex; align-items:center; justify-content:space-between; padding:7px 0; border-bottom:1px solid #1f2937; }
        .cr-row:last-child { border-bottom:none; }
        #cr-sessions-body tr { border-bottom:1px solid #1a1f2e; }
        #cr-sessions-body tr:hover td { background:#1f2937; }
        #cr-sessions-body td { padding:9px 12px; color:#d1d5db; font-size:13px; vertical-align:middle; white-space:nowrap; }
        .cr-th { padding:8px 12px; font-size:11px; font-weight:700; color:#6b7280; text-transform:uppercase; letter-spacing:.05em; border-bottom:1px solid #1f2937; text-align:left; }
        .cr-period-btn { padding:6px 14px; border-radius:8px; border:1px solid #374151; background:#1f2937; color:#9ca3af; cursor:pointer; font-size:13px; font-weight:500; transition:all .15s; }
        .cr-period-btn.active { border-color:#6366f1; background:#6366f1; color:#fff; font-weight:700; }
        .cr-period-btn:hover:not(.active) { border-color:#4b5563; color:#e5e7eb; }
      `;
      document.head.appendChild(style);
    }

    main.innerHTML = `
<div id="cr-analytics" style="padding:0;font-family:system-ui,sans-serif;color:#e2e8f0;min-height:100%">

  <!-- Header -->
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
    <div>
      <h1 style="margin:0 0 2px;font-size:22px;font-weight:700;color:#fff">Traffic Analytics</h1>
      <p style="margin:0;font-size:13px;color:#6b7280">Visits, registrations, sources and user sessions</p>
    </div>
    <div style="display:flex;gap:6px">
      ${['1d','7d','30d','90d'].map(p => `<button class="cr-period-btn${p===period?' active':''}" onclick="window.__crPeriod('${p}')">${p==='1d'?'Today':p==='7d'?'7 days':p==='30d'?'30 days':'90 days'}</button>`).join('')}
    </div>
  </div>

  <!-- KPI row -->
  <div id="cr-kpi" style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px">
    ${[1,2,3,4,5].map(()=>`<div class="cr-skeleton" style="height:88px"></div>`).join('')}
  </div>

  <!-- Row 2: chart + events -->
  <div style="display:grid;grid-template-columns:1fr 280px;gap:16px;margin-bottom:16px;align-items:start">
    <div class="cr-card">
      <p class="cr-label">Daily Visits</p>
      <div id="cr-daily-chart" style="height:150px;display:flex;align-items:flex-end;gap:3px;overflow:hidden"></div>
    </div>
    <div class="cr-card">
      <p class="cr-label">Event Breakdown</p>
      <div id="cr-events-list"></div>
    </div>
  </div>

  <!-- Row 3: referrers + UTM -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;align-items:start">
    <div class="cr-card">
      <p class="cr-label">Traffic Sources</p>
      <div id="cr-referrers"></div>
    </div>
    <div class="cr-card">
      <p class="cr-label">UTM Campaigns</p>
      <div id="cr-utm"></div>
    </div>
  </div>

  <!-- Row 4: top pages + top games -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;align-items:start">
    <div class="cr-card">
      <p class="cr-label">Top Pages</p>
      <div id="cr-pages"></div>
    </div>
    <div class="cr-card">
      <p class="cr-label">🎮 Top Games</p>
      <div id="cr-top-games"><p style="color:#4b5563;font-size:13px">Loading...</p></div>
    </div>
  </div>

  <!-- Row 5: sessions table -->
  <div class="cr-card">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <p class="cr-label" style="margin:0">User Sessions</p>
      <span id="cr-sessions-count" style="font-size:12px;color:#6b7280;background:#0f1117;padding:3px 10px;border-radius:20px"></span>
    </div>
    <div style="overflow-x:auto;margin:0 -20px;padding:0 20px">
      <table style="width:100%;border-collapse:collapse;min-width:620px">
        <thead>
          <tr>
            <th class="cr-th">Time</th>
            <th class="cr-th">IP</th>
            <th class="cr-th">Source</th>
            <th class="cr-th">User</th>
            <th class="cr-th" style="text-align:center">Pages</th>
            <th class="cr-th" style="text-align:center">Games</th>
            <th class="cr-th" style="text-align:center">Deps</th>
          </tr>
        </thead>
        <tbody id="cr-sessions-body">
          <tr><td colspan="7" style="padding:32px;text-align:center;color:#4b5563">Loading...</td></tr>
        </tbody>
      </table>
    </div>
    <div id="cr-sessions-pagination" style="margin-top:14px;display:flex;gap:6px;justify-content:flex-end"></div>
  </div>

</div>`;

    window.__crPeriod = function (p) {
      sessionStorage.setItem('cr_admin_period', p);
      renderAnalyticsPage();
    };
    window.__crPage = function (p) { loadSessions(p); };

    loadStats(period);
    loadSessions(1, period);

    function loadStats(period) {
      fetch('/api/analytics/stats?period=' + period)
        .then(r => r.json())
        .then(d => {
          if (!d.ok) return;
          const ev = {};
          (d.events || []).forEach(e => { ev[e.event_type] = parseInt(e.cnt); });
          const conv = d.totalVisits > 0
            ? ((parseInt(d.conversion?.converted || 0) / d.totalVisits) * 100).toFixed(1) : '0.0';

          // KPI cards
          const kpis = [
            { label: 'Unique Visits',   value: d.totalVisits,                                          icon: '👁️',  color: '#6366f1' },
            { label: 'Registrations',   value: d.registrations,                                        icon: '✅',  color: '#10b981' },
            { label: 'Game Sessions',   value: (d.gameSessions || ev.game_start || 0).toLocaleString(), icon: '🎮',  color: '#f59e0b' },
            { label: 'Deposits',        value: (d.deposits || 0) + (d.depositVolume > 0 ? ' ($'+d.depositVolume+')' : ''), icon: '💰',  color: '#3b82f6' },
            { label: 'Conversion',      value: (d.conversionPct || conv) + '%',                        icon: '📈',  color: '#8b5cf6' },
          ];
          const kpiEl = document.getElementById('cr-kpi');
          if (kpiEl) kpiEl.innerHTML = kpis.map(c => `
            <div class="cr-card" style="border-top:3px solid ${c.color};padding:16px">
              <div style="font-size:20px;margin-bottom:6px">${c.icon}</div>
              <div style="font-size:26px;font-weight:800;color:#fff;line-height:1">${c.value}</div>
              <div style="font-size:11px;color:#6b7280;margin-top:6px;font-weight:500">${c.label}</div>
            </div>`).join('');

          // Daily chart
          const daily = d.dailyVisits || [];
          const maxV = Math.max(...daily.map(r => parseInt(r.cnt)), 1);
          const chartEl = document.getElementById('cr-daily-chart');
          if (chartEl) {
            if (daily.length) {
              chartEl.innerHTML = daily.map(r => {
                const h = Math.max(4, (parseInt(r.cnt) / maxV) * 130);
                const day = new Date(r.day).toLocaleDateString('en-GB', { day:'2-digit', month:'2-digit' });
                return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0" title="${day}: ${r.cnt} visits">
                  <div style="width:100%;background:#6366f1;border-radius:3px 3px 0 0;height:${h}px;opacity:.8;transition:opacity .2s" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=.8"></div>
                  <div style="font-size:9px;color:#4b5563;white-space:nowrap;overflow:hidden;max-width:100%;text-overflow:ellipsis">${day}</div>
                </div>`;
              }).join('');
            } else {
              chartEl.innerHTML = '<div style="color:#4b5563;width:100%;text-align:center;font-size:13px;padding-top:50px">No data for this period</div>';
            }
          }

          // Events
          const evEl = document.getElementById('cr-events-list');
          if (evEl) {
            const labels = { visit:'🌐 Visit', pageview:'📄 Pageview', register:'✅ Register',
              login:'🔑 Login', game_start:'🎮 Game Start', deposit:'💰 Deposit',
              deposit_intent:'💳 Deposit Intent', identify:'👤 Identify', verified:'✔️ Verified' };
            // Merge tracker events with real game sessions count for accuracy
            const evRows = [...(d.events || [])];
            // Add real game sessions row if not already tracked
            const hasGameRow = evRows.some(e => e.event_type === 'game_start');
            if (!hasGameRow && d.gameSessions > 0) {
              evRows.push({ event_type: 'game_start', cnt: String(d.gameSessions) });
            }
            evEl.innerHTML = evRows.map(e => `
              <div class="cr-row">
                <span style="font-size:13px;color:#d1d5db">${labels[e.event_type] || e.event_type}</span>
                <span style="font-weight:700;color:#fff;font-size:14px">${parseInt(e.cnt).toLocaleString()}</span>
              </div>`).join('') || '<p style="color:#4b5563;font-size:13px">No data</p>';
          }

          // Top games
          const topGEl = document.getElementById('cr-top-games');
          if (topGEl && d.topGames && d.topGames.length) {
            const maxG = Math.max(...d.topGames.map(g => parseInt(g.cnt)), 1);
            topGEl.innerHTML = d.topGames.map(g => {
              const pct = Math.round((parseInt(g.cnt) / maxG) * 100);
              return `<div style="margin-bottom:8px">
                <div style="display:flex;justify-content:space-between;margin-bottom:3px">
                  <span style="font-size:12px;color:#d1d5db;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px">${g.game_title || 'Unknown'}</span>
                  <span style="font-size:12px;font-weight:700;color:#fff;margin-left:8px">${g.cnt}</span>
                </div>
                <div style="height:4px;background:#0f1117;border-radius:2px">
                  <div style="height:100%;width:${pct}%;background:#f59e0b;border-radius:2px"></div>
                </div>
              </div>`;
            }).join('');
          } else if (topGEl) {
            topGEl.innerHTML = '<p style="color:#4b5563;font-size:13px">No game data yet</p>';
          }

          // Referrers
          const refEl = document.getElementById('cr-referrers');
          if (refEl) {
            const maxR = Math.max(...(d.topReferrers || []).map(r => parseInt(r.cnt)), 1);
            refEl.innerHTML = (d.topReferrers || []).map(r => {
              const pct = Math.round((parseInt(r.cnt) / maxR) * 100);
              const lbl = r.referrer === 'Direct' ? '🏠 Direct' : r.referrer.replace(/https?:\/\/(www\.)?/, '').slice(0, 38);
              return `<div style="margin-bottom:10px">
                <div style="display:flex;justify-content:space-between;margin-bottom:4px">
                  <span style="font-size:12px;color:#d1d5db;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px" title="${r.referrer}">${lbl}</span>
                  <span style="font-size:12px;font-weight:700;color:#fff;margin-left:8px">${r.cnt}</span>
                </div>
                <div style="height:4px;background:#0f1117;border-radius:2px">
                  <div style="height:100%;width:${pct}%;background:#6366f1;border-radius:2px"></div>
                </div>
              </div>`;
            }).join('') || '<p style="color:#4b5563;font-size:13px">No data</p>';
          }

          // UTM
          const utmEl = document.getElementById('cr-utm');
          if (utmEl) {
            utmEl.innerHTML = (d.topUtm || []).map(r => {
              const src = r.source !== '—' ? r.source : '';
              const med = r.medium !== '—' ? '/'+r.medium : '';
              const camp = r.campaign !== '—' ? ' ('+r.campaign+')' : '';
              const lbl = (src||med) ? src+med+camp : '(no UTM)';
              return `<div class="cr-row">
                <span style="font-size:12px;color:#d1d5db;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px">${lbl}</span>
                <span style="background:#1f2937;color:#818cf8;border-radius:20px;padding:2px 10px;font-size:11px;font-weight:700;margin-left:8px">${r.cnt}</span>
              </div>`;
            }).join('') || '<p style="color:#4b5563;font-size:13px">No data</p>';
          }

          // Top pages
          const pgEl = document.getElementById('cr-pages');
          if (pgEl) {
            const maxPg = Math.max(...(d.topPages || []).map(r => parseInt(r.cnt)), 1);
            pgEl.innerHTML = (d.topPages || []).map(r => {
              const pct = Math.round((parseInt(r.cnt) / maxPg) * 100);
              return `<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
                <code style="font-size:12px;color:#818cf8;min-width:180px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0">${r.page||'/'}</code>
                <div style="flex:1;height:5px;background:#0f1117;border-radius:3px">
                  <div style="height:100%;width:${pct}%;background:#6366f1;border-radius:3px"></div>
                </div>
                <span style="font-size:12px;font-weight:700;color:#fff;min-width:36px;text-align:right">${r.cnt}</span>
              </div>`;
            }).join('') || '<p style="color:#4b5563;font-size:13px">No data</p>';
          }
        })
        .catch(e => console.error('Analytics stats error:', e));
    }

    function loadSessions(page, p) {
      page = page || 1;
      const period = p || sessionStorage.getItem('cr_admin_period') || '7d';
      fetch('/api/analytics/sessions?period=' + period + '&page=' + page + '&limit=30')
        .then(r => r.json())
        .then(d => {
          if (!d.ok) return;
          const tbody = document.getElementById('cr-sessions-body');
          const countEl = document.getElementById('cr-sessions-count');
          if (countEl) countEl.textContent = 'Total: ' + d.total;
          if (!tbody) return;

          if (!d.sessions.length) {
            tbody.innerHTML = '<tr><td colspan="7" style="padding:32px;text-align:center;color:#4b5563">No sessions for this period</td></tr>';
            return;
          }

          tbody.innerHTML = d.sessions.map(s => {
            const dt = new Date(s.created_at);
            const time = dt.toLocaleString('en-GB', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
            const src = s.utm_source
              ? `<span style="color:#818cf8;font-weight:600">${s.utm_source}${s.utm_medium?'/'+s.utm_medium:''}</span>`
              : s.referrer
                ? `<span style="color:#9ca3af;font-size:11px">${s.referrer.replace(/https?:\/\/(www\.)?/,'').slice(0,22)}</span>`
                : `<span style="color:#4b5563">Direct</span>`;
            const user = s.email
              ? `<span style="color:#10b981">${(s.name||s.email).slice(0,22)}</span>`
              : `<span style="color:#374151">—</span>`;
            const games = parseInt(s.games_played);
            const deps  = parseInt(s.deposits);
            return `<tr>
              <td style="color:#9ca3af">${time}</td>
              <td><code style="font-size:11px;color:#4b5563">${(s.ip||'—').slice(0,15)}</code></td>
              <td>${src}</td>
              <td>${user}</td>
              <td style="text-align:center;color:#6b7280">${s.event_count}</td>
              <td style="text-align:center">${games>0?`<span style="color:#f59e0b;font-weight:700">${games}</span>`:'<span style="color:#1f2937">—</span>'}</td>
              <td style="text-align:center">${deps>0?`<span style="color:#10b981;font-weight:700">${deps}</span>`:'<span style="color:#1f2937">—</span>'}</td>
            </tr>`;
          }).join('');

          const pgEl = document.getElementById('cr-sessions-pagination');
          if (pgEl) {
            const total = Math.ceil(d.total / 30);
            pgEl.innerHTML = total > 1
              ? Array.from({length: Math.min(total, 10)}, (_,i) => i+1).map(n =>
                  `<button onclick="window.__crPage(${n})" style="padding:4px 10px;border-radius:6px;border:1px solid ${n===page?'#6366f1':'#374151'};background:${n===page?'#6366f1':'#1f2937'};color:#fff;cursor:pointer;font-size:12px">${n}</button>`
                ).join('')
              : '';
          }
        })
        .catch(e => console.error('Sessions error:', e));
    }
  }

  // ── Watch for admin routes ───────────────────────────────────────────────
  let _analyticsObs = null;

  function startAnalyticsObserver() {
    if (_analyticsObs) return;
    _analyticsObs = new MutationObserver(() => {
      if (location.pathname.startsWith('/admin') && !document.getElementById('analytics-nav-link')) {
        injectNavLink();
      }
    });
    _analyticsObs.observe(document.body, { childList: true, subtree: true });
  }

  function watchRoute() {
    if (!location.pathname.startsWith('/admin')) return;
    let attempts = 0;
    const interval = setInterval(() => {
      const ok = injectNavLink();
      attempts++;
      if (ok || attempts > 40) clearInterval(interval);
    }, 300);
    startAnalyticsObserver();
  }

  function closeAnalyticsOverlay() {
    const ov = document.getElementById('analytics-overlay');
    if (ov) ov.remove();
    window.__analyticsActive = false;
    if (location.hash === '#analytics') history.replaceState(null, '', location.pathname);
    const btn = document.getElementById('analytics-nav-link');
    if (btn) {
      btn.classList.remove('bg-amber-500/15', 'text-amber-400');
      btn.classList.add('text-slate-400');
    }
  }
  window.closeAnalyticsOverlay = closeAnalyticsOverlay;

  const origPush = history.pushState;
  history.pushState = function () {
    if (window.__analyticsActive) closeAnalyticsOverlay();
    origPush.apply(this, arguments);
    if (location.pathname.startsWith('/admin')) {
      setTimeout(watchRoute, 200);
    }
  };

  window.addEventListener('popstate', function() {
    if (window.__analyticsActive) closeAnalyticsOverlay();
    if (location.pathname.startsWith('/admin')) setTimeout(watchRoute, 300);
  });

  window.addEventListener('popstate', () => {
    if (location.pathname.startsWith('/admin')) {
      setTimeout(watchRoute, 300);
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchRoute);
  } else {
    watchRoute();
  }
})();
