/**
 * Admin Geo-Block Manager
 * Adds a "Geo Block" section to the admin panel sidebar and content area
 */
(function () {
  'use strict';

  var ALL_COUNTRIES = [
    { code: 'US', name: 'United States' },
    { code: 'GB', name: 'United Kingdom' },
    { code: 'AU', name: 'Australia' },
    { code: 'FR', name: 'France' },
    { code: 'DE', name: 'Germany' },
    { code: 'NL', name: 'Netherlands' },
    { code: 'IT', name: 'Italy' },
    { code: 'ES', name: 'Spain' },
    { code: 'BE', name: 'Belgium' },
    { code: 'PL', name: 'Poland' },
    { code: 'HU', name: 'Hungary' },
    { code: 'RO', name: 'Romania' },
    { code: 'CZ', name: 'Czech Republic' },
    { code: 'SE', name: 'Sweden' },
    { code: 'NO', name: 'Norway' },
    { code: 'DK', name: 'Denmark' },
    { code: 'FI', name: 'Finland' },
    { code: 'PT', name: 'Portugal' },
    { code: 'GR', name: 'Greece' },
    { code: 'AT', name: 'Austria' },
    { code: 'CH', name: 'Switzerland' },
    { code: 'CA', name: 'Canada' },
    { code: 'JP', name: 'Japan' },
    { code: 'CN', name: 'China' },
    { code: 'KR', name: 'South Korea' },
    { code: 'IN', name: 'India' },
    { code: 'BR', name: 'Brazil' },
    { code: 'MX', name: 'Mexico' },
    { code: 'UA', name: 'Ukraine' },
    { code: 'TR', name: 'Turkey' },
  ];

  var token = function () { return localStorage.getItem('auth_token') || ''; };

  function isAdminPage() {
    return location.pathname.startsWith('/admin') && !location.pathname.startsWith('/admin/login');
  }

  function showGeoPanel() {
    var existing = document.getElementById('cr-geo-panel');
    if (existing) { existing.style.display = 'block'; return; }

    // Find main content area
    var main = document.querySelector('main');
    if (!main) return;

    var panel = document.createElement('div');
    panel.id = 'cr-geo-panel';
    panel.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';

    panel.innerHTML = `
      <div style="background:#141829;border:1px solid #252b45;border-radius:16px;width:100%;max-width:560px;max-height:85vh;overflow:hidden;display:flex;flex-direction:column;">
        <div style="padding:20px 24px;border-bottom:1px solid #252b45;display:flex;align-items:center;justify-content:space-between;">
          <div>
            <div style="color:#fff;font-weight:700;font-size:16px;">🌍 Geo-Block Settings</div>
            <div style="color:#64748b;font-size:12px;margin-top:2px;">Manage which countries can access the casino</div>
          </div>
          <button id="cr-geo-close" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:20px;padding:4px;">✕</button>
        </div>

        <div style="padding:16px 24px;border-bottom:1px solid #1e2a45;display:flex;align-items:center;justify-content:space-between;">
          <div style="color:#94a3b8;font-size:13px;">Geo-Block Enabled</div>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <span id="cr-geo-status-text" style="font-size:12px;color:#64748b;"></span>
            <div id="cr-geo-toggle" style="width:44px;height:24px;border-radius:12px;background:#1e2a45;position:relative;cursor:pointer;transition:background 0.2s;">
              <div id="cr-geo-thumb" style="width:20px;height:20px;border-radius:50%;background:#fff;position:absolute;top:2px;left:2px;transition:transform 0.2s;"></div>
            </div>
          </label>
        </div>

        <div style="padding:16px 24px;overflow-y:auto;flex:1;">
          <div style="color:#94a3b8;font-size:12px;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.05em;">Blocked Countries</div>
          <div id="cr-geo-countries" style="display:flex;flex-wrap:wrap;gap:8px;">
            <div style="color:#64748b;font-size:13px;">Loading...</div>
          </div>
          <div style="margin-top:16px;">
            <div style="color:#94a3b8;font-size:12px;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.05em;">Add Country</div>
            <div style="display:flex;gap:8px;">
              <select id="cr-geo-add-select" style="flex:1;background:#0a0e1a;border:1px solid #252b45;color:#fff;border-radius:8px;padding:8px 12px;font-size:13px;outline:none;">
                <option value="">Select country...</option>
              </select>
              <button id="cr-geo-add-btn" style="background:#f59e0b;color:#000;border:none;border-radius:8px;padding:8px 16px;font-weight:700;font-size:13px;cursor:pointer;">Add</button>
            </div>
          </div>
        </div>

        <div style="padding:16px 24px;border-top:1px solid #1e2a45;display:flex;align-items:center;justify-content:space-between;">
          <div id="cr-geo-msg" style="font-size:13px;"></div>
          <button id="cr-geo-save" style="background:linear-gradient(135deg,#f59e0b,#ea580c);color:#000;border:none;border-radius:8px;padding:10px 20px;font-weight:700;font-size:13px;cursor:pointer;">Save Changes</button>
        </div>
      </div>
    `;

    document.body.appendChild(panel);

    var config = { blocked_countries: [], enabled: true };

    // Load config
    fetch('/api/admin/geo-block', { headers: { Authorization: 'Bearer ' + token() } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        config = data;
        render();
      });

    function render() {
      // Toggle
      var toggle = document.getElementById('cr-geo-toggle');
      var thumb = document.getElementById('cr-geo-thumb');
      var statusText = document.getElementById('cr-geo-status-text');
      if (toggle && thumb) {
        toggle.style.background = config.enabled ? '#f59e0b' : '#1e2a45';
        thumb.style.transform = config.enabled ? 'translateX(20px)' : 'translateX(0)';
        statusText.textContent = config.enabled ? 'ON' : 'OFF';
        statusText.style.color = config.enabled ? '#f59e0b' : '#64748b';
      }

      // Countries list
      var container = document.getElementById('cr-geo-countries');
      if (!container) return;
      container.innerHTML = '';
      if (!config.blocked_countries.length) {
        container.innerHTML = '<div style="color:#64748b;font-size:13px;">No countries blocked</div>';
      } else {
        config.blocked_countries.forEach(function (code) {
          var country = ALL_COUNTRIES.find(function (c) { return c.code === code; });
          var name = country ? country.name : code;
          var tag = document.createElement('div');
          tag.style.cssText = 'display:flex;align-items:center;gap:6px;background:#0a0e1a;border:1px solid #252b45;border-radius:8px;padding:6px 12px;font-size:12px;color:#e2e8f0;';
          tag.innerHTML = '<span>' + name + ' (' + code + ')</span><button data-code="' + code + '" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:14px;padding:0 2px;line-height:1;">×</button>';
          container.appendChild(tag);
        });
      }

      // Add select options
      var select = document.getElementById('cr-geo-add-select');
      if (select) {
        select.innerHTML = '<option value="">Select country...</option>';
        ALL_COUNTRIES.forEach(function (c) {
          if (!config.blocked_countries.includes(c.code)) {
            var opt = document.createElement('option');
            opt.value = c.code;
            opt.textContent = c.name + ' (' + c.code + ')';
            select.appendChild(opt);
          }
        });
      }
    }

    // Event delegation for removing countries
    document.getElementById('cr-geo-countries').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-code]');
      if (!btn) return;
      var code = btn.getAttribute('data-code');
      config.blocked_countries = config.blocked_countries.filter(function (c) { return c !== code; });
      render();
    });

    // Toggle
    document.getElementById('cr-geo-toggle').addEventListener('click', function () {
      config.enabled = !config.enabled;
      render();
    });

    // Add country
    document.getElementById('cr-geo-add-btn').addEventListener('click', function () {
      var select = document.getElementById('cr-geo-add-select');
      if (select && select.value) {
        if (!config.blocked_countries.includes(select.value)) {
          config.blocked_countries.push(select.value);
          render();
        }
      }
    });

    // Save
    document.getElementById('cr-geo-save').addEventListener('click', function () {
      var btn = document.getElementById('cr-geo-save');
      var msg = document.getElementById('cr-geo-msg');
      btn.textContent = 'Saving...';
      btn.disabled = true;
      fetch('/api/admin/geo-block', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
        body: JSON.stringify(config)
      }).then(function (r) { return r.json(); }).then(function (data) {
        if (data.ok) {
          msg.textContent = '✅ Saved!';
          msg.style.color = '#22c55e';
        } else {
          msg.textContent = '❌ ' + (data.error || 'Error');
          msg.style.color = '#ef4444';
        }
        setTimeout(function () { msg.textContent = ''; }, 3000);
      }).finally(function () {
        btn.textContent = 'Save Changes';
        btn.disabled = false;
      });
    });

    // Close
    document.getElementById('cr-geo-close').addEventListener('click', function () {
      panel.remove();
    });
    panel.addEventListener('click', function (e) {
      if (e.target === panel) panel.remove();
    });
  }

  function addGeoBlockButton() {
    if (document.getElementById('cr-geo-nav-btn')) return;

    // Find the nav in admin sidebar
    var nav = document.querySelector('nav.flex-1') || document.querySelector('aside nav');
    if (!nav) return;

    var btn = document.createElement('button');
    btn.id = 'cr-geo-nav-btn';
    btn.style.cssText = 'width:100%;display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:8px;font-size:14px;font-weight:500;color:#94a3b8;background:none;border:none;cursor:pointer;transition:all 0.15s;text-align:left;';
    btn.innerHTML = '<span style="font-size:16px;">🌍</span><span>Geo Block</span>';
    btn.onmouseenter = function () { btn.style.color = '#fff'; btn.style.background = 'rgba(255,255,255,0.05)'; };
    btn.onmouseleave = function () { btn.style.color = '#94a3b8'; btn.style.background = 'none'; };
    btn.onclick = showGeoPanel;

    nav.appendChild(btn);
  }

  // Watch for admin panel to load
  if (isAdminPage()) {
    var observer = new MutationObserver(function () {
      if (document.querySelector('nav.flex-1') || document.querySelector('aside nav')) {
        addGeoBlockButton();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // Also try immediately
    setTimeout(addGeoBlockButton, 1500);
    setTimeout(addGeoBlockButton, 3000);

    // Hook React router navigation
    var origPush = history.pushState;
    history.pushState = function () {
      origPush.apply(this, arguments);
      setTimeout(addGeoBlockButton, 500);
    };
  }
})();
