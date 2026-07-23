// read_selection.js - Suno Selection Downloader fallback scanner
(function readSunoSelection() {

    // Suno has used both legacy Select clip buttons and native/ARIA
    // checkboxes. Keep the candidate list narrow so Like/Play/Publish
    // buttons cannot become false selections.
    const legacySelectControls = Array.from(document.querySelectorAll([
        '.multi-select-button button',
        'button[aria-label="Select"]',
        'button[aria-label="Deselect"]',
        'button[aria-label*="select clip" i]',
        'button[aria-label*="select track" i]',
        'button[aria-label*="deselect" i]',
        'button[aria-label*="unselect" i]',
        'button[aria-label*="remove selection" i]'
    ].join(', ')));
    const nativeCheckboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
    const ariaCheckboxes = Array.from(document.querySelectorAll([
        '[role="checkbox"]',
        '[data-testid*="checkbox" i][data-state]',
        '[data-testid*="select" i][aria-checked]'
    ].join(', ')));
    const allControls = [...new Set([
        ...legacySelectControls,
        ...nativeCheckboxes,
        ...ariaCheckboxes
    ])];

    // ─────────────────────────────────────────────
    // Reliable checks only; avoid color-based hacks.
    // ─────────────────────────────────────────────
    function hasSelectedState(el) {
        if (!el) return false;
        if (el.matches?.('input[type="checkbox"]')) return Boolean(el.checked);
        if (el.getAttribute?.('aria-pressed')  === 'true') return true;
        if (el.getAttribute?.('aria-checked')  === 'true') return true;
        if (el.getAttribute?.('aria-selected') === 'true') return true;
        if (el.getAttribute?.('data-state')    === 'checked') return true;
        if (el.getAttribute?.('data-state')    === 'on')      return true;
        if (el.getAttribute?.('data-selected') === 'true')    return true;
        return false;
    }

    function isSelected(control) {
        const label = String(control.getAttribute('aria-label') || control.getAttribute('title') || '').toLowerCase();
        if (/deselect clip|deselect|unselect|remove selection/.test(label)) return true;
        if (/^select(?: clip| track)?$/.test(label)) return false;
        if (hasSelectedState(control)) return true;

        const cb = control.querySelector?.('input[type="checkbox"]');
        if (cb?.checked) return true;

        // Some legacy builds keep state on the immediate select wrapper.
        // Never walk up to the whole row: a selected row would otherwise
        // make its Like/Play/Publish buttons look selected too.
        const wrapper = control.closest?.('.multi-select-button, [role="checkbox"]');
        if (wrapper !== control && hasSelectedState(wrapper)) return true;

        // Current list/waveform builds keep the selected state only in
        // React/CSS: unselected buttons have hover-only, selected ones do
        // not. Restrict this fallback to the dedicated select wrapper.
        const multiSelect = control.closest?.('.multi-select-button');
        return Boolean(multiSelect && !control.classList?.contains('hover-only'));
    }
    const selectedControls = allControls.filter(isSelected);

    const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
    const ROUTE_UUID_RE = /\/(?:song|track|clip|gen)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/ig;
    const MEDIA_UUID_RE = /(?:image_|audio_)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/ig;

    function normalizeClipId(value) {
        if (value == null) return null;
        const text = String(value);
        const uuid = text.match(UUID_RE);
        return uuid ? uuid[0] : null;
    }

    function addMatches(target, value, regex) {
        if (value == null) return;
        regex.lastIndex = 0;
        let match;
        while ((match = regex.exec(String(value)))) target.add(match[1]);
    }

    function collectClipIds(row) {
        if (!row) return [];

        const explicitIds = new Set();
        const ownValues = [
            row.dataset?.clipId,
            row.dataset?.songId,
            row.dataset?.trackId,
            row.getAttribute?.('data-clip-id'),
            row.getAttribute?.('data-song-id'),
            row.getAttribute?.('data-track-id')
        ];
        for (const value of ownValues) {
            const id = normalizeClipId(value);
            if (id) explicitIds.add(id);
        }

        const idNodes = row.querySelectorAll?.('[data-clip-id],[data-song-id],[data-track-id]') || [];
        for (const node of idNodes) {
            const id = normalizeClipId(
                node.dataset?.clipId ||
                node.dataset?.songId ||
                node.dataset?.trackId ||
                node.getAttribute?.('data-clip-id') ||
                node.getAttribute?.('data-song-id') ||
                node.getAttribute?.('data-track-id')
            );
            if (id) explicitIds.add(id);
        }
        if (explicitIds.size) return [...explicitIds];

        const routeIds = new Set();
        const links = row.querySelectorAll?.('a[href]') || [];
        for (const link of links) {
            addMatches(routeIds, link.href || link.getAttribute?.('href'), ROUTE_UUID_RE);
        }
        if (routeIds.size) return [...routeIds];

        const dataIds = new Set();
        const dataIdNodes = [
            ...(row.matches?.('[data-id]') ? [row] : []),
            ...(row.querySelectorAll?.('[data-id]') || [])
        ];
        for (const node of dataIdNodes) {
            const id = normalizeClipId(node.dataset?.id || node.getAttribute?.('data-id'));
            if (id) dataIds.add(id);
        }
        if (dataIds.size) return [...dataIds];

        // New Grid/Waveform cards expose the clip UUID through Suno media
        // URLs such as image_<UUID>.jpeg, even when the outer card is an
        // anonymous div with no route link or data attribute.
        const mediaIds = new Set();
        const media = row.querySelectorAll?.('img[src], source[src], source[srcset], audio[src]') || [];
        for (const item of media) {
            const value =
                item.src ||
                item.srcset ||
                item.getAttribute?.('src') ||
                item.getAttribute?.('srcset');
            addMatches(mediaIds, value, MEDIA_UUID_RE);
        }
        return [...mediaIds];
    }

    function extractClipId(row) {
        const ids = collectClipIds(row);
        return ids.length === 1 ? ids[0] : null;
    }

    function findClipRow(el) {
        let node = el;
        for (let i = 0; node && i < 16; i++, node = node.parentElement) {
            const ids = collectClipIds(node);
            const controls = node.querySelectorAll?.(
                '.multi-select-button button, input[type="checkbox"], [role="checkbox"], button[aria-label*="select clip" i], button[aria-label*="deselect clip" i]'
            ) || [];
            if (ids.length === 1 && controls.length <= 1) return node;
            // Multiple IDs or selection controls mean we reached the
            // surrounding list/select-all area, not one track card.
            if (ids.length > 1 || controls.length > 1) return null;
        }
        return null;
    }

    // ─────────────────────────────────────────────
    // Detailed diagnostics for a small sample.
    // Show all useful button details.
    // ─────────────────────────────────────────────
    function controlDump(control) {
        // Selection-control attributes
        const attrs = {};
        for (const a of control.attributes) attrs[a.name] = a.value;

        const parent = control.closest('.multi-select-button, [role="checkbox"]') || control.parentElement;
        const parentAttrs = {};
        if (parent) for (const a of parent.attributes) parentAttrs[a.name] = a.value;

        const row = findClipRow(control);
        const rowAttrs = {};
        if (row) for (const a of row.attributes) rowAttrs[a.name] = a.value;

        // SVG fill for first path
        const svgPath = control.querySelector?.('svg path, svg rect, svg circle');
        const svgFill = svgPath ? (svgPath.getAttribute('fill') || getComputedStyle(svgPath).fill) : null;
        const svgStroke = svgPath ? (svgPath.getAttribute('stroke') || getComputedStyle(svgPath).stroke) : null;

        // Key computed style fields
        const cs = getComputedStyle(control);

        return {
            selected_guess: isSelected(control),
            clip_id_guess: extractClipId(row),
            text: (control.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
            html: control.outerHTML.slice(0, 700),
            row_class: row?.className || null,
            row_text: row ? (row.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 180) : null,
            control_class: control.className,
            control_attrs: attrs,
            btn_bg: cs.backgroundColor,
            btn_color: cs.color,
            btn_opacity: cs.opacity,
            svg_fill: svgFill,
            svg_stroke: svgStroke,
            parent_class: parent?.className,
            parent_attrs: parentAttrs,
            row_attrs: rowAttrs
        };
    }

    // Use first selected/unselected examples
    const notSelected = allControls.filter(control => !isSelected(control)).slice(0, 2);
    const yesSelected = selectedControls.slice(0, 2);

    const diagNotSelected = notSelected.map(controlDump);
    const diagYesSelected = yesSelected.map(controlDump);

    // ─────────────────────────────────────────────
    // Collect tracks matched by isSelected()
    // ─────────────────────────────────────────────
    function extractTitle(row) {
        if (!row) return '';
        const clipLink = Array.from(row.querySelectorAll?.('a[href]') || [])
            .find(link => {
                const ids = new Set();
                addMatches(ids, link.href || link.getAttribute?.('href'), ROUTE_UUID_RE);
                return ids.size === 1;
            });
        const titleEl =
            (clipLink?.textContent?.trim() ? clipLink : null) ||
            row.querySelector('[data-testid*="title" i]') ||
            row.querySelector('[class*="title"i]') ||
            row.querySelector('[class*="name"i]') ||
            row.querySelector('span[role="button"]') ||
            row.querySelector('h2, h3, h4, p') ||
            clipLink;
        const text = (titleEl?.textContent || clipLink?.textContent || '').trim().replace(/\s+/g, ' ');
        return text.slice(0, 120);
    }

    const clips = [];
    const seenIds = new Set();
    let selectedWithoutClipId = 0;
    for (const control of selectedControls) {
        const row = findClipRow(control);
        const id = extractClipId(row);
        if (!id) {
            selectedWithoutClipId++;
            continue;
        }
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        clips.push({ id, title: extractTitle(row) });
    }

    return {
        clips,
        count: clips.length,
        _debug: {
            controls_found: allControls.length,
            legacy_controls_found: legacySelectControls.length,
            native_checkboxes_found: nativeCheckboxes.length,
            aria_checkboxes_found: ariaCheckboxes.length,
            selected_controls_found: selectedControls.length,
            selected_without_clip_id: selectedWithoutClipId,
            // Key diagnostics:
            NOT_selected_samples: diagNotSelected,
            YES_selected_samples: diagYesSelected,
            first_control_samples: allControls.slice(0, 8).map(controlDump)
        }
    };
})();
