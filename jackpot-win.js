// jackpot-win.js v2 — Epic Jackpot Win Overlay
(function () {
  if (location.pathname.startsWith('/admin')) return;
    const POLL_INTERVAL = 3000;
  const NOTIF_TTL = 1800000; // 30 minutes

  // Find any JWT token from localStorage (try all keys)
  function getAuthToken() {
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        // Direct JWT string
        if (raw.startsWith('eyJ')) return raw;
        // JSON object with token field
        const val = JSON.parse(raw);
        if (!val) continue;
        const t = val.token || val.access_token || val.accessToken;
        if (t && typeof t === 'string' && t.startsWith('eyJ')) return t;
        // Nested: { user: { token } } or { data: { token } }
        const nested = val.user || val.data || val.auth;
        if (nested) {
          const nt = nested.token || nested.access_token;
          if (nt && typeof nt === 'string' && nt.startsWith('eyJ')) return nt;
        }
      } catch (e) {}
    }
    return null;
  }

  // ── CSS ──────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #jp-win-overlay {
      display: none;
      position: fixed; inset: 0; z-index: 99999;
      background: radial-gradient(ellipse at center, rgba(10,8,0,.92) 0%, rgba(0,0,0,.97) 100%);
      align-items: center; justify-content: center; flex-direction: column;
      overflow: hidden;
    }
    #jp-win-overlay.show { display: flex; animation: jp-fadein .4s ease; }
    @keyframes jp-fadein { from { opacity:0 } to { opacity:1 } }

    #jp-rays {
      position: absolute; inset: 0; pointer-events: none;
      background: conic-gradient(
        from 0deg,
        transparent 0deg, rgba(255,200,0,.06) 10deg, transparent 20deg,
        transparent 30deg, rgba(255,200,0,.08) 40deg, transparent 50deg,
        transparent 60deg, rgba(255,200,0,.06) 70deg, transparent 80deg,
        transparent 90deg, rgba(255,200,0,.1) 100deg, transparent 110deg,
        transparent 120deg, rgba(255,200,0,.06) 130deg, transparent 140deg,
        transparent 150deg, rgba(255,200,0,.08) 160deg, transparent 170deg,
        transparent 180deg, rgba(255,200,0,.06) 190deg, transparent 200deg,
        transparent 210deg, rgba(255,200,0,.1) 220deg, transparent 230deg,
        transparent 240deg, rgba(255,200,0,.06) 250deg, transparent 260deg,
        transparent 270deg, rgba(255,200,0,.08) 280deg, transparent 290deg,
        transparent 300deg, rgba(255,200,0,.06) 310deg, transparent 320deg,
        transparent 330deg, rgba(255,200,0,.1) 340deg, transparent 350deg,
        transparent 360deg
      );
      animation: jp-spin 8s linear infinite;
    }
    @keyframes jp-spin { to { transform: rotate(360deg); } }

    #jp-coins-canvas { position: absolute; inset: 0; pointer-events: none; }

    #jp-content { position: relative; z-index: 2; text-align: center; padding: 0 20px; }

    #jp-emoji {
      font-size: clamp(60px, 12vw, 100px);
      animation: jp-bounce 0.6s cubic-bezier(.36,.07,.19,.97) both;
      display: block; line-height: 1;
    }
    @keyframes jp-bounce {
      0%  { transform: scale(0) rotate(-10deg); opacity: 0; }
      60% { transform: scale(1.3) rotate(4deg); opacity: 1; }
      80% { transform: scale(0.9) rotate(-2deg); }
      100%{ transform: scale(1) rotate(0deg); opacity: 1; }
    }

    #jp-title {
      font-size: clamp(48px, 10vw, 96px);
      font-weight: 900; letter-spacing: 6px;
      background: linear-gradient(180deg, #ffe066 0%, #ffa500 50%, #ff6a00 100%);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
      filter: drop-shadow(0 0 30px rgba(255,180,0,.8)) drop-shadow(0 0 60px rgba(255,100,0,.5));
      animation: jp-pulse-glow 1.5s ease-in-out infinite alternate, jp-slidein .5s .2s ease both;
      display: block; margin: 12px 0 8px;
    }
    @keyframes jp-pulse-glow {
      from { filter: drop-shadow(0 0 20px rgba(255,180,0,.6)) drop-shadow(0 0 40px rgba(255,100,0,.4)); }
      to   { filter: drop-shadow(0 0 40px rgba(255,200,0,1))  drop-shadow(0 0 80px rgba(255,120,0,.8)); }
    }
    @keyframes jp-slidein {
      from { transform: translateY(-30px); opacity: 0; }
      to   { transform: translateY(0); opacity: 1; }
    }

    #jp-subtitle {
      color: #ffd700; font-size: clamp(16px, 3vw, 22px); letter-spacing: 3px;
      text-transform: uppercase; opacity: .85;
      animation: jp-slidein .5s .4s ease both;
    }

    #jp-amount-wrap { margin: 28px 0 12px; animation: jp-slidein .5s .6s ease both; }
    #jp-amount-label { color: #9ca3af; font-size: 14px; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 6px; }
    #jp-amount {
      font-size: clamp(52px, 11vw, 110px); font-weight: 900; color: #fff;
      font-variant-numeric: tabular-nums;
      text-shadow: 0 0 30px rgba(255,220,0,.9), 0 4px 20px rgba(0,0,0,.6);
      letter-spacing: -2px;
    }

    #jp-congrats {
      color: #e5e7eb; font-size: clamp(14px, 2.5vw, 18px); margin-bottom: 32px;
      animation: jp-slidein .5s .8s ease both;
    }

    #jp-claim-btn {
      padding: 16px 52px;
      font-size: clamp(16px, 3vw, 20px); font-weight: 700; letter-spacing: 2px;
      background: linear-gradient(135deg, #f59e0b, #d97706);
      color: #000; border: none; border-radius: 50px; cursor: pointer;
      box-shadow: 0 0 30px rgba(245,158,11,.6), 0 4px 16px rgba(0,0,0,.4);
      animation: jp-slidein .5s 1s ease both, jp-btn-pulse 2s 1.5s ease-in-out infinite;
      transition: transform .15s; text-transform: uppercase;
    }
    #jp-claim-btn:hover { transform: scale(1.06); }
    @keyframes jp-btn-pulse {
      0%,100% { box-shadow: 0 0 30px rgba(245,158,11,.6), 0 4px 16px rgba(0,0,0,.4); }
      50%      { box-shadow: 0 0 60px rgba(245,158,11,1),  0 4px 24px rgba(0,0,0,.5); }
    }

    .jp-star {
      position: absolute; pointer-events: none;
      border-radius: 50%; background: #ffe066;
      animation: jp-star-fly var(--dur) var(--delay) ease-out forwards;
    }
    @keyframes jp-star-fly {
      0%   { transform: translate(0,0) scale(1); opacity: 1; }
      100% { transform: translate(var(--tx), var(--ty)) scale(0); opacity: 0; }
    }
  `;
  document.head.appendChild(style);

  // ── Sound (Web Audio API — no external files) ─────────────────────────────
  function playJackpotSound() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();

      function note(freq, start, dur, vol, type) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
        gain.gain.setValueAtTime(0, ctx.currentTime + start);
        gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + dur + 0.05);
      }

      // Fanfare melody — ascending triumphant
      const melody = [
        [523, 0.00], [659, 0.12], [784, 0.24], [1047, 0.36],
        [988, 0.55], [1047, 0.65], [1175, 0.80], [1319, 0.95],
        [1047, 1.20], [1319, 1.35], [1568, 1.50],
      ];
      melody.forEach(([freq, t]) => note(freq, t, 0.35, 0.35, 'sine'));

      // Harmony
      const harmony = [
        [392, 0.00], [494, 0.24], [659, 0.55], [784, 0.95], [1047, 1.50],
      ];
      harmony.forEach(([freq, t]) => note(freq, t, 0.5, 0.15, 'triangle'));

      // Coin chimes
      const chimes = [2093, 2349, 2637, 2794, 3136, 2794, 3136];
      chimes.forEach((freq, i) => note(freq, 0.05 + i * 0.08, 0.2, 0.12, 'sine'));

      // Bass punch
      note(130, 0.00, 0.4, 0.4, 'square');
      note(196, 0.36, 0.3, 0.3, 'square');

      // Rolling coins effect
      for (let i = 0; i < 30; i++) {
        const freq = 800 + Math.random() * 1200;
        note(freq, 0.5 + i * 0.06, 0.08, 0.06, 'sine');
      }
    } catch(e) { /* silent */ }
  }

  const overlay = document.createElement('div');
  overlay.id = 'jp-win-overlay';
  overlay.innerHTML = `
    <div id="jp-rays"></div>
    <canvas id="jp-coins-canvas"></canvas>
    <div id="jp-content">
      <span id="jp-emoji">🎰</span>
      <span id="jp-title">JACKPOT!</span>
      <div id="jp-subtitle">You hit the jackpot!</div>
      <div id="jp-amount-wrap">
        <div id="jp-amount-label">YOU WON</div>
        <div id="jp-amount">$0.00</div>
      </div>
      <div id="jp-congrats">Congratulations! The amount has been credited to your balance.</div>
      <button id="jp-claim-btn">🏆 Claim Your Prize</button>
    </div>
  `;
  document.body.appendChild(overlay);

  const canvas = document.getElementById('jp-coins-canvas');
  const ctx = canvas.getContext('2d');
  let particles = [], animFrame;

  function resizeCanvas() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
  window.addEventListener('resize', resizeCanvas);

  const COLORS = ['#ffe066','#ffa500','#ff6a00','#ffd700','#fff','#f59e0b','#10b981'];
  const SHAPES = ['circle','rect','star'];

  function spawnParticles() {
    particles = [];
    for (let i = 0; i < 200; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 8;
      particles.push({
        x: canvas.width / 2, y: canvas.height / 2,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (Math.random() * 5),
        gravity: 0.12 + Math.random() * 0.1,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        shape: SHAPES[Math.floor(Math.random() * SHAPES.length)],
        size: 4 + Math.random() * 12,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.15,
        opacity: 1, decay: 0.007 + Math.random() * 0.01,
      });
    }
  }

  function drawStar(c, x, y, r, color) {
    c.fillStyle = color; c.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (i * 4 * Math.PI) / 5 - Math.PI / 2;
      const ia = a + (2 * Math.PI) / 10;
      i === 0 ? c.moveTo(x + r * Math.cos(a), y + r * Math.sin(a)) : c.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
      c.lineTo(x + (r/2) * Math.cos(ia), y + (r/2) * Math.sin(ia));
    }
    c.closePath(); c.fill();
  }

  function animateParticles() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles = particles.filter(p => p.opacity > 0.05);
    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.vy += p.gravity;
      p.vx *= 0.99; p.rotation += p.rotSpeed; p.opacity -= p.decay;
      ctx.save(); ctx.globalAlpha = Math.max(0, p.opacity);
      ctx.translate(p.x, p.y); ctx.rotate(p.rotation);
      if (p.shape === 'circle') {
        ctx.fillStyle = p.color; ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill();
      } else if (p.shape === 'rect') {
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size/2, -p.size/4, p.size, p.size/2);
      } else { drawStar(ctx, 0, 0, p.size/2, p.color); }
      ctx.restore();
    });
    if (particles.length > 0) animFrame = requestAnimationFrame(animateParticles);
  }

  function spawnStars() {
    for (let i = 0; i < 24; i++) {
      const s = document.createElement('div');
      s.className = 'jp-star';
      s.style.setProperty('--dur', (0.8 + Math.random() * 1.4) + 's');
      s.style.setProperty('--delay', (Math.random() * 0.6) + 's');
      s.style.setProperty('--tx', (Math.random() - 0.5) * 500 + 'px');
      s.style.setProperty('--ty', (Math.random() - 0.5) * 500 + 'px');
      s.style.left = (25 + Math.random() * 50) + '%';
      s.style.top = (20 + Math.random() * 35) + '%';
      s.style.width = s.style.height = (4 + Math.random() * 10) + 'px';
      overlay.appendChild(s);
      setTimeout(() => s.remove(), 2500);
    }
  }

  function animateCounter(target, duration) {
    const el = document.getElementById('jp-amount');
    const start = performance.now();
    function tick(now) {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      el.textContent = '$' + (target * ease).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function showWin(amount) {
    playJackpotSound();
    resizeCanvas();
    // Temporarily push game iframe behind overlay
    document.querySelectorAll('iframe').forEach(f => {
      f._jpZ = f.style.zIndex;
      f.style.zIndex = '1';
    });
    overlay.classList.add('show');
    spawnParticles(); cancelAnimationFrame(animFrame); animateParticles();
    spawnStars();
    [600, 1200, 2000, 3500].forEach(t => setTimeout(() => { spawnParticles(); animateParticles(); spawnStars(); }, t));
    animateCounter(amount, 2500);
  }

  function hideWin() {
    // Restore game iframe z-index
    document.querySelectorAll('iframe').forEach(f => {
      f.style.zIndex = f._jpZ !== undefined ? f._jpZ : '';
    });
    overlay.classList.remove('show');
    cancelAnimationFrame(animFrame);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles = [];
  }

  document.getElementById('jp-claim-btn').addEventListener('click', hideWin);

  // ── Polling ───────────────────────────────────────────────────────────────
  // Track shown wins in localStorage so page refresh doesn't re-show
  function getShownWins() { try { return JSON.parse(localStorage.getItem('_jp_shown') || '[]'); } catch(e) { return []; } }
  function markShown(wonAt) {
    const shown = getShownWins();
    shown.push(wonAt);
    localStorage.setItem('_jp_shown', JSON.stringify(shown.slice(-20)));
  }

  async function checkJackpot() {
    try {
      const token = getAuthToken();
      if (!token) return;

      const r = await fetch('/api/jackpot/my-win', {
        headers: { Authorization: 'Bearer ' + token }
      });
      if (!r.ok) return;
      const d = await r.json();
      if (!d.win) return;

      const shown = getShownWins();
      if (shown.includes(d.won_at)) return;

      markShown(d.won_at);
      showWin(parseFloat(d.amount) || 0);
    } catch (e) { /* silent */ }
  }

  setTimeout(checkJackpot, 1500);
  setInterval(checkJackpot, POLL_INTERVAL);

  // Expose for visibility/focus checks
  window._jpCheck = checkJackpot;

  // Check immediately when user returns from game (tab switch / redirect back)
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') setTimeout(checkJackpot, 800);
  });
  window.addEventListener('focus', function() {
    setTimeout(checkJackpot, 800);
  });
  window.addEventListener('pageshow', function() {
    setTimeout(checkJackpot, 800);
  });

  // Manual test helper
  window._testJackpotWin = (amount) => showWin(amount || 12500);
  window._jpDebug = () => {
    const token = getAuthToken();
    console.log('[JP Debug] token found:', token ? token.substring(0,30)+'...' : 'NONE');
    console.log('[JP Debug] localStorage keys:', Object.keys(localStorage));
    if (token) {
      try { console.log('[JP Debug] JWT payload:', JSON.parse(atob(token.split('.')[1]))); } catch(e) {}
    }
  };
})();
