/* One bounded media session for the whole store. Optional videos never replace the poster on failure. */
(() => {
    const api = window.addonStore;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let enabled = true;
    try { enabled = localStorage.getItem('noctune-store-previews') !== 'off'; } catch (_) {}
    let active = null, serial = 0;
    const allowed = () => enabled && !reduced.matches && !document.hidden;
    function stop() {
        const old = active; active = null;
        if (!old) return;
        clearTimeout(old.delay); clearTimeout(old.timeout);
        api.cancelPreview(old.request).catch(() => {});
        old.container.classList.remove('preview-loading', 'preview-playing');
        if (old.video) { old.video.pause(); old.video.removeAttribute('src'); old.video.load(); old.video.remove(); }
        if (old.url) URL.revokeObjectURL(old.url);
    }
    function start(container, entry, immediate = false) {
        if (!allowed() || active?.container === container) return;
        stop();
        const state = { container, request: ++serial }; active = state;
        state.delay = setTimeout(async () => {
            if (active !== state) return;
            if (!allowed() || !container.isConnected) return stop();
            container.classList.add('preview-loading');
            state.timeout = setTimeout(() => { if (active === state) stop(); }, 20000);
            try {
                const media = await api.preview(state.request, entry.id, entry.kind, entry.channel);
                window.dispatchEvent(new CustomEvent('preview-cache-changed',{ detail:media.cache }));
                if (active !== state || !allowed() || !container.isConnected) return;
                const video = document.createElement('video'); state.video = video;
                video.className = 'animated-preview'; video.muted = true; video.loop = true; video.playsInline = true;
                video.setAttribute('aria-hidden', 'true'); video.disablePictureInPicture = true;
                state.url = URL.createObjectURL(new Blob([media.bytes], { type: media.mime }));
                video.addEventListener('error', () => { if (active === state) stop(); });
                video.addEventListener('loadedmetadata', () => {
                    // WebM recorded as a stream can report Infinity; reject it rather than trusting metadata.
                    if (video.videoWidth !== media.width || video.videoHeight !== media.height || !Number.isFinite(video.duration) || video.duration > 6 || Math.abs(video.duration-media.duration) > .5) { if (active === state) stop(); }
                }, { once: true });
                video.addEventListener('playing', () => {
                    if (active !== state) return;
                    clearTimeout(state.timeout);
                    const reveal = () => { if (active === state) { container.classList.remove('preview-loading'); container.classList.add('preview-playing'); } };
                    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(reveal); else requestAnimationFrame(reveal);
                }, { once: true });
                container.append(video); video.src = state.url;
                await video.play();
            } catch (_) { if (active === state) stop(); }
            finally { api.previewCache().then(cache => window.dispatchEvent(new CustomEvent('preview-cache-changed',{detail:cache}))).catch(()=>{}); }
        }, immediate ? 0 : 320);
    }
    function attach(container, entry, label) {
        if (!entry.animatedPreview) return;
        container.tabIndex = allowed() ? 0 : -1; container.setAttribute('aria-label',label);
        container.dataset.animatedPreview = 'true';
        const indicator = document.createElement('span'); indicator.className = 'preview-loader'; indicator.setAttribute('aria-hidden','true');
        container.append(indicator);
        container.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') start(container,entry); });
        container.addEventListener('pointerleave', event => {
            if (event.pointerType !== 'touch' && active?.container === container && !container.matches(':focus-visible')) stop();
        });
        container.addEventListener('focus', () => { if (container.matches(':focus-visible')) start(container,entry); });
        container.addEventListener('focusout', event => { if (!container.contains(event.relatedTarget) && active?.container === container) stop(); });
        container.addEventListener('pointerup', event => { if (event.pointerType === 'touch') { if (active?.container === container) stop(); else start(container,entry,true); } });
        container.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (active?.container === container) stop(); else start(container,entry,true); } });
    }
    function updateControls() { document.querySelectorAll('[data-animated-preview]').forEach(container => { container.tabIndex = allowed() ? 0 : -1; }); }
    reduced.addEventListener('change', () => { stop(); updateControls(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); updateControls(); });
    window.addEventListener('blur', stop); window.addEventListener('pagehide',stop);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') stop(); });
    window.storePreviews = { attach, stop, get enabled() { return enabled; }, setEnabled(value) { enabled = value; stop(); try { localStorage.setItem('noctune-store-previews',value ? 'on' : 'off'); } catch (_) {} updateControls(); } };
})();
