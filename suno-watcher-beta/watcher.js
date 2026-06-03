// watcher.js - persistent Suno selection watcher (content script)
(function () {
  if (window.__sunoWatcherLoaded) return;
  window.__sunoWatcherLoaded = true;
  const api = (typeof browser !== 'undefined') ? browser : chrome;
  const collected = new Map(); // id -> title
  const done = new Set(); // already downloaded -> skip

  function isSelected(btn) {
    const label = String(btn.getAttribute('aria-label') || btn.getAttribute('title') || '').toLowerCase();
    if (/deselect|unselect|remove selection/.test(label)) return true;
    if (label === 'select clip') return false;
    if (btn.getAttribute('aria-pressed') === 'true') return true;
    if (btn.getAttribute('aria-checked') === 'true') return true;
    if (btn.getAttribute('aria-selected') === 'true') return true;
    const cb = btn.querySelector('input[type="checkbox"]');
    if (cb && cb.checked) return true;
    let n = btn;
    for (let i = 0; n && i < 8; i++, n = n.parentElement) {
      if (n.getAttribute && n.getAttribute('aria-selected') === 'true') return true;
      if (n.getAttribute && n.getAttribute('aria-checked') === 'true') return true;
      const st = n.getAttribute && n.getAttribute('data-state');
      if (st === 'checked' || st === 'on') return true;
    }
    return false;
  }
  function findRow(el) {
    let n = el;
    for (let i = 0; n && i < 10; i++, n = n.parentElement) {
      if (n.classList && n.classList.contains('clip-row')) return n;
      if (n.matches && n.matches('article, [role="listitem"]')) return n;
    }
    return null;
  }
  function clipId(row) {
    if (!row) return null;
    for (const a of row.querySelectorAll('a[href]')) {
      const m = (a.href || '').match(/\/(?:song|track|clip|gen)\/([a-f0-9-]{8,})/i);
      if (m) return m[1];
    }
    const d = row.dataset && (row.dataset.clipId || row.dataset.songId || row.dataset.id);
    if (d) return d;
    const inner = row.querySelector('[data-clip-id],[data-song-id],[data-id]');
    if (inner) return inner.dataset.clipId || inner.dataset.songId || inner.dataset.id;
    return null;
  }
  function clipTitle(row) {
    if (!row) return '';
    const t = row.querySelector('[class*="title" i]') || row.querySelector('[class*="name" i]') || row.querySelector('p, h2, h3, h4');
    return ((t && t.textContent) || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  }
  function scan() {
    const btns = document.querySelectorAll('.multi-select-button button, button[aria-label*="select" i], button[aria-label*="deselect" i], .clip-browser-list-scroller button, [role="checkbox"][aria-label*="select" i]');
    for (const btn of btns) {
      if (!isSelected(btn)) continue;
      const row = findRow(btn);
      const id = clipId(row);
      if (id && !collected.has(id) && !done.has(id)) collected.set(id, clipTitle(row) || ('Untitled_' + id));
    }
  }
  setInterval(scan, 700);
  scan();

  api.runtime.onMessage.addListener((msg, _s, send) => {
    if (!msg) return;
    if (msg.action === 'watcher_get') {
      scan();
      send({ clips: [...collected].map(([id, title]) => ({ id, title })), count: collected.size });
      return true;
    }
    if (msg.action === 'watcher_clear') { collected.clear(); send({ ok: true }); return true; }
    if (msg.action === 'watcher_done') { for (const id of (msg.ids || [])) { done.add(id); collected.delete(id); } send({ ok: true }); return true; }
    if (msg.action === 'watcher_remove') { for (const id of (msg.ids || [])) collected.delete(id); send({ ok: true, count: collected.size }); return true; }
  });
})();
