/* app.js — Cryptora Partners SPA v2 */
'use strict';

// ── Toast system ────────────────────────────────────────────────
function showToast(msg, type) {
  type = type || 'info';
  var c = document.getElementById('toast-container');
  if (!c) return;
  var t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(function() { t.remove(); }, 4000);
}

// ── Helpers ─────────────────────────────────────────────────────
function fmt$( v) { return '$' + (parseFloat(v)||0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function fmtN( v) { return (parseInt(v)||0).toLocaleString(); }
function fmtDate(d) { if(!d) return '—'; return new Date(d).toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'}); }
function el(tag, cls, html) { var e = document.createElement(tag); if(cls) e.className = cls; if(html) e.innerHTML = html; return e; }
function skeletonLines(n) { var h=''; for(var i=0;i<n;i++) h+='<div class="skeleton skeleton-line '+(i%3===0?'narrow':i%3===1?'medium':'wide')+'"></div>'; return h; }

function badge(text, color) {
  var cls = {active:'badge-green',paid:'badge-green',completed:'badge-green',registered:'badge-blue',pending:'badge-amber',processing:'badge-amber',failed:'badge-red',rejected:'badge-red',suspended:'badge-red'};
  return '<span class="badge ' + (cls[text] || cls[color] || 'badge-muted') + '">' + (text||'—') + '</span>';
}

function pagination(total, limit, offset, onPage) {
  var pages = Math.ceil(total/limit);
  var cur = Math.floor(offset/limit);
  var wrap = el('div','pagination');
  var info = el('span','pagination-info');
  info.textContent = 'Showing ' + (offset+1) + '–' + Math.min(offset+limit, total) + ' of ' + fmtN(total);
  wrap.appendChild(info);
  var btns = el('div','pagination-btns');
  var prev = el('button','page-btn'); prev.textContent = '←'; prev.disabled = cur===0;
  prev.onclick = function() { if(cur>0) onPage((cur-1)*limit); };
  btns.appendChild(prev);
  for(var i=0;i<Math.min(pages,7);i++) {
    var pb = el('button','page-btn'+(i===cur?' active':''));
    pb.textContent = i+1;
    (function(p){ pb.onclick = function(){ onPage(p*limit); }; })(i);
    btns.appendChild(pb);
  }
  var next = el('button','page-btn'); next.textContent = '→'; next.disabled = cur>=pages-1;
  next.onclick = function() { if(cur<pages-1) onPage((cur+1)*limit); };
  btns.appendChild(next);
  wrap.appendChild(btns);
  return wrap;
}

// ── Auth Guard ──────────────────────────────────────────────────
function guardAuth() {
  if (!API.hasToken()) {
    renderLogin();
    return false;
  }
  return true;
}

// ── Pages ────────────────────────────────────────────────────────

async function renderDashboard(container) {
  container.innerHTML = '<div class="section-header"><div><h2 class="section-title">Dashboard</h2><div class="section-subtitle">Performance overview</div></div><div class="filter-bar">' +
    '<input type="date" class="form-control" id="d-from"> <span style="color:var(--text-muted)">to</span> <input type="date" class="form-control" id="d-to">' +
    '<button class="btn btn-secondary btn-sm" id="d-apply">Apply</button></div></div>' +
    '<div id="kpi-grid" class="kpi-grid">' + Array(8).fill('<div class="kpi-card"><div class="skeleton skeleton-line narrow"></div><div class="skeleton skeleton-line medium" style="height:28px;margin-top:8px"></div></div>').join('') + '</div>' +
    '<div class="card" style="margin-top:20px"><div class="card-header"><span class="card-title">Earnings Over Time</span></div><div id="chart-area"><div class="chart-empty">Loading...</div></div></div>';

  // Set default date range
  var now = new Date();
  var from = new Date(now); from.setDate(from.getDate()-30);
  document.getElementById('d-from').value = from.toISOString().slice(0,10);
  document.getElementById('d-to').value = now.toISOString().slice(0,10);
  document.getElementById('d-apply').onclick = function() { loadStats(); };

  async function loadStats() {
    var fromVal = document.getElementById('d-from').value;
    var toVal = document.getElementById('d-to').value;
    try {
      var data = await API.stats({ from: fromVal, to: toVal });
      var grid = document.getElementById('kpi-grid');
      if (!grid) return;
      var kpis = [
        { label:'Clicks', value: fmtN(data.clicks||0), delta:null },
        { label:'Registrations', value: fmtN(data.players||0), delta:null },
        { label:'FTDs', value: fmtN(data.depositors||0), delta:null },
        { label:'Conv. Rate', value: data.players > 0 ? (((data.depositors||0)/data.players)*100).toFixed(1)+'%' : '—', delta:null },
        { label:'Total Deposits', value: fmt$(data.total_deposits||0), delta:null },
        { label:'NGR', value: fmt$(data.ngr||0), delta:null },
        { label:'Earned', value: fmt$(data.total_earned||0), delta:null },
        { label:'Balance', value: fmt$(data.balance||0), delta:null },
      ];
      grid.innerHTML = kpis.map(function(k) {
        return '<div class="kpi-card"><div class="kpi-label">' + k.label + '</div><div class="kpi-value">' + k.value + '</div>' +
          (k.delta ? '<div class="kpi-delta neutral">—</div>' : '') + '</div>';
      }).join('');
    } catch(e) {
      showToast(e.message, 'error');
    }
  }
  loadStats();
}

async function renderPlayers(container) {
  var offset = 0; var limit = 20;
  container.innerHTML = '<div class="section-header"><div><h2 class="section-title">Players</h2><div class="section-subtitle">Your referred players</div></div>' +
    '</div><div class="filter-bar"><input class="form-control" id="p-search" placeholder="Search email..." style="min-width:200px">' +
    '<button class="btn btn-secondary btn-sm" id="p-search-btn">Search</button></div>' +
    '<div class="card"><div id="players-table"></div></div>';

  document.getElementById('p-search-btn').onclick = function() { offset=0; loadPlayers(); };
  document.getElementById('p-search').onkeydown = function(e) { if(e.key==='Enter') { offset=0; loadPlayers(); } };

  async function loadPlayers() {
    var t = document.getElementById('players-table');
    t.innerHTML = '<div class="state-loading">Loading...</div>';
    try {
      var search = document.getElementById('p-search').value;
      var data = await API.players({ limit:limit, offset:offset, search:search });
      var rows = data.players || [];
      if (!rows.length) {
        t.innerHTML = '<div class="state-empty"><h3>No players yet</h3><p>Players will appear here once someone registers via your referral link.</p></div>';
        return;
      }
      var html = '<div class="table-wrap"><table><thead><tr><th>Player ID</th><th>Email</th><th>Registered</th><th>FTD Date</th><th>FTD Amount</th><th>Source</th><th>Status</th></tr></thead><tbody>';
      rows.forEach(function(r) {
        html += '<tr><td class="mono primary">' + (r.id||'').slice(-8) + '</td>' +
          '<td>' + (r.email||'—') + '</td>' +
          '<td>' + fmtDate(r.registered_at) + '</td>' +
          '<td>' + fmtDate(r.first_deposit_at) + '</td>' +
          '<td class="number">' + (r.first_deposit_amount > 0 ? fmt$(r.first_deposit_amount) : '—') + '</td>' +
          '<td class="mono">' + (r.sub1||'—') + '</td>' +
          '<td>' + badge(r.status) + '</td></tr>';
      });
      html += '</tbody></table></div>';
      t.innerHTML = html;
      if (data.total > limit) {
        t.appendChild(pagination(data.total, limit, offset, function(o) { offset=o; loadPlayers(); }));
      }
    } catch(e) {
      t.innerHTML = '<div class="state-error">' + e.message + '</div>';
    }
  }
  loadPlayers();
}

async function renderReports(container) {
  container.innerHTML = '<div class="section-header"><div><h2 class="section-title">Reports</h2><div class="section-subtitle">Detailed analytics</div></div></div>' +
    '<div class="filter-bar">' +
    '<input type="date" class="form-control" id="r-from"> <span style="color:var(--text-muted)">to</span> <input type="date" class="form-control" id="r-to">' +
    '<button class="btn btn-secondary btn-sm" id="r-apply">Apply</button></div>' +
    '<div class="card"><div id="reports-table"><div class="state-loading">Loading...</div></div></div>';

  var now = new Date();
  var from = new Date(now); from.setDate(from.getDate()-30);
  document.getElementById('r-from').value = from.toISOString().slice(0,10);
  document.getElementById('r-to').value = now.toISOString().slice(0,10);
  document.getElementById('r-apply').onclick = loadReports;

  async function loadReports() {
    var t = document.getElementById('reports-table');
    t.innerHTML = '<div class="state-loading">Loading...</div>';
    var fromVal = document.getElementById('r-from').value;
    var toVal = document.getElementById('r-to').value;
    try {
      var data = await API.clicks({ from:fromVal, to:toVal, limit:500 });
      var rows = (data.clicks || data.items || data.rows || []);
      if (!rows.length) {
        t.innerHTML = '<div class="state-empty"><h3>No data for this period</h3><p>Try a wider date range.</p></div>';
        return;
      }
      var html = '<div class="table-wrap"><table><thead><tr><th>Date</th><th>Sub ID</th><th>Clicks</th><th>Conversions</th></tr></thead><tbody>';
      rows.forEach(function(r) {
        html += '<tr><td>' + fmtDate(r.created_at||r.date) + '</td><td class="mono">' + (r.sub1||'—') + '</td><td class="number">' + fmtN(r.count||1) + '</td><td class="number">' + fmtN(r.conversions||0) + '</td></tr>';
      });
      html += '</tbody></table></div>';
      t.innerHTML = html;
    } catch(e) {
      t.innerHTML = '<div class="state-error">' + e.message + '</div>';
    }
  }
  loadReports();
}

async function renderCommissions(container) {
  container.innerHTML = '<div class="section-header"><div><h2 class="section-title">Commissions</h2></div></div><div class="card"><div id="comm-table"><div class="state-loading">Loading...</div></div></div>';
  var t = document.getElementById('comm-table');
  try {
    var data = await API.commissions({ limit:50 });
    var rows = data.commissions || data.items || data || [];
    if (!rows.length) {
      t.innerHTML = '<div class="state-empty"><h3>No commissions yet</h3><p>Commissions are calculated based on your referred players\' activity.</p></div>';
      return;
    }
    var html = '<div class="table-wrap"><table><thead><tr><th>Period</th><th>NGR</th><th>Rate</th><th>Amount</th><th>Status</th><th>Paid At</th></tr></thead><tbody>';
    rows.forEach(function(r) {
      html += '<tr><td>' + (r.period_start||'') + ' – ' + (r.period_end||'') + '</td>' +
        '<td class="number">' + fmt$(r.ngr||0) + '</td>' +
        '<td class="number">' + (r.revshare_percent||0) + '%</td>' +
        '<td class="number primary">' + fmt$(r.amount||0) + '</td>' +
        '<td>' + badge(r.status) + '</td>' +
        '<td>' + fmtDate(r.paid_at) + '</td></tr>';
    });
    html += '</tbody></table></div>';
    t.innerHTML = html;
  } catch(e) {
    t.innerHTML = '<div class="state-error">' + e.message + '</div>';
  }
}

async function renderTracking(container) {
  container.innerHTML = '<div class="section-header"><div><h2 class="section-title">Tracking & Integration</h2></div></div><div id="tracking-content"><div class="state-loading">Loading...</div></div>';
  var tc = document.getElementById('tracking-content');
  try {
    var profile = await API.profile();
    var refCode = profile.ref_code || '';
    var refLink = 'https://cryptora.live/?ref=' + refCode;
    var postbackUrl = profile.postback_url || '';
    tc.innerHTML =
      '<div class="card" style="margin-bottom:16px">' +
      '<div class="card-header"><span class="card-title">Referral Link</span></div>' +
      '<div class="form-group"><label class="form-label">Your unique referral link</label>' +
      '<div style="display:flex;gap:8px">' +
      '<input class="form-control" id="ref-link-input" value="' + refLink + '" readonly>' +
      '<button class="btn btn-secondary" onclick="navigator.clipboard.writeText(document.getElementById(\'ref-link-input\').value).then(function(){showToast(\'Copied!\',\'success\')})">Copy</button></div>' +
      '</div>' +
      '<div class="form-group"><label class="form-label">Sub ID Builder</label>' +
      '<div style="display:flex;gap:8px">' +
      '<input class="form-control" id="sub1-input" placeholder="campaign name">' +
      '<button class="btn btn-secondary btn-sm" onclick="var s=document.getElementById(\'sub1-input\').value;var u=\'https://cryptora.live/?ref='+refCode+'\'+(s?\'&sub=\'+encodeURIComponent(s):\'\');document.getElementById(\'ref-link-input\').value=u">Build</button>' +
      '</div></div></div>' +
      '<div class="card"><div class="card-header"><span class="card-title">Postback (S2S)</span></div>' +
      '<p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:12px">Receive server-to-server callbacks for registrations and deposits.</p>' +
      '<div class="form-group"><label class="form-label">Postback URL</label>' +
      '<input class="form-control" id="postback-input" value="' + (postbackUrl||'') + '" placeholder="https://yourtracker.com/postback?click_id={click_id}&event={event}&amount={amount}">' +
      '</div>' +
      '<div class="form-group"><label class="form-label">Available Macros</label>' +
      '<code style="font-size:0.78rem;color:var(--text-secondary);background:var(--bg-elevated);padding:8px 12px;border-radius:6px;display:block">' +
      '{click_id} {ref_code} {sub1} {event} {player_id} {amount} {currency}' +
      '</code></div>' +
      '<div style="display:flex;gap:8px">' +
      '<button class="btn btn-primary" id="save-postback">Save Postback URL</button>' +
      '<button class="btn btn-secondary" id="test-postback">Send Test</button>' +
      '</div></div>';

    document.getElementById('save-postback').onclick = async function() {
      var url = document.getElementById('postback-input').value.trim();
      try {
        await API.updatePostback(url);
        showToast('Postback URL saved', 'success');
      } catch(e) { showToast(e.message, 'error'); }
    };
    document.getElementById('test-postback').onclick = async function() {
      try {
        var r = await API.testPostback();
        showToast(r.message || 'Test sent', 'success');
      } catch(e) { showToast(e.message, 'error'); }
    };
  } catch(e) {
    tc.innerHTML = '<div class="state-error">' + e.message + '</div>';
  }
}

async function renderNotifications(container) {
  container.innerHTML = '<div class="section-header"><div><h2 class="section-title">Notifications</h2></div></div><div class="card"><div id="notif-list"><div class="state-loading">Loading...</div></div></div>';
  var list = document.getElementById('notif-list');
  try {
    var data = await API.notifications({ limit: 30 });
    var notifs = data.notifications || [];
    if (!notifs.length) {
      list.innerHTML = '<div class="state-empty"><h3>No notifications</h3><p>You\'ll see commission approvals, FTDs, and system alerts here.</p></div>';
      return;
    }
    var icons = { commission_paid:'✅', commission_approved:'✅', commission_pending:'⏳', new_ftd:'💰', postback_failed:'❌' };
    list.innerHTML = notifs.map(function(n) {
      return '<div style="display:flex;align-items:flex-start;gap:12px;padding:14px 0;border-bottom:1px solid var(--border)">' +
        '<span style="font-size:1.2rem;margin-top:2px">' + (icons[n.type]||'ℹ️') + '</span>' +
        '<div style="flex:1"><div style="font-weight:600;font-size:0.9rem">' + n.title + '</div>' +
        '<div style="font-size:0.82rem;color:var(--text-muted);margin-top:2px">' + n.message + '</div></div>' +
        '<div style="font-size:0.75rem;color:var(--text-muted);white-space:nowrap">' + fmtDate(n.created_at) + '</div></div>';
    }).join('');
  } catch(e) {
    list.innerHTML = '<div class="state-error">' + e.message + '</div>';
  }
}

async function renderSettings(container) {
  container.innerHTML = '<div class="section-header"><div><h2 class="section-title">Settings</h2></div></div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:16px">' +
    '<div class="card" id="settings-profile"></div>' +
    '<div class="card" id="settings-password"></div>' +
    '<div class="card" id="settings-audit"></div>' +
    '</div>';

  // Profile section
  var profileCard = document.getElementById('settings-profile');
  profileCard.innerHTML = '<div class="card-header"><span class="card-title">Profile</span></div><div class="state-loading">Loading...</div>';
  try {
    var p = await API.profile();
    profileCard.innerHTML = '<div class="card-header"><span class="card-title">Profile</span></div>' +
      '<div class="form-group"><label class="form-label">Email</label><input class="form-control" value="' + (p.email||p.account_email||'—') + '" readonly></div>' +
      '<div class="form-group"><label class="form-label">Ref Code</label><input class="form-control" value="' + (p.ref_code||'—') + '" readonly></div>' +
      '<div class="form-group"><label class="form-label">Commission Model</label><input class="form-control" value="' + (p.commission_type||'—') + ' ' + (p.revshare_percent||0) + '%" readonly></div>' +
      '<div class="form-group"><label class="form-label">Status</label>' + badge(p.status||'active') + '</div>';
  } catch(e) { profileCard.innerHTML += '<div class="state-error">' + e.message + '</div>'; }

  // Password section
  var passCard = document.getElementById('settings-password');
  passCard.innerHTML = '<div class="card-header"><span class="card-title">Change Password</span></div>' +
    '<div class="form-group"><label class="form-label">Current Password</label><input class="form-control" type="password" id="cp-current"></div>' +
    '<div class="form-group"><label class="form-label">New Password</label><input class="form-control" type="password" id="cp-new"></div>' +
    '<div class="form-group"><label class="form-label">Confirm New Password</label><input class="form-control" type="password" id="cp-confirm"></div>' +
    '<button class="btn btn-primary" id="cp-submit">Change Password</button>';
  document.getElementById('cp-submit').onclick = async function() {
    var cur = document.getElementById('cp-current').value;
    var nw = document.getElementById('cp-new').value;
    var conf = document.getElementById('cp-confirm').value;
    if (nw !== conf) { showToast('Passwords do not match', 'error'); return; }
    if (nw.length < 8) { showToast('Password must be at least 8 characters', 'error'); return; }
    try {
      await API.changePassword(cur, nw);
      showToast('Password changed successfully', 'success');
      document.getElementById('cp-current').value = '';
      document.getElementById('cp-new').value = '';
      document.getElementById('cp-confirm').value = '';
    } catch(e) { showToast(e.message, 'error'); }
  };

  // Audit log section
  var auditCard = document.getElementById('settings-audit');
  auditCard.innerHTML = '<div class="card-header"><span class="card-title">Security Activity</span></div><div id="audit-content"><div class="state-loading">Loading...</div></div>';
  try {
    var audit = await API.auditLog();
    var events = audit.events || [];
    if (!events.length) {
      document.getElementById('audit-content').innerHTML = '<div class="state-empty" style="padding:24px"><h3>No activity logged</h3></div>';
    } else {
      document.getElementById('audit-content').innerHTML = events.slice(0,10).map(function(e) {
        return '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:0.82rem">' +
          '<span>' + (e.action||'—') + '</span><span style="color:var(--text-muted)">' + fmtDate(e.created_at) + '</span></div>';
      }).join('');
    }
  } catch(e) { document.getElementById('audit-content').innerHTML = '<div class="state-error">' + e.message + '</div>'; }
}

// ── Auth Pages ───────────────────────────────────────────────────
function renderLogin() {
  document.getElementById('app').innerHTML =
    '<div class="auth-screen">' +
    '<div class="auth-card">' +
    '<div class="auth-logo"><h1>Cryptora Partners</h1><p>Affiliate Dashboard</p></div>' +
    '<div id="auth-error" style="display:none" class="state-error" style="margin-bottom:14px"></div>' +
    '<div class="form-group"><label class="form-label">Email</label><input class="form-control" type="email" id="login-email" placeholder="you@example.com" autocomplete="email"></div>' +
    '<div class="form-group"><label class="form-label">Password</label><input class="form-control" type="password" id="login-password" autocomplete="current-password"></div>' +
    '<button class="btn btn-primary" style="width:100%;justify-content:center;margin-top:4px" id="login-btn">Sign In</button>' +
    '<p style="text-align:center;margin-top:14px;font-size:0.8rem;color:var(--text-muted)">No account? <a href="mailto:affiliates@cryptora.live" style="color:var(--gold)">Contact us</a></p>' +
    '</div></div>';

  function doLogin() {
    var email = document.getElementById('login-email').value.trim();
    var pass = document.getElementById('login-password').value;
    var errEl = document.getElementById('auth-error');
    var btn = document.getElementById('login-btn');
    if (!email || !pass) { errEl.textContent = 'Please enter email and password'; errEl.style.display=''; return; }
    btn.disabled = true; btn.textContent = 'Signing in...';
    API.login(email, pass).then(function(data) {
      if (data.token) {
        API.setToken(data.token);
        window.location.hash = '#/dashboard';
        initApp();
      } else {
        errEl.textContent = 'Invalid credentials'; errEl.style.display='';
        btn.disabled = false; btn.textContent = 'Sign In';
      }
    }).catch(function(e) {
      errEl.textContent = e.message; errEl.style.display='';
      btn.disabled = false; btn.textContent = 'Sign In';
    });
  }
  document.getElementById('login-btn').onclick = doLogin;
  document.getElementById('login-password').onkeydown = function(e) { if(e.key==='Enter') doLogin(); };
}

// ── App Shell ────────────────────────────────────────────────────
var ROUTES = {
  '/dashboard': { label:'Dashboard', render: renderDashboard },
  '/players':   { label:'Players',   render: renderPlayers },
  '/reports':   { label:'Reports',   render: renderReports },
  '/commissions':{ label:'Commissions', render: renderCommissions },
  '/tracking':  { label:'Tracking & Integration', render: renderTracking },
  '/notifications':{ label:'Notifications', render: renderNotifications },
  '/settings':  { label:'Settings',  render: renderSettings },
};

var NAV = [
  { path:'/dashboard',     label:'Dashboard' },
  { path:'/players',       label:'Players' },
  { path:'/reports',       label:'Reports' },
  { path:'/commissions',   label:'Commissions' },
  { path:'/tracking',      label:'Tracking & API' },
  { path:'/notifications', label:'Notifications' },
  { path:'/settings',      label:'Settings' },
];

function initApp() {
  if (!API.hasToken()) { renderLogin(); return; }

  var appEl = document.getElementById('app');
  appEl.innerHTML =
    '<div class="sidebar-overlay" id="overlay"></div>' +
    '<aside class="sidebar" id="sidebar">' +
    '<div class="sidebar-logo">Cryptora <span>Partners</span></div>' +
    '<nav class="sidebar-nav" id="sidebar-nav"></nav>' +
    '<div class="sidebar-footer">' +
    '<div class="sidebar-user"><div class="sidebar-avatar" id="user-initial">—</div><div class="sidebar-email" id="user-email">Loading...</div></div>' +
    '<button class="btn btn-ghost btn-sm" id="logout-btn" style="width:100%;justify-content:center">Sign Out</button>' +
    '</div></aside>' +
    '<div class="main-content">' +
    '<header class="topbar"><div style="display:flex;align-items:center;gap:12px">' +
    '<button class="mobile-menu-btn" id="mobile-menu-btn"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button>' +
    '<span class="topbar-title" id="page-title">Dashboard</span></div>' +
    '</header>' +
    '<main class="page-container" id="page-content"></main>' +
    '</div>' +
    '<div id="toast-container"></div>';

  // Mobile menu
  var menuBtn = document.getElementById('mobile-menu-btn');
  var sidebar = document.getElementById('sidebar');
  var overlay = document.getElementById('overlay');
  menuBtn.onclick = function() { sidebar.classList.toggle('open'); overlay.classList.toggle('visible'); };
  overlay.onclick = function() { sidebar.classList.remove('open'); overlay.classList.remove('visible'); };

  // Logout
  document.getElementById('logout-btn').onclick = async function() {
    await API.logout();
    renderLogin();
  };

  // Load user info
  API.me().then(function(d) {
    var email = d.email || d.account_email || '';
    document.getElementById('user-email').textContent = email;
    document.getElementById('user-initial').textContent = email.slice(0,1).toUpperCase();
  }).catch(function() {});

  // Build nav
  var nav = document.getElementById('sidebar-nav');
  NAV.forEach(function(item) {
    var n = el('div', 'nav-item', item.label);
    n.setAttribute('data-path', item.path);
    n.onclick = function() {
      window.location.hash = '#' + item.path;
      sidebar.classList.remove('open');
      overlay.classList.remove('visible');
    };
    nav.appendChild(n);
  });

  // Router
  function route() {
    var hash = window.location.hash.replace('#','') || '/dashboard';
    var r = ROUTES[hash];
    if (!r) { hash = '/dashboard'; r = ROUTES[hash]; }

    document.getElementById('page-title').textContent = r.label;

    document.querySelectorAll('.nav-item').forEach(function(n) {
      n.classList.toggle('active', n.getAttribute('data-path') === hash);
    });

    var content = document.getElementById('page-content');
    content.innerHTML = '';
    r.render(content);
  }

  window.onhashchange = route;
  route();
}

// ── Boot ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  var hash = window.location.hash;
  if (!hash || hash === '#/' || !API.hasToken()) {
    renderLogin();
  } else {
    initApp();
  }
});
