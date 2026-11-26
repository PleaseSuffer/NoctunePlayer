// A single low-frequency timer nudges at most two visible matches at a time.
window.createSettingsSearchBeacons = function ({ content, overlay }) {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const targets = new Set(), visible = new Set(), running = new Map();
    let panel = null, query = '', timer = null, cursor = 0;
    const canRun = () => !!query && overlay.classList.contains('open') && !document.hidden && !window._rafSuspended && !motion.matches;
    function cancel(node) {
        const animation = running.get(node);
        if (animation) { running.delete(node); animation.cancel(); }
        node.classList.remove('settings-search-beacon');
    }
    function sleep() {
        clearTimeout(timer); timer = null;
        for (const node of running.keys()) cancel(node);
    }
    function schedule(delay = 5000) {
        if (timer !== null || !canRun() || !visible.size) return;
        timer = setTimeout(pulse, delay);
    }
    function pulse() {
        timer = null;
        if (!canRun()) { sleep(); return; }
        const candidates = [...targets].filter(node => visible.has(node) && node.isConnected && !node.matches(':hover') && !node.contains(document.activeElement));
        for (const node of running.keys()) cancel(node);
        for (let i = 0; i < Math.min(2, candidates.length); i++) {
            const node = candidates[(cursor + i) % candidates.length];
            node.classList.add('settings-search-beacon');
            const animation = node.animate([
                { opacity: 0, offset: 0 },
                { opacity: .85, offset: .4 },
                { opacity: 0, offset: 1 },
            ], { duration: 1100, easing: 'ease-in-out', pseudoElement: '::after', id: 'settings-search-beacon' });
            running.set(node, animation);
            animation.finished.catch(() => {}).finally(() => {
                if (running.get(node) !== animation) return;
                running.delete(node); node.classList.remove('settings-search-beacon');
            });
        }
        cursor = candidates.length ? (cursor + 2) % candidates.length : 0;
        schedule();
    }
    const observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
            if (!targets.has(entry.target)) continue;
            if (entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0) visible.add(entry.target);
            else { visible.delete(entry.target); cancel(entry.target); }
        }
        if (!visible.size) sleep(); else schedule(350);
    }, { root: content, threshold: [0, .15] });
    function update(nextPanel, nextQuery) {
        const changed = nextPanel !== panel || nextQuery !== query;
        if (changed) {
            sleep(); observer.disconnect(); visible.clear(); cursor = 0;
            for (const node of targets) node.classList.remove('settings-search-beacon-anchor');
            targets.clear(); panel = nextPanel; query = nextQuery;
        }
        const next = new Set();
        if (query && panel) for (const hit of panel.querySelectorAll('.settings-search-hit')) {
            if (hit.closest('.settings-search-hidden') || hit.querySelector('.settings-search-hit')) continue;
            // When the match is a whole extension/card, point at its heading.
            next.add(hit.matches('.settings-card') ? (hit.querySelector('.addon-card-header, .integration-card-header') || hit) : hit);
        }
        for (const node of targets) if (!next.has(node)) {
            observer.unobserve(node); visible.delete(node); targets.delete(node); cancel(node);
            node.classList.remove('settings-search-beacon-anchor');
        }
        for (const node of next) if (!targets.has(node)) {
            targets.add(node); node.classList.add('settings-search-beacon-anchor'); observer.observe(node);
        }
        if (!canRun() || !visible.size) sleep(); else schedule(350);
    }
    function visibilityChanged() {
        if (!canRun()) sleep(); else schedule(350);
    }
    document.addEventListener('visibilitychange', visibilityChanged);
    window.noctune?.onWindowTrayVisibility(visibilityChanged);
    motion.addEventListener('change', visibilityChanged);
    return { update };
};
