/**
 * Cryptora — Deposit Rate Info Injector v4
 * Fixes: modal jump (in-place update) + rate flicker (observer disconnect during update)
 */
(function () {
  if (location.pathname.startsWith('/admin')) return;
    'use strict';

  const STABLECOINS = new Set(['USDT', 'USDC', 'BUSD', 'DAI']);
  const INJECT_ID = 'crypt-rate-banner';
  let prices = {};

  async function fetchPrices() {
    try {
      const r = await fetch('/api/crypto/prices');
      if (r.ok) { const d = await r.json(); prices = d.prices || d; }
    } catch (e) {}
  }
  fetchPrices();
  setInterval(fetchPrices, 60000);

  function detectSelectedToken(container) {
    const btns = Array.from(container.querySelectorAll('button'));
    const gradBtn = btns.find(b => b.className.includes('bg-gradient') || b.textContent.includes('Address'));
    if (gradBtn) {
      const m = gradBtn.textContent.match(/Get\s+(\S+)\s+/);
      if (m) return m[1].toUpperCase();
    }
    const activePill = btns.find(b => b.className.includes('bg-amber-500') && b.textContent.length < 30 && !b.className.includes('h-11'));
    if (activePill) return activePill.textContent.trim().split(/\s+/)[0].toUpperCase();
    return null;
  }

  function buildBannerHTML(token) {
    if (!token) return null;
    const isStable = STABLECOINS.has(token);
    let rateText, rateNote;

    if (isStable) {
      rateText = '1 ' + token + ' = $1.00 USD';
      rateNote = 'Стейблкоин — курс 1:1 к USD.';
    } else {
      const price = prices[token];
      if (!price) return null;
      const fmt = new Intl.NumberFormat('en-US', {
        style: 'currency', currency: 'USD',
        minimumFractionDigits: price < 1 ? 4 : 2,
        maximumFractionDigits: price < 1 ? 6 : 2,
      });
      rateText = '1 ' + token + ' \u2248 ' + fmt.format(price);
      rateNote = 'Средства конвертируются в USD по курсу на момент зачисления.';
    }

    return '<span style="font-size:18px;line-height:1;flex-shrink:0;margin-top:1px">\u{1F4B1}</span>'
      + '<div style="flex:1"><div style="color:#34d399;font-weight:700;font-size:13px;margin-bottom:2px">'
      + rateText + '</div><div style="color:#94a3b8;font-size:11px;line-height:1.4">' + rateNote
      + ' <span style="color:#64748b">Баланс пополняется в USD.</span></div></div>';
  }

  // Each watched modal gets its own observer ref so we can pause it during updates
  const modalObservers = new WeakMap();

  function injectBanner(container) {
    const token = detectSelectedToken(container);
    const existing = container.querySelector('#' + INJECT_ID);

    if (!token) {
      if (existing) existing.remove();
      return;
    }

    const html = buildBannerHTML(token);
    if (!html) {
      if (existing) existing.remove();
      return;
    }

    // --- Pause the observer to prevent feedback loop ---
    const obs = modalObservers.get(container);
    if (obs) obs.disconnect();

    if (existing) {
      // UPDATE IN PLACE — no remove/re-insert → no height change → no modal jump
      existing.innerHTML = html;
    } else {
      // First injection — create and place the banner
      const div = document.createElement('div');
      div.id = INJECT_ID;
      div.style.cssText = 'margin:12px 0 4px;padding:10px 14px;background:linear-gradient(135deg,rgba(16,185,129,.09),rgba(6,182,212,.06));border:1px solid rgba(16,185,129,.28);border-radius:10px;display:flex;align-items:flex-start;gap:10px';
      div.innerHTML = html;

      const warnCard = Array.from(container.querySelectorAll('[class*="border-amber"]'))
        .find(el => (el.textContent || '').includes('Send only'));
      const getBtn = Array.from(container.querySelectorAll('button'))
        .find(b => b.textContent.includes('Address') || b.textContent.includes('Generating'));

      if (warnCard && warnCard.parentNode) warnCard.parentNode.insertBefore(div, warnCard);
      else if (getBtn && getBtn.parentNode) getBtn.parentNode.insertBefore(div, getBtn);
      else container.appendChild(div);
    }

    // --- Resume observer after DOM change is done ---
    if (obs) {
      obs.observe(container, { childList: true, subtree: true, characterData: false });
    }
  }

  let refreshTimer = null;

  function watchDepositModal(modal) {
    injectBanner(modal);

    const obs = new MutationObserver(() => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => injectBanner(modal), 200);
    });
    // Store observer ref on the modal so injectBanner can pause it
    modalObservers.set(modal, obs);
    obs.observe(modal, { childList: true, subtree: true, characterData: false });

    // Stop watching if modal is removed from DOM
    const parentObs = new MutationObserver(() => {
      if (!document.body.contains(modal)) {
        obs.disconnect();
        parentObs.disconnect();
        modalObservers.delete(modal);
      }
    });
    parentObs.observe(document.body, { childList: true, subtree: false });
  }

  function findAndWatchDepositModal() {
    const candidates = new Set([
      ...document.querySelectorAll('[role=dialog][data-state=open]'),
      ...document.querySelectorAll('[role=dialog]'),
    ]);
    for (const el of candidates) {
      if (el.dataset.rateWatched) continue;
      const text = el.textContent || '';
      const isDeposit =
        text.includes('Deposit Cryptocurrency') ||
        text.includes('Deposit Crypto') ||
        (text.includes('Popular') && (text.includes('USDT') || text.includes('BTC')) && text.includes('Network'));
      if (isDeposit) {
        el.dataset.rateWatched = '1';
        watchDepositModal(el);
      }
    }
  }

  // Detect modal open via MutationObserver on body (immediate)
  let detectTimer = null;
  const domObserver = new MutationObserver(() => {
    clearTimeout(detectTimer);
    detectTimer = setTimeout(findAndWatchDepositModal, 250);
  });
  domObserver.observe(document.body, { childList: true, subtree: false });

  // Inject animation style (only once)
  const style = document.createElement('style');
  style.textContent = '@keyframes crFadeIn{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:translateY(0)}} #' + INJECT_ID + '{animation:crFadeIn 0.2s ease}';
  document.head.appendChild(style);

})();
