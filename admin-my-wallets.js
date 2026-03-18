(function () {
  if (!location.pathname.startsWith('/admin')) return;

  const TRONGRID = 'https://api.trongrid.io';
  const TRX_USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
  const TRON_API_KEY = '266aad7d-ab84-4026-9758-8dbf73c206ae';

  function getToken() { return localStorage.getItem('auth_token') || ''; }

  let overlay = null;

  function buildOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'mywallet-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:240px;right:0;bottom:0;background:#0a0e1a;z-index:200;overflow-y:auto;padding:24px 28px;';
    overlay.style.display = 'none';
    overlay.innerHTML = `
      <style>
        #mywallet-overlay *{box-sizing:border-box;}
        #mywallet-overlay h1{color:#f1f5f9;font-size:20px;font-weight:800;margin:0 0 3px;}
        #mywallet-overlay .mw-sub{color:#64748b;font-size:13px;margin:0 0 22px;}
        #mywallet-overlay .mw-card{background:#141829;border:1px solid #1e2a45;border-radius:14px;padding:18px 22px;margin-bottom:12px;}
        #mywallet-overlay .mw-row{display:flex;align-items:center;gap:14px;padding:12px 16px;border-radius:10px;border:1px solid #1e2a45;background:#0d1220;margin-bottom:8px;}
        #mywallet-overlay .mw-icon{font-size:20px;width:28px;text-align:center;}
        #mywallet-overlay .mw-info{flex:1;min-width:0;}
        #mywallet-overlay .mw-label{font-size:13px;font-weight:700;color:#f1f5f9;}
        #mywallet-overlay .mw-addr{font-size:11px;color:#64748b;font-family:monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:380px;margin-top:2px;cursor:pointer;}
        #mywallet-overlay .mw-addr:hover{color:#a5b4fc;}
        #mywallet-overlay .mw-bal{text-align:right;min-width:120px;}
        #mywallet-overlay .mw-bal-crypto{font-size:14px;font-weight:700;color:#f1f5f9;}
        #mywallet-overlay .mw-bal-usd{font-size:12px;color:#64748b;margin-top:2px;}
        #mywallet-overlay .mw-badge{font-size:11px;font-weight:700;padding:3px 9px;border-radius:6px;background:#10b98118;color:#10b981;white-space:nowrap;}
        #mywallet-overlay .mw-badge.zero{background:#1e293b;color:#475569;}
        #mywallet-overlay .mw-badge.loading{background:#1e293b;color:#94a3b8;}
        #mywallet-overlay .mw-btn{border:none;border-radius:10px;padding:10px 20px;font-size:13px;font-weight:700;cursor:pointer;transition:all .2s;}
        #mywallet-overlay .mw-btn-primary{background:#6366f1;color:#fff;}
        #mywallet-overlay .mw-btn-primary:hover{background:#4f46e5;}
        #mywallet-overlay .mw-total-card{background:linear-gradient(135deg,#1e1b4b,#1a2040);border:1px solid #3730a3;border-radius:14px;padding:20px 24px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:center;}
        #mywallet-overlay .mw-total-label{color:#a5b4fc;font-size:13px;font-weight:600;}
        #mywallet-overlay .mw-total-val{color:#f1f5f9;font-size:26px;font-weight:800;margin-top:4px;}
        #mywallet-overlay .mw-hot-badge{font-size:10px;font-weight:800;padding:2px 7px;border-radius:5px;background:#fbbf2420;color:#fbbf24;margin-left:8px;vertical-align:middle;}
        #mywallet-overlay .mw-spinner{width:14px;height:14px;border:2px solid #1e2a45;border-top-color:#6366f1;border-radius:50%;animation:mwspin .7s linear infinite;display:inline-block;vertical-align:middle;}
        @keyframes mwspin{to{transform:rotate(360deg);}}
        #mywallet-overlay .mw-copy-toast{position:fixed;bottom:28px;right:28px;background:#10b981;color:#fff;padding:10px 18px;border-radius:10px;font-size:13px;font-weight:700;opacity:0;transition:opacity .3s;pointer-events:none;z-index:9999;}
      </style>
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;">
        <div>
          <h1>💼 My Wallets</h1>
          <p class="mw-sub">Адреса и балансы кошельков вашего аккаунта</p>
        </div>
        <button class="mw-btn mw-btn-primary" id="mw-refresh">🔄 Обновить балансы</button>
      </div>
      <div class="mw-total-card">
        <div>
          <div class="mw-total-label">Общий баланс (TRX-сеть)</div>
          <div class="mw-total-val" id="mw-total">—</div>
        </div>
        <div style="text-align:right;">
          <div class="mw-total-label">🔥 Горячий кошелёк (выплаты)</div>
          <div id="mw-hot-addr" style="font-family:monospace;font-size:12px;color:#a5b4fc;margin-top:4px;cursor:pointer;" title="Нажмите чтобы скопировать">—</div>
        </div>
      </div>
      <div id="mw-list"><div style="text-align:center;padding:60px 0;color:#475569;"><span class="mw-spinner"></span><div style="margin-top:14px;font-size:13px;">Загрузка…</div></div></div>
      <div class="mw-copy-toast" id="mw-copy-toast">✓ Скопировано!</div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#mw-refresh').addEventListener('click', loadWallets);
    overlay.querySelector('#mw-hot-addr').addEventListener('click', function() { copyAddr(this.textContent.trim()); });
    return overlay;
  }

  function showOverlay() { buildOverlay().style.display = 'block'; loadWallets(); }
  function hideOverlay() { if (overlay) overlay.style.display = 'none'; }

  function copyAddr(addr) {
    navigator.clipboard.writeText(addr).catch(()=>{});
    const t = overlay.querySelector('#mw-copy-toast');
    t.style.opacity = '1';
    setTimeout(() => { t.style.opacity = '0'; }, 1800);
  }

  // Fetch TRX account info from TronGrid
  async function getTrxInfo(address) {
    try {
      const r = await fetch(TRONGRID + '/v1/accounts/' + address, {
        headers: { 'TRON-PRO-API-KEY': TRON_API_KEY }
      });
      const d = await r.json();
      const data = d.data && d.data[0];
      if (!data) return { trx: 0, usdt: 0 };
      const trx = (data.balance || 0) / 1e6;
      let usdt = 0;
      for (const t of (data.trc20 || [])) {
        if (t[TRX_USDT_CONTRACT] != null) usdt = parseInt(t[TRX_USDT_CONTRACT]) / 1e6;
      }
      return { trx, usdt };
    } catch(e) { return { trx: 0, usdt: 0, error: e.message }; }
  }

  const CHAIN_ICONS = { TRX:'🔴', ETH:'🔵', BSC:'🟡', POLYGON:'🟣', ARBITRUM:'🔷', BTC:'🟠', SOL:'🟢', XRP:'🩵', LTC:'⚪', TON:'💎' };

  async function loadWallets() {
    const list = overlay.querySelector('#mw-list');
    list.innerHTML = '<div style="text-align:center;padding:60px 0;color:#475569;"><span class="mw-spinner"></span><div style="margin-top:14px;font-size:13px;">Загрузка кошельков…</div></div>';
    overlay.querySelector('#mw-total').textContent = '—';

    try {
      const resp = await fetch('/api/crypto/admin/my-wallets', { headers: { 'Authorization': 'Bearer ' + getToken() } });
      const ct = resp.headers.get('content-type') || '';
      if (!ct.includes('json')) {
        if (resp.status === 401 || resp.status === 403) {
          throw new Error('Сессия истекла. Пожалуйста, перелогиньтесь.');
        }
        throw new Error('Сервер вернул не JSON (статус ' + resp.status + '). Возможно, сессия истекла.');
      }
      const data = await resp.json();
      if (resp.status === 401) {
        localStorage.removeItem('auth_token');
        throw new Error('Сессия истекла. Пожалуйста, перелогиньтесь.');
      }
      if (!resp.ok) throw new Error(data.error || resp.statusText);

      const wallets = data.wallets || [];
      const hotTRX = data.hotWalletTRX || '';

      if (hotTRX) {
        overlay.querySelector('#mw-hot-addr').textContent = hotTRX;
      }

      // Render rows immediately with loading state
      let html = '';
      for (const w of wallets) {
        const isTRX = w.chain === 'TRX';
        html += '<div class="mw-row" id="mwrow-' + w.address.slice(-8) + '">';
        html += '<div class="mw-icon">' + (CHAIN_ICONS[w.chain] || '🔘') + '</div>';
        html += '<div class="mw-info">';
        html += '<div class="mw-label">' + w.chain + '/' + w.token + (w.isHot ? ' <span class="mw-hot-badge">🔥 HOT</span>' : '') + '</div>';
        html += '<div class="mw-addr" title="' + w.address + '" onclick="(function(){navigator.clipboard.writeText(\'' + w.address + '\').catch(()=>{});var t=document.getElementById(\'mw-copy-toast\');if(t){t.style.opacity=\'1\';setTimeout(()=>{t.style.opacity=\'0\';},1800);}})();">' + w.address + '</div>';
        html += '</div>';
        html += '<div class="mw-bal" id="mwbal-' + w.address.slice(-8) + '">';
        if (isTRX) {
          html += '<div class="mw-bal-crypto"><span class="mw-spinner"></span></div>';
          html += '<div class="mw-bal-usd">загрузка…</div>';
        } else {
          html += '<div class="mw-bal-crypto" style="color:#475569;">—</div>';
          html += '<div class="mw-bal-usd" style="font-size:11px;color:#334155;">сеть недоступна</div>';
        }
        html += '</div>';
        html += '<div><span class="mw-badge loading" id="mwbadge-' + w.address.slice(-8) + '">' + (isTRX ? '⏳' : '—') + '</span></div>';
        html += '</div>';
      }
      list.innerHTML = '<div class="mw-card">' + (html || '<div style="text-align:center;padding:40px;color:#475569;font-size:13px;">Нет кошельков</div>') + '</div>';

      // Now async-load TRX balances
      let totalUsd = 0;
      const trxWallets = wallets.filter(w => w.chain === 'TRX');
      const priceResp = await fetch('/api/crypto/prices');
      const prices = await priceResp.json();

      await Promise.all(trxWallets.map(async w => {
        const info = await getTrxInfo(w.address);
        const key = w.address.slice(-8);
        const balEl = document.getElementById('mwbal-' + key);
        const badgeEl = document.getElementById('mwbadge-' + key);
        if (!balEl) return;

        const bal = w.token === 'TRX' ? info.trx : w.token === 'USDT' ? info.usdt : 0;
        const usdVal = w.token === 'TRX' ? bal * (prices.TRX || 0.28) : bal * 1;
        totalUsd += usdVal;

        balEl.innerHTML = '<div class="mw-bal-crypto">' + (bal > 0 ? bal.toFixed(4) : '0') + ' ' + w.token + '</div>'
          + '<div class="mw-bal-usd">≈ $' + usdVal.toFixed(2) + '</div>';
        if (badgeEl) {
          badgeEl.className = 'mw-badge' + (bal > 0 ? '' : ' zero');
          badgeEl.textContent = bal > 0 ? '✓ Есть средства' : 'Пусто';
        }
      }));

      overlay.querySelector('#mw-total').textContent = '$' + totalUsd.toFixed(2);

    } catch(e) {
      list.innerHTML = '<div class="mw-card" style="color:#f87171;text-align:center;padding:30px;">Ошибка: ' + e.message + '</div>';
    }
  }

  // Inject sidebar button
  function inject() {
    const nav = document.querySelector('aside nav, nav');
    if (!nav || document.getElementById('mw-nav-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'mw-nav-btn';
    btn.textContent = '💼 My Wallets';
    btn.style.cssText = 'width:100%;text-align:left;padding:10px 16px;border:none;background:transparent;color:#94a3b8;font-size:13px;font-weight:600;cursor:pointer;border-radius:8px;transition:all .15s;display:block;';
    btn.onmouseenter = () => { btn.style.background='#ffffff0d'; btn.style.color='#f1f5f9'; };
    btn.onmouseleave = () => { if(!btn._active){btn.style.background='transparent';btn.style.color='#94a3b8';} };
    btn.addEventListener('click', () => { showOverlay(); btn.style.background='#ffffff14'; btn.style.color='#f1f5f9'; btn._active=true; });
    nav.appendChild(btn);
  }

  document.addEventListener('click', function(e) {
    if (!overlay || overlay.style.display==='none') return;
    const btn = e.target.closest('button');
    if (!btn) return;
    const nav = document.querySelector('aside nav, nav');
    if (!nav || !nav.contains(btn)) return;
    if (btn.id !== 'mw-nav-btn') {
      hideOverlay();
      const b = document.getElementById('mw-nav-btn');
      if (b) { b._active=false; b.style.background='transparent'; b.style.color='#94a3b8'; }
    }
  }, true);

  const obs = new MutationObserver(inject);
  obs.observe(document.body, { childList:true, subtree:true });
  setTimeout(inject, 800);
  setTimeout(inject, 2500);
})();
