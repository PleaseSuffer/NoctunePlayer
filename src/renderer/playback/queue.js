// Queue entries use stable IDs: reordering never changes playlists or track indices.
function enqueuePlaylistTrack(index, next = false) {
    const track = fileEntries[index];
    if (!track) return false;
    if (externalAudioQueue.length >= 500) { statusText.textContent = noctuneI18n.t('extensions.collections.queueIsFull'); return false; }
    const metadata = parsedMetadataCache[index] || track;
    const entry = { queueId: crypto.randomUUID(), playlistId: currentPlaylistId,
        path: track.path, kind: track.kind, entryId: track.entryId, title: metadata.title || track.name,
        artist: metadata.artist || '', duration: metadata.duration || track.duration || 0 };
    if (track.kind === 'provider') entry.provider = { addonId: track.addonId, providerId: track.providerId,
        track: { ...track, id: track.trackId || track.id } };
    if (next) externalAudioQueue.unshift(entry); else externalAudioQueue.push(entry);
    window.addonEvents?.emit('queue.changed');
    return true;
}

function moveQueueEntry(id, index) {
    return window.playbackQueue.move(id, index);
}

(() => {
    const panel = document.getElementById('playback-queue');
    const toggle = document.getElementById('btn-queue');
    const toggles = [toggle, document.getElementById('mini-btn-queue')];
    const list = document.getElementById('queue-list');
    const scroller = document.getElementById('queue-list-scroll');
    const t = key => noctuneI18n.t('queue.' + key);
    let dragging = null, sourceTrack = null, returnFocus = null, visibleLimit = 100;
    let isOpen = false, motion = null;
    const node = (tag, cls, text) => { const el = document.createElement(tag); el.className = cls; if (text) el.textContent = text; return el; };
    function button(icon, label, run) {
        const el = node('button', 'queue-action'); el.type = 'button'; el.title = label; el.setAttribute('aria-label', label);
        const image = node('i', ''); image.dataset.lucide = icon; el.append(image);
        el.addEventListener('click', run); return el;
    }
    function setOpen(open, restoreFocus = true) {
        if (open === isOpen) return;
        const style = getComputedStyle(panel);
        const offset = style.getPropertyValue('--queue-motion-offset').trim();
        const from = panel.hidden ? { opacity: 0, transform: offset }
            : { opacity: style.opacity, transform: style.transform };
        const previous = motion;
        motion = null;
        previous?.cancel();
        isOpen = open;
        if (open) returnFocus = document.activeElement;
        for (const button of toggles) {
            button.setAttribute('aria-expanded', String(open));
            button.classList.toggle('active', open);
        }
        panel.hidden = false;
        panel.inert = !open;
        if (open) { render(); document.getElementById('queue-close').focus({ preventScroll: true }); }
        else if (restoreFocus && panel.contains(document.activeElement)) returnFocus?.focus({ preventScroll: true });
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) { panel.hidden = !open; return; }
        const animation = panel.animate([from, open ? { opacity: 1, transform: 'none' } : { opacity: 0, transform: offset }], {
            duration: open ? 220 : 180, easing: open ? 'ease-out' : 'ease-in', fill: 'forwards'
        });
        motion = animation;
        animation.finished.then(() => {
            if (motion !== animation) return;
            motion = null;
            panel.hidden = !isOpen;
            animation.cancel();
        }).catch(() => {}); // A reversed animation is expected to be cancelled.
    }
    function renderDragHint() {
        const hint = document.getElementById('queue-drag-hint');
        const icons = { '{handle}': 'grip-vertical', '{up}': 'chevron-up', '{down}': 'chevron-down' };
        hint.replaceChildren(...t('dragHint').split(/(\{handle\}|\{up\}|\{down\})/g).map(part => {
            if (!icons[part]) return document.createTextNode(part);
            const icon = node('i', ''); icon.dataset.lucide = icons[part]; icon.setAttribute('aria-hidden', 'true'); return icon;
        }));
        hint.setAttribute('aria-label', t('dragHintAccessible'));
        lucide.createIcons({ root: hint });
    }
    function render() {
        const entries = window.playbackQueue.view();
        const count = entries.length;
        document.getElementById('queue-badge').textContent = count || '';
        for (const button of toggles) button.setAttribute('aria-label', `${t('title')} · ${count}`);
        if (panel.hidden || panel.inert) return;
        const focus = document.activeElement?.closest('[data-queue-id]');
        const focusId = focus?.dataset.queueId, action = document.activeElement?.dataset.action;
        const playbackControls = document.getElementById('queue-current-controls');
        const playbackFocus = [...playbackControls.children].indexOf(document.activeElement);
        const scroll = scroller.scrollTop;
        list.replaceChildren();
        document.getElementById('queue-count').textContent = String(count);
        document.getElementById('queue-more').hidden = count <= visibleLimit;
        document.getElementById('queue-clear').disabled = !count;
        document.getElementById('queue-empty').hidden = !!count;
        const current = window.addonEvents.snapshot();
        const playback = document.getElementById('queue-current-controls');
        playback.replaceChildren(
            button(current.playing ? 'pause' : 'play', noctuneI18n.t(current.playing ? 'index.pause' : 'player.interface.play'), togglePlayback),
            button('skip-forward', noctuneI18n.t('player.interface.next'), () => playNext())
        );
        document.getElementById('queue-current-title').textContent = current.sessionId ? (current.title || trackTitle.textContent) : t('nothingPlaying');
        document.getElementById('queue-current-artist').textContent = current.sessionId ? current.artist : '';
        document.getElementById('queue-note').textContent = repeatMode === 1 ? t('repeatNote') : t('continueNote');
        for (const [index, entry] of entries.slice(0, visibleLimit).entries()) {
            entry.queueId ||= crypto.randomUUID();
            const row = node('li', 'queue-row'); row.dataset.queueId = entry.queueId;
            const handle = button('grip-vertical', t('move'), () => {}); handle.classList.add('queue-grip'); handle.dataset.action = 'grip'; handle.draggable = true;
            handle.addEventListener('dragstart', event => {
                dragging = entry.queueId; sourceTrack = null;
                event.dataTransfer.setData('application/x-noctune-queue', entry.queueId); event.dataTransfer.effectAllowed = 'move';
                row.classList.add('is-dragging');
            });
            handle.addEventListener('keydown', event => {
                if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); moveQueueEntry(entry.queueId, index + (event.key === 'ArrowUp' ? -1 : 1)); }
            });
            const info = node('button', 'queue-track');
            info.type = 'button';
            info.dataset.action = 'play';
            info.setAttribute('aria-label', noctuneI18n.t('player.interface.play'));
            info.addEventListener('click', () => {
                if (moveQueueEntry(entry.queueId, 0)) playNext().catch(console.error);
            });
            const track = entry.provider?.track || entry;
            const title = track.title || entry.title || String(entry.path || '').split(/[\\/]/).pop() || t('unknownTrack');
            info.append(node('span', 'queue-track-title', title), node('span', 'queue-track-artist', track.artist || t('unknownArtist')));
            info.title = [title, track.artist].filter(Boolean).join(' — ');
            const controls = node('div', 'queue-row-actions');
            for (const [key, icon, label, run, disabled] of [
                ['up', 'chevron-up', t('up'), () => moveQueueEntry(entry.queueId, index - 1), index === 0],
                ['down', 'chevron-down', t('down'), () => moveQueueEntry(entry.queueId, index + 1), index === count - 1],
                ['remove', 'x', t('remove'), () => window.playbackQueue.remove(entry.queueId), false]
            ]) {
                const control = button(icon, label, run); control.disabled = disabled; control.dataset.action = key; controls.append(control);
            }
            row.append(handle, node('span', 'queue-position', String(index + 1)), info, controls); list.append(row);
        }
        scroller.scrollTop = scroll;
        lucide.createIcons({ root: panel });
        if (playbackFocus >= 0) playbackControls.children[playbackFocus]?.focus({ preventScroll: true });
        if (focusId) {
            const rows = [...list.children];
            const row = rows.find(item => item.dataset.queueId === focusId) || rows[0];
            (row?.querySelector(`[data-action="${action || 'remove'}"]:not(:disabled)`) || row?.querySelector('button:not(:disabled)') || document.getElementById('queue-close')).focus({ preventScroll: true });
        }
    }
    document.getElementById('queue-more').addEventListener('click', () => { visibleLimit += 100; render(); });
    for (const button of toggles) button.addEventListener('click', () => setOpen(!isOpen));
    document.getElementById('queue-close').addEventListener('click', () => setOpen(false));
    document.getElementById('queue-clear').addEventListener('click', () => window.playbackQueue.clear());
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && isOpen) { event.preventDefault(); setOpen(false); } });
    document.addEventListener('pointerdown', event => {
        if (isOpen && !panel.contains(event.target) && !toggles.some(button => button.contains(event.target)) && !event.target.closest('#playlist, #context-menu, .provider-context-menu')) {
            setOpen(false, false);
        }
    });
    // Delegate so tracks loaded later and provider collections work as well.
    document.getElementById('playlist').addEventListener('pointerdown', event => {
        const row = event.target.closest('li[data-id]');
        if (row && !event.target.closest('button')) row.draggable = true;
    });
    document.getElementById('playlist').addEventListener('dragstart', event => {
        const row = event.target.closest('li[data-id]');
        if (!row) return;
        sourceTrack = { index: Number(row.dataset.id), playlistId: currentPlaylistId }; dragging = null;
        event.dataTransfer.setData('application/x-noctune-track', row.dataset.id); event.dataTransfer.effectAllowed = 'copy';
    });
    const accepts = event => dragging || sourceTrack || Array.from(event.dataTransfer?.types || []).includes('Files');
    panel.addEventListener('dragover', event => {
        if (!accepts(event)) return;
        event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = dragging ? 'move' : 'copy';
        panel.classList.add('queue-drop-active');
        list.querySelectorAll('.queue-drop-before, .queue-drop-after').forEach(el => el.classList.remove('queue-drop-before', 'queue-drop-after'));
        const row = event.target.closest('.queue-row');
        if (row) row.classList.add(event.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2 ? 'queue-drop-before' : 'queue-drop-after');
        const bounds = scroller.getBoundingClientRect();
        if (event.clientY < bounds.top + 40) scroller.scrollTop -= 18;
        else if (event.clientY > bounds.bottom - 40) scroller.scrollTop += 18;
    });
    panel.addEventListener('drop', event => {
        if (!accepts(event)) return;
        event.preventDefault(); event.stopPropagation();
        const row = event.target.closest('.queue-row');
        const entries = window.playbackQueue.view();
        let target = row ? entries.findIndex(entry => entry.queueId === row.dataset.queueId) + (row.classList.contains('queue-drop-after') ? 1 : 0) : entries.length;
        if (dragging) {
            const from = entries.findIndex(entry => entry.queueId === dragging);
            if (from >= 0) moveQueueEntry(dragging, Math.max(0, Math.min(entries.length - 1, target - (from < target ? 1 : 0))));
        } else if (sourceTrack && sourceTrack.playlistId === currentPlaylistId) {
            if (enqueuePlaylistTrack(sourceTrack.index)) { const entry = externalAudioQueue.at(-1); moveQueueEntry(entry.queueId, Math.min(target, window.playbackQueue.view().length - 1)); }
        } else if (Array.from(event.dataTransfer.types).includes('Files')) {
            const files = Array.from(event.dataTransfer.files).map(file => noctune.getDroppedFilePath(file)).filter(Boolean);
            queueAudioImport(() => openExternalAudioFiles({ files, action: 'enqueue' }));
        }
        clearDrag();
    });
    function clearDrag() {
        dragging = null; sourceTrack = null; panel.classList.remove('queue-drop-active');
        list.querySelectorAll('.is-dragging, .queue-drop-before, .queue-drop-after').forEach(el => el.classList.remove('is-dragging', 'queue-drop-before', 'queue-drop-after'));
    }
    panel.addEventListener('dragleave', event => { if (!panel.contains(event.relatedTarget)) panel.classList.remove('queue-drop-active'); });
    document.addEventListener('dragend', clearDrag);
    window.addEventListener('blur', clearDrag);
    window.addonEvents.on(event => {
        if (event.type === 'queue.changed') sendTrayState();
        if (/^(queue\.|track\.|playback\.(play|pause|ended|shuffle|repeat|stop))/.test(event.type)) render();
    });
    renderDragHint();
    noctuneI18n.onChange?.(renderDragHint);
    render();
})();
