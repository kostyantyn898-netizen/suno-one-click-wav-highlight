// background.js - Suno Simple Selection Downloader
const api = (typeof browser !== 'undefined') ? browser : chrome;

let isDownloading = false;
let stopRequested = false;
let currentJobId = 0;
let activeDownloadIds = new Set();

const FOLDER = 'Suno_Songs';
const INTER_TRACK_DELAY_MS = 0;
const NOTIFY_ICON = 'icon128.png';
const DOWNLOAD_WAIT_TIMEOUT_MS = 10 * 60 * 1000;

try {
    api.runtime.onInstalled.addListener(() => {
        if (api.sidePanel?.setPanelBehavior) api.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    });
    if (api.sidePanel?.setPanelBehavior) api.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
} catch (e) {}

function log(text) {
    try { api.runtime.sendMessage({ action: 'log', text }); } catch (e) {}
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function notifyDone(okCount, failCount, stopped = false) {
    const title = stopped ? 'Suno download stopped' : 'Suno download complete';
    const message = stopped
        ? `Stopped. Downloaded ${okCount}${failCount ? `, errors: ${failCount}` : ''}.`
        : `Downloaded ${okCount}${failCount ? `, errors: ${failCount}` : ''}.`;
    try { api.notifications.create({ type: 'basic', iconUrl: NOTIFY_ICON, title, message }); } catch (e) {}
}

async function getSunoTab() {
    try {
        const active = await api.tabs.query({ active: true, currentWindow: true });
        if (active[0]?.url?.includes('suno.com')) return active[0];
        const all = await api.tabs.query({});
        return all.find(t => t.url?.includes('suno.com')) || null;
    } catch (e) { return null; }
}

async function getClerkToken(tabId) {
    const results = await api.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: async () => {
            try {
                if (window.Clerk?.session) {
                    return await Promise.race([
                        window.Clerk.session.getToken(),
                        new Promise(r => setTimeout(() => r(null), 5000))
                    ]);
                }
            } catch (e) {}
            return null;
        }
    });
    return results?.[0]?.result || null;
}

function sanitizeFilename(name) {
    return (name || 'Untitled').replace(/[<>:"/\\|?*]/g, '').trim().substring(0, 100);
}

function buildFilename(folder, baseName, isAndroid) {
    const f = folder.replace(/[^a-zA-Z0-9_-]/g, '');
    return isAndroid ? `${f}-${baseName}` : `${f}/${baseName}`;
}

async function downloadFile(url, filename) {
    const id = await api.downloads.download({ url, filename, conflictAction: 'uniquify' });
    if (typeof id === 'number') activeDownloadIds.add(id);
    return id;
}

async function waitForDownloadDone(id, timeoutMs = DOWNLOAD_WAIT_TIMEOUT_MS) {
    if (typeof id !== 'number') return { state: 'unknown' };
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (stopRequested) return { state: 'stopped' };
        try {
            const items = await api.downloads.search({ id });
            const item = items?.[0];
            if (item && (item.state === 'complete' || item.state === 'interrupted')) {
                activeDownloadIds.delete(id);
                return { state: item.state, error: item.error };
            }
        } catch (e) {
            return { state: 'unknown', error: e?.message || String(e) };
        }
        await sleep(700);
    }
    return { state: 'timeout' };
}

async function waitForBatch(ids) {
    const clean = ids.filter(id => typeof id === 'number');
    for (const id of clean) {
        const done = await waitForDownloadDone(id);
        if (done.state === 'interrupted') log(`⚠️ Chrome download interrupted: ${done.error || id}`);
        if (done.state === 'timeout') log(`⚠️ Download wait timeout: ${id}`);
        if (done.state === 'stopped') return;
    }
}

async function downloadText(text, filename, tabId) {
    const dataUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;
    try { return await downloadFile(dataUrl, filename); } catch (err) {
        await api.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: (t, n) => {
                const blob = new Blob([t], { type: 'text/plain;charset=utf-8' });
                const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: n.replace(/\//g, '-') });
                document.body.appendChild(a);
                a.click();
                setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(a.href); }, 5000);
            },
            args: [text, filename]
        });
        return null;
    }
}

async function readSelectionFromPage(tabId) {
    const results = await api.scripting.executeScript({ target: { tabId }, files: ['read_selection.js'] });
    return results?.[0]?.result || { clips: [], count: 0 };
}

async function downloadWav(clipId, token, tabId) {
    const results = await api.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: async (id, authToken) => {
            if (window.sunoSimpleDlStop) return { stopped: true };
            const convertRes = await fetch(`https://studio-api.prod.suno.com/api/gen/${id}/convert_wav/`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' }
            });
            if (!convertRes.ok) return { error: `convert HTTP ${convertRes.status}` };

            for (let i = 0; i < 45; i++) {
                if (window.sunoSimpleDlStop) return { stopped: true };
                await new Promise(r => setTimeout(r, 1000));
                const pollRes = await fetch(`https://studio-api.prod.suno.com/api/gen/${id}/wav_file/`, { headers: { 'Authorization': `Bearer ${authToken}` } });
                if (pollRes.ok) {
                    const data = await pollRes.json();
                    const url = data.wav_file_url || data.url || data.download_url;
                    if (url) return { url };
                    if (data.status === 'complete' || data.status === 'ready') continue;
                } else if (pollRes.status === 202 || pollRes.status === 404) {
                    continue;
                } else return { error: `poll HTTP ${pollRes.status}` };
            }
            return { error: 'timeout' };
        },
        args: [clipId, token]
    });
    return results?.[0]?.result || { error: 'no result' };
}

async function fetchClipMeta(clipId, token, tabId) {
    const results = await api.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: async (id, authToken) => {
            const endpoints = [
                `https://studio-api.prod.suno.com/api/gen/${id}/`,
                `https://studio-api.prod.suno.com/api/gen/${id}`,
                `https://studio-api.prod.suno.com/api/gen/${id}/metadata/`,
                `https://studio-api.prod.suno.com/api/gen/${id}/metadata`
            ];
            for (const url of endpoints) {
                try {
                    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${authToken}` } });
                    if (res.ok) return await res.json();
                } catch (e) {}
            }
            return null;
        },
        args: [clipId, token]
    });
    return results?.[0]?.result || null;
}

async function fetchFeedClipsByIds(clipIds, token, tabId) {
    const ids = Array.from(new Set((clipIds || []).filter(Boolean)));
    if (!ids.length) return {};
    const results = await api.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: async (wantedIds, authToken) => {
            const wanted = new Set(wantedIds);
            const found = {};
            let cursor = null;
            const maxPages = 80;

            for (let page = 1; page <= maxPages && wanted.size; page++) {
                const body = {
                    limit: 20,
                    filters: {
                        disliked: 'False',
                        trashed: 'False',
                        fromStudioProject: { presence: 'False' }
                    }
                };
                if (cursor) body.cursor = cursor;

                try {
                    const response = await fetch('https://studio-api.prod.suno.com/api/feed/v3', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${authToken}`,
                            'Accept': 'application/json'
                        },
                        body: JSON.stringify(body)
                    });
                    if (!response.ok) break;
                    const data = await response.json();
                    const clips = Array.isArray(data?.clips) ? data.clips : [];
                    for (const clip of clips) {
                        if (!clip?.id || !wanted.has(clip.id)) continue;
                        found[clip.id] = {
                            id: clip.id,
                            title: clip.title || `Untitled_${clip.id}`,
                            image_url: clip.image_url || clip.image_large_url || clip.cover_image_url || clip.metadata?.image_url || null,
                            lyrics: clip.lyrics || clip.display_lyrics || clip.metadata?.lyrics || clip.metadata?.prompt || null,
                            metadata: clip.metadata || null,
                            raw: clip
                        };
                        wanted.delete(clip.id);
                    }
                    cursor = data?.next_cursor || data?.cursor || null;
                    if (!cursor || data?.has_more === false) break;
                } catch (e) {
                    break;
                }
            }
            return found;
        },
        args: [ids, token]
    });
    return results?.[0]?.result || {};
}
function extractText(value) {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            const text = extractText(item);
            if (text) return text;
        }
    }
    if (value && typeof value === 'object') {
        const nestedCandidates = [
            value.lyrics, value.display_lyrics, value.full_lyrics, value.raw_lyrics,
            value.prompt, value.text, value.content, value.value
        ];
        for (const candidate of nestedCandidates) {
            const text = extractText(candidate);
            if (text) return text;
        }
    }
    return null;
}

function extractLyrics(data) {
    if (!data || typeof data !== 'object') return null;
    const candidates = [
        data.lyrics,
        data.display_lyrics,
        data.full_lyrics,
        data.raw_lyrics,
        data.prompt,
        data.metadata?.lyrics,
        data.metadata?.display_lyrics,
        data.metadata?.full_lyrics,
        data.metadata?.raw_lyrics,
        data.metadata?.prompt,
        data.meta?.lyrics,
        data.meta?.display_lyrics,
        data.meta?.prompt,
        data.clip?.lyrics,
        data.clip?.display_lyrics,
        data.clip?.prompt,
        data.generation?.lyrics,
        data.generation?.prompt
    ];
    for (const candidate of candidates) {
        const text = extractText(candidate);
        if (text) return text;
    }
    return null;
}

function isLikelyThumbnailUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const u = url.toLowerCase();
    return /\b(thumbnail|thumb|small|avatar)\b/.test(u) || /[?&](w|h|width|height)=\d{1,3}\b/.test(u);
}

function scoreImageUrl(url) {
    if (!url || typeof url !== 'string') return -1;
    let score = 0;
    const u = url.toLowerCase();
    if (/\b(large|full|orig|original|hd|uhd|4k|2048|1536|1024)\b/.test(u)) score += 6;
    if (/\b(image_large|cover_image)\b/.test(u)) score += 4;
    if (isLikelyThumbnailUrl(url)) score -= 8;
    return score;
}

function extractImageUrl(data) {
    if (!data || typeof data !== 'object') return null;
    const candidates = [
        data.image_large_url,
        data.cover_image_url,
        data.image_url,
        data.cover_url,
        data.image,
        data.thumbnail_url,
        data.artwork_url,
        data.image_hd_url,
        data.image_4k_url,
        data.image_original_url,
        data.metadata?.image_url,
        data.metadata?.image_large_url,
        data.metadata?.image,
        data.metadata?.cover_url,
        data.metadata?.cover_image_url,
        data.meta?.image_url,
        data.meta?.image_large_url,
        data.meta?.image,
        data.meta?.cover_url,
        data.meta?.cover_image_url,
        data.clip?.image_url,
        data.clip?.image_large_url,
        data.clip?.image,
        data.clip?.cover_url,
        data.clip?.cover_image_url,
        data.generation?.image_url,
        data.generation?.image_large_url,
        data.generation?.image,
        data.generation?.cover_url,
        data.generation?.cover_image_url
    ];
    let bestUrl = null;
    let bestScore = -999;
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && /^https?:\/\//i.test(candidate.trim())) {
            const url = candidate.trim();
            const score = scoreImageUrl(url);
            if (score > bestScore) {
                bestScore = score;
                bestUrl = url;
            }
        }
    }
    return bestUrl;
}
function imageExt(url) {
    try {
        const ext = new URL(url).pathname.split('.').pop()?.toLowerCase();
        if (ext && /^[a-z0-9]{2,5}$/.test(ext)) return ext;
    } catch (e) {}
    return 'jpg';
}

async function downloadSelected(options = {}) {
    if (isDownloading) { log('⚠️ Already downloading. Wait or press STOP.'); return; }
    const tab = await getSunoTab();
    if (!tab?.id) { log('❌ Open suno.com in the browser.'); try { api.runtime.sendMessage({ action: 'download_complete', okCount: 0, failCount: 1 }); } catch (e) {} return; }

    const frozenClips = Array.isArray(options.clips) ? options.clips.filter(c => c?.id) : [];
    const selection = frozenClips.length ? { clips: frozenClips, count: frozenClips.length } : await readSelectionFromPage(tab.id);

    if (!selection.count) {
        log('⚠️ No selected tracks found.');
        try { api.runtime.sendMessage({ action: 'selection_empty' }); api.runtime.sendMessage({ action: 'download_complete', okCount: 0, failCount: 1 }); } catch (e) {}
        return;
    }

    log(`✅ Starting queue: ${selection.count} tracks.`);
    try { api.runtime.sendMessage({ action: 'selection_found', clips: selection.clips }); } catch (e) {}

    const token = await getClerkToken(tab.id);
    if (!token) { log('❌ Could not get auth token. Make sure you are logged in to Suno.'); try { api.runtime.sendMessage({ action: 'download_complete', okCount: 0, failCount: 1 }); } catch (e) {} return; }

    if (options.lyrics !== false || options.image !== false) {
        try {
            const feedMap = await fetchFeedClipsByIds(selection.clips.map(c => c.id), token, tab.id);
            let enriched = 0;
            selection.clips = selection.clips.map(clip => {
                const full = feedMap[clip.id];
                if (!full) return clip;
                enriched++;
                return { ...clip, ...full, title: clip.title || full.title };
            });
            if (enriched) log('✅ Feed metadata found for ' + enriched + ' tracks.');
            else log('ℹ️ Feed metadata was not enough; trying direct metadata API.');
        } catch (e) {
            log('ℹ️ Feed metadata fallback failed; trying direct metadata API.');
        }
    }

    let isAndroid = false;
    try { isAndroid = (await api.runtime.getPlatformInfo())?.os === 'android'; } catch (e) {}
    try { await api.scripting.executeScript({ target: { tabId: tab.id }, func: () => { window.sunoSimpleDlStop = false; } }); } catch (e) {}

    isDownloading = true;
    stopRequested = false;
    currentJobId++;
    activeDownloadIds = new Set();
    const jobId = currentJobId;
    const dlMusic = options.music !== false;
    const dlLyrics = options.lyrics !== false;
    const dlImage = options.image !== false;
    const folder = options.folder || FOLDER;
    let okCount = 0, failCount = 0;

    const batchSize = Math.max(1, Math.min(5, parseInt(options.batchSize, 10) || 1));
    log('⚙️ Mode: up to ' + batchSize + ' tracks in parallel.');

    async function processClip(clip, index) {
        if (stopRequested || jobId !== currentJobId) return { stopped: true, ok: false, fail: false };
        const title = clip.title || `Untitled_${clip.id}`;
        const short = clip.id.slice(-4);
        log(`⬇️ ${index + 1}/${selection.count}: ${title}`);
        try {
            let wavOk = false;
            if (dlMusic) {
                const wavResult = await downloadWav(clip.id, token, tab.id);
                if (wavResult.stopped) return { stopped: true, ok: false, fail: false };
                if (!wavResult.url) throw new Error(`WAV: ${wavResult.error || 'no url'}`);
                const wavName = buildFilename(folder, `${sanitizeFilename(title)}_${short}.wav`, isAndroid);
                const wavId = await downloadFile(wavResult.url, wavName);
                await waitForBatch([wavId]);
                wavOk = true;
            }

            let meta = null;
            if (dlLyrics || dlImage) {
                meta = clip.lyrics || clip.image_url || clip.metadata ? clip : await fetchClipMeta(clip.id, token, tab.id);
                if (!meta) log('⚠️ Metadata not found: ' + title);
            }

            if (dlLyrics && meta) {
                const lyrics = extractLyrics(meta);
                if (lyrics) {
                    const txtName = buildFilename(folder, `${sanitizeFilename(title)}_${short}.txt`, isAndroid);
                    const txtId = await downloadText(`${title}

${lyrics}
`, txtName, tab.id);
                    await waitForBatch([txtId]);
                } else {
                    log('ℹ️ Lyrics not found: ' + title);
                }
            }

            if (dlImage && meta) {
                const imgUrl = extractImageUrl(meta);
                if (imgUrl) {
                    const ext = imageExt(imgUrl);
                    const imgName = buildFilename(folder, `${sanitizeFilename(title)}_${short}_cover.${ext}`, isAndroid);
                    const imgId = await downloadFile(imgUrl, imgName);
                    await waitForBatch([imgId]);
                } else {
                    log('ℹ️ Cover not found: ' + title);
                }
            }

            if (stopRequested || jobId !== currentJobId) return { stopped: true, ok: false, fail: false };
            if (wavOk || !dlMusic) {
                try { api.runtime.sendMessage({ action: 'track_progress', id: clip.id, status: 'ok' }); } catch (e) {}
                return { stopped: false, ok: true, fail: false };
            }
            return { stopped: false, ok: false, fail: false };
        } catch (e) {
            const err = e?.message || String(e);
            log(`⚠️ Error: ${title} (${err})`);
            try { api.runtime.sendMessage({ action: 'track_progress', id: clip.id, status: 'fail', error: err }); } catch (e2) {}
            return { stopped: false, ok: false, fail: true };
        }
    }

    for (let index = 0; index < selection.clips.length; index += batchSize) {
        if (stopRequested || jobId !== currentJobId) { log('⏹️ Stopped.'); break; }
        const chunk = selection.clips.slice(index, index + batchSize);
        const results = await Promise.all(chunk.map((clip, offset) => processClip(clip, index + offset)));
        for (const result of results) {
            if (result?.ok) okCount++;
            if (result?.fail) failCount++;
        }
        if (results.some(r => r?.stopped) || stopRequested || jobId !== currentJobId) break;
        if (INTER_TRACK_DELAY_MS > 0) await sleep(INTER_TRACK_DELAY_MS);
    }
    const stopped = stopRequested || jobId !== currentJobId;
    isDownloading = false;
    stopRequested = false;
    activeDownloadIds = new Set();
    log(stopped ? `⏹️ Stopped. Downloaded: ${okCount}${failCount ? ', errors: ' + failCount : ''}.` : `🎉 Done. Downloaded: ${okCount}${failCount ? ', errors: ' + failCount : ''}.`);
    notifyDone(okCount, failCount, stopped);
    try { api.runtime.sendMessage({ action: 'download_complete', okCount, failCount, stopped }); } catch (e) {}
}

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'read_selection') {
        (async () => {
            const tab = await getSunoTab();
            if (!tab?.id) { sendResponse({ count: 0, clips: [], error: 'no suno tab' }); return; }
            sendResponse(await readSelectionFromPage(tab.id));
        })();
        return true;
    }
    if (msg.action === 'download_selected') { downloadSelected(msg.options || {}); sendResponse({ ok: true }); return true; }
    if (msg.action === 'stop_download') {
        stopRequested = true;
        isDownloading = false;
        getSunoTab().then(tab => { if (tab?.id) api.scripting.executeScript({ target: { tabId: tab.id }, func: () => { window.sunoSimpleDlStop = true; } }); });
        for (const id of activeDownloadIds) { try { api.downloads.cancel(id); } catch (e) {} }
        sendResponse({ ok: true });
        return true;
    }
    if (msg.action === 'refresh_suno') {
        (async () => {
            const tab = await getSunoTab();
            if (!tab?.id) { sendResponse({ ok: false, error: 'no suno tab' }); return; }
            try { await api.tabs.reload(tab.id); sendResponse({ ok: true }); }
            catch (e) { sendResponse({ ok: false, error: e?.message || String(e) }); }
        })();
        return true;
    }
    if (msg.action === 'get_state') { sendResponse({ isDownloading, stopRequested, jobId: currentJobId }); return true; }
});










