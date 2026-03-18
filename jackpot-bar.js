// jackpot-bar.js v10 — fixed injection position
(function () {
  if (location.pathname.startsWith('/admin')) return;
  const POLL_MS = 5000;
  let injected = false;
  let meterMax;
  let meterFill, meterPct, meterStatus, meterWrap;
  let lastAmount = 5000, lastMax = 10000;

  const style = document.createElement('style');
  style.textContent = `
    #jp-meter-wrap {
      width:100%; padding:10px 20px 14px; box-sizing:border-box;
      background:rgba(10,14,26,0.7);
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    #jp-meter-track { height:14px; background:rgba(255,255,255,.08); border-radius:99px; overflow:visible; position:relative; }
    #jp-meter-fill {
      height:100%; border-radius:99px; width:0%;
      transition:width 1.4s cubic-bezier(.4,0,.2,1), background .8s ease;
      position:relative;
    }
    #jp-meter-fill::after {
      content:''; position:absolute; inset:0;
      background:linear-gradient(180deg,rgba(255,255,255,.28) 0%,transparent 100%);
      border-radius:99px;
    }
    #jp-meter-fill::before {
      content:''; position:absolute; right:-5px; top:50%; transform:translateY(-50%);
      width:14px; height:14px; border-radius:50%;
      background:inherit; filter:blur(5px); opacity:.85;
    }
    #jp-meter-labels { display:flex; justify-content:space-between; align-items:center; margin-top:5px; }
    #jp-meter-pct   { font-size:11px; font-weight:700; letter-spacing:1px; transition:color .5s; }
    #jp-meter-status{ font-size:11px; font-weight:600; letter-spacing:.4px; transition:color .5s; }
    #jp-meter-max   { font-size:11px; color:rgba(255,255,255,.28); font-weight:500; }
    #jp-meter-hint  { font-size:12px; color:rgba(255,255,255,.40); text-align:center; margin-bottom:7px; font-weight:500; letter-spacing:.3px; }

    #jp-incoming-badge {
      display:none; background:linear-gradient(90deg,#ff4500,#ff8c00);
      color:#fff; font-size:10px; font-weight:800; letter-spacing:2px;
      text-transform:uppercase; padding:3px 10px; border-radius:99px;
      animation:jp-badge-pulse .65s ease-in-out infinite alternate;
      box-shadow:0 2px 10px rgba(255,69,0,.5);
    }
    @keyframes jp-badge-pulse {
      from{opacity:.75;transform:scale(.97)} to{opacity:1;transform:scale(1.04)}
    }
    .jp-meter-warm #jp-incoming-badge,
    .jp-meter-hot  #jp-incoming-badge { display:inline-block; }
    .jp-meter-warm #jp-meter-fill { animation:jp-m-glow 1.2s ease-in-out infinite alternate; }
    .jp-meter-hot  #jp-meter-fill { animation:jp-m-glow-hot .65s ease-in-out infinite alternate; }
    @keyframes jp-m-glow     { from{box-shadow:0 0 6px 2px rgba(255,120,0,.4)} to{box-shadow:0 0 14px 5px rgba(255,60,0,.7)} }
    @keyframes jp-m-glow-hot { from{box-shadow:0 0 10px 4px rgba(255,30,0,.6)} to{box-shadow:0 0 22px 8px rgba(255,0,0,.95)} }
  `;
  document.head.appendChild(style);

  function barColor(r) {
    if (r < 0.15) return 'linear-gradient(90deg,#3b82f6,#6366f1)';
    if (r < 0.30) return 'linear-gradient(90deg,#06b6d4,#3b82f6)';
    if (r < 0.45) return 'linear-gradient(90deg,#10b981,#06b6d4)';
    if (r < 0.60) return 'linear-gradient(90deg,#84cc16,#10b981)';
    if (r < 0.72) return 'linear-gradient(90deg,#eab308,#84cc16)';
    if (r < 0.82) return 'linear-gradient(90deg,#f97316,#eab308)';
    if (r < 0.90) return 'linear-gradient(90deg,#ef4444,#f97316)';
    return 'linear-gradient(90deg,#dc2626,#ef4444,#ff6b6b)';
  }
  function statusText(r) {
    if (r < 0.15) return 'Jackpot is growing 🌱';
    if (r < 0.35) return 'Getting interesting... 👀';
    if (r < 0.55) return 'Jackpot heating up! 🌡️';
    if (r < 0.70) return 'Could drop any moment! ⚡';
    if (r < 0.82) return 'Very close now! 🔥';
    if (r < 0.90) return 'ALMOST THERE!! 💥';
    return '🚨 JACKPOT ABOUT TO DROP!';
  }
  function statusColor(r) {
    if (r < 0.55) return 'rgba(255,255,255,.4)';
    if (r < 0.70) return '#eab308';
    if (r < 0.82) return '#f97316';
    return '#ef4444';
  }

  function updateMeter(amount, max) {
    if (!injected || !meterFill) return;
    if (meterMax) meterMax.textContent = (max>=1e6 ? "$"+(max/1e6).toFixed(1)+"M" : max>=1e3 ? "$"+(max/1e3|0)+"K" : "$"+max)+" max";
    const r = Math.min(amount / max, 1);
    meterFill.style.width = Math.max(r * 100, 0.5) + '%';
    meterFill.style.background = barColor(r);
    meterPct.textContent = (r * 100).toFixed(1) + '%';
    meterPct.style.color = statusColor(r);
    meterStatus.textContent = statusText(r);
    meterStatus.style.color = statusColor(r);
    meterWrap.classList.remove('jp-meter-warm', 'jp-meter-hot');
    if (r >= 0.85) meterWrap.classList.add('jp-meter-hot');
    else if (r >= 0.65) meterWrap.classList.add('jp-meter-warm');
  }

  function tryInject() {
    if (injected) return;

    // Find "Grand Jackpot" text node
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node, insertAfter = null;
    while ((node = walker.nextNode())) {
      if (node.textContent.trim() === 'Grand Jackpot') {
        // Walk up to find the jackpot CARD — a self-contained block
        // We want the outermost element that is SMALL (< 350px tall) but wide
        let el = node.parentElement;
        let bestEl = null;
        for (let i = 0; i < 12 && el && el !== document.body; i++) {
          const r = el.getBoundingClientRect();
          const w = window.innerWidth || 1200;
          if (r.width > w * 0.5 && r.height > 60 && r.height < 350) {
            bestEl = el; // keep going up to find the outermost matching element
          }
          el = el.parentElement;
        }
        if (bestEl) insertAfter = bestEl;
        break;
      }
    }

    if (!insertAfter) return;

    meterWrap = document.createElement('div');
    meterWrap.id = 'jp-meter-wrap';
    meterWrap.innerHTML = `
      <div id="jp-meter-hint">💡 The higher the bet — the greater the jackpot win chance</div>
      <div id="jp-meter-track"><div id="jp-meter-fill"></div></div>
      <div id="jp-meter-labels">
        <span id="jp-meter-pct" style="color:rgba(255,255,255,.4)">0%</span>
        <span id="jp-incoming-badge">🔥 JACKPOT INCOMING!</span>
        <span id="jp-meter-status" style="color:rgba(255,255,255,.4)">Jackpot is growing 🌱</span>
        <span id="jp-meter-max">$10K max</span>
      </div>`;

    // Insert AFTER the jackpot card, not inside it
    insertAfter.insertAdjacentElement('afterend', meterWrap);

    meterFill   = document.getElementById('jp-meter-fill');
    meterPct    = document.getElementById('jp-meter-pct');
    meterStatus = document.getElementById('jp-meter-status');
    meterMax    = document.getElementById('jp-meter-max');
    injected = true;
    updateMeter(lastAmount, lastMax);
  }

  async function fetchAndUpdate() {
    try {
      const r = await fetch('/api/jackpot');
      if (!r.ok) return;
      const d = await r.json();
      lastAmount = d.amount || 5000;
      lastMax = d.max_amount || 10000;
      if (!injected) tryInject();
      updateMeter(lastAmount, lastMax);
    } catch(e) {}
  }

  // Try to inject every 500ms until success, max 30 attempts (15 sec)
  let attempts = 0;
  const tryTimer = setInterval(() => {
    if (injected || ++attempts > 30) { clearInterval(tryTimer); return; }
    tryInject();
  }, 500);

  // Start polling after 2s
  setTimeout(() => { fetchAndUpdate(); setInterval(fetchAndUpdate, POLL_MS); }, 2000);
})();
