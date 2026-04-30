// background.js
const api = (typeof browser !== 'undefined') ? browser : chrome;

let stopFetchRequested = false;
let isFetching = false;

let stopDownloadRequested = false;
let isDownloading = false;
let currentDownloadJobId = 0;
let activeDownloadIds = new Set();
let autoTrashStopRequested = false;
let isAutoTrashRunning = false;
let autoTrashDebugLog = [];

const DOWNLOAD_STATE_KEY = 'sunoDownloadState';
const LAST_BATCH_KEY = 'sunoOneClickLastBatch';

async function clearDownloadState() {
    try { await api.storage.local.remove([DOWNLOAD_STATE_KEY]); } catch (e) { /* ignore */ }
}

async function finishDownloadState(extra = {}) {
    stopDownloadRequested = false;
    isDownloading = false;
    activeDownloadIds = new Set();
    await persistDownloadState(extra);
    broadcastDownloadState();
}

function failFetch(error) {
    isFetching = false;
    api.runtime.sendMessage({ action: "fetch_error", error });
}

async function failDownload(error, stopped = false) {
    if (error) logToPopup(error);
    await finishDownloadState({ finishedAt: Date.now(), error: error || null });
    api.runtime.sendMessage({ action: "download_complete", stopped });
}

async function getSunoTab() {
    // Popups/options can be the active tab in some browsers. Try active tab first, then fallback.
    try {
        const activeTabs = await api.tabs.query({ active: true, currentWindow: true });
        const active = activeTabs?.[0];
        if (active?.url && active.url.includes('suno.com')) return active;

        const windowTabs = await api.tabs.query({ currentWindow: true });
        const sunoInWindow = windowTabs.find(t => t.url && t.url.includes('suno.com'));
        if (sunoInWindow) return sunoInWindow;

        const allTabs = await api.tabs.query({});
        return allTabs.find(t => t.url && t.url.includes('suno.com')) || null;
    } catch (e) {
        return null;
    }
}

async function persistDownloadState(extra = {}) {
    try {
        await api.storage.local.set({
            [DOWNLOAD_STATE_KEY]: {
                isDownloading,
                stopRequested: stopDownloadRequested,
                jobId: currentDownloadJobId,
                activeDownloadIds: Array.from(activeDownloadIds),
                ...extra
            }
        });
    } catch (e) {
        // ignore
    }
}

async function readPersistedDownloadState() {
    try {
        const result = await api.storage.local.get(DOWNLOAD_STATE_KEY);
        return result?.[DOWNLOAD_STATE_KEY] || null;
    } catch (e) {
        return null;
    }
}

function broadcastDownloadState() {
    try {
        api.runtime.sendMessage({
            action: 'download_state',
            isDownloading,
            stopRequested: stopDownloadRequested,
            jobId: currentDownloadJobId
        });
    } catch (e) {
        // ignore
    }
}

async function highlightSongsOnSuno(batchSongs, highlightOptions = {}) {
    const tab = await getSunoTab();
    if (!tab?.id) return { ok: false, highlighted: 0, error: "No Suno tab found" };

    const songs = Array.isArray(batchSongs) ? batchSongs : [];
    const results = await api.scripting.executeScript({
        target: { tabId: tab.id },
        func: async (inputSongs, inputOptions) => {
            const STYLE_ID = 'suno-oneclick-highlight-style';
            const HIGHLIGHT_CLASS = 'suno-oneclick-downloaded';
            const BADGE_CLASS = 'suno-oneclick-badge';
            const DATA_ATTR = 'data-suno-oneclick-downloaded';

            const options = inputOptions || {};
            const preserveOld = !!options.preserveOld;
            const badgeText = String(options.badgeText || 'DOWNLOADED');
            const songs = (inputSongs || []).filter(s => s && (s.id || s.title)).map(s => ({
                id: String(s.id || ''),
                short8: String(s.id || '').slice(-8),
                short4: String(s.id || '').slice(-4),
                title: String(s.title || '').trim()
            }));

            function norm(text) {
                return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
            }

            function cssEscape(value) {
                try { return CSS.escape(value); }
                catch (e) { return String(value).replace(/"/g, '\\"'); }
            }

            function clearOld() {
                document.querySelectorAll('.' + HIGHLIGHT_CLASS).forEach(el => {
                    el.classList.remove(HIGHLIGHT_CLASS);
                    try { el.removeAttribute(DATA_ATTR); } catch (e) {}
                });
                document.querySelectorAll('.' + BADGE_CLASS).forEach(el => el.remove());
                const oldToast = document.getElementById('suno-oneclick-toast');
                if (oldToast) oldToast.remove();
            }

            function ensureStyle() {
                let style = document.getElementById(STYLE_ID);
                if (style) return;
                style = document.createElement('style');
                style.id = STYLE_ID;
                style.textContent = `
.${HIGHLIGHT_CLASS} {
  outline: 3px solid #ff2bd6 !important;
  box-shadow:
    0 0 0 2px rgba(0,245,255,.88),
    0 0 34px rgba(255,43,214,.95),
    0 0 54px rgba(0,245,255,.40),
    inset 0 0 24px rgba(255,43,214,.18) !important;
  border-radius: 14px !important;
  position: relative !important;
  z-index: 20 !important;
  isolation: isolate !important;
}
.${HIGHLIGHT_CLASS}::before {
  content: '' !important;
  position: absolute !important;
  inset: -3px !important;
  border-radius: 16px !important;
  pointer-events: none !important;
  background: linear-gradient(135deg, rgba(0,245,255,.16), rgba(255,43,214,.16)) !important;
  z-index: -1 !important;
}
.${BADGE_CLASS} {
  position: absolute !important;
  top: 8px !important;
  right: 8px !important;
  z-index: 2147483646 !important;
  padding: 5px 9px !important;
  border-radius: 999px !important;
  background: linear-gradient(135deg, #00f5ff, #2dff9f 48%, #ff2bd6) !important;
  color: #03050a !important;
  font: 900 11px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace !important;
  letter-spacing: .7px !important;
  text-transform: uppercase !important;
  box-shadow: 0 0 18px rgba(0,245,255,.55), 0 0 26px rgba(255,43,214,.48) !important;
  pointer-events: none !important;
}
#suno-oneclick-toast {
  position: fixed !important;
  right: 18px !important;
  bottom: 18px !important;
  z-index: 2147483647 !important;
  max-width: 390px !important;
  padding: 13px 15px !important;
  border: 1px solid rgba(0,245,255,.70) !important;
  border-radius: 14px !important;
  background: rgba(3,5,10,.96) !important;
  color: #e8fbff !important;
  font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace !important;
  box-shadow: 0 0 34px rgba(0,245,255,.26), 0 0 34px rgba(255,43,214,.20) !important;
}
`;
                document.documentElement.appendChild(style);
            }

            function looksLikeCard(el) {
                if (!el || el === document.body || el === document.documentElement) return false;
                const r = el.getBoundingClientRect?.();
                if (!r || r.width < 180 || r.height < 55) return false;
                if (r.width > Math.max(window.innerWidth + 120, 1200) || r.height > 520) return false;
                const interactive = el.querySelectorAll?.('button,a,img,svg,[role="button"]').length || 0;
                return interactive >= 1;
            }

            function findCard(el) {
                let best = null;
                let cur = el;
                for (let i = 0; cur && i < 14; i++, cur = cur.parentElement) {
                    if (cur.matches?.('article, [role="listitem"], [data-testid*="clip" i], [data-testid*="song" i], [data-testid*="card" i]')) return cur;
                    if (looksLikeCard(cur)) best = cur;
                }
                return best || el;
            }

            function addBadge(card) {
                if (!card) return;
                const existing = card.querySelector?.('.' + BADGE_CLASS);
                if (existing) { existing.textContent = badgeText; return; }
                if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
                const badge = document.createElement('div');
                badge.className = BADGE_CLASS;
                badge.textContent = badgeText;
                card.appendChild(badge);
            }

            function markCard(card, song) {
                if (!card || card.classList.contains(HIGHLIGHT_CLASS)) return false;
                card.classList.add(HIGHLIGHT_CLASS);
                try { card.setAttribute(DATA_ATTR, song.id || song.title || '1'); } catch (e) {}
                addBadge(card);
                return true;
            }

            function findById(song) {
                const tokens = [song.id, song.short8, song.short4].filter(v => v && v.length >= 4);
                const found = [];
                for (const token of tokens) {
                    const esc = cssEscape(token);
                    const selectors = [
                        `a[href*="${esc}"]`,
                        `[href*="${esc}"]`,
                        `[data-id*="${esc}"]`,
                        `[data-clip-id*="${esc}"]`,
                        `[data-song-id*="${esc}"]`,
                        `[data-testid*="${esc}"]`
                    ].join(',');
                    try { document.querySelectorAll(selectors).forEach(el => found.push(findCard(el))); } catch (e) {}
                }
                return found.filter(Boolean);
            }

            function findByTitle(song) {
                const title = norm(song.title);
                if (!title || title.length < 3) return [];
                const found = [];
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
                    acceptNode(node) {
                        const text = norm(node.nodeValue);
                        if (!text || text.length > 400) return NodeFilter.FILTER_REJECT;
                        return text.includes(title) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
                    }
                });
                let node;
                let scanned = 0;
                while ((node = walker.nextNode()) && scanned < 80) {
                    scanned++;
                    const parent = node.parentElement;
                    if (!parent) continue;
                    const card = findCard(parent);
                    if (card) found.push(card);
                }
                return found;
            }

            if (!preserveOld) clearOld();
            ensureStyle();

            const highlighted = [];
            let usedVirtualScroll = false;
            const used = new Set();
            const remaining = new Set(songs.map((_, i) => i));

            function tryRound() {
                for (const idx of Array.from(remaining)) {
                    const song = songs[idx];
                    let candidates = findById(song);
                    if (!candidates.length) candidates = findByTitle(song);
                    for (const card of candidates) {
                        if (!card || used.has(card)) continue;
                        if (markCard(card, song)) {
                            highlighted.push(card);
                            used.add(card);
                            remaining.delete(idx);
                            break;
                        }
                    }
                }
            }

            function findScrollContainer() {
                const main = document.querySelector('main');
                if (main && main.scrollHeight > main.clientHeight + 10) return main;
                const cands = document.querySelectorAll('div, section, main, article');
                for (const el of cands) {
                    if (!el.scrollHeight || el.scrollHeight <= el.clientHeight + 10) continue;
                    let cs;
                    try { cs = getComputedStyle(el); } catch (e) { continue; }
                    if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') return el;
                }
                return document.scrollingElement || document.documentElement;
            }

            function getDomOrderedCards(cards) {
                return Array.from(new Set(cards.filter(Boolean))).sort((a, b) => {
                    if (a === b) return 0;
                    const pos = a.compareDocumentPosition(b);
                    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
                    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
                    return 0;
                });
            }

            function clickLikeUser(el, shiftKey) {
                if (!el) return false;
                try { el.scrollIntoView({ behavior: 'auto', block: 'center' }); } catch (e) {}
                const rect = el.getBoundingClientRect?.();
                if (!rect || rect.width < 1 || rect.height < 1) return false;

                // HAR/RUM data shows manual Shift-click is reported as a click on the track title/card,
                // not as a checkbox API action. Click near the readable row body so React sees the same target.
                const x = Math.max(1, Math.min(window.innerWidth - 2, rect.left + Math.min(Math.max(120, rect.width * 0.45), rect.width - 16)));
                const y = Math.max(1, Math.min(window.innerHeight - 2, rect.top + rect.height / 2));
                const target = document.elementFromPoint(x, y) || el;
                const eventInit = {
                    bubbles: true,
                    cancelable: true,
                    composed: true,
                    view: window,
                    button: 0,
                    buttons: 1,
                    clientX: x,
                    clientY: y,
                    shiftKey: !!shiftKey
                };

                for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
                    const EventCtor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
                    target.dispatchEvent(new EventCtor(type, eventInit));
                }
                return true;
            }

            async function tryShiftSelectRange(cards) {
                const ordered = getDomOrderedCards(cards);
                if (!ordered.length) return { attempted: false, selected: 0, error: 'no_cards' };

                const first = ordered[0];
                const last = ordered[ordered.length - 1];
                try {
                    const firstClicked = clickLikeUser(first, true);
                    await new Promise(r => setTimeout(r, 160));
                    const lastClicked = first === last ? firstClicked : clickLikeUser(last, true);
                    await new Promise(r => setTimeout(r, 160));
                    return {
                        attempted: true,
                        selected: firstClicked && lastClicked ? ordered.length : 0,
                        firstClicked,
                        lastClicked
                    };
                } catch (e) {
                    return { attempted: true, selected: 0, error: e?.message || String(e) };
                }
            }

            // First pass: rows currently visible.
            tryRound();

            // If some rows are still missing, scroll the list container and retry.
            if (remaining.size > 0) {
                usedVirtualScroll = true;
                const scrollEl = findScrollContainer();
                let lastTop = -1;
                for (let attempt = 0; attempt < 14 && remaining.size > 0; attempt++) {
                    const before = scrollEl.scrollTop;
                    const step = Math.max(240, scrollEl.clientHeight * 0.8);
                    try { scrollEl.scrollTo({ top: before + step, behavior: 'auto' }); }
                    catch (e) { scrollEl.scrollTop = before + step; }
                    await new Promise(r => setTimeout(r, 420));
                    // Stop if the list cannot scroll further.
                    if (Math.abs(scrollEl.scrollTop - before) < 2 && scrollEl.scrollTop === lastTop) break;
                    lastTop = scrollEl.scrollTop;
                    tryRound();
                }
                // Finish by scrolling slightly upward so the user can see the list context.
                try { scrollEl.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {}
            }

            const canShiftSelect = songs.length <= 16 && !usedVirtualScroll;
            const selection = canShiftSelect
                ? await tryShiftSelectRange(highlighted)
                : { attempted: false, selected: 0, error: usedVirtualScroll ? 'virtual_scroll_skip' : 'batch_too_large' };

            const toast = document.createElement('div');
            toast.id = 'suno-oneclick-toast';
            const titles = songs.map(s => '• ' + (s.title || s.id || 'untitled')).join('<br>');
            toast.innerHTML = highlighted.length
                ? '<b>Suno One-Click:</b> marked ' + highlighted.length + ' downloaded card(s) for trash.'
                    + (selection.selected ? '<br><b>Experiment:</b> shift-clicked ' + selection.selected + ' card(s).' : (!canShiftSelect && usedVirtualScroll ? '<br><b>Experiment:</b> skipped shift-select after virtual scroll.' : (!canShiftSelect ? '<br><b>Experiment:</b> skipped shift-select for large batch.' : '<br><b>Experiment:</b> shift-select fallback only.')))
                    + '<br><br>' + titles
                : '<b>Suno One-Click:</b> last batch saved, but visible cards were not found.<br>Open the Suno list that contains them.<br><br>' + titles;
            document.body.appendChild(toast);
            setTimeout(() => { try { toast.remove(); } catch (e) {} }, 16000);

            if (highlighted[0]) highlighted[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
            return { highlighted: highlighted.length, selected: selection.selected || 0, selection };
        },
        args: [songs, highlightOptions]
    });

    const result = results?.[0]?.result || {};
    return { ok: true, highlighted: result.highlighted || 0, selected: result.selected || 0, selection: result.selection || null };
}


// Keep active download IDs in sync (best-effort)
try {
    api.downloads?.onChanged?.addListener((delta) => {
        if (!delta || typeof delta.id !== 'number') return;
        const state = delta.state?.current;
        if (state === 'complete' || state === 'interrupted') {
            if (activeDownloadIds.delete(delta.id)) {
                persistDownloadState();
            }
        }
    });
} catch (e) {
    // ignore
}


function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getSunoAuthToken() {
    appendAutoTrashDebug('auth: locating Suno tab');
    const tab = await getSunoTab();
    if (!tab?.id || !tab.url || !tab.url.includes("suno.com")) {
        throw new Error("Please open Suno.com first.");
    }

    appendAutoTrashDebug('auth: requesting Clerk token');
    const tokenResults = await api.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: async () => {
            try {
                if (window.Clerk && window.Clerk.session) {
                    return await Promise.race([
                        window.Clerk.session.getToken(),
                        new Promise(resolve => setTimeout(() => resolve(null), 5000))
                    ]);
                }
                return null;
            } catch (e) {
                return null;
            }
        }
    });

    const token = tokenResults?.[0]?.result || null;
    appendAutoTrashDebug(token ? 'auth: token ok' : 'auth: token missing');
    if (!token) throw new Error("Could not get Suno auth token.");
    return { token, tabId: tab.id };
}

async function fetchLatestSongForAutoTrash(excludeIds = new Set()) {
    appendAutoTrashDebug('feed: start');
    const auth = await getSunoAuthToken();
    appendAutoTrashDebug('feed: resolving user id');
    const userId = await fetchCurrentUserId(auth.token);
    appendAutoTrashDebug(userId ? 'feed: user id ok' : 'feed: user id missing, continuing');

    let cursor = null;
    const maxPages = 12;

    for (let page = 1; page <= maxPages; page++) {
        const body = {
            limit: 20,
            filters: {
                disliked: "False",
                trashed: "False",
                fromStudioProject: { presence: "False" }
            }
        };

        if (userId) {
            body.filters.user = { presence: "True", userId };
        }
        if (cursor) {
            body.cursor = cursor;
        }

        appendAutoTrashDebug('feed: request /api/feed/v3 page ' + page + (cursor ? ' with cursor' : ''));
        const response = await fetch('https://studio-api.prod.suno.com/api/feed/v3', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${auth.token}`
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new Error(`Feed HTTP ${response.status}`);
        }

        const data = await response.json();
        const clips = Array.isArray(data?.clips) ? data.clips : [];
        appendAutoTrashDebug('feed: page ' + page + ' got ' + clips.length + ' clips, excluding ' + excludeIds.size + ' already processed');

        const clip = clips.find(c => c?.id && !c?.is_trashed && !c?.trashed && !excludeIds.has(c.id));
        appendAutoTrashDebug(clip?.id ? ('feed: selected ' + clip.id + ' from page ' + page) : ('feed: no selectable clip on page ' + page));
        if (clip) {
            return {
                id: clip.id,
                title: clip.title || `Untitled_${clip.id}`,
                audio_url: clip.audio_url || null,
                image_url: clip.image_url || clip.image_large_url || clip.cover_image_url || null,
                lyrics: clip.lyrics || clip.display_lyrics || clip.metadata?.lyrics || clip.metadata?.prompt || null
            };
        }

        cursor = data?.next_cursor || data?.cursor || null;
        if (!cursor || data?.has_more === false) {
            appendAutoTrashDebug('feed: no more pages');
            break;
        }
    }

    appendAutoTrashDebug('feed: no selectable clip after paging');
    return null;
}
async function trashSongsOnSuno(songIds) {
    const ids = (Array.isArray(songIds) ? songIds : [])
        .filter(id => typeof id === 'string' && id.length > 0);
    if (!ids.length) return { ok: false, status: 0, error: "No clip ids" };

    const auth = await getSunoAuthToken();
    appendAutoTrashDebug('trash: request inside Suno tab for ' + ids.join(','));

    const results = await api.scripting.executeScript({
        target: { tabId: auth.tabId },
        world: "MAIN",
        func: async (clipIds, authToken) => {
            const endpoints = [
                'https://studio-api-prod.suno.com/api/gen/trash',
                'https://studio-api.prod.suno.com/api/gen/trash'
            ];

            let last = null;
            for (const url of endpoints) {
                try {
                    const response = await fetch(url, {
                        method: 'POST',
                        credentials: 'include',
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json',
                            'Authorization': `Bearer ${authToken}`
                        },
                        body: JSON.stringify({ trash: true, clip_ids: clipIds })
                    });

                    let data = null;
                    try { data = await response.json(); } catch (e) {}
                    last = { ok: response.ok, status: response.status, data };
                    if (response.ok && data?.is_trashed === true) return last;
                } catch (e) {
                    last = { ok: false, status: 0, error: e?.message || String(e) };
                }
            }
            return last || { ok: false, status: 0, error: 'Trash request failed' };
        },
        args: [ids, auth.token]
    });

    const result = results?.[0]?.result || { ok: false, status: 0, error: 'No trash result' };
    appendAutoTrashDebug('trash: response ' + JSON.stringify(result));
    return {
        ok: !!(result.ok && result.data?.is_trashed === true),
        status: result.status || 0,
        data: result.data || null,
        error: result.error || (result.ok ? 'Trash response did not confirm is_trashed=true' : 'Trash request failed')
    };
}

function appendAutoTrashDebug(text) {
    const stamp = new Date().toISOString();
    autoTrashDebugLog.push(`[${stamp}] ${text}`);
    if (autoTrashDebugLog.length > 1000) {
        autoTrashDebugLog = autoTrashDebugLog.slice(-1000);
    }
}

async function saveAutoTrashDebugLog(reason = 'finished') {
    if (!autoTrashDebugLog.length) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const body = [
        'Suno WAV Auto Trash Local debug log',
        `Reason: ${reason}`,
        `Saved: ${new Date().toISOString()}`,
        '',
        ...autoTrashDebugLog
    ].join('\n');

    try {
        await api.downloads.download({
            url: 'data:text/plain;charset=utf-8,' + encodeURIComponent(body),
            filename: `Suno_AutoTrash_Debug/suno-auto-trash-${stamp}.txt`,
            conflictAction: 'uniquify',
            saveAs: false
        });
    } catch (e) {
        try { api.runtime.sendMessage({ action: 'log', text: `Debug log save failed: ${e?.message || e}` }); } catch (ignored) {}
    }
}
async function runAutoTrashLoop(options = {}) {
    if (isAutoTrashRunning) {
        logToPopup("⚠️ Auto marker already running.");
        return;
    }
    if (isDownloading) {
        logToPopup("⚠️ Download already running. Stop it first.");
        return;
    }

    isAutoTrashRunning = true;
    autoTrashStopRequested = false;
    autoTrashDebugLog = [];
    appendAutoTrashDebug('auto: run loop entered');
    let movedToTrash = 0; // kept as internal counter for marked tracks
    const processedIds = new Set();
    const folderName = options.folderName || 'Suno_Songs';
    const downloadOptions = normalizeDownloadOptions(options.downloadOptions);
    const autoBatchSize = Math.max(1, Math.min(10, parseInt(options.batchSize, 10) || 5));

    try { api.runtime.sendMessage({ action: "auto_trash_state", running: true }); } catch (e) {}
    try { api.runtime.sendMessage({ action: "auto_marker_count", marked: 0 }); } catch (e) {}
    logToPopup("▶️ Custom AUTO marker started: download up to " + autoBatchSize + " track(s), then mark them.");
    logToPopup("⚠️ Do not scroll the Suno page while AUTO runs.");

    while (!autoTrashStopRequested) {
        const batch = [];
        for (let i = 0; i < autoBatchSize && !autoTrashStopRequested; i++) {
            let song = null;
            try {
                song = await fetchLatestSongForAutoTrash(processedIds);
            } catch (e) {
                logToPopup(`❌ Auto marker feed error: ${e?.message || e}`);
                break;
            }

            if (!song?.id) break;
            processedIds.add(song.id);
            batch.push(song);
        }

        if (!batch.length) {
            logToPopup("✅ No more visible tracks in feed.");
            break;
        }

        logToPopup(`🎯 Custom AUTO next (${batch.length}/${autoBatchSize}): ${batch.map(s => s.title || s.id).join(' + ')}`);
        stopDownloadRequested = false;
        isDownloading = true;
        currentDownloadJobId += 1;
        activeDownloadIds = new Set();
        await persistDownloadState({ startedAt: Date.now(), autoTrash: true, customBatchSize: autoBatchSize });
        broadcastDownloadState();

        try {
            api.runtime.sendMessage({
                action: "track_init",
                tracks: batch.map(s => ({ id: s.id, title: s.title || `Untitled_${s.id}` }))
            });
        } catch (e) {}

        let result = null;
        try {
            result = await downloadSelectedSongs(
                folderName,
                batch,
                'wav',
                currentDownloadJobId,
                downloadOptions,
                { skipHighlight: true }
            );
        } catch (e) {
            logToPopup(`⚠️ Custom AUTO download error: ${e?.message || e}`);
        }

        const successfulBatch = Array.isArray(result?.successfulSongs)
            ? result.successfulSongs.filter(s => s?.id)
            : [];

        const stopAfterMark = autoTrashStopRequested || result?.stopped;

        if (!successfulBatch.length) {
            logToPopup(stopAfterMark
                ? '⏹️ Custom AUTO stopped; no completed WAV to mark in this cycle.'
                : '⚠️ Custom AUTO: no WAV was confirmed in this cycle.');
            if (stopAfterMark) break;
            await delay(1500);
            continue;
        }

        if (stopAfterMark) {
            logToPopup(`⏹️ Custom AUTO stopped; marking ${successfulBatch.length} completed track(s) before exit.`);
        }

        let markedForManualDelete = false;
        try {
            const highlightResult = await highlightSongsOnSuno(successfulBatch, { preserveOld: true, badgeText: 'READY' });
            if (highlightResult?.selected) {
                markedForManualDelete = true;
                logToPopup(`✅ Custom AUTO selected ${highlightResult.selected} card(s). Ready for manual delete.`);
            } else if (highlightResult?.highlighted) {
                markedForManualDelete = true;
                logToPopup(`✨ Custom AUTO highlighted ${highlightResult.highlighted} card(s). Ready for manual delete.`);
            } else {
                logToPopup('⚠️ Custom AUTO downloaded tracks, but could not find their visible cards.');
            }
        } catch (e) {
            logToPopup(`⚠️ Custom AUTO highlight/select failed: ${e?.message || e}`);
        }

        if (markedForManualDelete) {
            movedToTrash += successfulBatch.length;
            try { api.runtime.sendMessage({ action: "auto_marker_count", marked: movedToTrash, title: successfulBatch.map(s => s.title || s.id).join(' + ') }); } catch (e) {}
        }
        if (stopAfterMark) break;
    }

    const stoppedByUser = autoTrashStopRequested;
    isAutoTrashRunning = false;
    autoTrashStopRequested = false;
    stopDownloadRequested = false;
    await saveAutoTrashDebugLog(stoppedByUser ? 'stopped' : 'finished');
    try { api.runtime.sendMessage({ action: "auto_trash_state", running: false, movedToTrash }); } catch (e) {}
    logToPopup(`⏹️ Auto marker finished. Marked ${movedToTrash} track(s) for manual delete.`);
}

function requestAutoTrashStop() {
    appendAutoTrashDebug('auto: stop requested');
    autoTrashStopRequested = true;
    stopDownloadRequested = true;
    persistDownloadState({ stoppedAt: Date.now(), autoTrash: true });
    broadcastDownloadState();

    getSunoTab().then(tab => {
        if (tab?.id) {
            api.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    window.sunoStopDownload = true;
                    window.sunoStopFetch = true;
                }
            });
        }
    });

    try { api.runtime.sendMessage({ action: "auto_trash_state", running: false, stopping: true }); } catch (e) {}
    try { api.runtime.sendMessage({ action: "download_stopped" }); } catch (e) {}
}
api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "auto_trash_start") {
        runAutoTrashLoop({
            folderName: message.folderName || 'Suno_Songs',
            downloadOptions: message.downloadOptions || { music: true, lyrics: true, image: true },
            batchSize: message.batchSize || 5
        });
        sendResponse({ ok: true, running: true });
        return true;
    }

    if (message.action === "auto_trash_stop") {
        requestAutoTrashStop();
        sendResponse({ ok: true, stopping: true });
        return true;
    }

    if (message.action === "get_auto_trash_state") {
        sendResponse({ running: isAutoTrashRunning, stopping: autoTrashStopRequested });
        return true;
    }

    if (message.action === "fetch_feed_page") {
        (async () => {
            try {
                const token = message.token;
                const cursorValue = message.cursor || null;
                const isPublicOnly = !!message.isPublicOnly;
                const userId = message.userId || null;

                if (!token) {
                    sendResponse({ ok: false, status: 0, error: "Missing token" });
                    return;
                }

                const body = {
                    limit: 20,
                    filters: {
                        disliked: "False",
                        trashed: "False",
                        fromStudioProject: { presence: "False" }
                    }
                };

                if (userId) {
                    body.filters.user = {
                        presence: "True",
                        userId: userId
                    };
                }

                if (isPublicOnly) {
                    body.filters.public = "True";
                }
                if (cursorValue) {
                    body.cursor = cursorValue;
                }

                const controller = new AbortController();
                const timeoutMs = 20000;
                const timeout = setTimeout(() => controller.abort(), timeoutMs);

                appendAutoTrashDebug('feed: request /api/feed/v3');
    const response = await fetch('https://studio-api.prod.suno.com/api/feed/v3', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(body),
                    signal: controller.signal
                });

                clearTimeout(timeout);

                const status = response.status;
                let data = null;
                try {
                    data = await response.json();
                } catch (e) {
                    // ignore
                }

                sendResponse({
                    ok: response.ok,
                    status,
                    data
                });
            } catch (e) {
                sendResponse({ ok: false, status: 0, error: e?.message || String(e) });
            }
        })();
        return true;
    }

    if (message.action === "fetch_songs") {
        stopFetchRequested = false;
        isFetching = true;
        fetchSongsList(message.isPublicOnly, message.maxPages, message.checkNewOnly, message.knownIds)
            .catch(err => failFetch("❌ System Error: " + (err?.message || err)));
    }
    
    if (message.action === "get_fetch_state") {
        sendResponse({ isFetching: isFetching });
        return true;
    }
    
    if (message.action === "stop_fetch") {
        stopFetchRequested = true;
        isFetching = false;
        // Notify content script to stop
        getSunoTab().then(tab => {
            if (tab?.id) {
                api.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => { window.sunoStopFetch = true; }
                });
            }
        });
    }
    
    if (message.action === "check_stop") {
        sendResponse({ stop: stopFetchRequested });
        return true;
    }

    if (message.action === "download_selected") {
        if (isDownloading) {
            logToPopup("⚠️ Download already running. Stop it first.");
            return;
        }
        stopDownloadRequested = false;
        isDownloading = true;
        currentDownloadJobId += 1;
        activeDownloadIds = new Set();
        persistDownloadState({ startedAt: Date.now() });
        broadcastDownloadState();

        // One-click UI: send tracks to the popup so it can render rows.
        try {
            const tracks = (message.songs || []).map(s => ({
                id: s.id,
                title: s.title || `Untitled_${s.id}`
            }));
            api.runtime.sendMessage({ action: "track_init", tracks });
        } catch (e) { /* ignore */ }

        downloadSelectedSongs(
            message.folderName,
            message.songs,
            message.format || 'mp3',
            currentDownloadJobId,
            normalizeDownloadOptions(message.downloadOptions)
        );
    }


    if (message.action === "highlight_last_batch") {
        (async () => {
            try {
                let songs = Array.isArray(message.songs) ? message.songs : [];
                if (!songs.length) {
                    const stored = await api.storage.local.get(LAST_BATCH_KEY);
                    songs = stored?.[LAST_BATCH_KEY]?.songs || [];
                }
                const result = await highlightSongsOnSuno(songs);
                sendResponse(result);
            } catch (e) {
                sendResponse({ ok: false, highlighted: 0, error: e?.message || String(e) });
            }
        })();
        return true;
    }

    if (message.action === "stop_download") {
        stopDownloadRequested = true;
        isDownloading = false;
        persistDownloadState({ stoppedAt: Date.now() });
        broadcastDownloadState();

        // Try to cancel in-progress browser downloads (best-effort)
        readPersistedDownloadState().then((state) => {
            const persistedIds = Array.isArray(state?.activeDownloadIds) ? state.activeDownloadIds : [];
            const idsToCancel = Array.from(new Set([...Array.from(activeDownloadIds), ...persistedIds]));
            for (const id of idsToCancel) {
                try { api.downloads.cancel(id); } catch (e) {}
            }
        });

        // Notify the Suno page to stop any in-page WAV polling
        getSunoTab().then(tab => {
            if (tab?.id) {
                api.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => { window.sunoStopDownload = true; }
                });
            }
        });

        try { api.runtime.sendMessage({ action: "download_stopped" }); } catch (e) {}
    }

    if (message.action === "get_download_state") {
        // Prefer persisted state (helps when popup is reopened)
        readPersistedDownloadState().then((state) => {
            if (state) {
                sendResponse({
                    isDownloading: !!state.isDownloading,
                    stopRequested: !!state.stopRequested,
                    jobId: state.jobId || 0
                });
            } else {
                sendResponse({
                    isDownloading,
                    stopRequested: stopDownloadRequested,
                    jobId: currentDownloadJobId
                });
            }
        });
        return true;
    }

    if (message.action === "download_item") {
        api.downloads.download({
            url: message.url,
            filename: message.filename,
            conflictAction: "uniquify"
        });
    }
    
    if (message.action === "songs_list") {
        isFetching = false;
        // Forward songs list from content script to popup
        api.runtime.sendMessage({ 
            action: "songs_fetched", 
            songs: message.songs,
            checkNewOnly: message.checkNewOnly
        });
    }
    
    if (message.action === "fetch_error_internal") {
        failFetch(message.error);
    }
});

async function fetchSongsList(isPublicOnly, maxPages, checkNewOnly = false, knownIds = []) {
    try {
        const tab = await getSunoTab();
        if (!tab?.id || !tab.url || !tab.url.includes("suno.com")) {
            failFetch("❌ Error: Please open Suno.com in the active tab.");
            return;
        }
        const tabId = tab.id;

        if (!checkNewOnly) {
            logToPopup("🔑 Extracting Auth Token...");
        }

        appendAutoTrashDebug('auth: requesting Clerk token');
    const tokenResults = await api.scripting.executeScript({
            target: { tabId: tabId },
            world: "MAIN",
            func: async () => {
                try {
                    if (window.Clerk && window.Clerk.session) {
                        return await window.Clerk.session.getToken();
                    }
                    return null;
                } catch (e) { return null; }
            }
        });

        const token = tokenResults[0]?.result;

        if (!token) {
            failFetch("❌ Error: Could not find Auth Token. Log in first!");
            return;
        }

        const userId = await fetchCurrentUserId(token);

        if (!checkNewOnly) {
            logToPopup("✅ Token found! Fetching songs list...");
        }

        await api.scripting.executeScript({
            target: { tabId: tabId },
            func: (t, p, m, c, k, u) => { 
                window.sunoAuthToken = t; 
                window.sunoPublicOnly = p;
                window.sunoMaxPages = m;
                window.sunoCheckNewOnly = c;
                window.sunoKnownIds = k;
                window.sunoUserId = u;
                window.sunoStopFetch = false;
                window.sunoMode = "fetch";
            },
            args: [token, isPublicOnly, maxPages, checkNewOnly, knownIds, userId]
        });

        await api.scripting.executeScript({
            target: { tabId: tabId },
            files: ["content.js"]
        });

    } catch (err) {
        console.error(err);
        failFetch("❌ System Error: " + (err?.message || err));
    }
}

async function fetchCurrentUserId(token) {
    try {
        const endpoints = [
            'https://studio-api.prod.suno.com/api/me/',
            'https://studio-api.prod.suno.com/api/me'
        ];

        for (const url of endpoints) {
            try {
                const res = await fetch(url, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!res.ok) continue;
                const data = await res.json();

                const direct = data?.id || data?.user_id || data?.user?.id || data?.profile?.id;
                if (typeof direct === 'string' && direct.length > 0) return direct;

                const fromTree = findUuidLikeId(data);
                if (fromTree) return fromTree;
            } catch (e) {
                // try next endpoint
            }
        }
    } catch (e) {
        // ignore
    }
    return null;
}

function findUuidLikeId(obj) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const stack = [obj];
    let safety = 0;

    while (stack.length && safety < 5000) {
        safety += 1;
        const cur = stack.pop();
        if (!cur || typeof cur !== 'object') continue;

        for (const value of Object.values(cur)) {
            if (typeof value === 'string' && uuidRegex.test(value)) {
                return value;
            }
            if (value && typeof value === 'object') {
                stack.push(value);
            }
        }
    }

    return null;
}

function normalizeDownloadOptions(options) {
    return {
        music: options?.music !== false,
        lyrics: options?.lyrics !== false,
        image: options?.image !== false
    };
}

async function downloadSelectedSongs(folderName, songs, format = 'mp3', jobId = 0, downloadOptions = { music: true, lyrics: true, image: true }, runOptions = {}) {
    const cleanFolder = folderName.replace(/[^a-zA-Z0-9_-]/g, "");
    
    function sanitizeFilename(name) {
        return name.replace(/[<>:"/\\|?*]/g, "").trim().substring(0, 100);
    }

    function buildDownloadFilename(baseName) {
        const folderPrefix = sanitizeFilename(cleanFolder);
        if (isAndroid) {
            return folderPrefix ? `${folderPrefix}-${baseName}` : baseName;
        }
        return cleanFolder ? `${cleanFolder}/${baseName}` : baseName;
    }

    async function downloadTextFile(text, filename) {
        async function downloadTextFileViaPage(fileText, fullFilename) {
            const sunoTab = await getSunoTab();
            if (!sunoTab?.id) {
                throw new Error('No Suno tab found for text download fallback');
            }

            const results = await api.scripting.executeScript({
                target: { tabId: sunoTab.id },
                world: "MAIN",
                func: async (payloadText, suggestedName) => {
                    try {
                        const blob = new Blob([payloadText], { type: 'text/plain;charset=utf-8' });
                        const blobUrl = URL.createObjectURL(blob);

                        const a = document.createElement('a');
                        a.href = blobUrl;
                        a.download = suggestedName;
                        a.style.display = 'none';
                        document.body.appendChild(a);
                        a.click();

                        setTimeout(() => {
                            try { document.body.removeChild(a); } catch (e) {}
                            try { URL.revokeObjectURL(blobUrl); } catch (e) {}
                        }, 5000);

                        return { ok: true };
                    } catch (e) {
                        return { error: e?.message || String(e) };
                    }
                },
                // When the downloads API rejects (e.g. data: URL not allowed), we fall back
                // to an in-page anchor. Browsers don't accept folder paths on that fallback,
                // so include the selected folder name in the suggested filename by
                // replacing path separators with '-'. This keeps files grouped by folder.
                args: [fileText, fullFilename.replace(/\//g, '-')]
            });

            const result = results?.[0]?.result;
            if (result?.error) {
                throw new Error(result.error);
            }
        }

        const dataUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;
        try {
            const downloadId = await api.downloads.download({
                url: dataUrl,
                filename,
                conflictAction: "uniquify"
            });
            if (typeof downloadId === 'number') {
                activeDownloadIds.add(downloadId);
                persistDownloadState();
            }
        } catch (err) {
            const msg = err?.message || String(err);
            const denied = /access denied|error processing url|invalid url|unsupported url/i.test(msg);
            if (!denied) throw err;
            await downloadTextFileViaPage(text, filename);
        }
    }

    function extractText(value) {
        if (typeof value === 'string') {
            const trimmed = value.trim();
            return trimmed.length > 0 ? trimmed : null;
        }

        if (Array.isArray(value)) {
            const parts = value.map(v => extractText(v)).filter(Boolean);
            if (parts.length > 0) return parts.join('\n');
        }

        if (value && typeof value === 'object') {
            const nestedCandidates = [
                value.lyrics,
                value.display_lyrics,
                value.full_lyrics,
                value.raw_lyrics,
                value.prompt,
                value.text,
                value.content,
                value.value
            ];
            for (const candidate of nestedCandidates) {
                const text = extractText(candidate);
                if (text) return text;
            }
        }

        return null;
    }

    function extractLyricsFromData(data) {
        if (!data || typeof data !== 'object') return null;

        const directCandidates = [
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

        for (const candidate of directCandidates) {
            const text = extractText(candidate);
            if (text) return text;
        }

        return null;
    }

    async function getAuthContext(authCtx) {
        if (authCtx.failed) return authCtx;
        if (authCtx.token && authCtx.tabId) return authCtx;

        const tab = await getSunoTab();
        if (!tab?.id || !tab.url || !tab.url.includes('suno.com')) {
            authCtx.failed = true;
            return authCtx;
        }

        authCtx.tabId = tab.id;

        if (!authCtx.token) {
            appendAutoTrashDebug('auth: requesting Clerk token');
    const tokenResults = await api.scripting.executeScript({
                target: { tabId: tab.id },
                world: "MAIN",
                func: async () => {
                    try {
                        if (window.Clerk && window.Clerk.session) {
                            return await window.Clerk.session.getToken();
                        }
                        return null;
                    } catch (e) {
                        return null;
                    }
                }
            });
            authCtx.token = tokenResults?.[0]?.result || null;
            if (!authCtx.token) {
                authCtx.failed = true;
            }
        }

        return authCtx;
    }

    async function fetchSongDataFromApi(songId, authCtx) {
        const ctx = await getAuthContext(authCtx);
        if (!ctx.token || !ctx.tabId) return null;

        const results = await api.scripting.executeScript({
            target: { tabId: ctx.tabId },
            world: "MAIN",
            func: async (clipId, authToken) => {
                const endpoints = [
                    `https://studio-api.prod.suno.com/api/gen/${clipId}/`,
                    `https://studio-api.prod.suno.com/api/gen/${clipId}`,
                    `https://studio-api.prod.suno.com/api/gen/${clipId}/metadata/`,
                    `https://studio-api.prod.suno.com/api/gen/${clipId}/metadata`
                ];

                for (const url of endpoints) {
                    try {
                        const response = await fetch(url, {
                            method: 'GET',
                            headers: {
                                'Authorization': `Bearer ${authToken}`,
                                'Accept': 'application/json'
                            }
                        });
                        if (!response.ok) continue;
                        const data = await response.json();
                        return data;
                    } catch (e) {
                        // try next endpoint
                    }
                }

                return null;
            },
            args: [songId, ctx.token]
        });

        return results?.[0]?.result || null;
    }

    async function resolveLyricsForSong(song, authCtx) {
        const fromSong = typeof song.lyrics === 'string' ? song.lyrics.trim() : '';
        if (fromSong) return fromSong;

        try {
            const apiData = await fetchSongDataFromApi(song.id, authCtx);
            const extracted = extractLyricsFromData(apiData);
            return extracted || '';
        } catch (e) {
            return '';
        }
    }

    function extractImageUrlFromData(data) {
        if (!data || typeof data !== 'object') return null;

        function scoreImageUrl(url) {
            if (!url || typeof url !== 'string') return -1;
            let score = 0;
            const u = url.toLowerCase();

            if (/\b(large|full|orig|original|hd|uhd|4k|2048|1536|1024)\b/.test(u)) score += 6;
            if (/\b(image_large|cover_image)\b/.test(u)) score += 4;
            if (/\bthumbnail|thumb|small|avatar\b/.test(u)) score -= 8;
            if (/[?&](w|h|width|height)=\d{1,3}\b/.test(u)) score -= 3;

            return score;
        }

        const directCandidates = [
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
        for (const candidate of directCandidates) {
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

    function isLikelyThumbnailUrl(url) {
        if (!url || typeof url !== 'string') return false;
        const u = url.toLowerCase();
        return /\bthumbnail|thumb|small|avatar\b/.test(u) || /[?&](w|h|width|height)=\d{1,3}\b/.test(u);
    }

    async function resolveImageUrlForSong(song, authCtx) {
        const fromSong = typeof song.image_url === 'string' ? song.image_url.trim() : '';
        const validFromSong = (fromSong && /^https?:\/\//i.test(fromSong)) ? fromSong : '';
        const songIsThumb = isLikelyThumbnailUrl(validFromSong);

        // Keep the existing URL only if it doesn't look like a thumbnail.
        if (validFromSong && !songIsThumb) return validFromSong;

        try {
            const apiData = await fetchSongDataFromApi(song.id, authCtx);
            const fromApi = extractImageUrlFromData(apiData) || '';
            if (fromApi) return fromApi;

            // Fallback only when API did not provide a better URL.
            return validFromSong || '';
        } catch (e) {
            return validFromSong || '';
        }
    }

    function getImageExtensionFromUrl(url) {
        try {
            const pathname = new URL(url).pathname || '';
            const ext = pathname.split('.').pop()?.toLowerCase();
            if (ext && /^[a-z0-9]{2,5}$/.test(ext)) {
                return ext;
            }
        } catch (e) {
            // ignore
        }
        return 'jpg';
    }

    async function downloadImageForSong(song) {
        const title = song.title || `Untitled_${song.id}`;
        const imageUrl = await resolveImageUrlForSong(song, lyricsAuthContext);
        if (!imageUrl) {
            return { downloaded: false, missing: true, title };
        }

        const ext = getImageExtensionFromUrl(imageUrl);
        const baseName = `${sanitizeFilename(title)}_${song.id.slice(-4)}_cover.${ext}`;
        const filename = buildDownloadFilename(baseName);

        try {
            await downloadOneFile(imageUrl, filename);
            return { downloaded: true, missing: false, title };
        } catch (err) {
            return { downloaded: false, missing: false, title, error: err?.message || String(err) };
        }
    }

    async function downloadLyricsForSong(song) {
        const title = song.title || `Untitled_${song.id}`;
        const lyrics = await resolveLyricsForSong(song, lyricsAuthContext);
        if (!lyrics) {
            return { downloaded: false, missing: true, title };
        }

        const baseName = `${sanitizeFilename(title)}_${song.id.slice(-4)}.txt`;
        const filename = buildDownloadFilename(baseName);
        const textContent = `${title}\n\n${lyrics}\n`;

        try {
            await downloadTextFile(textContent, filename);
            return { downloaded: true, missing: false, title };
        } catch (err) {
            return { downloaded: false, missing: false, title, error: err?.message || String(err) };
        }
    }
    
    const shouldDownloadMusic = !!downloadOptions?.music;
    const shouldDownloadLyrics = !!downloadOptions?.lyrics;
    const shouldDownloadImage = !!downloadOptions?.image;
    const selectedTypes = [];
    if (shouldDownloadMusic) selectedTypes.push(format.toUpperCase());
    if (shouldDownloadLyrics) selectedTypes.push('lyrics');
    if (shouldDownloadImage) selectedTypes.push('images');

    if (selectedTypes.length === 0) {
        await failDownload('⚠️ Nothing selected to download.', false);
        return;
    }

    logToPopup(`🚀 Starting download of ${songs.length} song(s): ${selectedTypes.join(', ')}...`);

    // Some platforms (notably Firefox Android) may not support subfolders in downloads filenames.
    let isAndroid = false;
    try {
        const platformInfo = await api.runtime.getPlatformInfo();
        isAndroid = platformInfo?.os === 'android';
    } catch (e) {
        // ignore
    }

    if (isAndroid) {
        logToPopup('📱 Android detected: saving files without subfolders.');
    }

    async function downloadOneFile(url, filename) {
        const downloadId = await api.downloads.download({
            url,
            filename,
            conflictAction: "uniquify"
        });
        if (typeof downloadId === 'number') {
            activeDownloadIds.add(downloadId);
            persistDownloadState();
        }
        return true;
    }

    // Ensure in-page stop flag exists (used for WAV polling)
    try {
        const tab = await getSunoTab();
        if (tab?.id && tab.url && tab.url.includes("suno.com")) {
            await api.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => { window.sunoStopDownload = false; }
            });
        }
    } catch (e) {
        // ignore
    }
    
    let downloadedCount = 0;
    const successfulSongs = []; // only tracks with successful WAV downloads are highlighted
    let lyricsDownloadedCount = 0;
    let lyricsMissingCount = 0;
    let imagesDownloadedCount = 0;
    let imagesMissingCount = 0;
    let failedCount = 0;
    const lyricsAuthContext = { token: null, tabId: null, failed: false };
    
    // For WAV downloads, we need to use the authenticated API
    if (format === 'wav' && shouldDownloadMusic) {
        // Get the active tab to execute the WAV conversion requests
        const tab = await getSunoTab();
        if (!tab?.id || !tab.url || !tab.url.includes("suno.com")) {
            await failDownload("❌ Error: Please open Suno.com for WAV downloads.", false);
            return;
        }
        const tabId = tab.id;
        
        // Get auth token
        appendAutoTrashDebug('auth: requesting Clerk token');
    const tokenResults = await api.scripting.executeScript({
            target: { tabId: tabId },
            world: "MAIN",
            func: async () => {
                try {
                    if (window.Clerk && window.Clerk.session) {
                        return await window.Clerk.session.getToken();
                    }
                    return null;
                } catch (e) { return null; }
            }
        });
        
        const token = tokenResults[0]?.result;
        if (!token) {
            await failDownload("❌ Error: Could not get auth token for WAV download.", false);
            return;
        }
        lyricsAuthContext.token = token;
        lyricsAuthContext.tabId = tabId;
        
        for (const song of songs) {
            if (stopDownloadRequested || !isDownloading || jobId !== currentDownloadJobId) {
                logToPopup("⏹️ Download stopped by user.");
                break;
            }
            const title = song.title || `Untitled_${song.id}`;
            const baseName = `${sanitizeFilename(title)}_${song.id.slice(-4)}.wav`;
            const filename = buildDownloadFilename(baseName);

            // Notify popup that this track is being processed.
            try { api.runtime.sendMessage({ action: "track_progress", id: song.id }); } catch (e) {}

            try {
                // Request WAV conversion and poll until ready
                const wavResult = await api.scripting.executeScript({
                    target: { tabId: tabId },
                    world: "MAIN",
                    func: async (clipId, authToken) => {
                        try {
                            if (window.sunoStopDownload) {
                                return { stopped: true };
                            }
                            // Step 1: Start the conversion
                            const convertResponse = await fetch(`https://studio-api.prod.suno.com/api/gen/${clipId}/convert_wav/`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${authToken}`
                                }
                            });
                            
                            if (!convertResponse.ok) {
                                return { error: `Convert HTTP ${convertResponse.status}` };
                            }
                            
                            // Step 2: Poll for the WAV file URL
                            const maxAttempts = 30;
                            for (let i = 0; i < maxAttempts; i++) {
                                if (window.sunoStopDownload) {
                                    return { stopped: true };
                                }
                                await new Promise(r => setTimeout(r, 1000));
                                
                                const pollResponse = await fetch(`https://studio-api.prod.suno.com/api/gen/${clipId}/wav_file/`, {
                                    method: 'GET',
                                    headers: {
                                        'Authorization': `Bearer ${authToken}`
                                    }
                                });
                                
                                if (pollResponse.ok) {
                                    const data = await pollResponse.json();
                                    const wavUrl = data.wav_file_url || data.url || data.download_url;
                                    if (wavUrl) {
                                        return { url: wavUrl };
                                    }
                                    if (data.status === 'complete' || data.status === 'ready') {
                                        continue;
                                    }
                                } else if (pollResponse.status === 404 || pollResponse.status === 202) {
                                    // Still processing, continue polling
                                    continue;
                                } else {
                                    return { error: `Poll HTTP ${pollResponse.status}` };
                                }
                            }
                            return { error: 'Timeout waiting for WAV' };
                        } catch (e) {
                            return { error: e.message };
                        }
                    },
                    args: [song.id, token]
                });
                
                const result = wavResult[0]?.result;

                if (result?.stopped) {
                    logToPopup("⏹️ Download stopped by user.");
                    break;
                }
                
                if (result?.error) {
                    logToPopup(`⚠️ WAV failed: ${title} (${result.error})`);
                    failedCount++;
                    try { api.runtime.sendMessage({ action: "track_wav", id: song.id, status: "fail", error: result.error }); } catch (e) {}
                    continue;
                }

                if (result?.url) {
                    await downloadOneFile(result.url, filename);
                    downloadedCount++;
                    try { api.runtime.sendMessage({ action: "track_wav", id: song.id, status: "ok" }); } catch (e) {}
                    successfulSongs.push({ id: song.id, title: song.title || ('Untitled_' + song.id) });

                    if (downloadedCount % 5 === 0) {
                        logToPopup(`📥 Downloaded ${downloadedCount}/${songs.length}...`);
                    }
                } else {
                    logToPopup(`⚠️ No WAV URL: ${title}`);
                    failedCount++;
                    try { api.runtime.sendMessage({ action: "track_wav", id: song.id, status: "fail", error: "no_url" }); } catch (e) {}
                }

                if (shouldDownloadLyrics && !(stopDownloadRequested || !isDownloading || jobId !== currentDownloadJobId)) {
                    const lyricsResult = await downloadLyricsForSong(song);
                    if (lyricsResult.downloaded) {
                        lyricsDownloadedCount++;
                    } else if (lyricsResult.missing) {
                        lyricsMissingCount++;
                        logToPopup(`⚠️ No lyrics found: ${title}`);
                    } else if (lyricsResult.error) {
                        failedCount++;
                        logToPopup(`⚠️ Lyrics failed: ${title} (${lyricsResult.error})`);
                    }
                }

                if (shouldDownloadImage && !(stopDownloadRequested || !isDownloading || jobId !== currentDownloadJobId)) {
                    const imageResult = await downloadImageForSong(song);
                    if (imageResult.downloaded) {
                        imagesDownloadedCount++;
                    } else if (imageResult.missing) {
                        imagesMissingCount++;
                        logToPopup(`⚠️ No image found: ${title}`);
                    } else if (imageResult.error) {
                        failedCount++;
                        logToPopup(`⚠️ Image failed: ${title} (${imageResult.error})`);
                    }
                }
            } catch (err) {
                const msg = (err && (err.message || err.toString)) ? (err.message || err.toString()) : '';
                logToPopup(`⚠️ Failed: ${title}${msg ? ` (${msg})` : ''}`);
                failedCount++;
                try { api.runtime.sendMessage({ action: "track_wav", id: song.id, status: "fail", error: msg || "exception" }); } catch (e) {}
            }

            // Longer delay for WAV to avoid rate limiting
            await new Promise(r => setTimeout(r, 500));
        }
    } else {
        // MP3 downloads - direct from CDN
        for (const song of songs) {
            if (stopDownloadRequested || !isDownloading || jobId !== currentDownloadJobId) {
                logToPopup("⏹️ Download stopped by user.");
                break;
            }
            if (shouldDownloadMusic && song.audio_url) {
                const title = song.title || `Untitled_${song.id}`;
                const baseName = `${sanitizeFilename(title)}_${song.id.slice(-4)}.mp3`;
                const filename = buildDownloadFilename(baseName);
                
                try {
                    await downloadOneFile(song.audio_url, filename);
                    downloadedCount++;
                    
                    if (downloadedCount % 5 === 0) {
                        logToPopup(`📥 Downloaded ${downloadedCount}/${songs.length}...`);
                    }
                } catch (err) {
                    const msg = (err && (err.message || err.toString)) ? (err.message || err.toString()) : '';
                    logToPopup(`⚠️ Failed: ${title}${msg ? ` (${msg})` : ''}`);
                    failedCount++;
                }
                
                await new Promise(r => setTimeout(r, 200));
            }

            if (shouldDownloadLyrics && !(stopDownloadRequested || !isDownloading || jobId !== currentDownloadJobId)) {
                const title = song.title || `Untitled_${song.id}`;
                const lyricsResult = await downloadLyricsForSong(song);
                if (lyricsResult.downloaded) {
                    lyricsDownloadedCount++;
                } else if (lyricsResult.missing) {
                    lyricsMissingCount++;
                    logToPopup(`⚠️ No lyrics found: ${title}`);
                } else if (lyricsResult.error) {
                    failedCount++;
                    logToPopup(`⚠️ Lyrics failed: ${title} (${lyricsResult.error})`);
                }
            }

            if (shouldDownloadImage && !(stopDownloadRequested || !isDownloading || jobId !== currentDownloadJobId)) {
                const title = song.title || `Untitled_${song.id}`;
                const imageResult = await downloadImageForSong(song);
                if (imageResult.downloaded) {
                    imagesDownloadedCount++;
                } else if (imageResult.missing) {
                    imagesMissingCount++;
                    logToPopup(`⚠️ No image found: ${title}`);
                } else if (imageResult.error) {
                    failedCount++;
                    logToPopup(`⚠️ Image failed: ${title} (${imageResult.error})`);
                }
            }
        }
    }
    
    const stopped = stopDownloadRequested || !isDownloading || jobId !== currentDownloadJobId;
    const parts = [];
    if (shouldDownloadMusic) parts.push(`${downloadedCount} song(s)`);
    if (shouldDownloadLyrics) parts.push(`${lyricsDownloadedCount} lyrics file(s)${lyricsMissingCount ? ` (${lyricsMissingCount} missing)` : ''}`);
    if (shouldDownloadImage) parts.push(`${imagesDownloadedCount} image file(s)${imagesMissingCount ? ` (${imagesMissingCount} missing)` : ''}`);
    const summary = parts.join(', ');

    if (stopped) {
        logToPopup(`⏹️ STOPPED. Downloaded ${summary}${failedCount ? ` (${failedCount} failed)` : ''}.`);
    } else if (failedCount > 0) {
        logToPopup(`🎉 COMPLETE! Downloaded ${summary} (${failedCount} failed).`);
    } else {
        logToPopup(`🎉 COMPLETE! Downloaded ${summary}.`);
    }

    // Reset download state
    await finishDownloadState({ finishedAt: Date.now() });

    // One-click build: clean transient state, then keep only the last batch for re-highlighting.
    // Highlight only successfully downloaded WAV tracks.
    const lastBatchSongs = successfulSongs.filter(s => s && s.id).map(s => ({ id: s.id, title: s.title }));
    await clearDownloadState();
    try { await api.storage.local.set({ [LAST_BATCH_KEY]: { at: Date.now(), songs: lastBatchSongs } }); } catch (e) { /* ignore */ }

    if (!runOptions.skipHighlight && !stopped && lastBatchSongs.length) {
        try {
            const result = await highlightSongsOnSuno(lastBatchSongs);
            if (result?.selected) {
                logToPopup(`✅ Shift-selected ${result.selected} downloaded card(s) on Suno.`);
            } else if (result?.highlighted) {
                logToPopup(`✨ Highlighted ${result.highlighted} downloaded card(s) on Suno.`);
            } else {
                logToPopup('ℹ️ Batch saved. Open the Suno list and press Highlight last batch if the cards are not visible.');
            }
        } catch (e) {
            logToPopup(`ℹ️ Highlight skipped: ${e?.message || e}`);
        }
    }

    api.runtime.sendMessage({ action: "download_complete", stopped: stopped });
    return { stopped, successfulSongs: lastBatchSongs, failedCount, downloadedCount };
}

function logToPopup(text) {
    appendAutoTrashDebug(String(text || ''));
    try { api.runtime.sendMessage({ action: "log", text: text }); } catch (e) {}
}








