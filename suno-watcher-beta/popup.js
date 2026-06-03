// popup.js - Suno Watcher Beta (transient popup)
const api = (typeof browser !== 'undefined') ? browser : chrome;
const counterDiv = document.getElementById('counter');
const dlBtn = document.getElementById('dlBtn');
const stopBtn = document.getElementById('stopBtn');
const tracksDiv = document.getElementById('tracks');
const statusDiv = document.getElementById('status');
const verEl = document.getElementById('ver');
const SETTINGS_KEY = 'sunoSimpleDlSettings';

try {
  if (verEl) {
    const manifest = api.runtime.getManifest();
    verEl.textContent = 'v' + (manifest.version_name || manifest.version || '?');
  }
} catch (e) {}

let clips = [];
let isDownloading = false;
let pollTimer = null;
let okIds = new Set();

function log(t) { statusDiv.innerText = t + '\n' + statusDiv.innerText; }
function setCounter(text, dim) { counterDiv.textContent = text; counterDiv.classList.toggle('empty', !!dim); }
function renderTracks(list) {
  clips = list || [];
  tracksDiv.innerHTML = '';
  if (!clips.length) { tracksDiv.classList.remove('visible'); return; }
  for (const c of clips) {
    const row = document.createElement('div');
    row.className = 'track'; row.dataset.id = c.id; row.dataset.status = 'pending'; row.title = c.title || c.id;
    const mk = document.createElement('span'); mk.className = 'mk'; row.appendChild(mk);
    const tn = document.createElement('span'); tn.className = 'tn'; tn.textContent = c.title || c.id; row.appendChild(tn);
    tracksDiv.appendChild(row);
  }
  tracksDiv.classList.add('visible');
}
function setTrackStatus(id, status, error) {
  const row = tracksDiv.querySelector(`.track[data-id="${CSS.escape(id)}"]`);
  if (!row) return; row.dataset.status = status; if (error) row.title = (row.title || id) + ' - ' + error;
}
function updateBtn() {
  dlBtn.textContent = isDownloading ? 'DOWNLOADING...' : (clips.length ? ('DOWNLOAD ' + clips.length) : 'NOTHING SELECTED');
  dlBtn.disabled = isDownloading || !clips.length;
  stopBtn.style.display = isDownloading ? 'block' : 'none';
  dlBtn.style.display = isDownloading ? 'none' : 'block';
}
async function sunoTab() {
  const a = await api.tabs.query({ active: true, currentWindow: true });
  if (a[0] && a[0].url && a[0].url.includes('suno.com')) return a[0];
  const all = await api.tabs.query({});
  return all.find(t => t.url && t.url.includes('suno.com')) || null;
}
async function refreshList() {
  if (isDownloading) return;
  const tab = await sunoTab();
  if (!tab || !tab.id) { setCounter('Open suno.com', true); renderTracks([]); updateBtn(); return; }
  let res;
  try { res = await api.tabs.sendMessage(tab.id, { action: 'watcher_get' }); }
  catch (e) {
    try { await api.runtime.sendMessage({ action: 'ensure_watcher' }); res = await api.tabs.sendMessage(tab.id, { action: 'watcher_get' }); }
    catch (e2) { setCounter('Open & focus suno.com', true); renderTracks([]); updateBtn(); return; }
  }
  const list = (res && res.clips) || [];
  if (JSON.stringify(list.map(c => c.id)) !== JSON.stringify(clips.map(c => c.id))) renderTracks(list);
  setCounter(clips.length ? (clips.length + ' selected') : 'Nothing selected yet', !clips.length);
  updateBtn();
}
async function getBatchSize() {
  try { const r = await api.storage.local.get(SETTINGS_KEY); return Math.max(1, Math.min(5, parseInt(r && r[SETTINGS_KEY] && r[SETTINGS_KEY].batchSize, 10) || 1)); } catch (e) { return 1; }
}
async function doDownload() {
  if (!clips.length || isDownloading) return;
  okIds = new Set();
  const batchSize = await getBatchSize();
  isDownloading = true; updateBtn();
  log('Downloading ' + clips.length + ' (x' + batchSize + ')...');
  api.runtime.sendMessage({ action: 'download_selected', options: { music: true, lyrics: true, image: true, folder: 'Suno_Songs', batchSize, clips: clips.map(c => ({ id: c.id, title: c.title })) } });
}
dlBtn.addEventListener('click', doDownload);
stopBtn.addEventListener('click', () => { api.runtime.sendMessage({ action: 'stop_download' }); isDownloading = false; updateBtn(); log('Stopped.'); });

api.runtime.onMessage.addListener((msg) => {
  if (!msg) return;
  if (msg.action === 'log') log(msg.text || '');
  if (msg.action === 'track_progress') { setTrackStatus(msg.id, msg.status, msg.error); if (msg.status === 'ok') okIds.add(msg.id); }
  if (msg.action === 'download_complete') {
    isDownloading = false; updateBtn();
    log('Done: ' + msg.okCount + ' ok' + (msg.failCount ? (', ' + msg.failCount + ' err') : ''));
    (async () => {
      const tab = await sunoTab();
      const ids = [...okIds];
      if (tab && tab.id && ids.length) { try { await api.tabs.sendMessage(tab.id, { action: 'watcher_done', ids }); } catch (e) {} }
      if (!msg.stopped && !msg.failCount) setTimeout(() => window.close(), 800);
    })();
  }
});

(async () => { await refreshList(); if (clips.length && !isDownloading) doDownload(); })();
pollTimer = setInterval(refreshList, 900);
