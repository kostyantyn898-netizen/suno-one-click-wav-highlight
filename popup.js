// popup.js - Suno WAV Auto Marker Local
const api = (typeof browser !== 'undefined') ? browser : chrome;

const FOLDER = 'Suno_Songs';
const DOWNLOAD_STATE_KEY = 'sunoDownloadState';
const LAST_BATCH_KEY = 'sunoOneClickLastBatch';
const FORMAT = 'wav';
const PUBLIC_ONLY = false;

function pagesFor(batchSize) { return 1; }

let stage = 'idle'; // idle | fetching | downloading | auto | done | error
let trackOrder = [];
let trackById = {};
let currentBatch = 0;
let autoMarkedCount = 0;

document.addEventListener('DOMContentLoaded', () => {
    const goBtns = document.querySelectorAll('.go-btn[data-count]');
    const manualStartBtn = document.getElementById('manualStartBtn');
    const batchCountInput = document.getElementById('batchCount');
    const countMinusBtn = document.getElementById('countMinusBtn');
    const countPlusBtn = document.getElementById('countPlusBtn');
    const autoStartBtn = document.getElementById('autoStartBtn');
    const autoStopBtn = document.getElementById('autoStopBtn');
    const autoCounterDiv = document.getElementById('autoCounter');
    const tracksDiv = document.getElementById('tracks');
    const summaryDiv = document.getElementById('summary');
    const statusDiv = document.getElementById('status');
    const versionFooter = document.getElementById('versionFooter');

    try {
        const v = api.runtime.getManifest()?.version;
        if (v) versionFooter.textContent = `v${v}`;
    } catch (e) { /* ignore */ }

    function logStatus(text) {
        statusDiv.innerText = text + '\n' + statusDiv.innerText;
        console.log('[suno-auto-marker]', text);
    }

    function setManualBusy(busy) {
        goBtns.forEach(b => b.disabled = busy);
        if (manualStartBtn) manualStartBtn.disabled = busy;
        if (batchCountInput) batchCountInput.disabled = busy;
        if (countMinusBtn) countMinusBtn.disabled = busy;
        if (countPlusBtn) countPlusBtn.disabled = busy;
        if (autoStartBtn) autoStartBtn.disabled = busy;
        if (autoStopBtn && stage !== 'auto') autoStopBtn.disabled = true;
    }

    function setAutoRunning(running, stopping) {
        if (running) stage = 'auto';
        else if (stage === 'auto') stage = stopping ? 'auto' : 'done';

        goBtns.forEach(b => b.disabled = running || !!stopping);
        if (manualStartBtn) manualStartBtn.disabled = running || !!stopping;
        if (batchCountInput) batchCountInput.disabled = running || !!stopping;
        if (countMinusBtn) countMinusBtn.disabled = running || !!stopping;
        if (countPlusBtn) countPlusBtn.disabled = running || !!stopping;
        if (autoStartBtn) autoStartBtn.disabled = running || !!stopping;
        if (autoStopBtn) autoStopBtn.disabled = !running && !stopping;
    }

    function clearSummary() {
        summaryDiv.className = '';
        summaryDiv.textContent = '';
        summaryDiv.style.display = 'none';
    }

    function updateAutoCounter(count, title) {
        autoMarkedCount = count || 0;
        if (!autoCounterDiv) return;
        autoCounterDiv.style.display = 'block';
        autoCounterDiv.textContent = 'AUTO // ' + autoMarkedCount + ' MARKED' + (title ? ' // ' + title : '');
    }

    function hideAutoCounter() {
        autoMarkedCount = 0;
        if (!autoCounterDiv) return;
        autoCounterDiv.textContent = 'AUTO // 0 MARKED';
        autoCounterDiv.style.display = 'none';
    }

    function showSummary(kind, text) {
        summaryDiv.className = kind;
        summaryDiv.textContent = text;
    }

    function clearTracks() {
        trackOrder = [];
        trackById = {};
        tracksDiv.innerHTML = '';
        tracksDiv.classList.remove('visible');
    }

    function cssEscape(s) {
        return String(s).replace(/(["\\])/g, '\\$1');
    }

    function renderTracks(tracks) {
        clearTracks();
        if (!Array.isArray(tracks) || tracks.length === 0) return;

        tracks.forEach(t => {
            trackOrder.push(t.id);
            trackById[t.id] = { title: t.title || t.id, status: 'pending', error: null };

            const row = document.createElement('div');
            row.className = 'track';
            row.dataset.id = t.id;
            row.dataset.status = 'pending';
            row.title = t.title || t.id;

            const marker = document.createElement('span');
            marker.className = 'marker';
            row.appendChild(marker);

            const titleSpan = document.createElement('span');
            titleSpan.className = 'title';
            titleSpan.textContent = t.title || t.id;
            row.appendChild(titleSpan);

            tracksDiv.appendChild(row);
        });

        tracksDiv.classList.add('visible');
    }

    function setTrackStatus(id, status, error) {
        const row = tracksDiv.querySelector('.track[data-id="' + cssEscape(id) + '"]');
        if (!row) return;
        row.dataset.status = status;
        if (trackById[id]) {
            trackById[id].status = status;
            if (error !== undefined) trackById[id].error = error;
        }
        if (error) {
            row.title = (trackById[id]?.title || id) + ' -- ' + error;
        }
    }

    function finalizeSummary(prefix) {
        if (trackOrder.length === 0) return;
        let ok = 0, fail = 0, pending = 0;
        for (const id of trackOrder) {
            const s = trackById[id]?.status;
            if (s === 'ok') ok++;
            else if (s === 'fail') fail++;
            else pending++;
        }

        if (fail === 0 && pending === 0 && ok === trackOrder.length) {
            showSummary('success', (prefix || 'OK') + ' // ' + ok + '/' + trackOrder.length);
        } else if (ok > 0 && fail > 0) {
            showSummary('partial', (prefix || 'PARTIAL') + ' // ' + ok + ' ok, ' + fail + ' fail');
        } else if (ok === 0 && fail > 0) {
            showSummary('fail', (prefix || 'FAIL') + ' // ' + fail + ' failed');
        } else {
            showSummary('partial', (prefix || 'STOPPED') + ' // ' + ok + ' ok, ' + fail + ' fail, ' + pending + ' pending');
        }
    }

    async function clearTransientState() {
        try { await api.storage.local.remove([DOWNLOAD_STATE_KEY]); } catch (e) { /* ignore */ }
    }

    async function clearRunState() {
        try { await api.storage.local.remove([DOWNLOAD_STATE_KEY, LAST_BATCH_KEY]); } catch (e) { /* ignore */ }
    }

    function getBatchCount() {
        const raw = parseInt(batchCountInput?.value, 10);
        const count = Number.isFinite(raw) ? raw : 5;
        const clamped = Math.max(1, Math.min(10, count));
        if (batchCountInput) batchCountInput.value = String(clamped);
        return clamped;
    }

    async function startAuto() {
        if (stage === 'fetching' || stage === 'downloading' || stage === 'auto') return;
        stage = 'auto';
        clearSummary();
        clearTracks();
        statusDiv.innerText = '';
        updateAutoCounter(0);
        setAutoRunning(true, false);
        const batchSize = getBatchCount();
        logStatus('AUTO started: up to ' + batchSize + ' track(s) per cycle.');
        logStatus('Do not scroll the Suno page while AUTO runs.');
        await clearRunState();

        try {
            api.runtime.sendMessage({
                action: 'auto_trash_start',
                folderName: FOLDER,
                downloadOptions: { music: true, lyrics: true, image: true },
                batchSize
            }, (response) => {
                const err = api.runtime.lastError;
                if (err) {
                    logStatus('Background error: ' + err.message);
                    setAutoRunning(false, false);
                    showSummary('fail', 'FAIL // background error');
                    return;
                }
                logStatus(response?.ok ? 'Background accepted auto mode.' : 'Background did not confirm auto mode.');
            });
        } catch (e) {
            stage = 'error';
            setAutoRunning(false, false);
            logStatus('Failed to start auto: ' + (e?.message || e));
            showSummary('fail', 'FAIL // cannot start auto');
        }
    }

    function stopAuto() {
        if (stage !== 'auto') return;
        setAutoRunning(false, true);
        logStatus('Stop requested. Current track may finish first.');
        try {
            api.runtime.sendMessage({ action: 'auto_trash_stop' });
        } catch (e) {
            logStatus('Failed to stop auto: ' + (e?.message || e));
        }
    }

    async function startManual(batchSize) {
        currentBatch = batchSize;
        if (stage === 'fetching' || stage === 'downloading' || stage === 'auto') return;
        stage = 'fetching';
        setManualBusy(true);
        clearSummary();
        clearTracks();
        statusDiv.innerText = '';
        logStatus('Refreshing feed...');
        await clearRunState();

        try {
            api.runtime.sendMessage({
                action: 'fetch_songs',
                isPublicOnly: PUBLIC_ONLY,
                maxPages: pagesFor(batchSize)
            });
        } catch (e) {
            stage = 'error';
            setManualBusy(false);
            logStatus('Failed to start fetch: ' + (e?.message || e));
            showSummary('fail', 'FAIL // cannot start fetch');
        }
    }

    function handleSongsFetched(songs) {
        if (stage === 'auto') return;
        const list = Array.isArray(songs) ? songs : [];
        if (list.length === 0) {
            stage = 'error';
            setManualBusy(false);
            logStatus('No songs found in feed.');
            showSummary('fail', 'FAIL // empty feed');
            return;
        }

        const batch = list.slice(0, currentBatch || 1);
        stage = 'downloading';
        logStatus('Got ' + list.length + ' songs. Downloading first ' + batch.length + ' as WAV.');

        try {
            api.runtime.sendMessage({
                action: 'download_selected',
                folderName: FOLDER,
                format: FORMAT,
                songs: batch,
                downloadOptions: { music: true, lyrics: true, image: true },
                batchSize: batch.length
            });
        } catch (e) {
            stage = 'error';
            setManualBusy(false);
            logStatus('Failed to start download: ' + (e?.message || e));
            showSummary('fail', 'FAIL // cannot start download');
        }
    }

    async function handleDownloadComplete(stopped) {
        if (stage === 'auto') {
            await clearTransientState();
            return;
        }
        stage = stopped ? 'error' : 'done';
        setManualBusy(false);
        finalizeSummary(stopped ? 'STOPPED' : 'OK');
        logStatus(stopped ? 'Stopped.' : 'Done.');
        await clearTransientState();
    }

    api.runtime.onMessage.addListener((message) => {
        if (!message || !message.action) return;

        switch (message.action) {
            case 'log':
                logStatus(message.text);
                return;

            case 'songs_fetched':
                handleSongsFetched(message.songs);
                return;

            case 'fetch_error':
                if (stage === 'auto') return;
                stage = 'error';
                setManualBusy(false);
                logStatus(message.error || 'Fetch error.');
                showSummary('fail', 'FAIL // fetch error');
                return;

            case 'track_init':
                renderTracks(message.tracks || []);
                return;

            case 'track_progress':
                if (message.id) setTrackStatus(message.id, 'in_progress');
                return;

            case 'track_wav':
                if (message.id) setTrackStatus(message.id, message.status === 'ok' ? 'ok' : 'fail', message.error);
                return;

            case 'track_trash':
                if (message.id) setTrackStatus(message.id, message.status === 'ok' ? 'ok' : 'fail', message.error);
                logStatus(message.status === 'ok' ? 'Marked for manual delete.' : ('Mark failed: ' + (message.error || 'unknown')));
                return;

            case 'auto_marker_count':
                updateAutoCounter(message.marked || 0, message.title || '');
                logStatus('Marked #' + (message.marked || 0) + (message.title ? ': ' + message.title : ''));
                return;

            case 'auto_trash_state':
                setAutoRunning(!!message.running, !!message.stopping);
                if (!message.running && !message.stopping) {
                    stage = 'done';
                    updateAutoCounter(message.movedToTrash || autoMarkedCount || 0);
                    showSummary('success', 'AUTO // marked ' + (message.movedToTrash || autoMarkedCount || 0) + ' track(s)');
                    logStatus('Auto finished. Debug log saved to Downloads/Suno_AutoTrash_Debug.');
                }
                return;

            case 'download_complete':
                handleDownloadComplete(!!message.stopped);
                return;

            case 'download_stopped':
                logStatus('Stop signal sent.');
                return;
        }
    });

    goBtns.forEach(b => b.addEventListener('click', () => {
        hideAutoCounter();
        const n = parseInt(b.dataset.count, 10) || 1;
        startManual(n);
    }));

    if (manualStartBtn) manualStartBtn.addEventListener('click', () => {
        hideAutoCounter();
        startManual(getBatchCount());
    });

    if (batchCountInput) batchCountInput.addEventListener('change', getBatchCount);
    if (batchCountInput) batchCountInput.addEventListener('input', getBatchCount);
    if (countMinusBtn) countMinusBtn.addEventListener('click', () => {
        const next = Math.max(1, getBatchCount() - 1);
        if (batchCountInput) batchCountInput.value = String(next);
    });
    if (countPlusBtn) countPlusBtn.addEventListener('click', () => {
        const next = Math.min(10, getBatchCount() + 1);
        if (batchCountInput) batchCountInput.value = String(next);
    });

    if (autoStartBtn) autoStartBtn.addEventListener('click', startAuto);
    if (autoStopBtn) autoStopBtn.addEventListener('click', stopAuto);

    try {
        api.runtime.sendMessage({ action: 'get_auto_trash_state' }, (state) => {
            if (state?.running) setAutoRunning(true, false);
        });
    } catch (e) { /* ignore */ }
});
