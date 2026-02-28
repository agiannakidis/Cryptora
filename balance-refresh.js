/**
 * Cryptora — Live Balance Refresh
 * Polls /api/auth/me every 30s and updates the header balance display
 */
(function () {
  'use strict';

  const POLL_MS = 30000;

  function getToken() {
    return localStorage.getItem('auth_token') ||
           sessionStorage.getItem('auth_token') ||
           localStorage.getItem('token') ||
           null;
  }

  function findBalanceNode() {
    // The wallet link: <a href="/Wallet">  <svg/> $1.00 </a>
    const links = document.querySelectorAll('a[href="/Wallet"], a[href*="/Wallet"]');
    for (const link of links) {
      // Find the text node that looks like a dollar amount
      for (const node of link.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim().match(/^\$[\d.,]+$/)) {
          return node;
        }
      }
      // Also check direct child spans/divs
      for (const child of link.children) {
        const t = child.textContent.trim();
        if (t.match(/^\$[\d.,]+$/)) return child;
      }
    }
    return null;
  }

  async function refreshBalance() {
    const token = getToken();
    if (!token) return; // not logged in

    try {
      const r = await fetch('/api/auth/me', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (!r.ok) return;
      const data = await r.json();
      const balance = parseFloat(data.balance || data.user?.balance || 0);
      if (isNaN(balance)) return;

      const fmt = '$' + balance.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

      const node = findBalanceNode();
      if (node) {
        if (node.nodeType === Node.TEXT_NODE) {
          if (node.textContent.trim() !== fmt) node.textContent = fmt;
        } else {
          if (node.textContent.trim() !== fmt) node.textContent = fmt;
        }
      }
    } catch {}
  }

  // Start polling once page has loaded content
  function start() {
    // First poll after 5s (let app initialize)
    setTimeout(() => {
      refreshBalance();
      setInterval(refreshBalance, POLL_MS);
    }, 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

})();
