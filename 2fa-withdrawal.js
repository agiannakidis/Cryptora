/**
 * Cryptora 2FA for Withdrawals
 * Intercepts the withdrawal form and injects a TOTP code field if 2FA is enabled.
 * Also adds a 2FA settings section to the account/wallet page.
 */
(function () {
  if (location.pathname.startsWith('/admin')) return;
    'use strict';

  var API_BASE = '/api/crypto';
  var token = function () { return localStorage.getItem('auth_token') || ''; };

  /* ── Helper: authenticated fetch ── */
  function apiFetch(path, options) {
    var opts = Object.assign({ headers: {} }, options || {});
    opts.headers['Authorization'] = 'Bearer ' + token();
    opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';
    return fetch(API_BASE + path, opts);
  }

  /* ── 2FA Status Cache ── */
  var twoFaEnabled = null;

  function load2FaStatus() {
    if (!token()) return Promise.resolve(false);
    return apiFetch('/2fa/status')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        twoFaEnabled = !!(d && d.enabled);
        return twoFaEnabled;
      })
      .catch(function () { return false; });
  }

  /* ════════════════════════════════════════════════
     MODAL: 2FA Setup
  ════════════════════════════════════════════════ */
  function show2FASetupModal() {
    removeModal('cr-2fa-modal');
    var overlay = document.createElement('div');
    overlay.id = 'cr-2fa-modal';
    overlay.style.cssText = [
      'position:fixed;inset:0;background:rgba(0,0,0,0.75);',
      'z-index:10000;display:flex;align-items:center;justify-content:center;',
      'padding:16px;'
    ].join('');

    var box = document.createElement('div');
    box.style.cssText = [
      'background:#0d1117;border:1px solid rgba(255,183,0,0.2);border-radius:16px;',
      'padding:28px 24px;max-width:420px;width:100%;',
      'box-shadow:0 20px 60px rgba(0,0,0,0.6);position:relative;',
    ].join('');

    var closeBtn = document.createElement('button');
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = '✕';
    closeBtn.style.cssText = 'position:absolute;top:16px;right:16px;background:none;border:none;color:#888;font-size:18px;cursor:pointer;min-height:32px;min-width:32px;';
    closeBtn.onclick = function () { removeModal('cr-2fa-modal'); };

    box.innerHTML = [
      '<h2 style="color:#FFB700;font-size:20px;font-weight:700;margin:0 0 6px;">🔐 Enable 2FA for Withdrawals</h2>',
      '<p style="color:#888;font-size:13px;margin:0 0 20px;">Scan the QR code with Google Authenticator or Authy to protect your withdrawals.</p>',
      '<div id="cr-2fa-qr" style="display:flex;justify-content:center;margin:0 0 16px;min-height:200px;align-items:center;">',
        '<span style="color:#666">Loading QR code...</span>',
      '</div>',
      '<div id="cr-2fa-secret-row" style="display:none;background:#111;border-radius:8px;padding:10px 14px;margin:0 0 20px;word-break:break-all;">',
        '<p style="color:#888;font-size:11px;margin:0 0 4px;">Manual entry key:</p>',
        '<code id="cr-2fa-secret-text" style="color:#FFB700;font-size:13px;font-family:monospace;"></code>',
      '</div>',
      '<div style="margin:0 0 16px;">',
        '<label style="color:#ccc;font-size:13px;display:block;margin-bottom:6px;">Enter 6-digit code from your app to confirm:</label>',
        '<input id="cr-2fa-code-input" type="text" inputmode="numeric" maxlength="6" placeholder="000000"',
          ' style="width:100%;box-sizing:border-box;background:#111;border:1px solid #333;border-radius:8px;',
          'padding:12px 14px;color:#fff;font-size:20px;letter-spacing:8px;text-align:center;font-family:monospace;" />',
      '</div>',
      '<div id="cr-2fa-error" style="color:#f87171;font-size:13px;margin:0 0 12px;display:none;"></div>',
      '<button id="cr-2fa-confirm-btn"',
        ' style="width:100%;background:linear-gradient(135deg,#FFB700,#FF8C00);color:#000;',
        'font-weight:700;font-size:15px;border:none;border-radius:10px;padding:14px;cursor:pointer;min-height:48px;">',
        'Confirm & Enable 2FA',
      '</button>',
    ].join('');

    box.appendChild(closeBtn);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // Load QR
    apiFetch('/2fa/setup', { method: 'POST', body: '{}' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.qrCode) {
          var qrDiv = document.getElementById('cr-2fa-qr');
          var img = document.createElement('img');
          img.src = d.qrCode;
          img.alt = 'QR code for authenticator';
          img.style.cssText = 'border-radius:8px;max-width:200px;';
          qrDiv.innerHTML = '';
          qrDiv.appendChild(img);
        }
        if (d.manualEntry) {
          var secRow = document.getElementById('cr-2fa-secret-row');
          var secText = document.getElementById('cr-2fa-secret-text');
          if (secRow && secText) {
            secText.textContent = d.manualEntry;
            secRow.style.display = 'block';
          }
        }
      })
      .catch(function (e) {
        var qrDiv = document.getElementById('cr-2fa-qr');
        if (qrDiv) qrDiv.innerHTML = '<span style="color:#f87171">Failed to load QR: ' + e.message + '</span>';
      });

    // Confirm button handler
    var confirmBtn = document.getElementById('cr-2fa-confirm-btn');
    var errDiv = document.getElementById('cr-2fa-error');
    var codeInput = document.getElementById('cr-2fa-code-input');
    if (confirmBtn) {
      confirmBtn.onclick = function () {
        var code = (codeInput && codeInput.value || '').trim();
        if (!code || code.length < 6) {
          if (errDiv) { errDiv.textContent = 'Enter a 6-digit code from your authenticator app.'; errDiv.style.display = 'block'; }
          return;
        }
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Verifying...';
        apiFetch('/2fa/confirm', { method: 'POST', body: JSON.stringify({ code: code }) })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d.success) {
              twoFaEnabled = true;
              removeModal('cr-2fa-modal');
              showToast('✅ 2FA enabled! Your withdrawals are now protected.', 'success');
              refresh2FABadge();
            } else {
              if (errDiv) { errDiv.textContent = d.error || 'Invalid code. Try again.'; errDiv.style.display = 'block'; }
              confirmBtn.disabled = false;
              confirmBtn.textContent = 'Confirm & Enable 2FA';
            }
          })
          .catch(function (e) {
            if (errDiv) { errDiv.textContent = 'Error: ' + e.message; errDiv.style.display = 'block'; }
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Confirm & Enable 2FA';
          });
      };
    }

    // Close on overlay click
    overlay.onclick = function (e) { if (e.target === overlay) removeModal('cr-2fa-modal'); };
    // Auto-focus input
    setTimeout(function () { if (codeInput) codeInput.focus(); }, 800);
  }

  /* ════════════════════════════════════════════════
     MODAL: 2FA Code Input (during withdrawal)
  ════════════════════════════════════════════════ */
  function show2FATotpModal(onSuccess) {
    removeModal('cr-2fa-totp-modal');
    var overlay = document.createElement('div');
    overlay.id = 'cr-2fa-totp-modal';
    overlay.style.cssText = [
      'position:fixed;inset:0;background:rgba(0,0,0,0.8);',
      'z-index:10001;display:flex;align-items:center;justify-content:center;padding:16px;'
    ].join('');

    var box = document.createElement('div');
    box.style.cssText = [
      'background:#0d1117;border:1px solid rgba(255,183,0,0.3);border-radius:16px;',
      'padding:28px 24px;max-width:360px;width:100%;text-align:center;',
      'box-shadow:0 20px 60px rgba(0,0,0,0.6);',
    ].join('');
    box.innerHTML = [
      '<div style="font-size:40px;margin-bottom:12px;">🔐</div>',
      '<h3 style="color:#FFB700;font-size:18px;font-weight:700;margin:0 0 8px;">2FA Required</h3>',
      '<p style="color:#888;font-size:13px;margin:0 0 20px;">Enter your 6-digit authenticator code to confirm this withdrawal.</p>',
      '<input id="cr-totp-input" type="text" inputmode="numeric" maxlength="6" placeholder="000000" autocomplete="one-time-code"',
        ' style="width:100%;box-sizing:border-box;background:#111;border:1px solid #444;border-radius:10px;',
        'padding:14px;color:#fff;font-size:28px;letter-spacing:12px;text-align:center;font-family:monospace;margin-bottom:8px;" />',
      '<div id="cr-totp-error" style="color:#f87171;font-size:12px;min-height:18px;margin-bottom:12px;"></div>',
      '<div style="display:flex;gap:10px;">',
        '<button id="cr-totp-cancel" style="flex:1;background:#1a1f2e;border:1px solid #333;color:#aaa;border-radius:10px;padding:13px;cursor:pointer;font-size:14px;min-height:48px;">Cancel</button>',
        '<button id="cr-totp-submit" style="flex:2;background:linear-gradient(135deg,#FFB700,#FF8C00);color:#000;border:none;border-radius:10px;padding:13px;cursor:pointer;font-weight:700;font-size:14px;min-height:48px;">Confirm</button>',
      '</div>',
    ].join('');

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    var input = document.getElementById('cr-totp-input');
    var errDiv = document.getElementById('cr-totp-error');
    var submitBtn = document.getElementById('cr-totp-submit');
    var cancelBtn = document.getElementById('cr-totp-cancel');

    setTimeout(function () { if (input) input.focus(); }, 100);

    if (cancelBtn) cancelBtn.onclick = function () { removeModal('cr-2fa-totp-modal'); };

    function doSubmit() {
      var code = (input && input.value || '').replace(/\s/g, '');
      if (!code || code.length < 6) {
        if (errDiv) errDiv.textContent = 'Enter a 6-digit code';
        return;
      }
      removeModal('cr-2fa-totp-modal');
      onSuccess(code);
    }

    if (submitBtn) submitBtn.onclick = doSubmit;
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') doSubmit();
      });
      input.addEventListener('input', function () {
        if (input.value.replace(/\s/g, '').length === 6) doSubmit();
      });
    }
  }

  /* ════════════════════════════════════════════════
     MODAL: Disable 2FA
  ════════════════════════════════════════════════ */
  function show2FADisableModal() {
    removeModal('cr-2fa-disable-modal');
    var overlay = document.createElement('div');
    overlay.id = 'cr-2fa-disable-modal';
    overlay.style.cssText = [
      'position:fixed;inset:0;background:rgba(0,0,0,0.8);',
      'z-index:10001;display:flex;align-items:center;justify-content:center;padding:16px;'
    ].join('');
    var box = document.createElement('div');
    box.style.cssText = [
      'background:#0d1117;border:1px solid rgba(248,113,113,0.3);border-radius:16px;',
      'padding:28px 24px;max-width:360px;width:100%;text-align:center;',
    ].join('');
    box.innerHTML = [
      '<div style="font-size:36px;margin-bottom:12px;">⚠️</div>',
      '<h3 style="color:#f87171;font-size:18px;font-weight:700;margin:0 0 8px;">Disable 2FA</h3>',
      '<p style="color:#888;font-size:13px;margin:0 0 20px;">Enter your current authenticator code to disable 2FA protection.</p>',
      '<input id="cr-2fa-dis-input" type="text" inputmode="numeric" maxlength="6" placeholder="000000"',
        ' style="width:100%;box-sizing:border-box;background:#111;border:1px solid #444;border-radius:10px;',
        'padding:14px;color:#fff;font-size:24px;letter-spacing:10px;text-align:center;font-family:monospace;margin-bottom:8px;" />',
      '<div id="cr-2fa-dis-error" style="color:#f87171;font-size:12px;min-height:18px;margin-bottom:12px;"></div>',
      '<div style="display:flex;gap:10px;">',
        '<button id="cr-2fa-dis-cancel" style="flex:1;background:#1a1f2e;border:1px solid #333;color:#aaa;border-radius:10px;padding:13px;cursor:pointer;font-size:14px;min-height:48px;">Cancel</button>',
        '<button id="cr-2fa-dis-submit" style="flex:2;background:#dc2626;color:#fff;border:none;border-radius:10px;padding:13px;cursor:pointer;font-weight:700;font-size:14px;min-height:48px;">Disable 2FA</button>',
      '</div>',
    ].join('');

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    document.getElementById('cr-2fa-dis-cancel').onclick = function () { removeModal('cr-2fa-disable-modal'); };
    setTimeout(function () { var i = document.getElementById('cr-2fa-dis-input'); if (i) i.focus(); }, 100);

    document.getElementById('cr-2fa-dis-submit').onclick = function () {
      var code = (document.getElementById('cr-2fa-dis-input').value || '').replace(/\s/g, '');
      if (!code || code.length < 6) {
        document.getElementById('cr-2fa-dis-error').textContent = 'Enter a 6-digit code';
        return;
      }
      apiFetch('/2fa/disable', { method: 'POST', body: JSON.stringify({ code: code }) })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.success) {
            twoFaEnabled = false;
            removeModal('cr-2fa-disable-modal');
            showToast('2FA disabled.', 'info');
            refresh2FABadge();
          } else {
            document.getElementById('cr-2fa-dis-error').textContent = d.error || 'Invalid code';
          }
        });
    };
  }

  /* ════════════════════════════════════════════════
     INJECT: 2FA Button into Wallet/Profile pages
  ════════════════════════════════════════════════ */
  var badge2FA_injected = false;

  function inject2FAButton() {
    if (document.getElementById('cr-2fa-badge')) return;
    if (!token()) return;

    load2FaStatus().then(function (enabled) {
      // Find the wallet/profile area — look for deposit button container
      var depositBtns = document.querySelectorAll('button');
      var withdrawBtn = null;
      depositBtns.forEach(function (btn) {
        var t = (btn.textContent || '').trim().toLowerCase();
        if (t.includes('withdraw') && !btn.id) withdrawBtn = btn;
      });

      var insertTarget = withdrawBtn
        ? withdrawBtn.closest('[class*="flex"]') || withdrawBtn.parentElement
        : null;

      // Also look for wallet page heading
      if (!insertTarget) {
        var walletHeadings = document.querySelectorAll('h1, h2, h3');
        walletHeadings.forEach(function (h) {
          if ((h.textContent || '').toLowerCase().includes('wallet')) insertTarget = h.parentElement;
        });
      }

      if (!insertTarget) return;
      if (document.getElementById('cr-2fa-badge')) return;

      var wrapper = document.createElement('div');
      wrapper.id = 'cr-2fa-badge';
      wrapper.style.cssText = [
        'position:fixed;top:72px;right:16px;z-index:100;',
        'display:flex;align-items:center;gap:10px;',
        'padding:10px 14px;',
        'background:rgba(10,14,26,0.95);',
        'border:1px solid rgba(255,183,0,0.25);',
        'border-radius:12px;',
        'box-shadow:0 4px 24px rgba(0,0,0,0.4);',
        'backdrop-filter:blur(8px);',
        'min-width:220px;max-width:280px;',
      ].join('');

      var icon = document.createElement('span');
      icon.textContent = enabled ? '🔐' : '🔓';
      icon.style.fontSize = '20px';

      var textBlock = document.createElement('div');
      textBlock.style.flex = '1';
      var title = document.createElement('div');
      title.id = 'cr-2fa-title';
      title.style.cssText = 'color:#ccc;font-size:14px;font-weight:600;';
      title.textContent = enabled ? '2FA Enabled' : '2FA Disabled';
      var sub = document.createElement('div');
      sub.style.cssText = 'color:#666;font-size:12px;';
      sub.textContent = enabled ? 'Withdrawals are protected by authenticator code' : 'Enable to protect withdrawals with a code';
      textBlock.appendChild(title);
      textBlock.appendChild(sub);

      var actionBtn = document.createElement('button');
      actionBtn.id = 'cr-2fa-toggle-btn';
      actionBtn.textContent = enabled ? 'Disable' : 'Enable';
      actionBtn.style.cssText = [
        'background:' + (enabled ? '#dc2626' : 'linear-gradient(135deg,#FFB700,#FF8C00)') + ';',
        'color:' + (enabled ? '#fff' : '#000') + ';',
        'border:none;border-radius:8px;padding:8px 16px;',
        'font-weight:700;font-size:13px;cursor:pointer;min-height:36px;',
      ].join('');
      actionBtn.onclick = function () {
        if (twoFaEnabled) {
          show2FADisableModal();
        } else {
          show2FASetupModal();
        }
      };

      wrapper.appendChild(icon);
      wrapper.appendChild(textBlock);
      wrapper.appendChild(actionBtn);

      // Insert before withdraw button or at end of target
      if (withdrawBtn && withdrawBtn.parentElement === insertTarget) {
        insertTarget.insertBefore(wrapper, withdrawBtn);
      } else {
        insertTarget.appendChild(wrapper);
      }

      badge2FA_injected = true;
    });
  }

  function refresh2FABadge() {
    var title = document.getElementById('cr-2fa-title');
    var btn = document.getElementById('cr-2fa-toggle-btn');
    var badge = document.getElementById('cr-2fa-badge');
    if (title) title.textContent = twoFaEnabled ? '2FA Enabled' : '2FA Disabled';
    if (btn) {
      btn.textContent = twoFaEnabled ? 'Disable' : 'Enable';
      btn.style.background = twoFaEnabled ? '#dc2626' : 'linear-gradient(135deg,#FFB700,#FF8C00)';
      btn.style.color = twoFaEnabled ? '#fff' : '#000';
    }
    if (badge) {
      var icon = badge.querySelector('span');
      if (icon) icon.textContent = twoFaEnabled ? '🔐' : '🔓';
    }
  }

  /* ════════════════════════════════════════════════
     INTERCEPT: Withdrawal API calls — inject TOTP
  ════════════════════════════════════════════════ */
  (function patchWithdrawFetch() {
    var origFetch = window.fetch;
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var method = ((init && init.method) || 'GET').toUpperCase();

      if (method === 'POST' && url && (url.includes('/api/crypto/withdraw') && !url.includes('/2fa'))) {
        // Check if 2FA is enabled
        if (twoFaEnabled) {
          // Parse existing body
          var body = {};
          try {
            if (init && init.body && typeof init.body === 'string') {
              body = JSON.parse(init.body);
            }
          } catch (e) { body = {}; }

          // If TOTP code not included, intercept
          if (!body.totp_code) {
            return new Promise(function (resolve, reject) {
              show2FATotpModal(function (code) {
                body.totp_code = code;
                var newInit = Object.assign({}, init, { body: JSON.stringify(body) });
                resolve(origFetch.call(window, input, newInit));
              });
            });
          }
        }
      }
      try { return origFetch.apply(window, arguments); } catch(e) { return Promise.reject(e); }
    };
  })();

  /* ── Helpers ── */
  function removeModal(id) {
    var el = document.getElementById(id);
    if (el) el.remove();
    document.body.style.overflow = '';
  }

  function showToast(message, type) {
    var toast = document.createElement('div');
    var bg = type === 'success' ? '#16a34a' : type === 'error' ? '#dc2626' : '#374151';
    toast.style.cssText = [
      'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);',
      'background:' + bg + ';color:#fff;border-radius:10px;',
      'padding:12px 24px;font-size:14px;font-weight:600;',
      'z-index:99999;box-shadow:0 4px 20px rgba(0,0,0,0.4);',
      'transition:opacity 0.3s;',
    ].join('');
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function () { toast.style.opacity = '0'; setTimeout(function () { toast.remove(); }, 400); }, 3000);
  }

  /* ── Watch for wallet page ── */
  function onRouteChange() {
    badge2FA_injected = false;
    setTimeout(function () {
      if (location.pathname.toLowerCase().includes('wallet') ||
          location.pathname === '/' || location.pathname === '/Home') {
        inject2FAButton();
      }
    }, 1000);
  }

  var origPush = history.pushState;
  history.pushState = function () { origPush.apply(this, arguments); onRouteChange(); };
  var origReplace = history.replaceState;
  history.replaceState = function () { origReplace.apply(this, arguments); onRouteChange(); };
  window.addEventListener('popstate', onRouteChange);

  // Initial load
  document.addEventListener('DOMContentLoaded', function () {
    load2FaStatus();
    setTimeout(function () { inject2FAButton(); }, 2000);
  });

})();
