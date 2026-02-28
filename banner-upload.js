// Banner image upload injector v2
(function() {
  'use strict';

  function getToken() { return localStorage.getItem('auth_token'); }

  function addUploadBtn(input) {
    if (!input || input.dataset.uploadInjected) return;
    input.dataset.uploadInjected = '1';

    const wrap = input.parentElement;
    if (!wrap) return;
    wrap.style.cssText += 'display:flex;gap:8px;align-items:center;';
    input.style.flex = '1';
    input.style.minWidth = '0';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = '&#128193; Upload';
    btn.style.cssText = 'background:rgba(59,130,246,.15);border:1px solid rgba(59,130,246,.35);color:#93c5fd;font-size:12px;font-weight:600;padding:6px 12px;border-radius:8px;cursor:pointer;white-space:nowrap;flex-shrink:0;font-family:inherit;';

    const status = document.createElement('span');
    status.style.cssText = 'font-size:11px;color:#64748b;flex-shrink:0;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

    btn.onclick = () => fileInput.click();

    fileInput.onchange = async () => {
      const file = fileInput.files[0];
      if (!file) return;
      btn.textContent = '⏳';
      btn.disabled = true;
      status.textContent = 'Uploading…';
      const fd = new FormData();
      fd.append('image', file);
      try {
        const r = await fetch('/api/banner/admin/upload', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + getToken() },
          body: fd,
        });
        const d = await r.json();
        if (!r.ok || !d.url) throw new Error(d.error || 'Failed');
        // Set value into React controlled input
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, d.url);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        status.style.color = '#4ade80';
        status.textContent = '✅ ' + file.name;
      } catch (e) {
        status.style.color = '#f87171';
        status.textContent = '❌ ' + e.message;
      } finally {
        btn.innerHTML = '&#128193; Upload';
        btn.disabled = false;
        fileInput.value = '';
      }
    };

    wrap.appendChild(fileInput);
    wrap.appendChild(btn);
    wrap.appendChild(status);
  }

  function findAndInject() {
    // Method 1: by placeholder
    document.querySelectorAll('input').forEach(inp => {
      const ph = inp.placeholder || '';
      if (ph.includes('unsplash') || ph.includes('images.') || ph.includes('Background')) {
        addUploadBtn(inp);
      }
    });

    // Method 2: by label text "Background Image"
    document.querySelectorAll('label').forEach(lbl => {
      if (/background\s*image/i.test(lbl.textContent)) {
        // find sibling or child input
        const parent = lbl.closest('div');
        if (parent) {
          const inp = parent.querySelector('input[type="text"], input:not([type])');
          if (inp) addUploadBtn(inp);
        }
      }
    });
  }

  // Observe DOM changes
  const obs = new MutationObserver(findAndInject);
  obs.observe(document.body, { childList: true, subtree: true });
  // Also poll for a few seconds after admin section loads
  let ticks = 0;
  const poll = setInterval(() => { findAndInject(); if (++ticks > 20) clearInterval(poll); }, 500);
})();
