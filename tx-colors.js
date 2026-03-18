// tx-colors.js v3 — color transaction amounts in div-based list layout
(function () {
  const style = document.createElement('style');
  style.textContent = `
    .tx-amt-red    { color: #ef4444 !important; font-weight: 700 !important; }
    .tx-amt-green  { color: #10b981 !important; font-weight: 700 !important; }
    .tx-amt-blue   { color: #3b82f6 !important; font-weight: 700 !important; }
    .tx-amt-orange { color: #f97316 !important; font-weight: 700 !important; }
    .tx-amt-gold   { color: #ffd700 !important; font-weight: 700 !important; }
  `;
  document.head.appendChild(style);

  const TYPE_CLASS = {
    'bet':        'tx-amt-red',
    'loss':       'tx-amt-red',
    'win':        'tx-amt-green',
    'deposit':    'tx-amt-blue',
    'withdrawal': 'tx-amt-orange',
    'jackpot':    'tx-amt-gold',
    'bonus':      'tx-amt-gold',
  };

  // Amount regex: matches "$1.50", "+$1.50", "-$1.50", "$0.00"
  const AMT_RE = /^[+\-]?\$[\d,]+\.\d{2}$/;

  function findAmountEl(root) {
    // Walk all text nodes in root looking for an amount pattern
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (AMT_RE.test(node.textContent.trim())) {
        return node.parentElement;
      }
    }
    return null;
  }

  function colorRow(row) {
    if (row.dataset.txc) return;

    // Find the type label in this row
    let typeText = '';
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const t = node.textContent.trim().toLowerCase();
      if (TYPE_CLASS[t]) { typeText = t; break; }
    }
    if (!typeText) return;

    const amtEl = findAmountEl(row);
    if (!amtEl) return;

    // Remove any existing tx-amt classes
    amtEl.classList.remove('tx-amt-red','tx-amt-green','tx-amt-blue','tx-amt-orange','tx-amt-gold');
    amtEl.classList.add(TYPE_CLASS[typeText]);

    // Fix prefix sign: bet/loss should show "-", win/deposit should show "+"
    const txt = amtEl.textContent.trim();
    const stripped = txt.replace(/^[+\-]/, '');
    if (typeText === 'bet' || typeText === 'loss' || typeText === 'withdrawal') {
      if (!txt.startsWith('-')) amtEl.textContent = '-' + stripped;
    } else {
      if (!txt.startsWith('+')) amtEl.textContent = '+' + stripped;
    }

    row.dataset.txc = '1';
  }

  function scan() {
    // Look for transaction rows — they contain a type word and an amount
    // Strategy: find all elements that contain exactly a type word as direct text
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      if (el.children.length > 0) continue; // leaf only
      const t = el.textContent.trim().toLowerCase();
      if (!TYPE_CLASS[t]) continue;
      // Walk up to find the row container (sibling has amount)
      let row = el.parentElement;
      for (let i = 0; i < 6; i++) {
        if (!row) break;
        const amtEl = findAmountEl(row);
        if (amtEl && amtEl !== el) {
          colorRow(row);
          break;
        }
        row = row.parentElement;
      }
    }
  }

  // MutationObserver with guard
  let ticking = false;
  const obs = new MutationObserver(() => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { scan(); ticking = false; });
  });
  obs.observe(document.body, { childList: true, subtree: true });

  setTimeout(scan, 800);
  setTimeout(scan, 2000);
})();
