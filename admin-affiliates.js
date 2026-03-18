/* admin-affiliates.js — v2 — Admin Affiliates panel with tabs */
(function() {
  if (window.location.pathname.indexOf('/admin') !== 0) return;

  const API = '/api/affiliate/admin';
  let overlay = null;
  let activeTab = 'affiliates';

  function authHeaders() {
    const t = localStorage.getItem('auth_token');
    return { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) };
  }
  async function apiFetch(url, opts = {}) {
    const r = await fetch(url, { headers: authHeaders(), ...opts });
    return r.json();
  }

  /* ── inject sidebar button ───────────────────── */
  function injectSidebarButton() {
    if (document.getElementById('aff-sidebar-btn')) return;
    const btns = Array.from(document.querySelectorAll('button,a'))
      .filter(el => el.textContent.includes('Support') || el.textContent.includes('My Wallets') || el.textContent.includes('Geo Block'));
    if (!btns.length) return;
    const ref = btns[btns.length - 1];
    const btn = document.createElement('button');
    btn.id = 'aff-sidebar-btn';
    btn.textContent = '🤝 Affiliates';
    btn.style.cssText = 'display:block;width:100%;text-align:left;padding:10px 16px;background:transparent;border:none;color:#c9d1d9;cursor:pointer;font-size:14px;border-radius:6px;';
    btn.onmouseenter = () => btn.style.background = '#21262d';
    btn.onmouseleave = () => btn.style.background = 'transparent';
    btn.onclick = () => openPanel();
    ref.parentNode.insertBefore(btn, ref.nextSibling);
  }

  /* ── tab render ──────────────────────────────── */
  function renderTabs() {
    const tabs = [
      { id: 'affiliates', label: '👥 Affiliates' },
      { id: 'traffic',    label: '📈 Traffic' },
      { id: 'campaigns',  label: '🎯 Campaigns' },
      { id: 'config',     label: '⚙️ Config' },
    ];
    return `<div style="display:flex;gap:4px;padding:0 20px 0;border-bottom:1px solid #21262d;margin-bottom:16px">
      ${tabs.map(t => `
        <button onclick="window.affSetTab('${t.id}')" id="aff-tab-${t.id}" style="
          background:transparent;border:none;border-bottom:2px solid ${t.id===activeTab?'#58a6ff':'transparent'};
          color:${t.id===activeTab?'#58a6ff':'#8b949e'};padding:10px 14px;cursor:pointer;font-size:13px;font-weight:600;
          transition:all .15s">${t.label}</button>`).join('')}
    </div>`;
  }

  /* ── open main panel ─────────────────────────── */
  function openPanel() {
    if (overlay) { overlay.style.display = 'flex'; renderActiveTab(); return; }
    overlay = document.createElement('div');
    overlay.id = 'aff-admin-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding-top:60px;';
    overlay.onclick = e => { if (e.target === overlay) overlay.style.display = 'none'; };
    overlay.innerHTML = `
<div style="background:#161b22;border:1px solid #30363d;border-radius:12px;width:980px;max-width:96vw;max-height:85vh;display:flex;flex-direction:column;overflow:hidden;">
  <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px 0;flex-shrink:0">
    <h2 style="margin:0;color:#e6edf3;font-size:18px;">🤝 Affiliate Management</h2>
    <div style="display:flex;gap:8px">
      <button id="aff-create-btn" style="background:#238636;color:#fff;border:none;border-radius:6px;padding:7px 14px;cursor:pointer;font-size:13px;">+ Create Account</button>
      <button onclick="document.getElementById('aff-admin-overlay').style.display='none'" style="background:transparent;border:none;color:#8b949e;font-size:20px;cursor:pointer;">×</button>
    </div>
  </div>
  <div id="aff-tabs-bar" style="flex-shrink:0;margin-top:12px"></div>
  <div id="aff-tab-content" style="overflow-y:auto;flex:1;padding:0 20px 20px"></div>
</div>`;
    document.body.appendChild(overlay);
    document.getElementById('aff-create-btn').onclick = () => openCreateModal();
    renderActiveTab();
  }

  window.affSetTab = (id) => {
    activeTab = id;
    document.querySelectorAll('[id^="aff-tab-"]').forEach(b => {
      const tid = b.id.replace('aff-tab-','');
      b.style.borderBottomColor = tid === id ? '#58a6ff' : 'transparent';
      b.style.color = tid === id ? '#58a6ff' : '#8b949e';
    });
    document.getElementById('aff-tabs-bar').innerHTML = renderTabs();
    renderActiveTab();
  };

  function renderActiveTab() {
    const bar = document.getElementById('aff-tabs-bar');
    const body = document.getElementById('aff-tab-content');
    if (bar) bar.innerHTML = renderTabs();
    if (!body) return;
    body.innerHTML = '<div style="padding:32px;text-align:center;color:#8b949e">Loading…</div>';
    if (activeTab === 'affiliates') loadAffiliates();
    else if (activeTab === 'traffic') loadTraffic();
    else if (activeTab === 'campaigns') loadCampaigns();
    else if (activeTab === 'config') loadConfig();
  }

  /* ══════════════════════════════════════════════
     TAB: AFFILIATES
  ══════════════════════════════════════════════ */
  async function loadAffiliates() {
    const body = document.getElementById('aff-tab-content');
    const data = await apiFetch('/api/affiliate/admin/list');
    if (!Array.isArray(data)) { body.innerHTML = `<p style="color:#f85149">${data.error||'Error'}</p>`; return; }
    if (!data.length) { body.innerHTML = '<p style="color:#8b949e">No affiliates found.</p>'; return; }
    body.innerHTML = `
<table style="width:100%;border-collapse:collapse;font-size:13px">
  <thead><tr style="color:#8b949e;border-bottom:1px solid #21262d">
    <th style="text-align:left;padding:8px 10px">Name / Email</th>
    <th style="text-align:left;padding:8px 10px">Ref Code</th>
    <th style="text-align:center;padding:8px 10px">Dashboard</th>
    <th style="text-align:right;padding:8px 10px">Referrals</th>
    <th style="text-align:right;padding:8px 10px">Depositors</th>
    <th style="text-align:right;padding:8px 10px">Earned</th>
    <th style="text-align:right;padding:8px 10px">RevShare</th>
    <th style="text-align:center;padding:8px 10px">Status</th>
    <th style="text-align:center;padding:8px 10px">Actions</th>
  </tr></thead>
  <tbody>
    ${data.map(a => `
    <tr style="border-bottom:1px solid #21262d" onmouseenter="this.style.background='#1c2128'" onmouseleave="this.style.background=''">
      <td style="padding:8px 10px;color:#e6edf3">
        <div>${a.affiliate_name||'—'}</div>
        <div style="color:#8b949e;font-size:11px">${a.affiliate_email||'—'}</div>
      </td>
      <td style="padding:8px 10px;font-family:monospace;color:#58a6ff">${a.ref_code||'—'}</td>
      <td style="padding:8px 10px;text-align:center">
        ${a.has_dashboard_access
          ? '<span style="color:#3fb950;font-size:12px">✅</span>'
          : `<button onclick="window.affGrantAccess('${a.id}','${(a.affiliate_name||'').replace(/'/g,'')}','${(a.affiliate_email||'').replace(/'/g,'')}')" style="background:#0d419d;color:#58a6ff;border:1px solid #1f6feb;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:11px">Grant</button>`}
      </td>
      <td style="padding:8px 10px;text-align:right;color:#c9d1d9">${a.referral_count||0}</td>
      <td style="padding:8px 10px;text-align:right;color:#c9d1d9">${a.depositor_count||0}</td>
      <td style="padding:8px 10px;text-align:right;color:#3fb950">$${(a.total_earned||0).toFixed(2)}</td>
      <td style="padding:8px 10px;text-align:right;color:#e6edf3">${a.revshare_percent||25}%</td>
      <td style="padding:8px 10px;text-align:center">
        <span style="background:${a.status==='active'?'#1a4731':'#4a1f1f'};color:${a.status==='active'?'#3fb950':'#f85149'};border-radius:12px;padding:2px 8px;font-size:11px">${a.status}</span>
      </td>
      <td style="padding:8px 10px;text-align:center">
        <div style="display:flex;gap:4px;justify-content:center">
          <button onclick="window.affEditCommission('${a.id}','${a.revshare_percent||25}')" style="background:#0d1117;border:1px solid #58a6ff;color:#58a6ff;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:11px">% Edit</button>
          <button onclick="window.affToggleStatus('${a.id}','${a.status}')" style="background:transparent;border:1px solid #30363d;color:#8b949e;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:11px">${a.status==='active'?'Suspend':'Activate'}</button>
        </div>
      </td>
    </tr>`).join('')}
  </tbody>
</table>`;
  }

  /* ══════════════════════════════════════════════
     TAB: TRAFFIC MONITORING
  ══════════════════════════════════════════════ */
  async function loadTraffic() {
    const body = document.getElementById('aff-tab-content');
    body.innerHTML = `
<div style="display:flex;gap:10px;align-items:center;margin-bottom:16px">
  <label style="color:#8b949e;font-size:13px">Period:</label>
  <select id="traffic-days" onchange="window.reloadTraffic()" style="background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:6px 10px;color:#e6edf3;font-size:13px">
    <option value="7">Last 7 days</option>
    <option value="30" selected>Last 30 days</option>
    <option value="90">Last 90 days</option>
    <option value="365">Last year</option>
  </select>
  <button onclick="window.reloadTraffic()" style="background:#21262d;border:1px solid #30363d;color:#c9d1d9;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:13px">Refresh</button>
</div>
<div id="traffic-table">Loading…</div>
<div style="margin-top:20px">
  <div style="font-weight:600;color:#e6edf3;margin-bottom:10px;font-size:14px">⚠️ Suspicious Activity</div>
  <div id="suspicious-table">Loading…</div>
</div>`;

    window.reloadTraffic = async () => {
      const days = document.getElementById('traffic-days')?.value || 30;
      const tt = document.getElementById('traffic-table');
      const st = document.getElementById('suspicious-table');
      if (!tt) return;
      tt.innerHTML = 'Loading…';

      const [traffic, susp] = await Promise.all([
        apiFetch(`/api/affiliate/admin/traffic?days=${days}`),
        apiFetch('/api/affiliate/admin/traffic/suspicious'),
      ]);

      if (!Array.isArray(traffic)) { tt.innerHTML = `<p style="color:#f85149">${traffic.error||'Error'}</p>`; return; }
      if (!traffic.length) { tt.innerHTML = '<p style="color:#8b949e">No traffic data for this period.</p>'; }
      else {
        tt.innerHTML = `
<table style="width:100%;border-collapse:collapse;font-size:13px">
  <thead><tr style="color:#8b949e;border-bottom:1px solid #21262d">
    <th style="text-align:left;padding:8px 10px">Affiliate</th>
    <th style="text-align:right;padding:8px 10px">Clicks</th>
    <th style="text-align:right;padding:8px 10px">Regs</th>
    <th style="text-align:right;padding:8px 10px">FTDs</th>
    <th style="text-align:right;padding:8px 10px">CVR%</th>
    <th style="text-align:right;padding:8px 10px">Deposits</th>
    <th style="text-align:right;padding:8px 10px">GGR</th>
    <th style="text-align:right;padding:8px 10px">Countries</th>
  </tr></thead>
  <tbody>
    ${traffic.map(r => `
    <tr style="border-bottom:1px solid #21262d" onmouseenter="this.style.background='#1c2128'" onmouseleave="this.style.background=''">
      <td style="padding:8px 10px">
        <div style="color:#e6edf3;font-size:12px">${r.name||r.email||'—'}</div>
        <div style="color:#58a6ff;font-family:monospace;font-size:11px">${r.ref_code}</div>
      </td>
      <td style="padding:8px 10px;text-align:right;color:#c9d1d9">${r.total_clicks}</td>
      <td style="padding:8px 10px;text-align:right;color:#c9d1d9">${r.registrations}</td>
      <td style="padding:8px 10px;text-align:right;color:#3fb950">${r.depositors}</td>
      <td style="padding:8px 10px;text-align:right;color:${r.cvr>5?'#3fb950':r.cvr>0?'#d29922':'#8b949e'}">${r.cvr}%</td>
      <td style="padding:8px 10px;text-align:right;color:#c9d1d9">$${r.total_deposits.toFixed(2)}</td>
      <td style="padding:8px 10px;text-align:right;color:${r.total_ggr>0?'#3fb950':'#8b949e'}">$${r.total_ggr.toFixed(2)}</td>
      <td style="padding:8px 10px;text-align:right;color:#8b949e">${r.countries}</td>
    </tr>`).join('')}
  </tbody>
</table>`;
      }

      // Suspicious
      const ips = susp.suspicious_ips || [];
      if (!ips.length) { st.innerHTML = '<p style="color:#3fb950;font-size:13px">✅ No suspicious activity detected</p>'; }
      else {
        st.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px">
  <thead><tr style="color:#8b949e;border-bottom:1px solid #21262d">
    <th style="text-align:left;padding:6px 10px">IP</th>
    <th style="text-align:left;padding:6px 10px">Affiliate</th>
    <th style="text-align:right;padding:6px 10px">Clicks</th>
    <th style="text-align:left;padding:6px 10px">Last Seen</th>
  </tr></thead>
  <tbody>
    ${ips.map(i => `<tr style="border-bottom:1px solid #21262d">
      <td style="padding:6px 10px;color:#f85149;font-family:monospace">${i.ip}</td>
      <td style="padding:6px 10px;color:#58a6ff;font-family:monospace">${i.ref_code}</td>
      <td style="padding:6px 10px;text-align:right;color:#d29922">${i.click_count}</td>
      <td style="padding:6px 10px;color:#8b949e;font-size:11px">${i.last_seen?new Date(i.last_seen).toLocaleDateString():''}</td>
    </tr>`).join('')}
  </tbody>
</table>`;
      }
    };
    window.reloadTraffic();
  }

  /* ══════════════════════════════════════════════
     TAB: CAMPAIGNS
  ══════════════════════════════════════════════ */
  async function loadCampaigns() {
    const body = document.getElementById('aff-tab-content');
    const data = await apiFetch('/api/affiliate/admin/campaigns');
    if (!Array.isArray(data)) { body.innerHTML = `<p style="color:#f85149">${data.error||'Error'}</p>`; return; }
    if (!data.length) {
      body.innerHTML = '<div style="text-align:center;color:#8b949e;padding:48px;font-size:0.9rem">No campaign data yet. Campaigns appear when affiliates use SubID links (e.g. ?ref=CODE&sub=campaign_name).</div>';
      return;
    }
    body.innerHTML = `
<p style="color:#8b949e;font-size:13px;margin-bottom:12px">Breakdown by affiliate + SubID (campaign tag). Affiliates add <code style="background:#0d1117;padding:2px 6px;border-radius:4px">?sub=name</code> to their links.</p>
<table style="width:100%;border-collapse:collapse;font-size:13px">
  <thead><tr style="color:#8b949e;border-bottom:1px solid #21262d">
    <th style="text-align:left;padding:8px 10px">Affiliate</th>
    <th style="text-align:left;padding:8px 10px">Campaign / SubID</th>
    <th style="text-align:right;padding:8px 10px">Clicks</th>
    <th style="text-align:right;padding:8px 10px">Conversions</th>
    <th style="text-align:right;padding:8px 10px">CVR%</th>
    <th style="text-align:right;padding:8px 10px">Countries</th>
    <th style="text-align:left;padding:8px 10px">Last Click</th>
  </tr></thead>
  <tbody>
    ${data.map(r => `
    <tr style="border-bottom:1px solid #21262d" onmouseenter="this.style.background='#1c2128'" onmouseleave="this.style.background=''">
      <td style="padding:8px 10px;color:#58a6ff;font-family:monospace;font-size:12px">${r.ref_code}<br><span style="color:#8b949e">${r.affiliate_name||''}</span></td>
      <td style="padding:8px 10px;color:#e6edf3;font-weight:500">${r.campaign}</td>
      <td style="padding:8px 10px;text-align:right;color:#c9d1d9">${r.clicks}</td>
      <td style="padding:8px 10px;text-align:right;color:#3fb950">${r.conversions}</td>
      <td style="padding:8px 10px;text-align:right;color:${r.cvr>5?'#3fb950':r.cvr>0?'#d29922':'#8b949e'}">${r.cvr}%</td>
      <td style="padding:8px 10px;text-align:right;color:#8b949e">${r.countries}</td>
      <td style="padding:8px 10px;color:#8b949e;font-size:11px">${r.last_click?new Date(r.last_click).toLocaleDateString():''}</td>
    </tr>`).join('')}
  </tbody>
</table>`;
  }

  /* ══════════════════════════════════════════════
     TAB: GENERAL CONFIG
  ══════════════════════════════════════════════ */
  async function loadConfig() {
    const body = document.getElementById('aff-tab-content');
    const cfg = await apiFetch('/api/affiliate/admin/config');
    body.innerHTML = `
<div style="max-width:520px">
  <p style="color:#8b949e;font-size:13px;margin-bottom:20px">Default settings applied when creating new affiliates. Existing affiliates keep their individual settings.</p>

  <div style="display:grid;gap:14px">
    <div>
      <label style="display:block;color:#8b949e;font-size:12px;margin-bottom:6px">Default Commission Type</label>
      <select id="cfg-type" style="width:100%;background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:9px 12px;color:#e6edf3;font-size:14px">
        <option value="revshare" ${cfg.default_commission_type==='revshare'?'selected':''}>RevShare</option>
        <option value="cpa" ${cfg.default_commission_type==='cpa'?'selected':''}>CPA</option>
        <option value="hybrid" ${cfg.default_commission_type==='hybrid'?'selected':''}>Hybrid (RevShare + CPA)</option>
      </select>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div>
        <label style="display:block;color:#8b949e;font-size:12px;margin-bottom:6px">Default RevShare %</label>
        <input id="cfg-revshare" type="number" min="0" max="100" value="${cfg.default_revshare||25}" style="width:100%;background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:9px 12px;color:#e6edf3;font-size:14px;box-sizing:border-box">
      </div>
      <div>
        <label style="display:block;color:#8b949e;font-size:12px;margin-bottom:6px">Default CPA Amount ($)</label>
        <input id="cfg-cpa" type="number" min="0" value="${cfg.default_cpa||0}" style="width:100%;background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:9px 12px;color:#e6edf3;font-size:14px;box-sizing:border-box">
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div>
        <label style="display:block;color:#8b949e;font-size:12px;margin-bottom:6px">Min Payout ($)</label>
        <input id="cfg-minpayout" type="number" min="0" value="${cfg.min_payout||20}" style="width:100%;background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:9px 12px;color:#e6edf3;font-size:14px;box-sizing:border-box">
      </div>
      <div>
        <label style="display:block;color:#8b949e;font-size:12px;margin-bottom:6px">Cookie Duration (days)</label>
        <input id="cfg-cookie" type="number" min="1" value="${cfg.cookie_days||30}" style="width:100%;background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:9px 12px;color:#e6edf3;font-size:14px;box-sizing:border-box">
      </div>
    </div>

    <div>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#c9d1d9;font-size:14px">
        <input id="cfg-autoapprove" type="checkbox" ${cfg.auto_approve?'checked':''} style="width:16px;height:16px;cursor:pointer">
        Auto-approve new affiliate registrations
      </label>
      <p style="color:#8b949e;font-size:12px;margin:4px 0 0 24px">If disabled, new affiliates must be manually approved before they can log in.</p>
    </div>

    <div id="cfg-save-result"></div>

    <button onclick="window.saveAffConfig()" style="background:#238636;color:#fff;border:none;border-radius:6px;padding:10px 20px;cursor:pointer;font-size:14px;font-weight:600;width:fit-content">
      💾 Save Settings
    </button>
  </div>
</div>`;

    window.saveAffConfig = async () => {
      const result = document.getElementById('cfg-save-result');
      const payload = {
        default_commission_type: document.getElementById('cfg-type').value,
        default_revshare: parseFloat(document.getElementById('cfg-revshare').value),
        default_cpa: parseFloat(document.getElementById('cfg-cpa').value),
        min_payout: parseFloat(document.getElementById('cfg-minpayout').value),
        cookie_days: parseInt(document.getElementById('cfg-cookie').value),
        auto_approve: document.getElementById('cfg-autoapprove').checked,
      };
      const r = await apiFetch('/api/affiliate/admin/config', { method: 'PUT', body: JSON.stringify(payload) });
      result.innerHTML = r.success
        ? '<p style="color:#3fb950;font-size:13px">✅ Settings saved</p>'
        : `<p style="color:#f85149;font-size:13px">❌ ${r.error||'Error'}</p>`;
    };
  }

  /* ── actions ─────────────────────────────────── */
  window.affToggleStatus = async (id, cur) => {
    const ns = cur === 'active' ? 'suspended' : 'active';
    await apiFetch(`/api/affiliate/admin/affiliates/${id}`, { method: 'PATCH', body: JSON.stringify({ status: ns }) });
    loadAffiliates();
  };

  window.affEditCommission = (id, cur) => {
    const v = prompt('RevShare % (current: ' + cur + '%):', cur);
    if (v === null) return;
    const p = parseFloat(v);
    if (isNaN(p) || p < 0 || p > 100) { alert('Invalid (0-100)'); return; }
    apiFetch('/api/affiliate/admin/accounts/' + id, { method: 'PATCH', body: JSON.stringify({ revshare_percent: p }) })
      .then(r => { if (r.success) loadAffiliates(); else alert('Error: ' + r.error); });
  };

  window.affGrantAccess = (affId, name, email) => openCreateModal(affId, name, email);

  /* ── create account modal ────────────────────── */
  function openCreateModal(linkTo = null, prefillName = '', prefillEmail = '') {
    let m = document.getElementById('aff-create-modal');
    if (m) m.remove();
    m = document.createElement('div');
    m.id = 'aff-create-modal';
    m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:10000;display:flex;align-items:center;justify-content:center;';
    m.innerHTML = `
<div style="background:#161b22;border:1px solid #30363d;border-radius:10px;padding:24px;width:440px;max-width:95vw">
  <h3 style="color:#e6edf3;margin:0 0 16px;font-size:16px">${linkTo?'🔑 Grant Dashboard Access':'➕ Create Affiliate Account'}</h3>
  <div style="display:flex;flex-direction:column;gap:12px">
    <input id="aff-c-name" placeholder="Full name" value="${prefillName}" style="background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:9px 12px;color:#e6edf3;font-size:14px;width:100%;box-sizing:border-box">
    <input id="aff-c-email" placeholder="Email" type="email" value="${prefillEmail}" style="background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:9px 12px;color:#e6edf3;font-size:14px;width:100%;box-sizing:border-box">
    <input id="aff-c-pass" placeholder="Password" type="password" style="background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:9px 12px;color:#e6edf3;font-size:14px;width:100%;box-sizing:border-box">
    <div style="display:flex;align-items:center;gap:8px">
      <label style="color:#8b949e;font-size:13px;white-space:nowrap">RevShare %</label>
      <input id="aff-c-rev" type="number" value="25" min="0" max="100" style="background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:9px 12px;color:#e6edf3;font-size:14px;width:80px">
    </div>
  </div>
  <div id="aff-c-result" style="margin-top:12px;display:none;background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:12px;font-size:13px"></div>
  <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
    <button onclick="document.getElementById('aff-create-modal').remove()" style="background:transparent;border:1px solid #30363d;color:#8b949e;border-radius:6px;padding:8px 16px;cursor:pointer">Cancel</button>
    <button id="aff-c-submit" style="background:#238636;color:#fff;border:none;border-radius:6px;padding:8px 16px;cursor:pointer">Create</button>
  </div>
</div>`;
    document.body.appendChild(m);
    document.getElementById('aff-c-submit').onclick = async () => {
      const email = document.getElementById('aff-c-email').value.trim();
      const name  = document.getElementById('aff-c-name').value.trim();
      const pass  = document.getElementById('aff-c-pass').value;
      const rev   = parseFloat(document.getElementById('aff-c-rev').value) || 25;
      if (!email || !pass) { alert('Email and password required'); return; }
      const btn = document.getElementById('aff-c-submit');
      btn.disabled = true; btn.textContent = 'Creating…';
      const res = await apiFetch('/api/affiliate/admin/create-account', {
        method: 'POST', body: JSON.stringify({ email, name, password: pass, revshare_percent: rev, link_to_affiliate_id: linkTo })
      });
      btn.disabled = false; btn.textContent = 'Create';
      const rd = document.getElementById('aff-c-result');
      rd.style.display = 'block';
      if (res.success) {
        rd.style.color = '#3fb950';
        rd.innerHTML = `✅ Account created!<br><strong style="color:#e6edf3">Ref:</strong> <code style="background:#0d1117;padding:2px 6px;border-radius:4px">${res.ref_code}</code><br>
<strong style="color:#e6edf3">Login:</strong> <a href="https://cryptora.live/partners/" target="_blank" style="color:#58a6ff">cryptora.live/partners/</a><br>
<span style="color:#8b949e;font-size:11px">Email: ${email}</span>`;
        setTimeout(() => { if (activeTab === 'affiliates') loadAffiliates(); }, 600);
      } else {
        rd.style.color = '#f85149';
        rd.textContent = '❌ ' + (res.error || 'Failed');
      }
    };
  }

  /* ── init ────────────────────────────────────── */
  const timer = setInterval(() => {
    const found = Array.from(document.querySelectorAll('button,a'))
      .some(el => el.textContent.includes('Support') || el.textContent.includes('My Wallets') || el.textContent.includes('Geo Block'));
    if (found) { clearInterval(timer); injectSidebarButton(); }
  }, 800);

})();
