        // Последовательные затухание и нарастание, без перекрытия треков.
        let crossfadeEnabled = false;
        let crossfadeOutDuration = 3;
        let crossfadeInDuration = 0;
        let crossfadeIntensity = 1;
        let _trackLoading = false;
        let _navigationToken = 0;
        let _trackEndHandledToken = -1;
        let _endFadeActive = false;

        function fadeEnvelope(progress) {
            return Math.pow(Math.max(0, Math.min(1, progress)), crossfadeIntensity);
        }

        function applyTrackEndFade() {
            if (!window.volumeNode || !audioCtx || isRadioMode || !localAudioElement) return;
            const duration = currentTrackDuration || localAudioElement.duration;
            const remaining = duration - localAudioElement.currentTime;
            const fading = crossfadeEnabled && crossfadeOutDuration > 0 && isFinite(duration) && duration > 0 && remaining <= crossfadeOutDuration;
            if (!fading && !_endFadeActive) return;
            const factor = fading ? fadeEnvelope(remaining / crossfadeOutDuration) : 1;
            const gain = isMuted ? 0 : volumeSliderToGain(parseFloat(volumeSlider.value)) * factor;
            window.volumeNode.gain.cancelScheduledValues(audioCtx.currentTime);
            window.volumeNode.gain.setValueAtTime(gain, audioCtx.currentTime);
            _endFadeActive = fading;
        }

        // ── Интеграция: Last.fm (скробблинг) ────────────────────────────────
        // Состояние сбрасывается при каждой смене трека (lastfmResetTrackState),
        // "now playing" уходит один раз на трек (дедуп по artist|title — повторные
        // паузы/резюме одного трека не долбят API), а сам скробл срабатывает один
        // раз, когда позиция пересекает порог по правилам Last.fm: трек короче 30с
        // не скробблится, иначе порог = min(половина длительности, 4 минуты).
        let _lastfmTrackMeta = null;
        let _lastfmScrobbled = false;
        let _lastfmNowPlayingSentFor = null;

        function lastfmResetTrackState(meta) {
            _lastfmTrackMeta = meta;
            _lastfmScrobbled = false;
            _lastfmNowPlayingSentFor = null;
        }

        function pushLastfmNowPlaying() {
            if (!window.lastfmEnabled || !window.lastfmConnected || window.lastfmNowPlayingEnabled === false) return;
            if (isRadioMode || !isPlaying || !_lastfmTrackMeta || !_lastfmTrackMeta.artist || !_lastfmTrackMeta.title) return;
            const key = _lastfmTrackMeta.artist + '|' + _lastfmTrackMeta.title;
            if (_lastfmNowPlayingSentFor === key) return;
            _lastfmNowPlayingSentFor = key;
            noctune.lastfm.nowPlaying({
                artist: _lastfmTrackMeta.artist,
                track: _lastfmTrackMeta.title,
                album: _lastfmTrackMeta.album || undefined,
                duration: _lastfmTrackMeta.duration || undefined,
            }).catch(() => {});
        }

        function maybeLastfmScrobble(current) {
            if (!window.lastfmEnabled || !window.lastfmConnected || window.lastfmScrobbleEnabled === false) return;
            if (_lastfmScrobbled || isRadioMode || !_lastfmTrackMeta || !_lastfmTrackMeta.artist || !_lastfmTrackMeta.title) return;
            const duration = _lastfmTrackMeta.duration || 0;
            if (duration < 30) return; // короткие треки Last.fm не скробблит
            const threshold = Math.min(duration / 2, 240);
            if (current < threshold) return;
            _lastfmScrobbled = true;
            noctune.lastfm.scrobble({
                artist: _lastfmTrackMeta.artist,
                track: _lastfmTrackMeta.title,
                album: _lastfmTrackMeta.album || undefined,
                duration: duration,
                // Момент "начала" трека восстанавливаем от текущей позиции —
                // достаточно точно для API и не требует хранить реальный wall-clock
                // старт (который сдвигался бы при каждой паузе).
                timestamp: Math.floor(Date.now() / 1000) - Math.floor(current),
            }).catch(() => {});
        }

        // ── ReplayGain ───────────────────────────────────────────────────────
        // window._currentTrackReplayGainDb хранит значение из тега ТЕКУЩЕГО
        // трека (или null, если тега нет) — записывается сразу после чтения
        // метаданных в playTrack(), задолго до того как граф Web Audio вообще
        // может существовать (initAudioEngine() ленивый, создаётся по первому
        // воспроизведению). Поэтому применение отделено от чтения: эта функция
        // безопасно no-op'ает, если узел ещё не создан, и вызывается заново
        // сразу после его создания в initAudioEngine().
        window._currentTrackReplayGainDb = null;
        function applyReplayGainNow() {
            if (!window.replayGainNode || !audioCtx) return;
            const enabled = window.replayGainEnabled && !isRadioMode;
            const db = enabled ? window._currentTrackReplayGainDb : null;
            const gain = (typeof db === 'number' && isFinite(db)) ? Math.pow(10, db / 20) : 1;
            window.replayGainNode.gain.setValueAtTime(gain, audioCtx.currentTime);
        }

        // Включение/выключение лимитера уже во время работающего аудиографа
        // (переключатель в настройках → Эквалайзер → Лимитер). ratio=1
        // математически означает «без компрессии при любом входном уровне» —
        // то есть полностью прозрачный проход независимо от threshold/knee,
        // поэтому узел можно оставить в графе и не перестраивать соединения.
        function applyLimiterEnabled(enabled) {
            if (!window.limiterNode || !audioCtx) return;
            if (enabled) {
                const limRatio = appStorage.getItem('setting_limiter_ratio');
                window.limiterNode.ratio.setValueAtTime(limRatio !== null ? parseFloat(limRatio) : 20, audioCtx.currentTime);
            } else {
                window.limiterNode.ratio.setValueAtTime(1, audioCtx.currentTime);
            }
        }

        function applyChannelMode(mode) {
            if (!window.chSplitter || !window.chMerger) return;
            // Disconnect all existing splitter→merger connections
            try { window.chSplitter.disconnect(window.chMerger); } catch(e) {}
            switch (mode) {
                case 'stereo':
                    window.chSplitter.connect(window.chMerger, 0, 0); // L→L
                    window.chSplitter.connect(window.chMerger, 1, 1); // R→R
                    break;
                case 'mono':
                    window.chSplitter.connect(window.chMerger, 0, 0); // L→L (sum)
                    window.chSplitter.connect(window.chMerger, 1, 0); // R→L (sum)
                    window.chSplitter.connect(window.chMerger, 0, 1); // L→R (sum)
                    window.chSplitter.connect(window.chMerger, 1, 1); // R→R (sum)
                    break;
                case 'left':
                    window.chSplitter.connect(window.chMerger, 0, 0); // L→L
                    window.chSplitter.connect(window.chMerger, 0, 1); // L→R
                    break;
                case 'right':
                    window.chSplitter.connect(window.chMerger, 1, 0); // R→L
                    window.chSplitter.connect(window.chMerger, 1, 1); // R→R
                    break;
                case 'swap':
                    window.chSplitter.connect(window.chMerger, 1, 0); // R→L
                    window.chSplitter.connect(window.chMerger, 0, 1); // L→R
                    break;
                default:
                    window.chSplitter.connect(window.chMerger, 0, 0);
                    window.chSplitter.connect(window.chMerger, 1, 1);
            }
        }

        function initAudioEngine() {
            if (audioCtx) return;
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            
            window.preampNode = audioCtx.createGain();
            const preampSlider = document.querySelector(`.eq-slider[data-index="preamp"]`);
            const preampVal = preampSlider ? parseFloat(preampSlider.value) : 0;
            window.preampNode.gain.value = isEqBypassed ? 1 : Math.pow(10, preampVal / 20);

            // ReplayGain — отдельный узел ПЕРЕД преампом/эквалайзером, чтобы
            // выравнивание громкости трека не искажалось цветовой окраской EQ.
            // Для радио остаётся 1 (0dB) всегда — у потоков нет ReplayGain-тега.
            window.replayGainNode = audioCtx.createGain();
            window.replayGainNode.gain.value = 1;
            window.replayGainNode.connect(window.preampNode);
            applyReplayGainNow();

            let lastNode = window.preampNode;

            frequencies.forEach((freq, index) => {
                const filter = audioCtx.createBiquadFilter();
                filter.type = 'peaking';
                filter.frequency.value = freq;
                filter.Q.value = 1.0;
                
                const slider = document.querySelector(`.eq-slider[data-index="${index}"]`);
                filter.gain.value = slider ? parseFloat(slider.value) : 0;
                
                lastNode.connect(filter);
                eqFilters.push(filter);
                lastNode = filter;
            });

            // Лимитер — DynamicsCompressorNode как предохранитель от хрипов/
            // клиппинга. Стоит СРАЗУ ПОСЛЕ всей цепочки, которая может
            // поднять уровень выше 0dBFS: ReplayGain (может задрать тихие
            // треки), преамп (+12dB) и все 12 полос EQ (тоже до +12dB каждая,
            // и при одновременном подъёме нескольких соседних полос суммарный
            // подъём на конкретной частоте может оказаться заметно больше,
            // чем показывает любой отдельный слайдер — классика для любого
            // параметрического эквалайзера). Настройки — "прозрачный
            // брикволл": быстрая атака ловит транзиенты до клиппинга, порог
            // с запасом до нуля, высокий ratio почти без слышимого "накачивания".
            window.limiterNode = audioCtx.createDynamicsCompressor();
            // Значения читаются из сохранённых настроек (appStorage), если
            // пользователь их менял — иначе используются дефолты ниже. И то,
            // и то — настраивается во вкладке "Эквалайзер" (см. settings.js).
            const limDefaults = { threshold: -3, knee: 6, ratio: 20, attack: 0.003, release: 0.15 };
            const limThreshold = appStorage.getItem('setting_limiter_threshold');
            const limKnee = appStorage.getItem('setting_limiter_knee');
            const limRatio = appStorage.getItem('setting_limiter_ratio');
            const limAttack = appStorage.getItem('setting_limiter_attack'); // хранится в мс
            const limRelease = appStorage.getItem('setting_limiter_release'); // хранится в мс
            window.limiterNode.threshold.value = limThreshold !== null ? parseFloat(limThreshold) : limDefaults.threshold;
            window.limiterNode.knee.value = limKnee !== null ? parseFloat(limKnee) : limDefaults.knee;
            window.limiterNode.ratio.value = limRatio !== null ? parseFloat(limRatio) : limDefaults.ratio;
            window.limiterNode.attack.value = limAttack !== null ? parseFloat(limAttack) / 1000 : limDefaults.attack;
            window.limiterNode.release.value = limRelease !== null ? parseFloat(limRelease) / 1000 : limDefaults.release;
            // Лимитер можно полностью выключить — узел остаётся в графе (см.
            // applyLimiterEnabled), но при создании графа стартовое значение
            // ratio должно сразу учитывать сохранённое состояние тумблера.
            const limEnabledSetting = appStorage.getItem('setting_limiter_enabled');
            const limiterEnabledAtInit = limEnabledSetting === null ? true : limEnabledSetting === '1';
            if (!limiterEnabledAtInit) window.limiterNode.ratio.value = 1;
            lastNode.connect(window.limiterNode);
            lastNode = window.limiterNode;

            analyzer = audioCtx.createAnalyser();
            analyzer.fftSize = 512; 
            
            lastNode.connect(analyzer);

            // Balance (StereoPanner) + channel-mode (Splitter/Merger) nodes
            window.pannerNode = audioCtx.createStereoPanner();
            const savedBal = appStorage.getItem('setting_balance');
            window.pannerNode.pan.value = savedBal !== null ? (parseFloat(savedBal) - 50) / 50 : 0;

            window.chSplitter = audioCtx.createChannelSplitter(2);
            window.chMerger   = audioCtx.createChannelMerger(2);
            // Default: stereo routing L→L, R→R
            window.chSplitter.connect(window.chMerger, 0, 0);
            window.chSplitter.connect(window.chMerger, 1, 1);
            window.chMerger.connect(window.pannerNode);
            window.pannerNode.connect(audioCtx.destination);

            // Apply saved channel mode
            const savedPBMode = appStorage.getItem('setting_pb_mode');
            if (savedPBMode && savedPBMode !== 'stereo') applyChannelMode(savedPBMode);

            // Initial fallback connection (replaced when volumeNode is created)
            analyzer.connect(window.chSplitter);

            document.querySelectorAll('.eq-slider').forEach(slider => {
                slider.addEventListener('input', (e) => {
                    const idx = e.target.getAttribute('data-index');
                    const val = parseFloat(e.target.value);
                    // Зеркалим во все копии этого слайдера (модал + вкладка
                    // "Эквалайзер" в Настройках) и обе подписи под ним.
                    writeEqBandUI(idx, val);

                    if (idx === 'preamp') {
                        if (!isEqBypassed && window.preampNode && audioCtx) {
                            window.preampNode.gain.setValueAtTime(Math.pow(10, val / 20), audioCtx.currentTime);
                        }
                    } else {
                        if (!isEqBypassed && eqFilters[idx] && audioCtx) {
                            eqFilters[idx].gain.setValueAtTime(val, audioCtx.currentTime);
                        }
                    }
                });
            });

            visualize();
        }

        function applyPreset(name, save = true) {
            const values = presets[name];
            if (!values) return;
            currentSelectedPresetName = name;
            
            document.querySelectorAll('.preset-btn').forEach(b => {
                b.classList.toggle('active', b.textContent.trim() === name);
            });

            const preampVal = values[0];
            writeEqBandUI('preamp', preampVal);
            if (!isEqBypassed && window.preampNode && audioCtx) {
                window.preampNode.gain.setValueAtTime(Math.pow(10, preampVal / 20), audioCtx.currentTime);
            }

            for (let i = 0; i < 12; i++) {
                const val = values[i + 1];
                writeEqBandUI(i, val);
                if (!isEqBypassed && eqFilters[i] && audioCtx) {
                    eqFilters[i].gain.setValueAtTime(val, audioCtx.currentTime);
                }
            }

            if (save) saveEqState();
        }

        eqToggle.addEventListener('change', (e) => {
            isEqBypassed = !e.target.checked;
            openEqBtn.classList.toggle('active', !isEqBypassed);
            // Держим тумблер во вкладке "Эквалайзер" (Настройки) в курсе — на
            // случай если переключили именно этот, основной eq-toggle
            // (обратное направление уже обрабатывает equalizer.js).
            if (typeof eqToggleSettings !== 'undefined' && eqToggleSettings) {
                eqToggleSettings.checked = e.target.checked;
            }

            if (window.preampNode && audioCtx) {
                const preampSlider = document.querySelector(`.eq-slider[data-index="preamp"]`);
                const targetGain = isEqBypassed ? 1 : Math.pow(10, parseFloat(preampSlider.value) / 20);
                window.preampNode.gain.setValueAtTime(targetGain, audioCtx.currentTime);
            }

            eqFilters.forEach((filter, i) => {
                const slider = document.querySelector(`.eq-slider[data-index="${i}"]`);
                const targetGain = isEqBypassed ? 0 : parseFloat(slider.value);
                if (audioCtx) filter.gain.setValueAtTime(targetGain, audioCtx.currentTime);
            });
            
            saveEqState();
        });

        function formatTime(seconds) {
            if (isNaN(seconds) || !isFinite(seconds)) return "0:00";
            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
        }

        async function startRadioMetadataReader(streamUrl, stationName) {
            const metadataToken = _loadToken;
            try {
                if (radioMetadataAbort) {
                    radioMetadataAbort.abort();
                }

                const controller = new AbortController();
                radioMetadataAbort = controller;
                currentRadioTrack = '';

                const response = await fetch(streamUrl, {
                    headers: {
                        'Icy-MetaData': '1'
                    },
                    mode: 'cors',
                    signal: controller.signal
                });

                const metaInt = parseInt(response.headers.get('icy-metaint'));

                if (!metaInt) {
                    console.log('ICY metadata не поддерживается');
                    return;
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder('utf-8');

                let audioBytesRead = 0;

                while (true) {
                    const { value, done } = await reader.read();

                    if (done || controller.signal.aborted || metadataToken !== _loadToken || !isRadioMode) break;

                    let offset = 0;

                    while (offset < value.length) {

                        const remaining = metaInt - audioBytesRead;
                        const chunkRemaining = value.length - offset;

                        if (chunkRemaining < remaining) {
                            audioBytesRead += chunkRemaining;
                            offset += chunkRemaining;
                            continue;
                        }

                        offset += remaining;
                        audioBytesRead = 0;

                        const metaLength = value[offset] * 16;
                        offset++;

                        if (metaLength > 0) {
                            const metaBytes = value.slice(offset, offset + metaLength);
                            const metaString = decoder.decode(metaBytes);

                            const match = metaString.match(/StreamTitle='([^']*)'/);

                            if (match) {

                                const rawTitle = match[1].trim();

                                if (rawTitle !== currentRadioTrack) {

                                    currentRadioTrack = rawTitle;

                                    let artist = '';
                                    let title = rawTitle;

                                    if (rawTitle.includes(' - ')) {
                                        const parts = rawTitle.split(' - ');
                                        artist = parts[0].trim();
                                        title = parts.slice(1).join(' - ').trim();
                                    }

                                    if (window.setLyricsTrack) window.setLyricsTrack({ radio: true, stationName, artist, title }, metadataToken);
                                    trackTitle.textContent = title;
                                    trackArtist.textContent = artist;

                                    miniTrackTitle.textContent =
                                        [artist, title].filter(Boolean).join(' — ');

                                    triggerMiniMarquee();

                                    statusText.textContent =
                                        'Сейчас играет на радио';

                                    if ('mediaSession' in navigator) {
                                        navigator.mediaSession.metadata = new MediaMetadata({
                                            title: title,
                                            artist: artist,
                                            album: stationName || 'Noctune Radio'
                                        });
                                    }
                                    pushDiscordActivity();
                                }
                            }
                        }

                        offset += metaLength;
                    }
                }

            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.error('Ошибка ICY metadata:', err);
                }
            }
        }

        let _lastSavedPosition = 0;
        let _positionSaveTimer = 0;
        function maybeSavePosition(current) {
            const rememberToggle = document.getElementById('setting-remember-track');
            if (rememberToggle && !rememberToggle.checked) return;
            const now = Date.now();
            if (now - _positionSaveTimer >= 5000) {
                _positionSaveTimer = now;
                _lastSavedPosition = current;
                appStorage.setItem('player_last_track_position', current.toFixed(2));
            }
        }

        let progressInterval = null;
        let _smtcSyncCounter = 0;
        function startProgressUpdater() {
            if(progressInterval) clearInterval(progressInterval);
            progressInterval = setInterval(() => {
                if (!isPlaying) return;
                
                if (isRadioMode) {
                    timeCurrent.textContent = "--:--";
                    progressFill.style.width = "0%";
                    document.getElementById('mini-progress-fill').style.width = "0%";
                    return;
                }

                // Используем HTMLAudioElement как источник истины о позиции
                const current = localAudioElement ? localAudioElement.currentTime : 0;
                const duration = currentTrackDuration || (localAudioElement ? localAudioElement.duration : 0);

                timeCurrent.textContent = formatTime(current);
                maybeSavePosition(current);
                maybeLastfmScrobble(current);
                if (typeof updateWaveformProgress === 'function' && duration > 0) updateWaveformProgress(current / duration);

                // Resync SMTC position every ~10 s to correct drift
                _smtcSyncCounter++;
                if (_smtcSyncCounter >= 40) { _smtcSyncCounter = 0; updateSMTCPosition(current); }
                
                if (duration && duration > 0 && isFinite(duration)) {
                    const pct = (current / duration) * 100;
                    progressFill.style.width = `${Math.min(pct, 100)}%`;
                    document.getElementById('mini-progress-fill').style.width = `${Math.min(pct, 100)}%`;
                    
                    applyTrackEndFade();

                }
            }, 250);
        }

        function stopTrack() {
            // Отменяем также асинхронные загрузки и обработчики старого трека.
            _loadToken++;
            if (typeof noctune !== 'undefined') noctune.metadata?.cancelCover?.();
            if (typeof cancelTrackWaveform === 'function') cancelTrackWaveform();
            if (window.clearRadioArtwork) window.clearRadioArtwork();
            _navigationToken++;
            _trackLoading = false;
            _endFadeActive = false;
            clearInterval(progressInterval);
            progressInterval = null;
            if (audioBufferSource) {
                try { audioBufferSource.stop(); } catch(e){}
                audioBufferSource.disconnect();
                audioBufferSource = null;
            }
            if (localAudioElement) {
                localAudioElement.pause();
                localAudioElement.removeAttribute('src');
                localAudioElement.load?.();
            }
            if (radioAudioElement) {
                radioAudioElement.pause();
                radioAudioElement.removeAttribute('src');
                radioAudioElement.load?.();
            }
            if (radioMetadataAbort) {
                radioMetadataAbort.abort();
                radioMetadataAbort = null;
            }
            isPlaying = false;
        }

        // Tooltip при наведении на полосу прогресса
        function attachTooltip(wrapper, tooltip) {
            wrapper.addEventListener('mousemove', (e) => {
                if (isRadioMode) {
                    tooltip.style.opacity = '0';
                    return;
                }

                const duration = currentTrackDuration || (localAudioElement ? localAudioElement.duration : 0);
                if (!duration || isNaN(duration) || !isFinite(duration)) return;

                const rect = wrapper.getBoundingClientRect();
                let clickX = e.clientX - rect.left;
                
                if (clickX < 0) clickX = 0;
                if (clickX > rect.width) clickX = rect.width;

                const percent = clickX / rect.width;
                const timeAtCursor = percent * duration;

                tooltip.textContent = formatTime(timeAtCursor);
                tooltip.style.left = `${percent * 100}%`;
                tooltip.style.opacity = '1';
            });

            wrapper.addEventListener('mouseleave', () => {
                tooltip.style.opacity = '0';
            });
        }

        // Инициализация тултипов для основного и мини-плеера
        attachTooltip(progressWrapper, document.getElementById('seek-tooltip'));
        attachTooltip(document.getElementById('mini-progress-track'), document.getElementById('mini-seek-tooltip'));

        function attachVolumeTooltip(slider, tooltip) {
            function show(e) {
                const rect = slider.getBoundingClientRect();
                // Default Chromium range thumb is ~16 px wide; the track runs
                // from thumbRadius to (rect.width − thumbRadius), so we subtract
                // the radius from both the cursor offset and the divisor.
                const thumbRadius = 8;
                const usable = rect.width - thumbRadius * 2;
                const x = e.clientX - rect.left - thumbRadius;
                const pct = Math.round(Math.max(0, Math.min(1, x / usable)) * 100);
                tooltip.textContent = pct + '%';
                tooltip.style.left = e.clientX + 'px';
                tooltip.style.top  = (e.clientY - 10) + 'px';
                tooltip.classList.add('visible');
            }
            slider.addEventListener('mousemove',  show);
            slider.addEventListener('mouseenter', show);
            slider.addEventListener('mouseleave', () => tooltip.classList.remove('visible'));
        }
        attachVolumeTooltip(volumeSlider,     document.getElementById('vol-tooltip'));
        attachVolumeTooltip(miniVolumeSlider, document.getElementById('mini-vol-tooltip'));

        function triggerMiniMarquee() {
            miniTrackTitle.classList.remove('animate');
            setTimeout(() => {
                const containerWidth = miniMarqueeContainer.offsetWidth;
                const textWidth = miniTrackTitle.scrollWidth;
                if (textWidth > containerWidth) {
                    const originalText = miniTrackTitle.textContent;
                    miniTrackTitle.innerHTML = `${originalText} ㅤㅤㅤㅤㅤㅤ ${originalText}`;
                    miniTrackTitle.classList.add('animate');
                }
            }, 50);
        }

        async function playTrack(orderIndex, startPosition = 0) {
            if (!Number.isInteger(orderIndex) || orderIndex < 0 || orderIndex >= playlistOrder.length || !fileEntries[playlistOrder[orderIndex]]) return;

            // Синхронизируем позицию курсора в виртуальном плейлисте
            if (isShuffle) syncShufflePos(orderIndex);

            initAudioEngine();

            stopTrack();
            const myToken = _loadToken;
            if (window.setLyricsTrack) window.setLyricsTrack(null, myToken);

            // Save last track
            const rememberToggle = document.getElementById('setting-remember-track');
            if (!rememberToggle || rememberToggle.checked) {
                appStorage.setItem('player_last_playlist', currentPlaylistId || '');
                appStorage.setItem('player_last_track_order', orderIndex);
                appStorage.setItem('player_last_track_position', '0');
            }
            // Lock active playlist to the one currently playing
            activePlaylistId = currentPlaylistId;

            const items = playlistElem.querySelectorAll('li');
            items.forEach(li => li.classList.remove('active'));
            
            currentIndex = orderIndex;
            const absoluteTrackId = playlistOrder[currentIndex];
            const activeLi = playlistElem.querySelector(`li[data-id="${absoluteTrackId}"]`);
            if (activeLi) activeLi.classList.add('active');

            const entry = fileEntries[absoluteTrackId];
            
            if (entry.kind === 'radio') {
                isRadioMode = true;
                if (window.setLyricsTrack) window.setLyricsTrack({ radio: true, stationName: entry.name, artist: '', title: '' }, myToken);
                statusText.textContent = 'Подключение к потоку...';
                trackTitle.textContent = entry.name;
                trackArtist.textContent = "Интернет Радиостанция";
                miniTrackTitle.textContent = `Radio — ${entry.name}`;
                triggerMiniMarquee();

                // Clear cover for radio
                const pci = document.getElementById('player-cover-img');
                const pcp = document.getElementById('player-cover-placeholder');
                if (pci) { pci.classList.remove('loaded'); pci.src = ''; }
                if (pcp) pcp.style.display = '';

                timeTotal.textContent = "Live";
                timeCurrent.textContent = "--:--";

                if ('mediaSession' in navigator) {
                    navigator.mediaSession.metadata = new MediaMetadata({
                        title: entry.name,
                        artist: "Интернет Радио",
                        album: 'Noctune Radio'
                    });
                }
                _discordRadioStartedAt = Date.now();
                lastfmResetTrackState(null); // радио не скробблим — см. пометку в карточке настроек
                window._currentTrackReplayGainDb = null;
                applyReplayGainNow();
                if (typeof renderWaveform === 'function') renderWaveform(null); // нет фиксированной длины потока — waveform не строим

                try {
                    if (!radioAudioElement) {
                        radioAudioElement = new Audio();
                        radioAudioElement.crossOrigin = "anonymous";
                        // Громкость самого элемента всегда оставляем на 1 (unity) — поток
                        // идёт через тот же Web Audio граф (window.volumeNode), что и
                        // локальные треки, и громкостью управляет именно этот узел.
                        // Если параллельно задавать ещё и radioAudioElement.volume, оба
                        // множителя применятся последовательно и радио станет вдвойне
                        // тише локальной музыки при одном и том же положении слайдера.
                        radioAudioElement.volume = 1;
                        // Keep in DOM so Chromium recognises this as an active media session
                        radioAudioElement.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none;opacity:0;';
                        document.body.appendChild(radioAudioElement);
                        mediaElementSourceNode = audioCtx.createMediaElementSource(radioAudioElement);
                        mediaElementSourceNode.connect(window.replayGainNode || window.preampNode);
                    }

                    radioAudioElement.src = entry.path;
                    
                    if (!window.volumeNode) {
                        window.volumeNode = audioCtx.createGain();
                        analyzer.disconnect();
                        analyzer.connect(window.volumeNode);
                        window.volumeNode.connect(window.chSplitter);
                    }

                    const currentVol = isMuted ? 0 : volumeSliderToGain(parseFloat(volumeSlider.value));
                    window.volumeNode.gain.setValueAtTime(currentVol, audioCtx.currentTime);

                    window.volumeNode.gain.cancelScheduledValues(audioCtx.currentTime);
                    window.volumeNode.gain.setValueAtTime(currentVol, audioCtx.currentTime);
                    radioAudioElement.play().then(() => {
                        if (myToken !== _loadToken) return;
                        startRadioMetadataReader(entry.path, entry.name);
                    }).catch(err => {
                        // AbortError — ожидаемо при быстром переключении
                        if (err.name === 'AbortError') return;
                        if (myToken !== _loadToken) return;
                        stopTrack();
                        updatePlayIcons(false);
                        statusText.textContent = 'Ошибка потока';
                        console.error(err);
                    });
                    isPlaying = true;
                    updatePlayIcons(true);
                    statusText.textContent = 'Трансляция';
                    startProgressUpdater();
                    btnRepeat.classList.add('btn-disabled');
                    miniBtnRepeat.classList.add('btn-disabled');
                    btnShuffle.classList.add('btn-disabled');
                    miniBtnShuffle.classList.add('btn-disabled');
                    // Disable speed control for radio
                    document.getElementById('speed-zone').classList.add('speed-control-disabled');
                } catch(err) {
                    statusText.textContent = 'Ошибка потока';
                }

            } else {
                isRadioMode = false;

                _trackLoading = true;

                statusText.textContent = 'Загрузка...';
                
                try {
                    const filePath = entry.path;
                    const cachedMeta = parsedMetadataCache[absoluteTrackId] || await (async () => {
                        // Быстрое чтение метаданных если кэш ещё не заполнен —
                        // единый вызов через music-metadata (preload) вместо
                        // ручного fs.open + самописного ID3-парсера.
                        try {
                            const m = await noctune.metadata.parseFile(filePath, entry.name);
                            if (m.fileSize) entry._fileSize = m.fileSize;
                            return m;
                        } catch(e) {
                            return { title: entry.name.replace(/\.[^/.]+$/, ""), artist: "Неизвестный исполнитель" };
                        }
                    })();

                    // Проверяем, не был ли уже выбран другой трек
                    if (myToken !== _loadToken) return;

                    const meta = { ...cachedMeta };
                    if (meta.hasEmbeddedCover) {
                        meta.coverDataUrl = await noctune.metadata.cover(filePath) || meta.coverThumbnailDataUrl;
                        if (myToken !== _loadToken) return;
                    }
                    if (window.setLyricsTrack) window.setLyricsTrack({ ...meta, filePath }, myToken);
                    trackTitle.textContent = meta.title;
                    trackArtist.textContent = meta.artist;
                    miniTrackTitle.textContent = `${meta.artist} — ${meta.title}`;
                    triggerMiniMarquee();
                    lastfmResetTrackState({ artist: meta.artist, title: meta.title, album: meta.album || '', duration: 0 });
                    window._currentTrackReplayGainDb = (typeof meta.replayGainTrackDb === 'number') ? meta.replayGainTrackDb : null;
                    applyReplayGainNow();

                    if ('mediaSession' in navigator) {
                        const artwork = [];
                        if (meta.coverDataUrl) artwork.push({ src: meta.coverDataUrl, sizes: '512x512', type: 'image/jpeg' });
                        navigator.mediaSession.metadata = new MediaMetadata({
                            title: meta.title,
                            artist: meta.artist,
                            album: meta.album || '',
                            artwork
                        });
                    }

                    if (typeof loadTrackWaveform === 'function') loadTrackWaveform(filePath, myToken);

                    // Каждый трек — новый Audio() + новый MediaElementSourceNode.
                    // createMediaElementSource можно вызвать для одного элемента только один раз,
                    // поэтому переиспользовать нельзя — создаём свежую пару.
                    if (localMediaSource) {
                        try { localMediaSource.disconnect(); } catch(e){}
                        localMediaSource = null;
                    }
                    if (localAudioElement) {
                        localAudioElement.pause();
                        localAudioElement.removeAttribute('src');
                        // Remove from DOM — each track gets a fresh element
                        try { if (localAudioElement.parentNode) localAudioElement.parentNode.removeChild(localAudioElement); } catch(e){}
                    }

                    localAudioElement = new Audio();
                    localAudioElement.preload = 'auto';
                    localAudioElement.crossOrigin = "anonymous";
                    // Must be in the DOM for Chromium to register an active media session
                    // (required for navigator.mediaSession setActionHandler callbacks to fire)
                    localAudioElement.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none;opacity:0;';
                    document.body.appendChild(localAudioElement);

                    // Подключаем в аудиограф сразу (до установки src)
                    localMediaSource = audioCtx.createMediaElementSource(localAudioElement);
                    localMediaSource.connect(window.replayGainNode || window.preampNode);

                    // volumeNode создаём если ещё нет
                    if (!window.volumeNode) {
                        window.volumeNode = audioCtx.createGain();
                        analyzer.disconnect();
                        analyzer.connect(window.volumeNode);
                        window.volumeNode.connect(window.chSplitter);
                    }

                    // Устанавливаем источник — браузер начинает буферизацию немедленно
                    const fileUrl = `file://${filePath.replace(/\\/g, '/')}`;
                    localAudioElement.src = fileUrl;
                    localAudioElement.load();

                    // Инициализируем переменные длительности как 0, обновим по событию
                    currentTrackDuration = 0;
                    currentDecodedBuffer = null; // сброс старого буфера
                    timeTotal.textContent = "0:00";
                    pausedAt = startPosition;

                    // Обновляем длительность и метаданные как только они станут известны
                    const onMeta = () => {
                        if (myToken !== _loadToken) return;
                        const dur = localAudioElement.duration;
                        currentTrackDuration = isFinite(dur) ? dur : 0;
                        if (window.setLyricsTrack) window.setLyricsTrack({ ...meta, filePath, duration: currentTrackDuration }, myToken);
                        // Для совместимости с seek/tooltip — эмулируем объект с duration
                        currentDecodedBuffer = { duration: currentTrackDuration };
                        timeTotal.textContent = formatTime(currentTrackDuration);
                        if (_lastfmTrackMeta) _lastfmTrackMeta.duration = currentTrackDuration;
                        // Now that duration is known, sync SMTC position state
                        updateSMTCPosition(localAudioElement.currentTime || startPosition);

                        const stats_size = entry._fileSize || 0;
                        if (stats_size > 0 && currentTrackDuration > 0) {
                            const kbps = Math.round((stats_size * 8) / currentTrackDuration / 1000);
                            const metaElem = document.getElementById(`meta-${absoluteTrackId}`);
                            if (metaElem) metaElem.textContent = `${formatTime(currentTrackDuration)} | ${kbps}kbps`;
                        } else {
                            const metaElem = document.getElementById(`meta-${absoluteTrackId}`);
                            if (metaElem && currentTrackDuration > 0) metaElem.textContent = formatTime(currentTrackDuration);
                        }
                    };

                    localAudioElement.addEventListener('loadedmetadata', onMeta, { once: true });
                    localAudioElement.addEventListener('ended', () => {
                        if (myToken === _loadToken && isPlaying) handleTrackEnded();
                    });

                    // Проверяем ещё раз перед запуском
                    if (myToken !== _loadToken) return;

                    // Запускаем воспроизведение немедленно (не ждём полной загрузки)
                    _trackLoading = false;
                    startSourceAt(startPosition);

                    // Если размер файла не закэширован — подгружаем в фоне
                    if (!entry._fileSize) {
                        noctune.fs.stat(filePath).then(stats => {
                            entry._fileSize = stats.size;
                            // Обновим kbps если длительность уже известна
                            if (myToken === _loadToken && currentTrackDuration > 0) {
                                const kbps = Math.round((stats.size * 8) / currentTrackDuration / 1000);
                                const metaElem = document.getElementById(`meta-${absoluteTrackId}`);
                                if (metaElem) metaElem.textContent = `${formatTime(currentTrackDuration)} | ${kbps}kbps`;
                            }
                        }).catch(() => {});
                    }

                    btnShuffle.classList.remove('btn-disabled');
                    btnRepeat.classList.remove('btn-disabled');
                    miniBtnShuffle.classList.remove('btn-disabled');
                    miniBtnRepeat.classList.remove('btn-disabled');
                    // Re-enable speed control
                    {
                        document.getElementById('speed-zone').classList.remove('speed-control-disabled');
                    }
                } catch (e) {
                    if (myToken === _loadToken) statusText.textContent = 'Ошибка загрузки';
                } finally {
                    if (myToken === _loadToken) _trackLoading = false;
                }
            }
        }

        const miniProgressTrack = document.getElementById('mini-progress-track');
        const miniSeekTooltip = document.getElementById('mini-seek-tooltip');
        // Функция для обновления позиции и контента тултипа мини-плеера
        function updateMiniTooltip(e) {
            const duration = currentTrackDuration || (localAudioElement ? localAudioElement.duration : 0);
            if (isRadioMode || !duration || !isFinite(duration)) return;
            
            const rect = miniProgressTrack.getBoundingClientRect();
            const mouseX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
            const percentage = mouseX / rect.width;
            const targetTime = percentage * duration;
            
            const miniSeekTooltip = document.getElementById('mini-seek-tooltip');
            if (miniSeekTooltip) {
                miniSeekTooltip.textContent = formatTime(targetTime);
                miniSeekTooltip.style.left = `${e.clientX}px`;
                miniSeekTooltip.style.top = `${rect.top - 8}px`;
            }
        }

        // 1. Клик по полосе прогресса мини-плеера
        miniProgressTrack.addEventListener('click', (e) => {
            const duration = currentTrackDuration || (localAudioElement ? localAudioElement.duration : 0);
            if (isRadioMode || !duration || !isFinite(duration)) return;
            const rect = miniProgressTrack.getBoundingClientRect();
            const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
            const percentage = clickX / rect.width;
            const targetTime = percentage * duration;
            
            if (isPlaying) { 
                startSourceAt(targetTime, false); 
            } else {
                pausedAt = targetTime;
                if (localAudioElement) localAudioElement.currentTime = targetTime;
                progressFill.style.width = `${percentage * 100}%`;
                
                const miniProgressFill = document.getElementById('mini-progress-fill');
                if (miniProgressFill) miniProgressFill.style.width = `${percentage * 100}%`;
                
                timeCurrent.textContent = formatTime(targetTime);
            }
            
            updateMiniTooltip(e);
        });

        // 2. Движение мыши — перемещаем тултип и меняем в нем время
        miniProgressTrack.addEventListener('mousemove', (e) => {
            updateMiniTooltip(e);
        });

        // 3. Мышь зашла на полосу прогресса — плавно показываем тултип
        miniProgressTrack.addEventListener('mouseenter', (e) => {
            const duration = currentTrackDuration || (localAudioElement ? localAudioElement.duration : 0);
            if (isRadioMode || !duration || !isFinite(duration)) return;
            const miniSeekTooltip = document.getElementById('mini-seek-tooltip');
            if (miniSeekTooltip) {
                miniSeekTooltip.classList.add('visible');
            }
            updateMiniTooltip(e);
        });

        // 4. Мышь покинула полосу прогресса — скрываем тултип
        miniProgressTrack.addEventListener('mouseleave', () => {
            const miniSeekTooltip = document.getElementById('mini-seek-tooltip');
            if (miniSeekTooltip) {
                miniSeekTooltip.classList.remove('visible');
            }
        });

        function startSourceAt(position, fadeIn = true) {
            if (isRadioMode) return;
            if (!localAudioElement || !localAudioElement.getAttribute('src') || _trackLoading) return;

            _endFadeActive = false;
            _trackEndHandledToken = -1;

            if (!window.volumeNode) {
                window.volumeNode = audioCtx.createGain();
                analyzer.disconnect();
                analyzer.connect(window.volumeNode);
                window.volumeNode.connect(window.chSplitter);
            }

            const targetVol = isMuted ? 0 : volumeSliderToGain(parseFloat(volumeSlider.value));

            if (fadeIn && crossfadeEnabled && crossfadeInDuration > 0) {
                // Fade-in: стартуем с нулевой громкостью, плавно поднимаем
                window.volumeNode.gain.cancelScheduledValues(audioCtx.currentTime);
                window.volumeNode.gain.setValueAtTime(0, audioCtx.currentTime);
                const curve = new Float32Array(65);
                for (let i = 0; i < curve.length; i++) curve[i] = targetVol * fadeEnvelope(i / (curve.length - 1));
                window.volumeNode.gain.setValueCurveAtTime(curve, audioCtx.currentTime, crossfadeInDuration);
            } else {
                window.volumeNode.gain.cancelScheduledValues(audioCtx.currentTime);
                window.volumeNode.gain.setValueAtTime(targetVol, audioCtx.currentTime);
            }

            localAudioElement.currentTime = position;
            // Resume AudioContext in case it was suspended (e.g. triggered by SMTC without a user gesture)
            if (audioCtx && audioCtx.state === 'suspended') {
                audioCtx.resume().catch(() => {});
            }
            const playingElement = localAudioElement;
            const playingToken = _loadToken;
            localAudioElement.play().catch(err => {
                // AbortError — ожидаемо при быстром переключении треков (play прерван pause)
                if (err.name === 'AbortError') return;
                if (playingToken !== _loadToken || playingElement !== localAudioElement) return;
                stopTrack();
                updatePlayIcons(false);
                statusText.textContent = 'Ошибка воспроизведения';
                console.error("Ошибка воспроизведения:", err);
            });

            startTime = audioCtx.currentTime;
            pausedAt = position;
            isPlaying = true;
            appStorage.setItem('player_was_playing', '1');

            updateSMTCPosition(position);
            updatePlayIcons(true);
            statusText.textContent = 'Воспроизведение';
            startProgressUpdater();
            sendTrayState();
        }

        function sendTrayState() {
            try {
                const title = document.getElementById('track-title')?.textContent || 'Ничего не играет';
                const hasPlaylist = playlistOrder.length > 0;
                noctune.sendTrayState({
                    isPlaying,
                    trackTitle: title.length > 40 ? title.slice(0, 38) + '…' : title,
                    prevEnabled: hasPlaylist && currentIndex > 0,
                    nextEnabled: hasPlaylist && currentIndex < playlistOrder.length - 1,
                });
            } catch(e) {}
            pushDiscordActivity();
            pushLastfmNowPlaying();
        }

        // ── Интеграция: Discord Rich Presence ──────────────────────────────
        // Собирает текущее состояние воспроизведения (трек/автор/плейлист/
        // позиция) в формат activity для Discord и отправляет в main-процесс,
        // где живёт само соединение с локальным Discord-клиентом. Здесь же —
        // конструирование кнопки «Слушать» для радиостанций.
        let _discordRadioStartedAt = null;

        function buildDiscordActivity() {
            const title = (trackTitle?.textContent || '').trim() || 'Без названия';
            const artist = (trackArtist?.textContent || '').trim();
            const pl = userPlaylists.find(p => p.id === activePlaylistId);
            const plName = pl ? pl.name : (isRadioMode ? 'Радио' : 'Без плейлиста');

            const activity = {
                type: 2, // Listening — «Слушает Noctune Player»
                details: title.slice(0, 128),
                largeImageKey: 'logo',
                largeImageText: plName.slice(0, 128),
                smallImageKey: isPlaying ? 'play' : 'pause',
                smallImageText: isPlaying ? 'Воспроизведение' : 'Пауза',
                instance: false,
            };
            if (artist) activity.state = artist.slice(0, 128);

            if (window.discordRPCShowProgress !== false && isPlaying) {
                const now = Date.now();
                if (isRadioMode) {
                    // У радио нет известной длительности — открытый счётчик
                    // «сколько слушает», без конечной точки.
                    if (!_discordRadioStartedAt) _discordRadioStartedAt = now;
                    activity.startTimestamp = Math.floor(_discordRadioStartedAt / 1000);
                } else {
                    const duration = currentTrackDuration || (localAudioElement ? localAudioElement.duration : 0);
                    const pos = localAudioElement ? localAudioElement.currentTime : 0;
                    // Discord сам «тикает» индикатор прогресса по реальному времени между
                    // startTimestamp и endTimestamp — он не знает о playbackRate трека.
                    // Поэтому оставшуюся и уже прошедшую часть нужно масштабировать на
                    // 1/rate: при 2x аудио-секунда проходит за полсекунды реального времени
                    // и наоборот при замедлении — иначе полоска в Discord рассинхронизируется
                    // с реальной позицией и временем окончания трека.
                    const rate = (localAudioElement && localAudioElement.playbackRate > 0) ? localAudioElement.playbackRate : 1;
                    if (duration && isFinite(duration) && duration > 0) {
                        const startMs = now - Math.floor((pos / rate) * 1000);
                        activity.startTimestamp = Math.floor(startMs / 1000);
                        activity.endTimestamp = Math.floor((startMs + (duration / rate) * 1000) / 1000);
                    }
                }
            } else if (!isRadioMode) {
                _discordRadioStartedAt = null;
            }

            // Кнопка «Слушать» — только для радио, друг запускает ту же станцию у себя
            if (isRadioMode && window.discordRPCShowRadioButton !== false && playlistOrder.length) {
                const absId = playlistOrder[currentIndex];
                const entry = fileEntries[absId];
                if (entry && entry.path) {
                    const base = (window.discordRPCRedirectBase || '').trim();
                    let buttonUrl;
                    if (base) {
                        const sep = base.includes('?') ? '&' : '?';
                        buttonUrl = `${base}${sep}name=${encodeURIComponent(entry.name || title)}&url=${encodeURIComponent(entry.path)}`;
                    } else {
                        buttonUrl = entry.path; // без редиректа — просто открыть поток в браузере
                    }
                    if (/^https?:\/\//i.test(buttonUrl)) {
                        activity.buttons = [{ label: 'Слушать', url: buttonUrl }];
                    }
                }
            }

            return activity;
        }

        function pushDiscordActivity() {
            if (!window.discordRPCEnabled) return;
            try {
                if (!isPlaying && !playlistOrder.length) {
                    noctune.discordRpcClearActivity();
                    return;
                }
                noctune.discordRpcSetActivity(buildDiscordActivity());
            } catch (e) {}
        }
        // Раз в 20с подстраховочно пересылаем активность — на случай дрейфа/сна
        // компьютера; полоска прогресса в Discord и без этого тикает сама за счёт
        // timestamp'ов, это просто страховка на случай пропущенного события.
        setInterval(() => { if (isPlaying) pushDiscordActivity(); }, 20000);

        function updatePlayIcons(playing) {
            const mainIcon = document.getElementById('main-play-icon');
            const miniIcon = document.getElementById('mini-play-icon');
            if (playing) {
                mainIcon.setAttribute('data-lucide', 'pause');
                miniIcon.setAttribute('data-lucide', 'pause');
                if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
                // Keep the MediaSession alive so SMTC buttons keep firing
                if (window._msKeepAlive) window._msKeepAlive.play().catch(() => {});
            } else {
                mainIcon.setAttribute('data-lucide', 'play');
                miniIcon.setAttribute('data-lucide', 'play');
                if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
                // Do NOT pause _msKeepAlive — session must stay active so SMTC 'play' can fire
            }
            lucide.createIcons();
            sendTrayState();
        }

        function updateSMTCPosition(position) {
            if (!('mediaSession' in navigator)) return;
            const duration = currentTrackDuration || (localAudioElement ? localAudioElement.duration : 0);
            if (!duration || !isFinite(duration) || duration <= 0) return;
            try {
                navigator.mediaSession.setPositionState({
                    duration: duration,
                    playbackRate: (localAudioElement && localAudioElement.playbackRate) ? localAudioElement.playbackRate : 1,
                    position: Math.max(0, Math.min(position, duration))
                });
            } catch(e) {}
        }

        // Позиция слайдера (0–1, то, что хранится и показывается в UI) — это
        // не сам gain, а перцептивная позиция. Громкость на слух подчиняется
        // примерно логарифмическому закону, поэтому простой линейный gain
        // «сжимает» большую часть слышимого изменения в нижнюю четверть шкалы.
        // Тейпер ниже — стандартный приём из аудиософта: линейное приращение
        // в дБ на каждый шаг слайдера в диапазоне VOLUME_TAPER_DB, так что
        // равные шаги слайдера ощущаются на слух примерно равными по громкости.
        const VOLUME_TAPER_DB = 24; // во сколько дБ «укладывается» весь ход слайдера
        function volumeSliderToGain(v) {
            if (!(v > 0)) return 0;   // 0 или некорректное значение — честная тишина
            if (v >= 1) return 1;     // верх шкалы — unity gain (0 дБ), без округления
            const db = -VOLUME_TAPER_DB * (1 - v);
            return Math.pow(10, db / 20);
        }

        function updateVolumeIcons(val) {
            const mainVolIcon = document.getElementById('main-volume-icon');
            const miniVolIcon = document.getElementById('mini-volume-icon');
            const iconName = (val <= 0 || isMuted) ? 'volume-x' : (val < 0.4) ? 'volume' : (val < 0.7) ? 'volume-1' : 'volume-2';
            if (mainVolIcon) mainVolIcon.setAttribute('data-lucide', iconName);
            if (miniVolIcon) miniVolIcon.setAttribute('data-lucide', iconName);
            lucide.createIcons();
        }

        function updateVolume(val, saveToStorage = true) {
            const volumeValue = parseFloat(val);
            if (volumeValue > 0) isMuted = false; 
            
            volumeSlider.value = volumeValue;
            miniVolumeSlider.value = volumeValue;
            
            if (saveToStorage) { appStorage.setItem('player_volume', volumeValue); }
            const gainValue = isMuted ? 0 : volumeSliderToGain(volumeValue);
            if (window.volumeNode) {
                window.volumeNode.gain.cancelScheduledValues(audioCtx.currentTime);
                window.volumeNode.gain.setValueAtTime(gainValue, audioCtx.currentTime);
            }
            // radioAudioElement.volume не меняем — см. комментарий в playTrack:
            // громкость радио целиком регулируется через window.volumeNode,
            // как и у локальных треков, чтобы шкала слайдера ощущалась одинаково.
            applyTrackEndFade();
            updateVolumeIcons(isMuted ? 0 : volumeValue);
        }

        async function handleTrackEnded() {
            if (_trackEndHandledToken === _loadToken || !isPlaying || isRadioMode) return;
            stopTrack();
            const endedToken = _loadToken;
            _trackEndHandledToken = endedToken;

            // If user switched to a different playlist while playing, restore the active one first
            if (activePlaylistId && activePlaylistId !== currentPlaylistId) {
                await selectPlaylist(activePlaylistId);
                if (endedToken !== _loadToken) return;
            }

            // Повтор текущего трека только при явно включённом режиме.
            if (repeatMode === 1) {
                stopTrack();
                playTrack(currentIndex, 0);
                return;
            }

            // «Воспроизвести следующим» — высший приоритет после repeat-track
            if (playNextIndex !== -1) {
                const nextOrder = playlistOrder.indexOf(playNextIndex);
                playNextIndex = -1;
                if (nextOrder !== -1) { playTrack(nextOrder, 0); return; }
            }

            // Проверяем настройку автоперехода к следующему треку
            const settingAutoNext = document.getElementById('setting-autonext');
            const autoNext = !settingAutoNext || settingAutoNext.checked;
            if (!autoNext) {
                stopTrack();
                currentIndex = -1;
                updatePlayIcons(false);
                statusText.textContent = 'Окончено';
                return;
            }

            const nextIdx = getNextTrackIndex(true);

            if (nextIdx >= 0) {
                playTrack(nextIdx, 0);
                return;
            }

            // Треков больше нет — проверяем автопереход к следующему плейлисту
            const settingAutoNextPl = document.getElementById('setting-autonext-playlist');
            const autoNextPlaylist = settingAutoNextPl && settingAutoNextPl.checked;
            const folderPlaylists = userPlaylists.filter(p => p.type === 'folder');
            const curPlIdx = folderPlaylists.findIndex(p => p.id === currentPlaylistId);

            if (autoNextPlaylist && folderPlaylists.length > 1 && curPlIdx !== -1) {
                const nextPl = folderPlaylists[(curPlIdx + 1) % folderPlaylists.length];
                await selectPlaylist(nextPl.id);
                if (endedToken !== _loadToken) return;
                if (playlistOrder.length > 0) {
                    playTrack(0, 0);
                    return;
                }
            }

            // Плейлист завершён — останавливаемся
            stopTrack();
            if (localAudioElement) {
                localAudioElement.pause();
                localAudioElement.removeAttribute('src');
                localAudioElement = null;
            }
            currentIndex = -1;
            if ('mediaSession' in navigator) {
                navigator.mediaSession.playbackState = 'none';
                try { navigator.mediaSession.setPositionState({}); } catch(e) {}
            }
            if (window._msKeepAlive) window._msKeepAlive.pause();
            updatePlayIcons(false);
            statusText.textContent = 'Окончено';
        }

        function togglePlayback() {
            if (_trackLoading) {
                stopTrack();
                updatePlayIcons(false);
                statusText.textContent = 'Остановлено';
                return;
            }
            if (isRadioMode && radioAudioElement && radioAudioElement.getAttribute('src')) {
                if (isPlaying) {
                    radioAudioElement.pause();
                    isPlaying = false;
                    updatePlayIcons(false);
                    statusText.textContent = 'Пауза';
                } else {
                    radioAudioElement.play().catch(err => { if (err.name !== 'AbortError') console.error(err); });
                    isPlaying = true;
                    updatePlayIcons(true);
                    statusText.textContent = 'Трансляция';
                }
                return;
            }

            // Трек был удалён во время воспроизведения — запускаем следующий доступный
            if (localAudioElement && !localAudioElement.getAttribute('src') && playlistOrder.length > 0) {
                const nextIdx = currentIndex >= 0 && currentIndex < playlistOrder.length
                    ? currentIndex
                    : 0;
                playTrack(nextIdx);
                return;
            }

            if (!localAudioElement) {
                if (playlistOrder.length > 0) {
                    if (currentIndex === -1) {
                        playTrack(0);
                    } else {
                        const lastOrder = parseInt(appStorage.getItem('player_last_track_order'));
                        const startIdx = (!isNaN(lastOrder) && lastOrder >= 0 && lastOrder < playlistOrder.length) ? lastOrder : 0;
                        const savedPos = parseFloat(appStorage.getItem('player_last_track_position') || '0');
                        playTrack(startIdx, savedPos > 0 ? savedPos : 0);
                    }
                }
                return;
            }

            if (isPlaying) {
                // Запоминаем позицию через HTMLAudioElement
                pausedAt = localAudioElement.currentTime;
                localAudioElement.pause();
                isPlaying = false;
                updateSMTCPosition(pausedAt);
                updatePlayIcons(false);
                statusText.textContent = 'Пауза';
                // Save position on pause
                const remToggle = document.getElementById('setting-remember-track');
                if (!remToggle || remToggle.checked) {
                    appStorage.setItem('player_last_track_position', pausedAt.toFixed(2));
                }
                appStorage.setItem('player_was_playing', '0');
            } else {
                const duration = currentTrackDuration || localAudioElement.duration || 0;
                if (pausedAt >= duration && duration > 0) pausedAt = 0;
                startSourceAt(pausedAt, false);
            }
        }

        btnPlayPause.addEventListener('click', togglePlayback);
        miniBtnPlayPause.addEventListener('click', togglePlayback);

        async function playPrev() {
            const navigationToken = ++_navigationToken;
            if (activePlaylistId && activePlaylistId !== currentPlaylistId) {
                await selectPlaylist(activePlaylistId);
                if (navigationToken !== _navigationToken) return;
            }
            if (playlistOrder.length === 0) return;
            const prevIdx = getNextTrackIndex(false);
            playTrack(prevIdx >= 0 ? prevIdx : 0);
        }

        async function playNext() {
            const navigationToken = ++_loadToken;
            if (activePlaylistId && activePlaylistId !== currentPlaylistId) {
                await selectPlaylist(activePlaylistId);
                if (navigationToken !== _loadToken) return;
            }
            if (playlistOrder.length === 0) return;
            const nextIdx = getNextTrackIndex(true);
            if (nextIdx >= 0) {
                playTrack(nextIdx);
            } else {
                // Список закончился — при ручном нажатии Next переходим на начало
                playTrack(0);
            }
        }

        // ── Горячие клавиши плеера ──────────────────────────────────────────
        // Биндинги хранятся как { actionId: "combo" }, где combo — нормализованная
        // строка вида "k", "shift+j", "ArrowUp". Настраиваются на вкладке
        // «Горячие клавиши» в настройках; см. соответствующий блок в settings IIFE.
        const DEFAULT_HOTKEYS = {
            togglePlay: 'KeyK',
            seekBack10: 'KeyJ',
            seekFwd10: 'KeyL',
            mute: 'KeyM',
            prevTrack: 'shift+KeyJ',
            nextTrack: 'shift+KeyL',
            volumeUp: 'ArrowUp',
            volumeDown: 'ArrowDown',
            seekBack5: 'ArrowLeft',
            seekFwd5: 'ArrowRight',
        };

        // Старые версии хранили буквы как e.key ('k', 'shift+j') — это зависит
        // от раскладки (на русской ЙЦУКЕН физическая клавиша «K» даёт «л», и
        // бинд молча перестаёт срабатывать). Подменяем такие записи на код
        // физической клавиши (KeyK и т.п.), который от раскладки не зависит.
