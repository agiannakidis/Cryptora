// profile-page.js — inject Profile page + add to user dropdown + move 2FA here
(function() {
  'use strict';
  const AUTH_KEY = 'auth_token';
  const API = '/api';
  function getToken() { return localStorage.getItem(AUTH_KEY); }
  function authHeaders() {
    const t = getToken();
    return t ? { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
  }
  async function apiGet(path) { const r = await fetch(API + path, { headers: authHeaders() }); return r.json(); }
  async function apiPut(path, body) { const r = await fetch(API + path, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) }); return r.json(); }
  async function apiPost(path, body) { const r = await fetch(API + path, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) }); return r.json(); }

  function showMsg(msg, ok) {
    const el = document.getElementById('pp-msg');
    if (!el) return;
    el.textContent = msg; el.style.display = 'block';
    el.style.background = ok ? 'rgba(34,197,94,.15)' : 'rgba(239,68,68,.15)';
    el.style.border = ok ? '1px solid rgba(34,197,94,.3)' : '1px solid rgba(239,68,68,.3)';
    el.style.color = ok ? '#4ade80' : '#f87171';
    setTimeout(() => { el.style.display = 'none'; }, 3000);
  }

  async function ppSave() {
    const name = document.getElementById('pp-name')?.value?.trim();
    const currency = document.getElementById('pp-currency')?.value;
    const r = await apiPut('/auth/me', { name, currency });
    if (r.error) showMsg(r.error, false); else showMsg('Profile saved!', true);
  }

  async function ppChangePwd() {
    const current = document.getElementById('pp-pwd-current')?.value;
    const newPwd = document.getElementById('pp-pwd-new')?.value;
    if (!current || !newPwd) return showMsg('Fill in both fields', false);
    if (newPwd.length < 8) return showMsg('New password: min 8 characters', false);
    const r = await apiPost('/auth/change-password', { currentPassword: current, newPassword: newPwd });
    if (r.error) showMsg(r.error, false);
    else { showMsg('Password updated!', true); document.getElementById('pp-pwd-current').value = ''; document.getElementById('pp-pwd-new').value = ''; }
  }

  async function load2faStatus() {
    const container = document.getElementById('pp-2fa-status');
    if (!container) return;
    try {
      const r = await apiGet('/crypto/2fa/status');
      if (r.enabled) {
        container.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between"><div><span style="color:#4ade80;font-weight:600">2FA Enabled</span><p style="color:#64748b;font-size:.8rem;margin:4px 0 0">Your account is protected</p></div><button onclick="pp2faDisable()" style="padding:8px 16px;background:rgba(239,68,68,.15);color:#f87171;border:1px solid rgba(239,68,68,.3);border-radius:8px;cursor:pointer;font-size:.85rem">Disable</button></div>';
      } else {
        container.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><div><span style="color:#f59e0b;font-weight:600">2FA Disabled</span><p style="color:#64748b;font-size:.8rem;margin:4px 0 0">Enable for extra security on withdrawals</p></div><button onclick="pp2faEnable()" style="padding:8px 16px;background:rgba(240,192,64,.1);color:#f0c040;border:1px solid rgba(240,192,64,.3);border-radius:8px;cursor:pointer;font-size:.85rem">Enable 2FA</button></div><div id="pp-2fa-setup" style="display:none"></div>';
      }
    } catch(e) { container.innerHTML = '<span style="color:#64748b">2FA status unavailable</span>'; }
  }

  async function pp2faEnable() {
    const setup = document.getElementById('pp-2fa-setup');
    if (!setup) return;
    setup.style.display = 'block';
    setup.innerHTML = '<p style="color:#64748b">Loading...</p>';
    const r = await apiPost('/crypto/2fa/setup', {});
    if (r.error) { setup.innerHTML = '<p style="color:#f87171">' + r.error + '</p>'; return; }
    setup.innerHTML = '<div style="background:#0a0e1a;border:1px solid #252b45;border-radius:12px;padding:20px;text-align:center"><p style="color:#94a3b8;font-size:.85rem;margin-bottom:12px">Scan with Google Authenticator</p><img src="' + r.qrCode + '" style="border-radius:8px;max-width:180px;margin:0 auto;display:block"/><p style="color:#64748b;font-size:.75rem;margin:12px 0 16px;word-break:break-all">' + r.secret + '</p><div style="display:flex;gap:8px;justify-content:center"><input id="pp-2fa-code" type="text" maxlength="6" placeholder="6-digit code" style="padding:10px 14px;background:#141829;border:1px solid #252b45;border-radius:8px;color:#e2e8f0;font-size:1rem;text-align:center;width:140px"/><button onclick="pp2faConfirm()" style="padding:10px 20px;background:linear-gradient(135deg,#f0c040,#d97706);color:#0a0e1a;font-weight:700;border:none;border-radius:8px;cursor:pointer">Confirm</button></div></div>';
  }

  async function pp2faConfirm() {
    const code = document.getElementById('pp-2fa-code')?.value?.trim();
    if (!code || code.length !== 6) return showMsg('Enter 6-digit code', false);
    const r = await apiPost('/crypto/2fa/verify', { token: code });
    if (r.error) showMsg(r.error, false); else { showMsg('2FA enabled!', true); load2faStatus(); }
  }

  async function pp2faDisable() {
    const code = prompt('Enter your 2FA code to disable:');
    if (!code) return;
    const r = await apiPost('/crypto/2fa/disable', { token: code });
    if (r.error) showMsg(r.error, false); else { showMsg('2FA disabled', true); load2faStatus(); }
  }

  window.ppSave = ppSave; window.ppChangePwd = ppChangePwd;
  window.pp2faEnable = pp2faEnable; window.pp2faConfirm = pp2faConfirm; window.pp2faDisable = pp2faDisable;

  function renderProfilePage(container) {
    container.innerHTML = '<div style="max-width:580px;margin:0 auto;padding:32px 16px;color:#e2e8f0;font-family:-apple-system,sans-serif">' +
      '<button onclick="history.back()" style="color:#64748b;background:none;border:none;cursor:pointer;font-size:.9rem;margin-bottom:16px">← Back</button>' +
      '<h1 style="font-size:1.5rem;font-weight:700;color:#f0c040;margin-bottom:24px">My Profile</h1>' +
      '<div id="pp-msg" style="display:none;padding:10px 16px;border-radius:8px;margin-bottom:16px;font-size:.9rem"></div>' +
      // Basic info
      '<div style="background:#141829;border:1px solid #252b45;border-radius:16px;padding:24px;margin-bottom:20px">' +
        '<h2 style="font-size:.85rem;font-weight:600;color:#64748b;margin-bottom:16px;text-transform:uppercase;letter-spacing:.06em">Account Info</h2>' +
        '<label style="display:block;font-size:.85rem;color:#94a3b8;margin-bottom:6px">Display Name</label>' +
        '<input id="pp-name" type="text" placeholder="Your name" style="width:100%;padding:10px 14px;background:#0a0e1a;border:1px solid #252b45;border-radius:8px;color:#e2e8f0;font-size:.95rem;box-sizing:border-box;margin-bottom:14px"/>' +
        '<label style="display:block;font-size:.85rem;color:#94a3b8;margin-bottom:6px">Email</label>' +
        '<input id="pp-email" type="email" disabled style="width:100%;padding:10px 14px;background:#0a0e1a;border:1px solid #1e2540;border-radius:8px;color:#475569;font-size:.95rem;box-sizing:border-box;margin-bottom:14px"/>' +
        '<label style="display:block;font-size:.85rem;color:#94a3b8;margin-bottom:6px">Currency</label>' +
        '<select id="pp-currency" style="width:100%;padding:10px 14px;background:#0a0e1a;border:1px solid #252b45;border-radius:8px;color:#e2e8f0;font-size:.95rem;box-sizing:border-box;margin-bottom:20px"><option value="USD">USD</option><option value="EUR">EUR</option></select>' +
        '<button onclick="ppSave()" style="padding:10px 24px;background:linear-gradient(135deg,#f0c040,#d97706);color:#0a0e1a;font-weight:700;border:none;border-radius:8px;cursor:pointer">Save Changes</button>' +
      '</div>' +
      // Change password
      '<div style="background:#141829;border:1px solid #252b45;border-radius:16px;padding:24px;margin-bottom:20px">' +
        '<h2 style="font-size:.85rem;font-weight:600;color:#64748b;margin-bottom:16px;text-transform:uppercase;letter-spacing:.06em">Change Password</h2>' +
        '<label style="display:block;font-size:.85rem;color:#94a3b8;margin-bottom:6px">Current Password</label>' +
        '<input id="pp-pwd-current" type="password" placeholder="••••••••" style="width:100%;padding:10px 14px;background:#0a0e1a;border:1px solid #252b45;border-radius:8px;color:#e2e8f0;font-size:.95rem;box-sizing:border-box;margin-bottom:14px"/>' +
        '<label style="display:block;font-size:.85rem;color:#94a3b8;margin-bottom:6px">New Password</label>' +
        '<input id="pp-pwd-new" type="password" placeholder="Min 8 characters" style="width:100%;padding:10px 14px;background:#0a0e1a;border:1px solid #252b45;border-radius:8px;color:#e2e8f0;font-size:.95rem;box-sizing:border-box;margin-bottom:20px"/>' +
        '<button onclick="ppChangePwd()" style="padding:10px 24px;background:#1e293b;color:#e2e8f0;font-weight:600;border:1px solid #334155;border-radius:8px;cursor:pointer">Update Password</button>' +
      '</div>' +
      // 2FA
      '<div style="background:#141829;border:1px solid #252b45;border-radius:16px;padding:24px">' +
        '<h2 style="font-size:.85rem;font-weight:600;color:#64748b;margin-bottom:4px;text-transform:uppercase;letter-spacing:.06em">Two-Factor Authentication</h2>' +
        '<p style="font-size:.82rem;color:#475569;margin-bottom:16px">Protects withdrawals with a TOTP code</p>' +
        '<div id="pp-2fa-status">Loading...</div>' +
      '</div>' +
    '</div>';

    apiGet('/auth/me').then(user => {
      if (user.error) return;
      const n = document.getElementById('pp-name'); if (n) n.value = user.name || '';
      const e = document.getElementById('pp-email'); if (e) e.value = user.email || '';
      const c = document.getElementById('pp-currency'); if (c) c.value = user.currency || 'USD';
    });
    load2faStatus();
  }

  function checkRoute() {
    const path = window.location.pathname;
    if (path === '/Profile' || path === '/profile') {
      let pp = document.getElementById('profile-page-root');
      if (!pp) {
        pp = document.createElement('div');
        pp.id = 'profile-page-root';
        pp.style.cssText = 'position:fixed;top:64px;left:0;right:0;bottom:0;overflow-y:auto;background:#0a0e1a;z-index:50';
        document.body.appendChild(pp);
      }
      pp.style.display = 'block';
      renderProfilePage(pp);
    } else {
      const pp = document.getElementById('profile-page-root');
      if (pp) pp.style.display = 'none';
    }
  }

  function injectProfileMenuItem() {
    const obs = new MutationObserver(() => {
      document.querySelectorAll('[role="menuitem"]').forEach(item => {
        if ((item.textContent.trim() === 'Log out' || item.textContent.trim() === 'Sign out' || item.textContent.trim() === 'Logout') && !item.dataset.ppDone) {
          const menu = item.closest('[role="menu"]');
          if (!menu || menu.querySelector('[data-pp-profile]')) return;
          const profileItem = document.createElement('div');
          profileItem.setAttribute('role', 'menuitem');
          profileItem.setAttribute('data-pp-profile', '1');
          profileItem.className = item.className;
          profileItem.style.cursor = 'pointer';
          profileItem.textContent = 'Profile';
          profileItem.addEventListener('click', () => {
            window.history.pushState({}, '', '/Profile');
            checkRoute();
            document.body.click();
          });
          menu.insertBefore(profileItem, item);
          item.dataset.ppDone = '1';
        }
      });
      // Suppress floating 2FA popup
      const popup = document.getElementById('twofa-popup-overlay');
      if (popup && popup.style.display !== 'none') {
        popup.style.display = 'none';
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  window.addEventListener('popstate', checkRoute);
  const origPush = history.pushState.bind(history);
  history.pushState = function(...args) { origPush(...args); setTimeout(checkRoute, 50); };

  const init = () => { checkRoute(); injectProfileMenuItem(); };
  if (document.readyState !== 'loading') setTimeout(init, 300);
  else document.addEventListener('DOMContentLoaded', init);
})();
