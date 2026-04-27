// popup.js - Suno One-Click WAV + Highlight
// Натиснув на 1/6/16 -> fresh fetch -> N пісень -> качає WAV+lyrics+image
// Підсвічує статус кожного треку у списку (ok / fail).
// Highlight на сторінці suno.com -- автоматично через background після завершення.
// Popup НЕ закривається сам.

const api = (typeof browser !== 'undefined') ? browser : chrome;

// Конфіг (без UI, без storage).
const FOLDER = 'Suno_Songs';
const DOWNLOAD_STATE_KEY = 'sunoDownloadState';
const LAST_BATCH_KEY = 'sunoOneClickLastBatch';
// BATCH_SIZE визначається кнопкою (1 / 6 / 16).
const FORMAT = 'wav';
// Кількість сторінок feed/v3 під обраний batchSize.
// Безпечна політика: максимум 16 треків, одна сторінка, без virtual-scroll range select.
function pagesFor(batchSize) { return 1; }
const PUBLIC_ONLY = false;

// Стан popup'а в пам'яті (не зберігається).
let stage = 'idle'; // idle | fetching | downloading | done | error
let trackOrder = []; // [id, id, ...] у порядку рендеру
let trackById = {};  // id -> { title, status, error }
let currentBatch = 0; // обраний користувачем розмір батча

document.addEventListener('DOMContentLoaded', () => {
    const goBtns = document.querySelectorAll('.go-btn');
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
        console.log('[suno-1c]', text);
    }

    function setBusy(busy) { goBtns.forEach(b => b.disabled = busy); }

    function clearSummary() {
        summaryDiv.className = '';
        summaryDiv.textContent = '';
        summaryDiv.style.display = 'none';
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
            row.title = (trackById[id] && trackById[id].title ? trackById[id].title : id) + ' -- ' + error;
        }
    }

    function finalizeSummary() {
        if (trackOrder.length === 0) return;
        let ok = 0, fail = 0, pending = 0;
        for (const id of trackOrder) {
            const s = trackById[id] && trackById[id].status;
            if (s === 'ok') ok++;
            else if (s === 'fail') fail++;
            else pending++;
        }
        if (fail === 0 && pending === 0 && ok === trackOrder.length) {
            showSummary('success', 'OK // ' + ok + '/' + trackOrder.length + ' WAV ready');
        } else if (ok > 0 && fail > 0) {
            showSummary('partial', 'PARTIAL // ' + ok + ' ok, ' + fail + ' fail of ' + trackOrder.length);
        } else if (ok === 0 && fail > 0) {
            showSummary('fail', 'FAIL // 0/' + trackOrder.length + ' WAV (' + fail + ' failed)');
        } else {
            showSummary('partial', 'STOPPED // ' + ok + ' ok, ' + fail + ' fail, ' + pending + ' pending');
        }
    }

    async function clearTransientState() {
        try { await api.storage.local.remove([DOWNLOAD_STATE_KEY]); } catch (e) { /* ignore */ }
    }

    async function clearRunState() {
        try { await api.storage.local.remove([DOWNLOAD_STATE_KEY, LAST_BATCH_KEY]); } catch (e) { /* ignore */ }
    }

    async function start(batchSize) {
        currentBatch = batchSize;
        if (stage === 'fetching' || stage === 'downloading') {
            console.log('[suno-1c] start ignored, stage=', stage);
            return;
        }
        stage = 'fetching';
        setBusy(true);
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
            setBusy(false);
            logStatus('Failed to start fetch: ' + (e && e.message ? e.message : e));
            showSummary('fail', 'FAIL // cannot start fetch');
        }
    }

    function handleSongsFetched(songs) {
        const list = Array.isArray(songs) ? songs : [];
        if (list.length === 0) {
            stage = 'error';
            setBusy(false);
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
                downloadOptions: { music: true, lyrics: true, image: true }
            });
        } catch (e) {
            stage = 'error';
            setBusy(false);
            logStatus('Failed to start download: ' + (e && e.message ? e.message : e));
            showSummary('fail', 'FAIL // cannot start download');
        }
    }

    async function handleDownloadComplete(stopped) {
        stage = stopped ? 'error' : 'done';
        setBusy(false);
        finalizeSummary();
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
                stage = 'error';
                setBusy(false);
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

            case 'download_complete':
                handleDownloadComplete(!!message.stopped);
                return;

            case 'download_stopped':
                console.log('[suno-1c] download_stopped event');
                return;
        }
    });

    goBtns.forEach(b => b.addEventListener('click', () => {
        const n = parseInt(b.dataset.count, 10) || 1;
        start(n);
    }));
});


