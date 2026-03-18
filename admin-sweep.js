(function () {
  if (!location.pathname.startsWith('/admin')) return;

  const API = '/api';
  const CHAINS = [
    { chain: 'TRX', tokens: ['USDT', 'USDC', 'TRX'], label: 'Tron (TRC20)', color: '#ef4444' },
    { chain: 'ETH', tokens: ['USDT', 'USDC', 'ETH'], label: 'Ethereum', color: '#6366f1' },
    { chain: 'BSC', tokens: ['USDT', 'USDC', 'BNB'], label: 'BNB Chain', color: '#f59e0b' },
    { chain: 'POLYGON', tokens: ['USDT', 'USDC', 'MATIC'], label: 'Polygon', color: '#8b5cf6' },
    { chain: 'ARBITRUM', tokens: ['USDT', 'USDC', 'ETH'], label: 'Arbitrum', color: '#3b82f6' },
    { chain: 'BTC', tokens: ['BTC'], label: 'Bitcoin', color: '#f97316' },
    { chain: 'SOL', tokens: ['SOL', 'USDC'], label: 'Solana', color: '#10b981' },
    { chain: 'XRP', tokens: ['XRP'], label: 'Ripple', color: '#06b6d4' },
    { chain: 'LTC', tokens: ['LTC'], label: 'Litecoin', color: '#94a3b8' },
    { chain: 'TON', tokens: ['TON', 'USDT'], label: 'TON', color: '#0ea5e9' },
  ];

  let sweepOverlay = null;
  let selectedChain = 'TRX';
  let selectedToken = 'USDT';

  function getToken() {
    return localStorage.getItem('auth_token') || '';
  }

  function buildOverlay() {
    if (sweepOverlay) return sweepOverlay;

    const overlay = document.createElement('div');
    overlay.id = 'sweep-overlay';
    overlay.style.cssText = `
      position:fixed;top:0;left:240px;right:0;bottom:0;
      background:#0a0e1a;z-index:200;overflow-y:auto;padding:24px 28px;
    `;
    overlay.style.display = 'none';

    overlay.innerHTML = `
      <style>
        #sweep-overlay .sw-card{background:#141829;border:1px solid #1e2a45;border-radius:14px;padding:22px;margin-bottom:18px;}
        #sweep-overlay .sw-input{width:100%;background:#0d1220;border:1px solid #1e2a45;border-radius:9px;padding:10px 14px;color:#f1f5f9;font-size:13px;outline:none;box-sizing:border-box;font-family:monospace;}
        #sweep-overlay .sw-input:focus{border-color:#6366f1;}
        #sweep-overlay .sw-chip{display:inline-block;padding:5px 12px;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;border:1.5px solid #1e2a45;color:#64748b;background:#0a0f1c;transition:all .15s;margin:3px;}
        #sweep-overlay .sw-chip.active{border-color:var(--cc);background:color-mix(in srgb,var(--cc) 18%,transparent);color:var(--cc);}
        #sweep-overlay .sw-btn{border:none;border-radius:10px;padding:11px 22px;font-size:13px;font-weight:700;cursor:pointer;transition:all .2s;display:inline-flex;align-items:center;gap:7px;}
        #sweep-overlay .sw-btn-primary{background:#6366f1;color:#fff;}
        #sweep-overlay .sw-btn-primary:hover:not(:disabled){background:#4f46e5;}
        #sweep-overlay .sw-btn-primary:disabled{opacity:.5;cursor:not-allowed;}
        #sweep-overlay .sw-btn-sec{background:#1e2a45;color:#94a3b8;}
        #sweep-overlay .sw-btn-sec:hover:not(:disabled){background:#253350;color:#f1f5f9;}
        #sweep-overlay .sw-btn-sec:disabled{opacity:.5;cursor:not-allowed;}
        #sweep-overlay .sw-row{display:flex;justify-content:space-between;align-items:center;padding:9px 13px;border-radius:8px;font-size:12px;font-family:monospace;margin-bottom:5px;}
        #sweep-overlay .sw-swept{background:#10b98118;color:#10b981;}
        #sweep-overlay .sw-skip{background:#1e293b;color:#64748b;}
        #sweep-overlay .sw-err{background:#ef444418;color:#f87171;}

        /* balance table */
        #sw-bal-table{width:100%;border-collapse:collapse;}
        #sw-bal-table th{text-align:left;color:#64748b;font-size:11px;text-transform:uppercase;padding:8px 12px;border-bottom:1px solid #1e2a45;}
        #sw-bal-table td{padding:10px 12px;border-bottom:1px solid #0d1220;font-size:13px;}
        #sw-bal-table tr:hover td{background:#ffffff06;}
        .sw-tag{display:inline-block;padding:2px 8px;border-radius:5px;font-size:11px;font-weight:700;}
        .sw-spin{display:inline-block;width:16px;height:16px;border:2px solid #1e2a45;border-top-color:#6366f1;border-radius:50%;animation:sw-rotate .7s linear infinite;}
        @keyframes sw-rotate{to{transform:rotate(360deg)}}
      </style>

      <div style="max-width:900px;">

        <!-- Header -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:22px;">
          <div>
            <h1 style="color:#f1f5f9;font-size:20px;font-weight:800;margin:0 0 3px;">💸 Crypto Balances & Sweep</h1>
            <p style="color:#64748b;font-size:13px;margin:0;">View balances across all user wallets, then sweep to your address</p>
          </div>
          <button id="sw-refresh-btn" class="sw-btn sw-btn-sec">🔄 Check Balances</button>
        </div>

        <!-- Balance summary table -->
        <div class="sw-card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
            <h3 style="color:#f1f5f9;font-size:14px;font-weight:700;margin:0;">Wallet Balances by Chain</h3>
            <span id="sw-grand-total" style="font-size:15px;font-weight:800;color:#10b981;"></span>
          </div>
          <div id="sw-bal-wrap">
            <div style="color:#64748b;font-size:13px;padding:20px 0;text-align:center;">
              Click "Check Balances" to scan all user wallets on-chain
            </div>
          </div>
        </div>

        <!-- Sweep form -->
        <div class="sw-card">
          <h3 style="color:#f1f5f9;font-size:14px;font-weight:700;margin:0 0 16px;">Sweep to My Wallet</h3>

          <div style="margin-bottom:14px;">
            <div style="font-size:11px;color:#64748b;margin-bottom:8px;text-transform:uppercase;">Network</div>
            <div id="sw-chain-wrap">
              ${CHAINS.map(c => `<span class="sw-chip${c.chain === 'TRX' ? ' active' : ''}" data-chain="${c.chain}" style="--cc:${c.color}">${c.label}</span>`).join('')}
            </div>
          </div>

          <div style="margin-bottom:14px;">
            <div style="font-size:11px;color:#64748b;margin-bottom:8px;text-transform:uppercase;">Token</div>
            <div id="sw-token-wrap">
              <span class="sw-chip active" data-token="USDT" style="--cc:#10b981;">USDT</span>
              <span class="sw-chip" data-token="USDC" style="--cc:#3b82f6;">USDC</span>
              <span class="sw-chip" data-token="TRX" style="--cc:#ef4444;">TRX</span>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 140px;gap:14px;margin-bottom:16px;">
            <div>
              <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:7px;text-transform:uppercase;">Your destination address</label>
              <input id="sw-addr" class="sw-input" type="text" placeholder="Paste your wallet address…" />
            </div>
            <div>
              <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:7px;text-transform:uppercase;">Min $ per wallet</label>
              <input id="sw-min" class="sw-input" type="number" value="1" min="0.01" step="0.1" />
            </div>
          </div>

          <div style="background:#7c2d1215;border:1px solid #991b1b25;border-radius:8px;padding:10px 13px;margin-bottom:16px;font-size:12px;color:#fca5a5;line-height:1.5;">
            ⚠️ Sends <strong>real on-chain transactions</strong> from every user wallet to your address. Double-check the destination address!
          </div>

          <button id="sw-run" class="sw-btn sw-btn-primary">🚀 Run Sweep</button>
        </div>

        <!-- Results -->
        <div id="sw-results" style="display:none;" class="sw-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
            <h3 style="color:#f1f5f9;font-size:14px;font-weight:700;margin:0;">Sweep Results</h3>
            <span id="sw-summary" style="font-size:13px;color:#64748b;"></span>
          </div>
          <div id="sw-rows"></div>
        </div>

      </div>
    `;

    // ── Chain click ──
    overlay.querySelector('#sw-chain-wrap').addEventListener('click', e => {
      const chip = e.target.closest('[data-chain]');
      if (!chip) return;
      selectedChain = chip.dataset.chain;
      overlay.querySelectorAll('#sw-chain-wrap .sw-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const cfg = CHAINS.find(c => c.chain === selectedChain);
      const tw = overlay.querySelector('#sw-token-wrap');
      tw.innerHTML = (cfg?.tokens || ['USDT']).map((t, i) =>
        `<span class="sw-chip${i === 0 ? ' active' : ''}" data-token="${t}" style="--cc:#10b981;">${t}</span>`
      ).join('');
      selectedToken = cfg?.tokens[0] || 'USDT';
    });

    // ── Token click ──
    overlay.querySelector('#sw-token-wrap').addEventListener('click', e => {
      const chip = e.target.closest('[data-token]');
      if (!chip) return;
      selectedToken = chip.dataset.token;
      overlay.querySelectorAll('#sw-token-wrap .sw-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    });

    // ── Check Balances ──
    overlay.querySelector('#sw-refresh-btn').addEventListener('click', async () => {
      const btn = overlay.querySelector('#sw-refresh-btn');
      const wrap = overlay.querySelector('#sw-bal-wrap');
      const grandEl = overlay.querySelector('#sw-grand-total');

      btn.disabled = true;
      btn.innerHTML = '<span class="sw-spin"></span> Scanning…';
      wrap.innerHTML = `<div style="color:#64748b;font-size:13px;padding:28px 0;text-align:center;"><span class="sw-spin" style="width:20px;height:20px;"></span><br/><br/>Querying on-chain balances… this may take 30-60 seconds</div>`;
      grandEl.textContent = '';

      try {
        const r = await fetch(`${API}/crypto/admin/wallet-totals`, {
          headers: { Authorization: `Bearer ${getToken()}` }
        });
        const data = await r.json();

        if (data.ok && data.results) {
          const withBalance = data.results.filter(x => x.totalBalance > 0);
          const empty = data.results.filter(x => x.totalBalance <= 0);

          if (data.grandTotalUsd > 0) {
            grandEl.textContent = `Total: $${data.grandTotalUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
          }

          if (!data.results.length) {
            wrap.innerHTML = '<div style="color:#64748b;text-align:center;padding:20px 0;">No user wallets found yet</div>';
          } else {
            wrap.innerHTML = `
              <table id="sw-bal-table">
                <thead>
                  <tr>
                    <th>Chain</th>
                    <th>Token</th>
                    <th style="text-align:right;">Total Balance</th>
                    <th style="text-align:right;">USD Value</th>
                    <th style="text-align:right;">Wallets</th>
                    <th style="text-align:center;">Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${withBalance.map(row => `
                    <tr>
                      <td><span class="sw-tag" style="background:#1e2a45;color:#94a3b8;">${row.chain}</span></td>
                      <td style="color:#f1f5f9;font-weight:700;">${row.token}</td>
                      <td style="text-align:right;color:#f1f5f9;font-family:monospace;">${row.totalBalance.toFixed(4)}</td>
                      <td style="text-align:right;color:#10b981;font-weight:700;">$${row.totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                      <td style="text-align:right;color:#64748b;">${row.walletCount}</td>
                      <td style="text-align:center;">
                        <button class="sw-quick-sweep sw-btn sw-btn-sec" 
                          data-chain="${row.chain}" data-token="${row.token}"
                          style="padding:5px 14px;font-size:12px;">
                          Sweep
                        </button>
                      </td>
                    </tr>
                  `).join('')}
                  ${empty.length ? `
                    <tr><td colspan="6" style="color:#334155;font-size:11px;text-align:center;padding:12px;">
                      ${empty.map(r => `${r.chain}/${r.token}`).join(', ')} — empty
                    </td></tr>
                  ` : ''}
                </tbody>
              </table>
            `;

            // Quick sweep buttons — prefill the form
            wrap.querySelectorAll('.sw-quick-sweep').forEach(btn => {
              btn.addEventListener('click', () => {
                const chain = btn.dataset.chain;
                const token = btn.dataset.token;

                // Select chain chip
                overlay.querySelectorAll('#sw-chain-wrap .sw-chip').forEach(c => {
                  c.classList.toggle('active', c.dataset.chain === chain);
                });
                selectedChain = chain;

                // Rebuild token chips
                const cfg = CHAINS.find(c => c.chain === chain);
                const tw = overlay.querySelector('#sw-token-wrap');
                tw.innerHTML = (cfg?.tokens || [token]).map(t =>
                  `<span class="sw-chip${t === token ? ' active' : ''}" data-token="${t}" style="--cc:#10b981;">${t}</span>`
                ).join('');
                selectedToken = token;

                // Scroll to form
                overlay.querySelector('#sw-addr').scrollIntoView({ behavior: 'smooth' });
                overlay.querySelector('#sw-addr').focus();
              });
            });
          }
        } else {
          wrap.innerHTML = `<div style="color:#f87171;padding:12px 0;">❌ ${data.error || 'Error loading balances'}</div>`;
        }
      } catch (e) {
        wrap.innerHTML = `<div style="color:#f87171;padding:12px 0;">❌ ${e.message}</div>`;
      } finally {
        btn.disabled = false;
        btn.innerHTML = '🔄 Check Balances';
      }
    });

    // ── Run Sweep ──
    overlay.querySelector('#sw-run').addEventListener('click', async () => {
      const addr = overlay.querySelector('#sw-addr').value.trim();
      const minUsd = parseFloat(overlay.querySelector('#sw-min').value) || 1;
      const btn = overlay.querySelector('#sw-run');
      const results = overlay.querySelector('#sw-results');
      const rows = overlay.querySelector('#sw-rows');
      const summary = overlay.querySelector('#sw-summary');

      if (!addr) { alert('Enter your destination address'); return; }
      if (!confirm(`Sweep ${selectedToken} on ${selectedChain} → ${addr.slice(0, 20)}…\nMin $${minUsd}. Continue?`)) return;

      btn.disabled = true;
      btn.innerHTML = '<span class="sw-spin"></span> Sweeping… please wait';
      results.style.display = 'none';

      try {
        const r = await fetch(`${API}/crypto/admin/sweep-all`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
          body: JSON.stringify({ chain: selectedChain, token: selectedToken, to_address: addr, min_usd: minUsd })
        });
        const data = await r.json();

        results.style.display = 'block';

        if (data.ok) {
          const swept = (data.results || []).filter(x => x.status === 'swept');
          const skipped = (data.results || []).filter(x => x.status === 'skipped');
          const errors = (data.results || []).filter(x => x.status === 'error');

          summary.innerHTML = `<span style="color:#10b981;font-weight:700;">✅ ${data.swept} swept · $${data.totalSweptUsd}</span>&nbsp;·&nbsp;${skipped.length} skipped&nbsp;·&nbsp;<span style="color:${errors.length ? '#f87171' : '#64748b'}">${errors.length} errors</span>`;

          rows.innerHTML = [
            ...swept.map(r => `<div class="sw-row sw-swept"><span>${r.address}</span><span>${(r.amountSent || 0).toFixed(6)} ${selectedToken}&nbsp;·&nbsp;TX:&nbsp;${r.txHash ? r.txHash.slice(0, 22) + '…' : '—'}</span></div>`),
            ...skipped.map(r => `<div class="sw-row sw-skip"><span>${r.address || '—'}</span><span>$${(r.balanceUsd || 0).toFixed(2)}&nbsp;·&nbsp;${r.reason}</span></div>`),
            ...errors.map(r => `<div class="sw-row sw-err"><span>${(r.address || '?').slice(0, 20)}…</span><span>${r.error}</span></div>`)
          ].join('') || '<div style="color:#64748b;text-align:center;padding:20px 0;">No wallets found</div>';
        } else {
          rows.innerHTML = `<div style="color:#f87171;padding:12px 0;">❌ ${data.error || 'Error'}</div>`;
          summary.textContent = 'Failed';
        }
      } catch (e) {
        results.style.display = 'block';
        rows.innerHTML = `<div style="color:#f87171;padding:12px 0;">❌ ${e.message}</div>`;
      } finally {
        btn.disabled = false;
        btn.innerHTML = '🚀 Run Sweep';
      }
    });

    document.body.appendChild(overlay);
    sweepOverlay = overlay;
    return overlay;
  }

  function showOverlay() { buildOverlay().style.display = 'block'; }
  function hideOverlay() { if (sweepOverlay) sweepOverlay.style.display = 'none'; }

  function bindCryptoTab() {
    const nav = document.querySelector('aside nav, nav');
    if (!nav) return;
    const btns = Array.from(nav.querySelectorAll('button'));
    const cryptoBtn = btns.find(b => b.textContent.trim() === 'Crypto');
    if (!cryptoBtn || cryptoBtn._sweepBound) return;
    cryptoBtn._sweepBound = true;
    cryptoBtn.addEventListener('click', () => setTimeout(showOverlay, 50));
  }

  // Global: hide overlay when any OTHER nav button is clicked
  document.addEventListener('click', function(e) {
    if (!sweepOverlay || sweepOverlay.style.display === 'none') return;
    var btn = e.target.closest('button');
    if (!btn) return;
    var nav = document.querySelector('aside nav, nav');
    if (!nav || !nav.contains(btn)) return;
    if (btn.textContent.trim() !== 'Crypto') hideOverlay();
  }, true);

  const obs = new MutationObserver(bindCryptoTab);
  obs.observe(document.body, { childList: true, subtree: true });
  setTimeout(bindCryptoTab, 1000);
  setTimeout(bindCryptoTab, 2500);
})();
