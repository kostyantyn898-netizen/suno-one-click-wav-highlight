// popup.js - Suno Simple Selection Downloader side panel
const api = (typeof browser !== 'undefined') ? browser : chrome;

const counterDiv = document.getElementById('counter');
const scanBtn = document.getElementById('scanBtn');
const captureBtn = document.getElementById('captureBtn');
const dlBtn = document.getElementById('dlBtn');
const stopBtn = document.getElementById('stopBtn');
const tracksDiv = document.getElementById('tracks');
const statusDiv = document.getElementById('status');
const verEl = document.getElementById('ver');
const countdownDiv = document.getElementById('countdown');
const batchSizeSelect = document.getElementById('batchSize');
const SETTINGS_KEY = 'sunoSimpleDlSettings';

try { if (verEl) verEl.textContent = 'v' + (api.runtime.getManifest()?.version || '?'); } catch (e) {}

const opts = { wav: true, lyrics: true, image: true };

function clampBatchSize(value) {
    const raw = parseInt(value, 10);
    const n = Number.isFinite(raw) ? raw : 1;
    return Math.max(1, Math.min(5, n));
}

function getBatchSize() {
    const n = clampBatchSize(batchSizeSelect?.value);
    if (batchSizeSelect) batchSizeSelect.value = String(n);
    try { api.storage.local.set({ [SETTINGS_KEY]: { batchSize: n } }); } catch (e) {}
    return n;
}

if (batchSizeSelect) {
    batchSizeSelect.addEventListener('change', getBatchSize);
    try {
        api.storage.local.get(SETTINGS_KEY, (result) => {
            const saved = result?.[SETTINGS_KEY]?.batchSize;
            if (saved != null) batchSizeSelect.value = String(clampBatchSize(saved));
        });
    } catch (e) {}
}

// Always download WAV + lyrics + cover; no per-type toggle.

let isDownloading = false;
let clips = [];
let collectedIds = new Set();
let countdownRunning = false;
let collecting = false;
let collectTimer = null;
let downloadedIds = new Set();
let lastScannerDiagnostic = '';

function log(text) { statusDiv.innerText = text + '\n' + statusDiv.innerText; }

function setCaptureUi(on) {
    collecting = on;
    captureBtn.textContent = on ? 'STOP COLLECTING' : 'COLLECT MORE THAN VISIBLE';
    updateMainButton();
}

function setCounter(count, text) {
    counterDiv.classList.remove('empty');
    if (!count) counterDiv.classList.add('empty');
    counterDiv.textContent = text || (count + (count === 1 ? ' visible track' : ' visible tracks'));
}

function renderTracks(list) {
    clips = list || [];
    tracksDiv.innerHTML = '';
    if (!clips.length) { tracksDiv.classList.remove('visible'); return; }
    for (const c of clips) {
        const row = document.createElement('div');
        row.className = 'track';
        row.dataset.id = c.id;
        row.dataset.status = 'pending';
        row.title = c.title || c.id;
        const mk = document.createElement('span');
        mk.className = 'mk';
        row.appendChild(mk);
        const tn = document.createElement('span');
        tn.className = 'tn';
        tn.textContent = c.title || c.id;
        row.appendChild(tn);
        tracksDiv.appendChild(row);
    }
    tracksDiv.classList.add('visible');
}

function setTrackStatus(id, status, error) {
    const row = tracksDiv.querySelector(`.track[data-id="${CSS.escape(id)}"]`);
    if (!row) return;
    row.dataset.status = status;
    if (error) row.title = (row.title || id) + ' - ' + error;
}

function updateMainButton() {
    if (isDownloading) {
        dlBtn.textContent = 'DOWNLOADING...';
    } else if (countdownRunning) {
        dlBtn.textContent = 'STARTING...';
    } else if (collecting) {
        dlBtn.textContent = clips.length ? ('DOWNLOAD ' + clips.length) : 'COLLECTING SELECTION...';
    } else {
        dlBtn.textContent = 'COLLECTING SELECTION...';
    }
}

function setDownloading(on) {
    isDownloading = on;
    scanBtn.style.display = 'none';
    captureBtn.style.display = 'none';
    scanBtn.disabled = true;
    captureBtn.disabled = true;
    dlBtn.disabled = on || countdownRunning;
    stopBtn.style.display = on || countdownRunning ? 'block' : 'none';
    dlBtn.style.display = on ? 'none' : 'block';
    updateMainButton();
}

function mergeClips(found) {
    let added = 0;
    for (const clip of found || []) {
        if (!clip?.id || collectedIds.has(clip.id) || downloadedIds.has(clip.id)) continue;
        collectedIds.add(clip.id);
        clips.push({ id: clip.id, title: clip.title });
        added++;
    }
    if (added) {
        renderTracks(clips);
        setCounter(clips.length, clips.length + ' collected tracks');
        log('Collect: +' + added + ', total ' + clips.length + '.');
        updateMainButton();
    }
    return added;
}

async function scanVisible() {
    const sel = await api.runtime.sendMessage({ action: 'read_selection' });
    const found = sel.clips || [];
    const debug = sel?._debug;
    if (!found.length && debug) {
        const diagnostic =
            'Scanner: ' + (debug.controls_found || 0) + ' controls, ' +
            (debug.selected_controls_found || 0) + ' selected, ' +
            (debug.selected_without_clip_id || 0) + ' without clip ID.';
        if (diagnostic !== lastScannerDiagnostic) {
            lastScannerDiagnostic = diagnostic;
            log(diagnostic);
        }
    } else if (found.length) {
        lastScannerDiagnostic = '';
    }
    return found;
}

async function scanSelection({ quiet = false } = {}) {
    if (!quiet) statusDiv.innerText = '';
    setCounter(0, 'Scanning selection...');
    try {
        const found = (await scanVisible()).filter(c => !downloadedIds.has(c.id));
        collectedIds = new Set(found.map(c => c.id));
        renderTracks(found);
        if (found.length) {
            setCounter(found.length);
            log('Visible selected: ' + found.length + ' tracks.');
            if (found.length >= 14) log('ℹ️ If you selected more than the visible rows, keep the panel open and scroll through the selection.');
            for (const clip of found.slice(0, 8).reverse()) log('• ' + (clip.title || clip.id));
            if (found.length > 8) log('• ... plus ' + (found.length - 8));
        } else {
            setCounter(0, 'No selected tracks found');
            log('Select tracks on Suno and scan again.');
        }
    } catch (e) {
        setCounter(0, 'Scan error');
        log('❌ Scan error: ' + (e?.message || e));
    }
    setDownloading(isDownloading);
}

async function collectTick() {
    if (!collecting) return;
    try { mergeClips(await scanVisible()); } catch (e) { log('❌ Collect scan error: ' + (e?.message || e)); }
}

function startCollecting({ keepBanner = false } = {}) {
    clips = [];
    collectedIds = new Set();
    renderTracks([]);
    if (!keepBanner) setCounter(0, 'Select tracks on Suno...');
    setCaptureUi(true);
    log('Collection started automatically. Select and scroll tracks on Suno; this panel will collect every selected row it sees.');
    collectTick();
    if (!collectTimer) collectTimer = setInterval(collectTick, 700);
}

function stopCollecting() {
    setCaptureUi(false);
    if (collectTimer) clearInterval(collectTimer);
    collectTimer = null;
    setCounter(clips.length, clips.length + ' collected tracks');
    setDownloading(false);
    log('Collection stopped: ' + clips.length + ' tracks.');
}

async function countdown(seconds = 3) {
    countdownRunning = true;
    setDownloading(false);
    countdownDiv.style.display = 'block';
    for (let n = seconds; n > 0; n--) {
        if (!countdownRunning) break;
        countdownDiv.textContent = n;
        log('Starting in ' + n + '...');
        await new Promise(r => setTimeout(r, 1000));
    }
    const ok = countdownRunning;
    countdownDiv.style.display = 'none';
    countdownRunning = false;
    return ok;
}

scanBtn.addEventListener('click', () => scanSelection());
captureBtn.addEventListener('click', () => collecting ? stopCollecting() : startCollecting());
function clearCollection(message, { keepBanner = false } = {}) {
    if (collecting) stopCollecting();
    clips = [];
    collectedIds = new Set();
    renderTracks([]);
    if (!keepBanner) setCounter(0, 'Collected list cleared');
    if (message) log(message);
    startCollecting({ keepBanner });
}

dlBtn.addEventListener('click', async () => {
    if (!clips.length) {
        log('No tracks collected yet. Select tracks on Suno or scroll through the selected range.');
        return;
    }
    if (collecting) stopCollecting();
    statusDiv.innerText = '';
    if (!clips.length) return;
    const batchSize = getBatchSize();
    log('Starting now: ' + clips.length + ' tracks, up to ' + batchSize + ' in parallel.');
    setDownloading(true);
    api.runtime.sendMessage({
        action: 'download_selected',
        options: {
            music: opts.wav,
            lyrics: opts.lyrics,
            image: opts.image,
            folder: 'Suno_Songs',
            batchSize,
            clips: clips.map(c => ({ id: c.id, title: c.title }))
        }
    });
});

stopBtn.addEventListener('click', () => {
    countdownRunning = false;
    countdownDiv.style.display = 'none';
    api.runtime.sendMessage({ action: 'stop_download' });
    log('⏹️ STOP requested.');
    setDownloading(false);
});

api.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'log') log(msg.text || '');
    if (msg.action === 'selection_found') {
        renderTracks(msg.clips || clips);
        setCounter((msg.clips || clips).length);
    }
    if (msg.action === 'selection_empty') {
        renderTracks([]);
        setCounter(0, 'No selected tracks found');
    }
    if (msg.action === 'track_progress') {
        setTrackStatus(msg.id, msg.status, msg.error);
        if (msg.status === 'ok') downloadedIds.add(msg.id);
        else if (msg.status === 'fail') downloadedIds.delete(msg.id);
    }
    if (msg.action === 'download_complete') {
        setDownloading(false);
        const text = msg.stopped
            ? ('Stopped: ' + msg.okCount + ' ok' + (msg.failCount ? ', ' + msg.failCount + ' errors' : ''))
            : ('Done: ' + msg.okCount + ' ok' + (msg.failCount ? ', ' + msg.failCount + ' errors' : ''));
        setCounter(msg.okCount || 1, text);
        log('✅ ' + text + '.');
        if (!msg.stopped) {
            clearCollection('Auto-cleared after download. Monitoring selection again.', { keepBanner: true });
        }
    }
});

(async () => {
    try {
        const state = await api.runtime.sendMessage({ action: 'get_state' });
        if (state?.isDownloading) setDownloading(true);
    } catch (e) {}
    setCounter(0, 'Collection active');
    setDownloading(false);
    if (!isDownloading) startCollecting();
})();
