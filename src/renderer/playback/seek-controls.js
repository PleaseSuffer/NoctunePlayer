(function initSeekControls() {
    const controls = () => ['progress-wrapper', 'mini-progress-track', 'lyrics-seek'].map(id => document.getElementById(id)).filter(Boolean);
    function render(percent) {
        for (const id of ['progress-fill', 'mini-progress-fill']) {
            const fill = document.getElementById(id);
            if (fill) fill.style.width = percent + '%';
        }
        const range = document.getElementById('lyrics-seek');
        if (range) { range.value = percent; range.parentElement?.style.setProperty('--seek-progress', percent + '%'); }
    }
    function duration() {
        const value = currentTrackDuration || localAudioElement?.duration;
        return !isRadioMode && !_trackLoading && localAudioElement?.getAttribute('src') && Number.isFinite(value) && value > 0 ? value : 0;
    }
    window.seekPlaybackPercent = percent => {
        const total = duration();
        if (!total || !Number.isFinite(percent)) return;
        percent = Math.max(0, Math.min(100, percent));
        const position = total * percent / 100;
        if (isPlaying) startSourceAt(position, false);
        else { pausedAt = position; localAudioElement.currentTime = position; updateSMTCPosition(position); }
        render(percent);
        if (typeof timeCurrent !== 'undefined') timeCurrent.textContent = formatTime(position);
        if (typeof updateWaveformProgress === 'function') updateWaveformProgress(percent / 100);
    };
    window.attachPlaybackSeek = (element, afterSeek = () => {}) => {
        let gesture = null;
        const setDragging = on => controls().forEach(control => {
            control.classList.toggle('seek-dragging', on);
            control.parentElement?.classList.toggle('seek-dragging', on);
        });
        const current = () => gesture && gesture.audio === localAudioElement
            && gesture.src === localAudioElement?.getAttribute('src')
            && gesture.token === (typeof _loadToken === 'undefined' ? null : _loadToken) && duration();
        const seekAt = event => {
            const rect = element.getBoundingClientRect();
            if (rect.width <= 0) return;
            window.seekPlaybackPercent((event.clientX - rect.left) / rect.width * 100);
            afterSeek();
        };
        const finish = event => {
            if (!gesture || event.pointerId !== gesture.id) return;
            gesture = null; setDragging(false);
            if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
        };
        element.addEventListener('pointerdown', event => {
            if (gesture || event.button !== 0 || event.isPrimary === false || !duration()) return;
            event.preventDefault(); element.focus();
            gesture = { id: event.pointerId, x: event.clientX, audio: localAudioElement, src: localAudioElement.getAttribute('src'), token: typeof _loadToken === 'undefined' ? null : _loadToken };
            element.setPointerCapture(event.pointerId);
            seekAt(event);
        });
        element.addEventListener('pointermove', event => {
            if (!gesture || event.pointerId !== gesture.id) return;
            if (!current()) { finish(event); return; }
            if (!gesture.moved && Math.abs(event.clientX - gesture.x) < 2) return;
            gesture.moved = true;
            setDragging(true); seekAt(event);
        });
        element.addEventListener('pointerup', event => {
            if (gesture && event.pointerId === gesture.id && current() && gesture.moved) seekAt(event);
            finish(event);
        });
        element.addEventListener('pointercancel', finish);
        element.addEventListener('lostpointercapture', finish);
        if (element.type === 'range') element.addEventListener('input', () => {
            window.seekPlaybackPercent(Number(element.value)); afterSeek();
        });
    };
})();
