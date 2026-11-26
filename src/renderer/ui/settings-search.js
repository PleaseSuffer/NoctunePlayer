(function initSettingsSearch() {
    const overlay = document.getElementById('settings-overlay');
    const field = document.getElementById('settings-search-field');
    const control = document.getElementById('settings-search-control');
    const input = document.getElementById('settings-search-input');
    const toggle = document.getElementById('settings-search-toggle');
    const clearButton = document.getElementById('settings-search-clear');
    const content = document.querySelector('.settings-content');
    const empty = document.getElementById('settings-search-empty');
    const status = document.getElementById('settings-search-status');
    if (!overlay || !input || !content) return;
    const beacons = window.createSettingsSearchBeacons({ content, overlay });
    const panels = [...document.querySelectorAll('.settings-panel')];
    const nav = [...document.querySelectorAll('.settings-nav-item')];
    const unitSelector = '.settings-row, .settings-option-group, .settings-card, .settings-section-title, .addon-disclosure, .addon-action-group, .addon-permission-group, .integration-card-body, [data-settings-detail], .pl-editor-item, .about-card, .notification-history-card, .notification-history-toolbar';
    const ignored = 'script, style, input, textarea, select, svg, [aria-hidden="true"], [hidden], [role="listbox"], .viz-type-dropdown-menu, .settings-search-count';
    const normalize = value => String(value).toLocaleLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
    // Keep the examples in docs/settings-search.md aligned with this dictionary.
    const aliases = [
        [/setting-normalize/, 'нормализация громкость треков normalization volume leveling'],
        [/setting-replaygain/, 'replaygain теги громкости нормализация'],
        [/setting-crossfade/, 'кроссфейд плавный переход затухание crossfade'],
        [/mini-player|mini-/, 'мини плеер миниплеер mini player'],
        [/glass-opacity|opacity/, 'прозрачность прозрачный opacity transparency'],
        [/cover-cache/, 'кэш кеш обложки cache artwork'],
        [/auto-check-updates|check-on-startup/, 'обновления проверка update startup'],
    ];
    let tokens = [], timer, applying = false, autoNavigating = false;
    const originalDetails = new Map();
    const counts = new Map();
    const highlighted = new Set();
    let returnPanel = null;
    let returnScroll = 0;
    const message = (key, args = {}) => {
        const fullKey = 'settings.search.' + key;
        return globalThis.noctuneI18n?.t(fullKey, args) || fullKey;
    };
    function observe() { observer.observe(content, { childList: true, subtree: true, characterData: true }); }
    function reset() {
        for (const node of highlighted) node.classList.remove('settings-search-hidden', 'settings-search-hit', 'settings-search-group', 'settings-search-reveal');
        highlighted.clear();
        for (const [detail, open] of originalDetails) if (detail.isConnected) detail.open = open;
        originalDetails.clear();
        globalThis.CSS?.highlights?.delete('settings-search');
    }
    function decorate(node, className, enabled = true) {
        node.classList.toggle(className, enabled); if (enabled) highlighted.add(node);
    }
    function matches(value) { return tokens.every(token => value.includes(token)); }
    function indexPanel(panel) {
        const units = new Set([...panel.children, ...panel.querySelectorAll(unitSelector)]);
        const entries = new Map();
        for (const node of units) {
            if (node.closest('[hidden]')) continue;
            entries.set(node, { node, text: '', children: [], keep: false, count: 0 });
        }
        function owner(node) {
            while (node && node !== panel && !entries.has(node)) node = node.parentElement;
            return entries.get(node);
        }
        const roots = [];
        for (const entry of entries.values()) {
            const parent = owner(entry.node.parentElement);
            (parent ? parent.children : roots).push(entry);
        }
        const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
        const textNodes = [];
        while (walker.nextNode()) {
            const text = walker.currentNode;
            if (!text.textContent.trim() || text.parentElement.closest(ignored)) continue;
            const entry = owner(text.parentElement);
            if (entry) { entry.text += ' ' + text.textContent; textNodes.push(text); }
        }
        for (const control of panel.querySelectorAll('input[id], button[title], button[aria-label]')) {
            if (control.closest('[hidden], [role="listbox"]')) continue;
            const entry = owner(control); if (!entry) continue;
            if (control.tagName === 'BUTTON') entry.text += ' ' + (control.title || control.getAttribute('aria-label') || '');
            for (const [pattern, words] of aliases) if (pattern.test(control.id)) entry.text += ' ' + words;
        }
        function visit(items, context) {
            let sectionContext = context, heading = null, count = 0;
            for (const entry of items) {
                const own = normalize(entry.text);
                if (entry.node.classList.contains('settings-section-title')) {
                    sectionContext = context + ' ' + own; heading = entry;
                    entry.keep = matches(sectionContext);
                    if (entry.keep && tokens.some(token => own.includes(token))) decorate(entry.node, 'settings-search-hit');
                    continue;
                }
                const combined = sectionContext + ' ' + own;
                const ownMatch = matches(combined);
                const childCount = visit(entry.children, combined);
                entry.keep = ownMatch || childCount > 0;
                entry.count = childCount || (ownMatch ? 1 : 0);
                if (entry.keep) {
                    count += entry.count;
                    if (heading) heading.keep = true;
                    const direct = ownMatch && tokens.some(token => own.includes(token));
                    if (direct) decorate(entry.node, 'settings-search-hit');
                    if (entry.node.classList.contains('settings-card')) decorate(entry.node, 'settings-search-group');
                    // Keep a group's controlling switch with its matching dependent options.
                    if (entry.node.classList.contains('settings-option-group')) {
                        const header = entry.children.find(child => child.node.classList.contains('settings-row'));
                        if (header) header.keep = true;
                    }
                }
            }
            return count;
        }
        const count = visit(roots, normalize(nav.find(item => item.dataset.panel === panel.id)?.querySelector('[data-i18n]')?.textContent || ''));
        for (const entry of entries.values()) {
            decorate(entry.node, 'settings-search-hidden', !entry.keep);
            if (!entry.keep) continue;
            // Search only reveals presentation; it never enables a feature or writes a setting.
            for (let parent = entry.node; parent && parent !== panel; parent = parent.parentElement) {
                if (parent.style.display === 'none' && !parent.matches('[hidden], [role="listbox"], .viz-type-dropdown-menu')) decorate(parent, 'settings-search-reveal');
                if (parent.tagName === 'DETAILS' && !parent.open) {
                    if (!originalDetails.has(parent)) originalDetails.set(parent, false);
                    parent.open = true;
                }
            }
        }
        return { count, textNodes };
    }
    function updateEmpty() {
        const active = document.querySelector('.settings-panel.active');
        const count = counts.get(active?.id) || 0;
        empty.hidden = !tokens.length || count > 0;
        const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
        status.textContent = tokens.length ? message('results', { count, total }) : '';
    }
    function apply({ navigate = false } = {}) {
        clearTimeout(timer); timer = null; if (applying) return;
        applying = true; observer.disconnect(); reset();
        tokens = normalize(input.value).match(/[\p{L}\p{N}]+/gu) || [];
        counts.clear();
        overlay.classList.toggle('settings-search-active', !!tokens.length);
        clearButton.hidden = !input.value;
        const ranges = [];
        if (tokens.length) {
            for (const panel of panels) {
                const { count, textNodes } = indexPanel(panel); counts.set(panel.id, count);
                if (globalThis.Highlight && globalThis.CSS?.highlights) for (const text of textNodes) {
                    if (text.parentElement.closest('.settings-search-hidden')) continue;
                    const value = text.textContent.toLocaleLowerCase().replace(/ё/g, 'е');
                    for (const token of tokens) {
                        let start = 0, position;
                        while ((position = value.indexOf(token, start)) !== -1) {
                            const range = document.createRange(); range.setStart(text, position); range.setEnd(text, position + token.length); ranges.push(range);
                            start = position + token.length;
                        }
                    }
                }
            }
            if (ranges.length) CSS.highlights.set('settings-search', new Highlight(...ranges));
        }
        for (const item of nav) {
            const count = counts.get(item.dataset.panel) || 0;
            item.classList.toggle('settings-search-dimmed', !!tokens.length && !count);
            item.classList.toggle('settings-search-found', !!tokens.length && !!count);
            let badge = item.querySelector('.settings-search-count');
            if (tokens.length && count) {
                if (!badge) { badge = document.createElement('span'); badge.className = 'settings-search-count'; item.append(badge); }
                badge.textContent = String(count);
            } else badge?.remove();
        }
        let navigated = false;
        if (navigate && tokens.length && !counts.get(document.querySelector('.settings-panel.active')?.id)) {
            const target = nav.find(item => counts.get(item.dataset.panel));
            if (target) { autoNavigating = true; target.click(); autoNavigating = false; navigated = true; }
        }
        updateEmpty(); document.dispatchEvent(new Event('settings-sections-changed'));
        beacons.update(document.querySelector('.settings-panel.active'), tokens.join(' '));
        applying = false; observe();
        // Entering a panel can rebuild its editor. Index the replacement nodes too.
        if (navigated) queueMicrotask(() => apply());
    }
    function schedule() { if (!timer) timer = setTimeout(() => apply(), 100); }
    const observer = new MutationObserver(() => { if (tokens.length && !applying) schedule(); });
    observe();
    function clear({ restore = false } = {}) {
        input.value = ''; apply();
        if (restore && returnPanel) {
            autoNavigating = true; nav.find(item => item.dataset.panel === returnPanel)?.click(); autoNavigating = false;
            content.scrollTo({ top: returnScroll, behavior: 'instant' });
        }
        returnPanel = null;
    }
    function open(value, { focus = true, restore = true } = {}) {
        toggle.setAttribute('aria-expanded', String(value));
        field.inert = !value; field.classList.toggle('open', value);
        control.classList.toggle('is-expanded', value);
        overlay.classList.toggle('settings-search-expanded', value);
        if (value) { if (focus) input.focus(); }
        else { clear({ restore }); if (focus) toggle.focus(); }
    }
    toggle.addEventListener('click', () => open(toggle.getAttribute('aria-expanded') !== 'true'));
    input.addEventListener('input', event => {
        if (event.isComposing) return;
        if (!input.value.trim()) { clear({ restore: true }); return; }
        if (!tokens.length && input.value.trim()) {
            returnPanel = document.querySelector('.settings-panel.active')?.id; returnScroll = content.scrollTop;
        }
        clearTimeout(timer); timer = setTimeout(() => { apply({ navigate: true }); content.scrollTo({ top: 0, behavior: 'instant' }); }, 100);
    });
    clearButton.addEventListener('click', () => { input.focus(); clear({ restore: true }); });
    function collapseEmpty() {
        if (toggle.getAttribute('aria-expanded') === 'true' && !input.value.trim()) open(false, { focus: false });
    }
    document.addEventListener('pointerdown', event => { if (!control.contains(event.target)) collapseEmpty(); });
    control.addEventListener('focusout', event => { if (!control.contains(event.relatedTarget)) collapseEmpty(); });
    field.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); open(false); }
        if (event.key === 'Enter') {
            event.preventDefault(); apply({ navigate: true });
            document.querySelector('.settings-panel.active .settings-search-hit')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
    });
    document.addEventListener('keydown', event => {
        if (overlay.classList.contains('open') && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); open(true); input.select(); }
    });
    document.addEventListener('settings-panel-changed', () => {
        if (!autoNavigating && tokens.length) { returnPanel = document.querySelector('.settings-panel.active')?.id; returnScroll = 0; }
        if (tokens.length && !applying) apply();
    });
    document.addEventListener('settings-closed', () => {
        open(false, { focus: false, restore: false });
    });
    globalThis.noctuneI18n?.onChange?.(() => { if (tokens.length) schedule(); });
    window.settingsSearch = { clear: () => open(false, { focus: false, restore: false }), refresh: schedule };
})();
