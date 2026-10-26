(() => {
    if (!noctune.miniPlayer) return;
    let settings = { enabled: true }, visible = false, timer = null, last = '';
    const api = noctune.miniPlayer;
    function publish(force = false) {
        if (!settings.enabled && !force) return;
        const style = getComputedStyle(document.body);
        const colors = {};
        for (const key of ['--bg-color', '--container-bg', '--text-color', '--text-muted', '--accent-color', '--accent-fg', '--border-color', '--track-hover']) colors[key] = style.getPropertyValue(key).trim();
        const audio = isRadioMode ? radioAudioElement : localAudioElement;
        const image = document.getElementById('player-cover-img');
        const state = { playing: isPlaying, radio: isRadioMode, title: trackTitle.textContent, artist: trackArtist.textContent,
            position: audio?.currentTime || pausedAt || 0, duration: isRadioMode ? 0 : currentTrackDuration || 0,
            volume: Number(volumeSlider.value), muted: isMuted, shuffle: isShuffle, repeat: repeatMode,
            artwork: image?.classList.contains('loaded') ? image.src : '',
            theme: document.body.dataset.theme === 'light' ? 'light' : 'dark', colors,
            hotkeyCombos: window.getPlayerHotkeyCombos?.() || [] };
        const serialized = JSON.stringify(state);
        if (force || serialized !== last) { api.publish(state); last = serialized; }
    }
    function schedule() {
        clearInterval(timer);
        if (settings.enabled) timer = setInterval(publish, visible ? 250 : 1000);
    }
    function received(value) {
        settings = value; schedule(); window.dispatchEvent(new CustomEvent('mini-player-settings', { detail: value }));
        publish(true);
    }
    window.floatingMiniPlayer = {
        get enabled() { return settings.enabled; },
        open(replace = true) { publish(true); api.open(replace); },
        get settings() { return settings; },
        publish,
    };
    api.getSettings().then(received).catch(() => { settings.enabled = false; });
    api.onSettings(received);
    api.onVisibility(value => { visible = value; schedule(); if (visible) publish(true); });
    api.onCommand(async command => {
        try {
            if (command.action === 'expand') {
                mainPlayer.classList.remove('minimized'); miniPlayer.classList.remove('active');
            }
            else if (command.action === 'playpause') togglePlayback();
            else if (command.action === 'pause') { if (isPlaying) togglePlayback(); }
            else if (command.action === 'prev') await playPrev();
            else if (command.action === 'next') await playNext();
            else if (command.action === 'mute') toggleMute();
            else if (command.action === 'shuffle' && !isRadioMode) toggleShuffle();
            else if (command.action === 'repeat' && !isRadioMode) toggleRepeat();
            else if (command.action === 'volume') updateVolume(command.value);
            else if (command.action === 'seek') window.seekPlaybackPercent(command.value * 100);
            else if (command.action === 'hotkey') window.handlePlayerHotkey?.({ ...command.value, preventDefault() {} });
            else if (command.action === 'lyrics') {
                mainPlayer.classList.remove('minimized'); miniPlayer.classList.remove('active');
                document.getElementById('btn-lyrics')?.click();
            }
            else if (command.action === 'settings') {
                mainPlayer.classList.remove('minimized'); miniPlayer.classList.remove('active');
                document.getElementById('settings-fab').click();
                document.querySelector('[data-panel="panel-player"]').click();
                document.getElementById('mini-player-settings-title').scrollIntoView({ block: 'start' });
            }
        } catch (error) { console.warn('Команда мини-плеера:', error); }
        publish(true);
    });
    window.addEventListener('beforeunload', () => clearInterval(timer));
})();
