        const searchInput = document.getElementById('search-input');
        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            const playlistItems = playlistElem.querySelectorAll('li');

            playlistItems.forEach(li => {
                if (li.classList.contains('add-station-item')) return;
                
                const titleEl = li.querySelector('.track-title-item');
                const artistEl = li.querySelector('.track-artist-item');
                if (titleEl && artistEl) {
                    const title = titleEl.textContent.toLowerCase();
                    const artist = artistEl.textContent.toLowerCase();
                    li.style.display = (title.includes(searchTerm) || artist.includes(searchTerm)) ? 'flex' : 'none';
                }
            });
        });

        function restoreEqState() {
            const saved = appStorage.getItem('player_eq_state');
            if (!saved) { applyPreset("Обычный", false); return; }

            const state = JSON.parse(saved);
            eqToggle.checked = state.enabled;
            isEqBypassed = !state.enabled;
            openEqBtn.classList.toggle('active', state.enabled);

            if (state.selectedPreset && presets[state.selectedPreset]) { applyPreset(state.selectedPreset, false); } 
            else { applyPreset("Обычный", false); }
        }

        if ('mediaSession' in navigator) {
            // Generate a proper 2-second silent WAV so the keepalive loop is stable.
            // A 0-duration WAV loops thousands of times/sec, causing the session to flicker
            // between "playing" and "ended" — SMTC sees an unstable state and stops sending
            // play/pause commands (next/prev are unaffected because they're stateless).
            (function createKeepAlive() {
                const SR = 22050, seconds = 2;
                const n = SR * seconds;
                const buf = new ArrayBuffer(44 + n * 2);
                const d = new DataView(buf);
                const w = (off, s) => [...s].forEach((c, i) => d.setUint8(off + i, c.charCodeAt(0)));
                w(0, 'RIFF'); d.setUint32(4, 36 + n * 2, true);
                w(8, 'WAVEfmt '); d.setUint32(16, 16, true);
                d.setUint16(20, 1, true); d.setUint16(22, 1, true);
                d.setUint32(24, SR, true); d.setUint32(28, SR * 2, true);
                d.setUint16(32, 2, true); d.setUint16(34, 16, true);
                w(36, 'data'); d.setUint32(40, n * 2, true);
                // samples stay 0 — 16-bit signed PCM silence
                const url = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
                window._msKeepAlive = new Audio(url);
                window._msKeepAlive.loop   = true;
                window._msKeepAlive.volume = 0;
                window._msKeepAlive.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none;';
                document.body.appendChild(window._msKeepAlive);
            })();

            // Remove isPlaying guard — togglePlayback() checks state internally.
            // The guard was causing silent no-ops when isPlaying was stale.
            navigator.mediaSession.setActionHandler('play',  () => {
                if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
                if (!isPlaying) togglePlayback();
            });
            navigator.mediaSession.setActionHandler('pause', () => {
                if (isPlaying) togglePlayback();
            });
            navigator.mediaSession.setActionHandler('stop',          () => { stopTrack(); navigator.mediaSession.playbackState = 'none'; });
            navigator.mediaSession.setActionHandler('previoustrack', playPrev);
            navigator.mediaSession.setActionHandler('nexttrack',     playNext);
            navigator.mediaSession.setActionHandler('seekto', (details) => {
                if (isRadioMode || !localAudioElement) return;
                const target = details.seekTime ?? 0;
                if (isPlaying) {
                    startSourceAt(target, false);
                } else {
                    pausedAt = target;
                    localAudioElement.currentTime = target;
                    updateSMTCPosition(target);
                }
            });
            navigator.mediaSession.setActionHandler('seekbackward', (details) => {
                if (isRadioMode || !localAudioElement) return;
                const skip = details.seekOffset ?? 10;
                const target = Math.max(0, (localAudioElement.currentTime || pausedAt) - skip);
                if (isPlaying) startSourceAt(target, false);
                else { pausedAt = target; localAudioElement.currentTime = target; updateSMTCPosition(target); }
            });
            navigator.mediaSession.setActionHandler('seekforward', (details) => {
                if (isRadioMode || !localAudioElement) return;
                const skip = details.seekOffset ?? 10;
                const dur = currentTrackDuration || localAudioElement.duration || 0;
                const target = Math.min(dur, (localAudioElement.currentTime || pausedAt) + skip);
                if (isPlaying) startSourceAt(target, false);
                else { pausedAt = target; localAudioElement.currentTime = target; updateSMTCPosition(target); }
            });
        }

        window.addEventListener('DOMContentLoaded', async () => {
            loadPlaylistsFromStorage();

            try {
                const version = await noctune.getAppVersion();
                try {
                    const tech = await noctune.getTechVersions();
                    const ev = document.getElementById('about-electron-version');
                    const sv = document.getElementById('about-store-version');
                    const nv = document.getElementById('about-node-version');
                    if (ev) ev.textContent = 'v' + tech.electron;
                    if (sv) sv.textContent = 'v' + tech.electronStore;
                    if (nv) nv.textContent = 'v' + tech.node;
                } catch(e) {}
                document.getElementById('app-version').textContent = `v${version}`;
            } catch (e) {
                document.getElementById('app-version').textContent = 'v1.0.0 (dev)';
            }

            const savedPath = await noctune.getSavedDirectory();
            if (savedPath && userPlaylists.length === 0) {
                const fallbackPl = {
                    id: 'pl_default',
                    name: "Основная папка",
                    type: 'folder',
                    path: savedPath,
                    stations: []
                };
                userPlaylists.push(fallbackPl);
                savePlaylistsToStorage();
                renderPlaylistsDropdown();
                selectPlaylist(fallbackPl.id);
            } else if(userPlaylists.length > 0) {
                // Restore last playlist and track
                const rememberToggle = document.getElementById('setting-remember-track');
                const shouldRemember = !rememberToggle || rememberToggle.checked;
                const lastPlId = appStorage.getItem('player_last_playlist');
                const lastTrackOrder = appStorage.getItem('player_last_track_order');
                
                if (shouldRemember && lastPlId && userPlaylists.find(p => p.id === lastPlId)) {
                    await selectPlaylist(lastPlId);
                    if (lastTrackOrder !== null) {
                        const idx = parseInt(lastTrackOrder);
                        if (!isNaN(idx) && idx >= 0 && idx < playlistOrder.length) {
                            const absoluteTrackId = playlistOrder[idx];
                            const activeLi = playlistElem.querySelector(`li[data-id="${absoluteTrackId}"]`);
                            if (activeLi) {
                                activeLi.classList.add('active');
                                activeLi.scrollIntoView({ block: 'nearest' });
                                currentIndex = idx;
                            }

                            const entry = fileEntries[absoluteTrackId];

                            // Восстанавливаем название и автора из fileEntries
                            if (entry && entry.kind !== 'radio') {
                                const displayName = entry.name.replace(/\.[^/.]+$/, '');
                                const metaTitle   = entry.meta?.title  || displayName;
                                const metaArtist  = entry.meta?.artist || '';
                                trackTitle.textContent      = metaTitle;
                                trackArtist.textContent     = metaArtist;
                                miniTrackTitle.textContent  = metaArtist
                                    ? `${metaArtist} — ${metaTitle}`
                                    : metaTitle;
                                triggerMiniMarquee?.();
                                statusText.textContent = 'Пауза';
                            }

                            // Восстанавливаем позицию
                            const savedPos = parseFloat(appStorage.getItem('player_last_track_position') || '0');
                            if (savedPos > 0) {
                                pausedAt = savedPos;
                                if (entry && entry.kind !== 'radio') {
                                    const tmpAudio = new Audio();
                                    tmpAudio.preload = 'metadata';
                                    tmpAudio.addEventListener('loadedmetadata', () => {
                                        const dur = tmpAudio.duration;
                                        if (isFinite(dur) && savedPos < dur) {
                                            currentTrackDuration = dur;
                                            timeTotal.textContent  = formatTime(dur);
                                            timeCurrent.textContent = formatTime(savedPos);
                                            const pct = (savedPos / dur) * 100;
                                            progressFill.style.width = `${pct}%`;
                                            document.getElementById('mini-progress-fill').style.width = `${pct}%`;
                                            // Если метаданные ещё не были загружены — обновим из тега
                                            if (tmpAudio._meta) {
                                                if (!entry.meta?.title) trackTitle.textContent = tmpAudio._meta.title || trackTitle.textContent;
                                                if (!entry.meta?.artist) trackArtist.textContent = tmpAudio._meta.artist || trackArtist.textContent;
                                            }
                                        }
                                        tmpAudio.src = '';
                                    }, { once: true });
                                    tmpAudio.src = `file://${entry.path.replace(/\\/g, '/')}`;
                                }
                            }

                            // Авто-воспроизведение если было включено и настройка разрешает
                            const restorePlayback = document.getElementById('setting-restore-playback');
                            const wasPlaying = appStorage.getItem('player_was_playing') === '1';
                            if (restorePlayback?.checked && wasPlaying && entry && entry.kind !== 'radio') {
                                // Небольшая задержка чтобы AudioContext успел инициализироваться
                                setTimeout(() => playTrack(idx, savedPos > 0 ? savedPos : 0), 300);
                            }
                        }
                    }
                } else {
                    selectPlaylist(userPlaylists[0].id);
                }
            }
        });

        renderPresetButtons();

        const savedTheme = appStorage.getItem('player_theme');
        if (savedTheme === 'dark') {
            document.body.setAttribute('data-theme', 'dark');
            themeToggle.innerHTML = '<i data-lucide="sun"></i>';
        }

        const savedVolume = appStorage.getItem('player_volume');
        if (savedVolume !== null) { updateVolume(parseFloat(savedVolume), false); }

        if (appStorage.getItem('player_shuffle') === '1') {
            isShuffle = true;
            btnShuffle.classList.add('active');
            miniBtnShuffle.classList.add('active');
        }
        const savedRepeat = parseInt(appStorage.getItem('player_repeat') || '0');
        if (savedRepeat >= 0 && savedRepeat <= 2) repeatMode = savedRepeat;
        updateRepeatUI();

        restoreEqState();
        lucide.createIcons();

