// read_selection.js - Suno Watcher Beta fallback scanner
(function readSunoSelection() {

    // Find all selection buttons confirmed from HAR/DOM inspection.
    const allSelectBtns = Array.from(document.querySelectorAll(
        '.multi-select-button button, .multi-select-button BUTTON, button[aria-label="Select clip"], button[aria-label*="select" i], button[aria-label*="deselect" i], button[aria-label*="unselect" i], button[aria-label*="selected" i]'
    ));
    const byAriaLabel = Array.from(document.querySelectorAll(
        'button[aria-label="Select clip"], BUTTON[aria-label="Select clip"], button[aria-label*="select" i], button[aria-label*="selected" i], button[aria-label*="deselect" i], button[aria-label*="unselect" i]'
    ));
        const listButtons = Array.from(document.querySelectorAll(
        '.clip-browser-list-scroller button, .clip-browser-list-scroller [role="checkbox"], .clip-browser-list-scroller [aria-label*="select" i], [role="checkbox"][aria-label*="select" i]'
    ));
    const allBtns = [...new Set([...allSelectBtns, ...byAriaLabel, ...listButtons])];

    // ─────────────────────────────────────────────
    // Reliable checks only; avoid color-based hacks.
    // ─────────────────────────────────────────────
    function isSelected(btn) {
        const label = String(btn.getAttribute('aria-label') || btn.getAttribute('title') || '').toLowerCase();
        if (/deselect clip|deselect|unselect|remove selection/.test(label)) return true;
        if (label === 'select clip') return false;

        if (btn.getAttribute('aria-pressed')  === 'true') return true;
        if (btn.getAttribute('aria-checked')  === 'true') return true;
        if (btn.getAttribute('aria-selected') === 'true') return true;
        if (btn.getAttribute('data-state')    === 'checked') return true;
        if (btn.getAttribute('data-state')    === 'on')      return true;
        if (btn.getAttribute('data-selected') === 'true')    return true;

        const cb = btn.querySelector('input[type="checkbox"]');
        if (cb?.checked) return true;

        let node = btn;
        for (let i = 0; node && i < 8; i++, node = node.parentElement) {
            if (node.getAttribute?.('aria-selected') === 'true') return true;
            if (node.getAttribute?.('aria-checked') === 'true') return true;
            if (node.getAttribute?.('data-selected') === 'true') return true;
            const state = node.getAttribute?.('data-state');
            if (state === 'checked' || state === 'on') return true;
        }

        return false;
    }
    const selectedBtns = allBtns.filter(isSelected);

    // ─────────────────────────────────────────────
    // Detailed diagnostics for a small sample.
    // Show all useful button details.
    // ─────────────────────────────────────────────
    function btnDump(btn) {
        // Button attributes
        const attrs = {};
        for (const a of btn.attributes) attrs[a.name] = a.value;

        // Parent div.multi-select-button attributes
        const parent = btn.closest('.multi-select-button') || btn.parentElement;
        const parentAttrs = {};
        if (parent) for (const a of parent.attributes) parentAttrs[a.name] = a.value;

        // clip-row attributes
        let row = btn;
        for (let i = 0; row && i < 10; i++, row = row.parentElement) {
            if (row.classList?.contains('clip-row')) break;
        }
        const rowAttrs = {};
        if (row && row.classList?.contains('clip-row')) {
            for (const a of row.attributes) rowAttrs[a.name] = a.value;
        }

        // SVG fill for first path
        const svgPath = btn.querySelector('svg path, svg rect, svg circle');
        const svgFill = svgPath ? (svgPath.getAttribute('fill') || getComputedStyle(svgPath).fill) : null;
        const svgStroke = svgPath ? (svgPath.getAttribute('stroke') || getComputedStyle(svgPath).stroke) : null;

        // Key computed style fields
        const cs = getComputedStyle(btn);

        return {
            selected_guess: isSelected(btn),
            text: (btn.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
            html: btn.outerHTML.slice(0, 700),
            row_class: row?.className || null,
            row_text: row ? (row.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 180) : null,
            btn_class: btn.className,
            btn_attrs: attrs,
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
    const notSelected = allBtns.filter(b => !isSelected(b)).slice(0, 2);
    const yesSelected = selectedBtns.slice(0, 2);

    const diagNotSelected = notSelected.map(btnDump);
    const diagYesSelected = yesSelected.map(btnDump);

    // ─────────────────────────────────────────────
    // Collect tracks matched by isSelected()
    // ─────────────────────────────────────────────
    function findClipRow(el) {
        let node = el;
        for (let i = 0; node && i < 10; i++, node = node.parentElement) {
            if (node.classList?.contains('clip-row')) return node;
            if (node.matches?.('article, [role="listitem"]')) return node;
        }
        return null;
    }

    function extractClipId(row) {
        if (!row) return null;
        const links = row.querySelectorAll('a[href]');
        for (const a of links) {
            const m = (a.href || '').match(/\/(?:song|track|clip|gen)\/([a-f0-9-]{8,})/i);
            if (m) return m[1];
        }
        const dataId = row.dataset?.clipId || row.dataset?.songId || row.dataset?.id;
        if (dataId) return dataId;
        const inner = row.querySelector('[data-clip-id],[data-song-id],[data-id]');
        if (inner) return inner.dataset.clipId || inner.dataset.songId || inner.dataset.id;
        return null;
    }

    function extractTitle(row) {
        if (!row) return '';
        const titleEl =
            row.querySelector('[class*="title"i]') ||
            row.querySelector('[class*="name"i]') ||
            row.querySelector('p, h2, h3, h4');
        return (titleEl?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    }

    const clips = [];
    const seenIds = new Set();
    for (const btn of selectedBtns) {
        const row = findClipRow(btn);
        const id = extractClipId(row);
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        clips.push({ id, title: extractTitle(row) });
    }

    return {
        clips,
        count: clips.length,
        _debug: {
            total_buttons_found: allBtns.length,
            multi_select_buttons_found: allSelectBtns.length,
            list_buttons_found: listButtons.length,
            selected_by_aria: selectedBtns.length,
            // Key diagnostics:
            NOT_selected_samples: diagNotSelected,
            YES_selected_samples: diagYesSelected,
            first_button_samples: allBtns.slice(0, 8).map(btnDump)
        }
    };
})();
