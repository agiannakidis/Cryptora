// admin-operator-nav.js — Injects "Operators" link into admin sidebar/nav
// Moved from inline script in index.html to standalone file
(function() {
  if (!window.location.pathname.startsWith('/admin')) return;

  function injectOperatorLink() {
    // Look for admin nav elements
    const selectors = [
      'a[href="/admin/players"]',
      'a[href*="players"]',
      '[class*="sidebar"] a',
      'nav a',
      '[class*="nav"] a'
    ];
    for (const sel of selectors) {
      const links = document.querySelectorAll(sel);
      for (const link of links) {
        if (link.href && link.href.includes('/admin') && !document.getElementById('op-nav-link')) {
          const li = link.closest('li') || link.parentElement;
          const newEl = li.cloneNode(true);
          const newLink = newEl.querySelector('a') || newEl;
          if (newLink.tagName === 'A') {
            newLink.href = '/admin/operators';
            newLink.id = 'op-nav-link';
            newLink.removeAttribute('data-discover');
          }
          // Update text content
          const textNodes = newEl.querySelectorAll('span, p, div');
          let changed = false;
          for (const t of textNodes) {
            if (t.children.length === 0 && t.textContent.trim()) {
              t.textContent = 'Operators';
              changed = true; break;
            }
          }
          if (!changed) newEl.textContent = 'Operators';
          li.parentElement.appendChild(newEl);

          // Add notification badge if there are pending operators
          fetch('/api/operator/admin/list', {
            headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('auth_token') || '') }
          }).then(r => r.json()).then(ops => {
            const pending = Array.isArray(ops) ? ops.filter(o => o.status === 'pending_approval').length : 0;
            const unread = Array.isArray(ops) ? ops.reduce((s,o) => s + parseInt(o.unread||0), 0) : 0;
            const total = pending + unread;
            if (total > 0) {
              const badge = document.createElement('span');
              badge.textContent = total;
              badge.style.cssText = 'background:#ef4444;color:#fff;border-radius:10px;padding:1px 7px;font-size:10px;font-weight:800;margin-left:6px;';
              newEl.appendChild(badge);
            }
          }).catch(() => {});
          return true;
        }
      }
    }
    return false;
  }

  // Try immediately and then watch for React render
  let attempts = 0;
  const interval = setInterval(() => {
    if (injectOperatorLink() || ++attempts > 40) clearInterval(interval);
  }, 500);
})();
