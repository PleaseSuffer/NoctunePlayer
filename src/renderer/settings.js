        // ===========================
        //   SETTINGS MODAL LOGIC
        // ===========================
        (function initSettings() {
            const fab = document.getElementById('settings-fab');
            const overlay = document.getElementById('settings-overlay');
            const closeBtn = document.getElementById('settings-close-btn');
            const navItems = document.querySelectorAll('.settings-nav-item');
            const panels = document.querySelectorAll('.settings-panel');

            // ── Плавное появление блоков доп. настроек, открываемых переключателем ──
            // Скрытие остаётся мгновенным (display:none), а вот появление проигрывает
            // лёгкую анимацию — но только если элемент действительно был скрыт, чтобы
            // повторные вызовы (например, при движении слайдера) не переигрывали её.
            function showSettingsBlock(el, displayValue) {
                if (!el) return;
                const wasHidden = el.style.display === 'none';
                el.style.display = displayValue;
                if (wasHidden) {
                    el.classList.remove('settings-reveal-anim');
                    void el.offsetWidth; // форсируем reflow, чтобы анимация надёжно перезапустилась
                    el.classList.add('settings-reveal-anim');
                }
            }
            function hideSettingsBlock(el) {
                if (!el) return;
                el.classList.remove('settings-reveal-anim');
                el.style.display = 'none';
            }
            function setSettingsBlockVisible(el, visible, displayValue) {
                if (visible) showSettingsBlock(el, displayValue || 'flex');
                else hideSettingsBlock(el);
            }

            // Open / close
            fab.addEventListener('click', () => {
                overlay.classList.add('open');
                fab.classList.add('open');
                refreshSettingsUI();
                lucide.createIcons();
            });
            function closeSettings() {
                overlay.classList.remove('open');
                fab.classList.remove('open');
            }
            closeBtn.addEventListener('click', closeSettings);
            overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSettings(); });

            // Tab navigation
            const settingsContent = document.querySelector('.settings-content');
            navItems.forEach(item => {
                item.addEventListener('click', () => {
                    navItems.forEach(n => n.classList.remove('active'));
                    panels.forEach(p => p.classList.remove('active'));
                    item.classList.add('active');
                    const target = item.dataset.panel;
                    document.getElementById(target).classList.add('active');
                    if (settingsContent) settingsContent.scrollTop = 0;
                    if (target === 'panel-general') renderPlEditor();
                });
            });

            // ---- GENERAL: Playlist editor ----
            function renderPlEditor() {
                const list = document.getElementById('pl-editor-list');
                list.innerHTML = '';
                if (!userPlaylists || userPlaylists.length === 0) {
                    list.innerHTML = '<li style="color:var(--text-muted);font-size:12px;padding:8px;">Нет плейлистов</li>';
                    return;
                }
                userPlaylists.forEach((pl, idx) => {
                    const li = document.createElement('li');
                    li.className = 'pl-editor-item';
                    li.draggable = true;
                    li.dataset.idx = idx;
                    const isRadio = pl.type === 'radio';
                    li.innerHTML = `
                        <span class="pl-drag-handle"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="18" x2="16" y2="18"/></svg></span>
                        <span class="pl-name">${pl.name || 'Без названия'}</span>
                        <span class="pl-type-badge ${isRadio ? 'radio' : ''}">${isRadio ? 'Радио' : 'Папка'}</span>
                        <button type="button" class="actions-btn pl-export-btn" data-idx="${idx}" title="Экспортировать в .m3u" style="flex-shrink:0;">
                            <i data-lucide="download" style="width:14px;height:14px;"></i>
                        </button>
                    `;
                    li.querySelector('.pl-export-btn').addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (window.exportPlaylistToM3U) window.exportPlaylistToM3U(userPlaylists[idx]);
                    });
                    // Drag-and-drop reorder
                    li.addEventListener('dragstart', (e) => {
                        li.classList.add('dragging');
                        e.dataTransfer.setData('text/plain', idx);
                    });
                    li.addEventListener('dragend', () => li.classList.remove('dragging'));
                    li.addEventListener('dragover', (e) => {
                        e.preventDefault();
                        const dragging = list.querySelector('.dragging');
                        if (dragging && dragging !== li) {
                            const rect = li.getBoundingClientRect();
                            const midY = rect.top + rect.height / 2;
                            if (e.clientY < midY) list.insertBefore(dragging, li);
                            else li.insertAdjacentElement('afterend', dragging);
                        }
                    });
                    li.addEventListener('drop', (e) => {
                        e.preventDefault();
                        // Rebuild userPlaylists from DOM order
                        const newOrder = [];
                        list.querySelectorAll('.pl-editor-item').forEach(el => {
                            const i = parseInt(el.dataset.idx);
                            if (userPlaylists[i]) newOrder.push(userPlaylists[i]);
                        });
                        userPlaylists.length = 0;
                        newOrder.forEach(p => userPlaylists.push(p));
                        savePlaylistsToStorage();
                        renderPlaylistsDropdown();
                        renderPlEditor();
                    });
                    list.appendChild(li);
                });
                lucide.createIcons();
            }

            // ---- PLAYER: Crossfade ----
            const settingCrossfade    = document.getElementById('setting-crossfade');
            const crossfadeDurationRow = document.getElementById('crossfade-duration-row');

            const crossfadeOutSlider  = document.getElementById('setting-crossfade-out');
            const crossfadeOutLabel   = document.getElementById('setting-crossfade-out-label');
            const crossfadeInSlider   = document.getElementById('setting-crossfade-in');
            const crossfadeInLabel    = document.getElementById('setting-crossfade-in-label');
            const crossfadeFadeinRow  = document.getElementById('crossfade-fadein-row');

            settingCrossfade.addEventListener('change', () => {
                crossfadeEnabled = settingCrossfade.checked;
                crossfadeDurationRow.classList.toggle('visible', crossfadeEnabled);
                crossfadeFadeinRow.classList.toggle('visible', crossfadeEnabled);
                appStorage.setItem('setting_crossfade', crossfadeEnabled ? '1' : '0');
            });

            crossfadeOutSlider.addEventListener('input', () => {
                crossfadeOutDuration = parseFloat(crossfadeOutSlider.value);
                crossfadeOutLabel.textContent = crossfadeOutDuration.toFixed(1) + 'с';
                appStorage.setItem('setting_crossfade_out', crossfadeOutDuration);
            });

            crossfadeInSlider.addEventListener('input', () => {
                crossfadeInDuration = parseFloat(crossfadeInSlider.value);
                crossfadeInLabel.textContent = crossfadeInDuration.toFixed(1) + 'с';
                appStorage.setItem('setting_crossfade_in', crossfadeInDuration);
            });

            // ---- PLAYER: Remember last track + submenu ----
            const settingRememberTrack = document.getElementById('setting-remember-track');
            function applyRememberTrackSub(checked) {
                const sub     = document.getElementById('remember-track-sub');
                const restoreEl = document.getElementById('setting-restore-playback');
                setSettingsBlockVisible(sub, checked, 'block');
                if (restoreEl) {
                    restoreEl.disabled = !checked;
                    if (!checked) { restoreEl.checked = false; appStorage.setItem('setting_restore_playback', '0'); }
                }
            }
            settingRememberTrack.addEventListener('change', () => {
                appStorage.setItem('setting_remember_track', settingRememberTrack.checked ? '1' : '0');
                applyRememberTrackSub(settingRememberTrack.checked);
            });

            // ---- GENERAL: Autonext ----
            const settingAutoNext = document.getElementById('setting-autonext');
            settingAutoNext.addEventListener('change', () => {
                appStorage.setItem('setting_autonext', settingAutoNext.checked ? '1' : '0');
            });

            // ---- GENERAL: Minimize to tray ----
            const settingMinimizeToTray = document.getElementById('setting-minimize-to-tray');
            settingMinimizeToTray.addEventListener('change', () => {
                appStorage.setItem('setting_minimize_to_tray', settingMinimizeToTray.checked ? '1' : '0');
                noctune.setMinimizeToTray(settingMinimizeToTray.checked);
            });

            // ---- PLAYER: Autonext playlist ----
            const settingAutoNextPlaylist = document.getElementById('setting-autonext-playlist');
            settingAutoNextPlaylist.addEventListener('change', () => {
                appStorage.setItem('setting_autonext_playlist', settingAutoNextPlaylist.checked ? '1' : '0');
            });

            // ---- PLAYER: Restore playback state ----
            const settingRestorePlayback = document.getElementById('setting-restore-playback');
            if (settingRestorePlayback) settingRestorePlayback.addEventListener('change', () => {
                appStorage.setItem('setting_restore_playback', settingRestorePlayback.checked ? '1' : '0');
            });

            // ---- GENERAL: Notifications ----
            const settingNotifications = document.getElementById('setting-notifications');
            settingNotifications.addEventListener('change', () => {
                appStorage.setItem('setting_notifications', settingNotifications.checked ? '1' : '0');
            });

            // ---- GENERAL: Open links in external browser ----
            const settingOpenLinksExternal = document.getElementById('setting-open-links-external');
            settingOpenLinksExternal.addEventListener('change', () => {
                appStorage.setItem('setting_open_links_external', settingOpenLinksExternal.checked ? '1' : '0');
            });

            // ---- APPEARANCE: Visualizer type dropdown ----
            const vizTypeBtn  = document.getElementById('viz-type-dropdown-btn');
            const vizTypeMenu = document.getElementById('viz-type-dropdown-menu');
            const vizTypeLabel = document.getElementById('viz-type-label');
            const VIZ_GROUPS = {
                'circle-smooth': ['circles', 'gradient'],
                'circle-lines':  ['circles', 'gradient'],
                'bars-bottom':   ['bars',    'gradient'],
                'bars-center':   ['bars',    'gradient'],
                'waveform':      ['waveform','gradient'],
                'fireworks':     ['fireworks'],
            };

            function updateVizSettingsBlocks(style) {
                const groups = VIZ_GROUPS[style] || [];
                document.getElementById('viz-settings-circles').classList.toggle('visible', groups.includes('circles'));
                document.getElementById('viz-settings-bars').classList.toggle('visible', groups.includes('bars'));
                document.getElementById('viz-settings-waveform').classList.toggle('visible', groups.includes('waveform'));
                document.getElementById('viz-settings-gradient').classList.toggle('visible', groups.includes('gradient'));
                document.getElementById('viz-settings-fireworks').classList.toggle('visible', groups.includes('fireworks'));
            }

            function selectVizType(style) {
                window.vizStyle = style;
                appStorage.setItem('setting_viz_style', style);
                const item = vizTypeMenu.querySelector(`[data-viz="${style}"]`);
                if (item) {
                    vizTypeLabel.textContent = item.textContent.trim();
                    const iconName = item.dataset.icon;
                    vizTypeBtn.querySelector('.pd-icon').innerHTML = `<i data-lucide="${iconName}" style="width:14px;height:14px;"></i>`;
                }
                vizTypeMenu.querySelectorAll('.viz-type-menu-item').forEach(el =>
                    el.classList.toggle('active', el.dataset.viz === style));
                updateVizSettingsBlocks(style);
                lucide.createIcons();
            }

            vizTypeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const open = vizTypeMenu.classList.toggle('open');
                vizTypeBtn.classList.toggle('open', open);
            });
            document.addEventListener('click', () => {
                vizTypeMenu.classList.remove('open');
                vizTypeBtn.classList.remove('open');
            });
            vizTypeMenu.addEventListener('click', (e) => {
                const item = e.target.closest('.viz-type-menu-item');
                if (!item) return;
                e.stopPropagation();
                selectVizType(item.dataset.viz);
                vizTypeMenu.classList.remove('open');
                vizTypeBtn.classList.remove('open');
            });

            // ---- APPEARANCE: Fireworks (Салют) settings ----
            const fwColorBtn        = document.getElementById('fw-color-dropdown-btn');
            const fwColorMenu       = document.getElementById('fw-color-dropdown-menu');
            const fwColorLabel      = document.getElementById('fw-color-label');
            const fwCustomColorRow  = document.getElementById('fw-custom-color-row');
            const fwCustomColor1    = document.getElementById('fw-custom-color1');
            const fwCustomColor2    = document.getElementById('fw-custom-color2');
            const fwCustomColor3    = document.getElementById('fw-custom-color3');
            const fwThresholdSlider = document.getElementById('setting-fw-threshold');
            const fwThresholdLabel  = document.getElementById('setting-fw-threshold-label');
            const fwFreqSlider      = document.getElementById('setting-fw-frequency');
            const fwFreqLabel       = document.getElementById('setting-fw-frequency-label');
            const fwIdleSpawnToggle = document.getElementById('setting-fw-idle-spawn');
            const fwBeatToggle      = document.getElementById('setting-fw-beat-reactive');
            const fwBeatBurstRow    = document.getElementById('fw-beat-burst-row');
            const fwBeatBurstSlider = document.getElementById('setting-fw-beat-burst');
            const fwBeatBurstLabel  = document.getElementById('setting-fw-beat-burst-label');
            const fwTrailSlider     = document.getElementById('setting-fw-trail');
            const fwTrailLabel      = document.getElementById('setting-fw-trail-label');

            const FW_COLOR_MODES = {
                random: { label: 'Случайный',     icon: 'shuffle' },
                accent: { label: 'Акцентный цвет', icon: 'droplet' },
                custom: { label: 'Свой цвет',      icon: 'pipette' },
            };

            function selectFwColorMode(mode) {
                const def = FW_COLOR_MODES[mode] || FW_COLOR_MODES.random;
                window.fireworksColorMode = mode;
                fwColorLabel.textContent = def.label;
                fwColorBtn.querySelector('.pd-icon').innerHTML = `<i data-lucide="${def.icon}" style="width:14px;height:14px;"></i>`;
                fwColorMenu.querySelectorAll('.viz-type-menu-item').forEach(el =>
                    el.classList.toggle('active', el.dataset.fwcolor === mode));
                setSettingsBlockVisible(fwCustomColorRow, mode === 'custom', 'flex');
                appStorage.setItem('setting_fw_color_mode', mode);
                lucide.createIcons();
            }
            fwColorBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const open = fwColorMenu.classList.toggle('open');
                fwColorBtn.classList.toggle('open', open);
            });
            document.addEventListener('click', () => {
                fwColorMenu.classList.remove('open');
                fwColorBtn.classList.remove('open');
            });
            fwColorMenu.addEventListener('click', (e) => {
                const item = e.target.closest('.viz-type-menu-item');
                if (!item) return;
                e.stopPropagation();
                selectFwColorMode(item.dataset.fwcolor);
                fwColorMenu.classList.remove('open');
                fwColorBtn.classList.remove('open');
            });

            // «Свой цвет» — палитра из нескольких цветов (как у градиента визуализатора):
            // на каждый залп случайно берётся один из указанных пользователем цветов.
            function applyFwCustomColors() {
                window.fireworksCustomColors = [fwCustomColor1.value, fwCustomColor2.value, fwCustomColor3.value];
                appStorage.setItem('setting_fw_custom_colors', JSON.stringify(window.fireworksCustomColors));
            }
            fwCustomColor1.addEventListener('input', applyFwCustomColors);
            fwCustomColor2.addEventListener('input', applyFwCustomColors);
            fwCustomColor3.addEventListener('input', applyFwCustomColors);

            fwThresholdSlider.addEventListener('input', () => {
                const v = parseFloat(fwThresholdSlider.value);
                fwThresholdLabel.textContent = v.toFixed(2);
                window.fireworksThreshold = v;
                appStorage.setItem('setting_fw_threshold', v);
            });

            fwFreqSlider.addEventListener('input', () => {
                const v = parseFloat(fwFreqSlider.value);
                fwFreqLabel.textContent = v.toFixed(1);
                window.fireworksFrequency = v;
                appStorage.setItem('setting_fw_frequency', v);
            });

            fwIdleSpawnToggle.addEventListener('change', () => {
                window.fireworksIdleSpawn = fwIdleSpawnToggle.checked;
                appStorage.setItem('setting_fw_idle_spawn', fwIdleSpawnToggle.checked ? '1' : '0');
            });

            function applyFwBeatBurstRowVisibility(enabled) {
                setSettingsBlockVisible(fwBeatBurstRow, enabled, 'block');
            }
            fwBeatToggle.addEventListener('change', () => {
                window.fireworksBeatReactive = fwBeatToggle.checked;
                applyFwBeatBurstRowVisibility(fwBeatToggle.checked);
                appStorage.setItem('setting_fw_beat_reactive', fwBeatToggle.checked ? '1' : '0');
            });
            fwBeatBurstSlider.addEventListener('input', () => {
                const v = parseInt(fwBeatBurstSlider.value);
                fwBeatBurstLabel.textContent = v;
                window.fireworksBeatBurstCount = v;
                appStorage.setItem('setting_fw_beat_burst', v);
            });

            fwTrailSlider.addEventListener('input', () => {
                const v = parseInt(fwTrailSlider.value);
                fwTrailLabel.textContent = v;
                window.fireworksTrail = v;
                appStorage.setItem('setting_fw_trail', v);
            });

            // ---- APPEARANCE: Visualizer gradient colors ----
            const vizColor1 = document.getElementById('viz-grad-color1');
            const vizColor2 = document.getElementById('viz-grad-color2');
            const vizColor3 = document.getElementById('viz-grad-color3');
            const vizGradReset = document.getElementById('viz-grad-reset');

            // Gradient presets — order matches accent swatches (Синий, Фиолетовый, Зелёный, Красный, Оранжевый, Бирюзовый, Розовый, Coral)
            const GRAD_PRESETS = [
                ['#4a90e2', '#7b2ff7', '#00d4ff'],
                ['#bb86fc', '#4a90e2', '#03dac6'],
                ['#2ecc71', '#1abc9c', '#a8ff78'],
                ['#e74c3c', '#ff6b35', '#ffd700'],
                ['#f39c12', '#e74c3c', '#ffe57f'],
                ['#1abc9c', '#2980b9', '#a8ff78'],
                ['#e91e8c', '#bb86fc', '#ff6b35'],
                ['#ff6b35', '#e91e8c', '#ffd700'],
            ];

            function highlightActiveGradPreset() {
                const c1 = vizColor1.value.toLowerCase();
                const c2 = vizColor2.value.toLowerCase();
                const c3 = vizColor3.value.toLowerCase();
                document.querySelectorAll('#viz-grad-presets .grad-preset').forEach((p, i) => {
                    const [pc1, pc2, pc3] = GRAD_PRESETS[i];
                    p.classList.toggle('active', pc1 === c1 && pc2 === c2 && pc3 === c3);
                });
            }

            document.querySelectorAll('#viz-grad-presets .grad-preset').forEach((preset, i) => {
                preset.addEventListener('click', () => {
                    const [c1, c2, c3] = GRAD_PRESETS[i];
                    vizColor1.value = c1;
                    vizColor2.value = c2;
                    vizColor3.value = c3;
                    applyVizColors();
                    highlightActiveGradPreset();
                });
            });

            function applyVizColors() {
                window.vizGradColor1 = vizColor1.value;
                window.vizGradColor2 = vizColor2.value;
                window.vizGradColor3 = vizColor3.value;
                appStorage.setItem('setting_viz_grad', JSON.stringify([vizColor1.value, vizColor2.value, vizColor3.value]));
            }
            vizColor1.addEventListener('input', () => { applyVizColors(); highlightActiveGradPreset(); });
            vizColor2.addEventListener('input', () => { applyVizColors(); highlightActiveGradPreset(); });
            vizColor3.addEventListener('input', () => { applyVizColors(); highlightActiveGradPreset(); });
            vizGradReset.addEventListener('click', () => {
                vizColor1.value = '#bb86fc'; vizColor2.value = '#4a90e2'; vizColor3.value = '#03dac6';
                applyVizColors();
                highlightActiveGradPreset();
            });

            // Плавная смена цветов градиента визуализатора (используется, когда
            // цвета подставляются программно — адаптивная палитра под новые обои —
            // а не вживую тянутся пальцем по color-picker'у, где нужна мгновенная
            // реакция). window.vizGradColorN — то, что реально читает рисующий
            // цикл каждый кадр, поэтому плавность достигается покадровой
            // интерполяцией RGB, а не CSS-переходом (это обычный canvas).
            let _vizGradAnimRAF = null;
            function hexToRgbArr(hex) {
                hex = (hex || '#000000').replace('#', '');
                if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
                const num = parseInt(hex, 16) || 0;
                return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
            }
            function animateVizGradColorsTo(target1, target2, target3, duration = 700) {
                if (_vizGradAnimRAF) cancelAnimationFrame(_vizGradAnimRAF);
                const start1 = hexToRgbArr(window.vizGradColor1 || vizColor1.value);
                const start2 = hexToRgbArr(window.vizGradColor2 || vizColor2.value);
                const start3 = hexToRgbArr(window.vizGradColor3 || vizColor3.value);
                const end1 = hexToRgbArr(target1), end2 = hexToRgbArr(target2), end3 = hexToRgbArr(target3);

                // Поля выбора цвета и localStorage обновляем сразу на финальное
                // значение — анимируем только то, что рисуется на канвасе.
                vizColor1.value = target1; vizColor2.value = target2; vizColor3.value = target3;
                appStorage.setItem('setting_viz_grad', JSON.stringify([target1, target2, target3]));

                const t0 = performance.now();
                function step(now) {
                    const t = Math.min(1, (now - t0) / duration);
                    const e = 1 - Math.pow(1 - t, 3); // easeOutCubic — быстрый старт, мягкое завершение
                    window.vizGradColor1 = rgbToHex(start1[0] + (end1[0] - start1[0]) * e, start1[1] + (end1[1] - start1[1]) * e, start1[2] + (end1[2] - start1[2]) * e);
                    window.vizGradColor2 = rgbToHex(start2[0] + (end2[0] - start2[0]) * e, start2[1] + (end2[1] - start2[1]) * e, start2[2] + (end2[2] - start2[2]) * e);
                    window.vizGradColor3 = rgbToHex(start3[0] + (end3[0] - start3[0]) * e, start3[1] + (end3[1] - start3[1]) * e, start3[2] + (end3[2] - start3[2]) * e);
                    if (t < 1) { _vizGradAnimRAF = requestAnimationFrame(step); }
                    else { _vizGradAnimRAF = null; }
                }
                _vizGradAnimRAF = requestAnimationFrame(step);
            }

            // ---- APPEARANCE: Viz rotate colors (circles only) ----
            const settingVizRotate = document.getElementById('setting-viz-rotate-colors');
            const vizRotateSpeedRow = document.getElementById('viz-rotate-speed-row');
            function applyRotateSpeedRowVisibility(checked) {
                setSettingsBlockVisible(vizRotateSpeedRow, checked, 'block');
            }
            settingVizRotate.addEventListener('change', () => {
                window.vizRotateColors = settingVizRotate.checked;
                appStorage.setItem('setting_viz_rotate', settingVizRotate.checked ? '1' : '0');
                applyRotateSpeedRowVisibility(settingVizRotate.checked);
            });

            // ---- APPEARANCE: Rotate speed (circles) ----
            const rotateSpeedSlider = document.getElementById('setting-viz-rotate-speed');
            const rotateSpeedLabel  = document.getElementById('setting-viz-rotate-speed-label');
            if (rotateSpeedSlider) rotateSpeedSlider.addEventListener('input', () => {
                window.vizRotateSpeed = parseFloat(rotateSpeedSlider.value);
                rotateSpeedLabel.textContent = parseFloat(rotateSpeedSlider.value).toFixed(1);
                appStorage.setItem('setting_viz_rotate_speed', rotateSpeedSlider.value);
            });

            // ---- APPEARANCE: Inner viz ----
            const settingVizInner = document.getElementById('setting-viz-inner');
            settingVizInner.addEventListener('change', () => {
                window.vizShowInner = settingVizInner.checked;
                appStorage.setItem('setting_viz_inner', settingVizInner.checked ? '1' : '0');
            });

            // ---- APPEARANCE: Bars peaks ----
            const settingVizPeaks = document.getElementById('setting-viz-peaks');
            if (settingVizPeaks) settingVizPeaks.addEventListener('change', () => {
                window.vizShowPeaks = settingVizPeaks.checked;
                appStorage.setItem('setting_viz_peaks', settingVizPeaks.checked ? '1' : '0');
            });

            // ---- APPEARANCE: Bars scroll gradient ----
            const settingScrollGrad = document.getElementById('setting-viz-scroll-grad');
            const vizScrollSpeedRow = document.getElementById('viz-scroll-speed-row');
            function applyScrollGradRowVisibility(checked) {
                setSettingsBlockVisible(vizScrollSpeedRow, checked, 'block');
            }
            if (settingScrollGrad) settingScrollGrad.addEventListener('change', () => {
                window.vizScrollGrad = settingScrollGrad.checked;
                appStorage.setItem('setting_viz_scroll_grad', settingScrollGrad.checked ? '1' : '0');
                applyScrollGradRowVisibility(settingScrollGrad.checked);
            });

            // ---- APPEARANCE: Bars scroll speed ----
            const scrollSpeedSlider = document.getElementById('setting-viz-scroll-speed');
            const scrollSpeedLabel  = document.getElementById('setting-viz-scroll-speed-label');
            if (scrollSpeedSlider) scrollSpeedSlider.addEventListener('input', () => {
                window.vizScrollSpeed = parseFloat(scrollSpeedSlider.value);
                scrollSpeedLabel.textContent = parseFloat(scrollSpeedSlider.value).toFixed(1);
                appStorage.setItem('setting_viz_scroll_speed', scrollSpeedSlider.value);
            });

            // ---- APPEARANCE: Waveform scroll gradient ----
            const settingScrollGradWave = document.getElementById('setting-viz-scroll-grad-wave');
            const vizScrollSpeedWaveRow = document.getElementById('viz-scroll-speed-wave-row');
            function applyScrollGradWaveRowVisibility(checked) {
                setSettingsBlockVisible(vizScrollSpeedWaveRow, checked, 'block');
            }
            if (settingScrollGradWave) settingScrollGradWave.addEventListener('change', () => {
                window.vizScrollGradWave = settingScrollGradWave.checked;
                appStorage.setItem('setting_viz_scroll_grad_wave', settingScrollGradWave.checked ? '1' : '0');
                applyScrollGradWaveRowVisibility(settingScrollGradWave.checked);
            });

            // ---- PERFORMANCE WARNING: waveform lines + trail ----
            function checkWaveformPerfWarning() {
                const warn    = document.getElementById('viz-wave-perf-warning');
                const warnTxt = document.getElementById('viz-wave-perf-warning-text');
                if (!warn || !warnTxt) return;

                const lines    = window.vizWaveLines        || 1;
                const trail    = !!window.vizWaveTrail;
                const duration = window.vizWaveTrailAmount  || 0.30;

                // Уровни нагрузки
                const heavyLines    = lines >= 6;
                const heavyTrail    = trail && duration >= 2.5;
                const mediumLines   = lines >= 4;
                const mediumTrail   = trail && duration >= 1.0;
                const anyTrail      = trail;

                let msg = '';

                if (heavyLines && heavyTrail) {
                    msg = `Высокая нагрузка: ${lines} линий + след ${duration.toFixed(2)} с. Возможны просадки FPS.`;
                } else if (heavyLines) {
                    msg = `${lines} линий могут снизить производительность на слабых устройствах.`;
                } else if (heavyTrail) {
                    msg = `Длинный след (${duration.toFixed(2)} с) увеличивает количество прорисовок. Возможны просадки FPS.`;
                } else if (mediumLines && mediumTrail) {
                    msg = `${lines} линий + след ${duration.toFixed(2)} с — умеренная нагрузка на GPU.`;
                } else if (mediumLines && anyTrail) {
                    msg = `${lines} линий с угасающим следом — умеренная нагрузка на GPU.`;
                }

                const show = msg.length > 0;
                setSettingsBlockVisible(warn, show, 'flex');
                warnTxt.textContent = msg;
                if (show) lucide.createIcons({ nodes: [warn] });
            }

            // ---- APPEARANCE: Waveform trail ----
            const settingWaveTrail = document.getElementById('setting-viz-wave-trail');
            const vizWaveTrailRow  = document.getElementById('viz-wave-trail-row');
            function applyWaveTrailRowVisibility(checked) {
                setSettingsBlockVisible(vizWaveTrailRow, checked, 'block');
            }
            if (settingWaveTrail) settingWaveTrail.addEventListener('change', () => {
                window.vizWaveTrail = settingWaveTrail.checked;
                appStorage.setItem('setting_viz_wave_trail', settingWaveTrail.checked ? '1' : '0');
                applyWaveTrailRowVisibility(settingWaveTrail.checked);
                checkWaveformPerfWarning();
            });

            const waveTrailAmountSlider = document.getElementById('setting-viz-wave-trail-amount');
            const waveTrailAmountLabel  = document.getElementById('setting-viz-wave-trail-amount-label');
            if (waveTrailAmountSlider) waveTrailAmountSlider.addEventListener('input', () => {
                window.vizWaveTrailAmount = parseFloat(waveTrailAmountSlider.value);
                waveTrailAmountLabel.textContent = parseFloat(waveTrailAmountSlider.value).toFixed(2);
                appStorage.setItem('setting_viz_wave_trail_amount', waveTrailAmountSlider.value);
                checkWaveformPerfWarning();
            });

            const settingWaveHideSilence = document.getElementById('setting-viz-wave-hide-silence');
            if (settingWaveHideSilence) settingWaveHideSilence.addEventListener('change', () => {
                window.vizHideOnSilence = settingWaveHideSilence.checked;
                if (!settingWaveHideSilence.checked) window._waveAlpha = 1;
                appStorage.setItem('setting_viz_wave_hide_silence', settingWaveHideSilence.checked ? '1' : '0');
            });

            // ---- APPEARANCE: Waveform scroll speed ----
            const scrollSpeedWaveSlider = document.getElementById('setting-viz-scroll-speed-wave');
            const scrollSpeedWaveLabel  = document.getElementById('setting-viz-scroll-speed-wave-label');
            if (scrollSpeedWaveSlider) scrollSpeedWaveSlider.addEventListener('input', () => {
                window.vizScrollSpeedWave = parseFloat(scrollSpeedWaveSlider.value);
                scrollSpeedWaveLabel.textContent = parseFloat(scrollSpeedWaveSlider.value).toFixed(1);
                appStorage.setItem('setting_viz_scroll_speed_wave', scrollSpeedWaveSlider.value);
            });

            // ---- APPEARANCE: Waveform lines count ----
            const waveLineSlider = document.getElementById('setting-viz-wave-lines');
            const waveLineLabel  = document.getElementById('setting-viz-wave-lines-label');
            if (waveLineSlider) waveLineSlider.addEventListener('input', () => {
                window.vizWaveLines = parseInt(waveLineSlider.value);
                waveLineLabel.textContent = waveLineSlider.value;
                appStorage.setItem('setting_viz_wave_lines', waveLineSlider.value);
                // Сбрасываем историю при смене кол-ва линий
                window._waveHistory = null;
                checkWaveformPerfWarning();
            });
            const waveSensSlider = document.getElementById('setting-viz-wave-sens');
            const waveSensLabel  = document.getElementById('setting-viz-wave-sens-label');
            if (waveSensSlider) waveSensSlider.addEventListener('input', () => {
                window.vizWaveSens = parseFloat(waveSensSlider.value);
                waveSensLabel.textContent = parseFloat(waveSensSlider.value).toFixed(1);
                appStorage.setItem('setting_viz_wave_sens', waveSensSlider.value);
            });

            function updateInnerVizRowVisibility() { /* legacy compat */ }
            const settingShowEq = document.getElementById('setting-show-eq-btn');
            settingShowEq.addEventListener('change', () => {
                openEqBtn.style.display = settingShowEq.checked ? '' : 'none';
                appStorage.setItem('setting_show_eq_btn', settingShowEq.checked ? '1' : '0');
            });

            // ---- PLAYER: Playback speed ----
            const speedSlider = document.getElementById('setting-playback-speed');
            const speedLabel = document.getElementById('setting-playback-speed-label');
            function applyPlaybackSpeed(v) {
                const label = v.toFixed(1) + '×';
                speedSlider.value = v;
                speedLabel.textContent = label;
                const mainSlider = document.getElementById('main-speed-slider');
                const mainLabel = document.getElementById('main-speed-label');
                if (mainSlider) mainSlider.value = v;
                if (mainLabel) mainLabel.textContent = label;
                if (localAudioElement) localAudioElement.playbackRate = v;
                appStorage.setItem('setting_playback_speed', v);
                // Пересчитываем start/endTimestamp для Discord RPC сразу — иначе полоска
                // прогресса в Discord останется рассинхронизирована до следующего
                // периодического пуша (раз в 20с, см. pushDiscordActivity в audio-engine.js).
                if (typeof pushDiscordActivity === 'function') pushDiscordActivity();
            }

            speedSlider.addEventListener('input', () => applyPlaybackSpeed(parseFloat(speedSlider.value)));

            document.getElementById('main-speed-slider').addEventListener('input', function() {
                applyPlaybackSpeed(parseFloat(this.value));
            });

            // ---- PLAYER: Balance slider ----
            const balanceSlider = document.getElementById('setting-balance');
            const balanceLabel  = document.getElementById('setting-balance-label');
            function applyBalance(sliderVal) {
                const display = 50 - sliderVal; // +50 (L) … 0 … -50 (R)
                balanceLabel.textContent = display > 0 ? '+' + display : String(display);
                if (window.pannerNode) {
                    window.pannerNode.pan.value = (sliderVal - 50) / 50; // -1…0…+1
                }
                appStorage.setItem('setting_balance', sliderVal);
            }
            balanceSlider.addEventListener('input', () => applyBalance(parseInt(balanceSlider.value)));

            balanceSlider.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                balanceSlider.value = 50;
                applyBalance(50);
            });

            // ---- PLAYER: Playback mode dropdown ----
            const pbModeBtn   = document.getElementById('pb-mode-dropdown-btn');
            const pbModeMenu  = document.getElementById('pb-mode-dropdown-menu');
            const pbModeLabel = document.getElementById('pb-mode-label');

            const PB_MODE_NAMES = {
                'stereo': 'Стерео',
                'mono':   'Моно',
                'left':   'Только левый канал',
                'right':  'Только правый канал',
                'swap':   'Инвертированное стерео',
            };
            const PB_MODE_ICONS = {
                'stereo': 'headphones',
                'mono':   'minus-circle',
                'left':   'arrow-left-circle',
                'right':  'arrow-right-circle',
                'swap':   'repeat-2',
            };

            function selectPbMode(mode) {
                applyChannelMode(mode);
                appStorage.setItem('setting_pb_mode', mode);
                pbModeLabel.textContent = PB_MODE_NAMES[mode] || mode;
                const icon = PB_MODE_ICONS[mode] || 'headphones';
                pbModeBtn.querySelector('.pd-icon').innerHTML =
                    `<i data-lucide="${icon}" style="width:14px;height:14px;"></i>`;
                pbModeMenu.querySelectorAll('.pb-mode-menu-item').forEach(el =>
                    el.classList.toggle('active', el.dataset.mode === mode));
                lucide.createIcons();
            }

            pbModeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const open = pbModeMenu.classList.toggle('open');
                pbModeBtn.classList.toggle('open', open);
            });
            document.addEventListener('click', () => {
                pbModeMenu.classList.remove('open');
                pbModeBtn.classList.remove('open');
            });
            pbModeMenu.addEventListener('click', (e) => {
                const item = e.target.closest('.pb-mode-menu-item');
                if (!item) return;
                e.stopPropagation();
                selectPbMode(item.dataset.mode);
                pbModeMenu.classList.remove('open');
                pbModeBtn.classList.remove('open');
            });

            // ---- PLAYER: Show cover art toggle ----
            const settingShowCover = document.getElementById('setting-show-cover');
            settingShowCover.addEventListener('change', () => {
                document.body.classList.toggle('show-covers', settingShowCover.checked);
                appStorage.setItem('setting_show_cover', settingShowCover.checked ? '1' : '0');
            });

            // ---- PLAYER: Auto-refresh playlist ----
            const settingAutoRefresh = document.getElementById('setting-auto-refresh');
            const autoRefreshIntervalRow = document.getElementById('auto-refresh-interval-row');
            const autoRefreshSlider = document.getElementById('setting-auto-refresh-interval');
            const autoRefreshLabel = document.getElementById('setting-auto-refresh-label');
            let _autoRefreshTimer = null;

            function startAutoRefresh(intervalSec) {
                stopAutoRefresh();
                _autoRefreshTimer = setInterval(() => {
                    const pl = userPlaylists.find(p => p.id === currentPlaylistId);
                    if (pl && pl.type === 'folder') appendNewTracksFromDirectory(pl.path);
                }, intervalSec * 1000);
            }
            function stopAutoRefresh() {
                if (_autoRefreshTimer) { clearInterval(_autoRefreshTimer); _autoRefreshTimer = null; }
            }

            settingAutoRefresh.addEventListener('change', () => {
                const on = settingAutoRefresh.checked;
                setSettingsBlockVisible(autoRefreshIntervalRow, on, 'flex');
                appStorage.setItem('setting_auto_refresh', on ? '1' : '0');
                if (on) startAutoRefresh(parseInt(autoRefreshSlider.value));
                else stopAutoRefresh();
            });
            autoRefreshSlider.addEventListener('input', () => {
                const v = parseInt(autoRefreshSlider.value);
                autoRefreshLabel.textContent = v + 'с';
                appStorage.setItem('setting_auto_refresh_interval', v);
                if (settingAutoRefresh.checked) startAutoRefresh(v);
            });

            // Restore auto-refresh settings
            const savedAutoRefresh = appStorage.getItem('setting_auto_refresh');
            const savedAutoRefreshInterval = parseInt(appStorage.getItem('setting_auto_refresh_interval') || '30');
            if (!isNaN(savedAutoRefreshInterval)) {
                autoRefreshSlider.value = savedAutoRefreshInterval;
                autoRefreshLabel.textContent = savedAutoRefreshInterval + 'с';
            }
            if (savedAutoRefresh === '1') {
                settingAutoRefresh.checked = true;
                autoRefreshIntervalRow.style.display = 'flex';
                startAutoRefresh(savedAutoRefreshInterval);
            }

            // ---- APPEARANCE: Dark theme toggle in settings ----
            const settingDark = document.getElementById('setting-dark-theme');
            settingDark.addEventListener('change', () => {
                if (settingDark.checked) {
                    document.body.setAttribute('data-theme', 'dark');
                    appStorage.setItem('player_theme', 'dark');
                    themeToggle.innerHTML = '<i data-lucide="sun"></i>';
                } else {
                    document.body.removeAttribute('data-theme');
                    appStorage.setItem('player_theme', 'light');
                    themeToggle.innerHTML = '<i data-lucide="moon"></i>';
                }
                lucide.createIcons();
            });
            // Sync with main theme toggle
            themeToggle.addEventListener('click', () => {
                settingDark.checked = document.body.getAttribute('data-theme') === 'dark';
            });

            // ---- APPEARANCE: Accent color swatches ----
            const swatches = document.querySelectorAll('.accent-swatch');
            const colorPicker = document.getElementById('accent-color-picker');
            function setAccentColor(color) {
                document.documentElement.style.setProperty('--accent-color', color);
                document.body.style.setProperty('--accent-color', color);
                appStorage.setItem('setting_accent_color', color);
                colorPicker.value = color;
                swatches.forEach(s => s.classList.toggle('active', s.dataset.color === color));
            }
            swatches.forEach(s => s.addEventListener('click', () => setAccentColor(s.dataset.color)));
            colorPicker.addEventListener('input', () => setAccentColor(colorPicker.value));

            // Viz style buttons — теперь через dropdown (legacy removed)

            // ---- APPEARANCE: Show/hide visualizer ----
            const settingViz = document.getElementById('setting-show-visualizer');
            function applyVizVisibility(show) {
                canvas.style.opacity = show ? '1' : '0';
                const adv = document.getElementById('viz-advanced-settings');
                setSettingsBlockVisible(adv, show, 'flex');
            }
            settingViz.addEventListener('change', () => {
                applyVizVisibility(settingViz.checked);
                appStorage.setItem('setting_show_viz', settingViz.checked ? '1' : '0');
            });

            // ---- APPEARANCE: Show/hide stars ----
            const settingStars = document.getElementById('setting-show-stars');
            const settingStarsInteractive = document.getElementById('setting-stars-interactive');
            const starsInteractiveRow = document.getElementById('stars-interactive-row');

            function applyStarsInteractiveRowVisibility(starsOn) {
                setSettingsBlockVisible(starsInteractiveRow, starsOn, '');
            }
            settingStars.addEventListener('change', () => {
                starCanvas.style.opacity = settingStars.checked ? '1' : '0';
                appStorage.setItem('setting_show_stars', settingStars.checked ? '1' : '0');
                applyStarsInteractiveRowVisibility(settingStars.checked);
            });

            if (settingStarsInteractive) settingStarsInteractive.addEventListener('change', () => {
                window.starsInteractive = settingStarsInteractive.checked;
                appStorage.setItem('setting_stars_interactive', settingStarsInteractive.checked ? '1' : '0');
            });

            // ---- APPEARANCE: Confetti ----
            const settingConfetti = document.getElementById('setting-confetti');
            const confettiBlock = document.getElementById('confetti-settings-block');

            function applyConfettiVisibility(enabled) {
                setSettingsBlockVisible(confettiBlock, enabled, 'flex');
                confettiCanvas.style.opacity = enabled ? '1' : '0';
                window.confettiEnabled = enabled;
            }
            settingConfetti.addEventListener('change', () => {
                applyConfettiVisibility(settingConfetti.checked);
                appStorage.setItem('setting_confetti', settingConfetti.checked ? '1' : '0');
            });

            // ── Spawn mode dropdown ────────────────────────────────────────
            const CONFETTI_SPAWN_MODES = {
                top:       { label: 'Сверху',          icon: 'arrow-down'      },
                bottom:    { label: 'Снизу',           icon: 'arrow-up'        },
                sides:     { label: 'С краёв',         icon: 'arrow-left-right'},
                center:    { label: 'Из центра',       icon: 'crosshair'       },
                corners:   { label: 'Из углов',        icon: 'maximize-2'      },
                random:    { label: 'Случайно',        icon: 'shuffle'         },
                sprinkler: { label: 'Разбрызгиватель', icon: 'sparkles'        },
            };
            const spawnDropBtn    = document.getElementById('confetti-spawn-dropdown-btn');
            const spawnDropMenu   = document.getElementById('confetti-spawn-dropdown-menu');
            const spawnLabel      = document.getElementById('confetti-spawn-label');
            const sprinklerRow    = document.getElementById('confetti-sprinkler-row');

            function selectConfettiSpawn(mode) {
                window.confettiSpawnMode = mode;
                confettiParticles = [];
                // Update dropdown label & icon
                const info = CONFETTI_SPAWN_MODES[mode] || CONFETTI_SPAWN_MODES.top;
                spawnLabel.textContent = info.label;
                spawnDropBtn.querySelector('.pd-icon').innerHTML =
                    `<i data-lucide="${info.icon}" style="width:14px;height:14px;"></i>`;
                // Highlight active item
                if (spawnDropMenu) spawnDropMenu.querySelectorAll('.viz-type-menu-item').forEach(el =>
                    el.classList.toggle('active', el.dataset.mode === mode));
                // Show/hide sprinkler rows (lines + sensitivity)
                setSettingsBlockVisible(sprinklerRow, mode === 'sprinkler', 'block');
                // Reset sprinkler state on mode change
                if (mode !== 'sprinkler') { window._sprinklerAngle = 0; window._sprinklerCooldown = 0; }
                appStorage.setItem('setting_confetti_spawn', mode);
                lucide.createIcons();
            }

            if (spawnDropBtn) spawnDropBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const open = spawnDropMenu.classList.toggle('open');
                spawnDropBtn.classList.toggle('open', open);
            });
            document.addEventListener('click', () => {
                if (spawnDropMenu) { spawnDropMenu.classList.remove('open'); }
                if (spawnDropBtn)  { spawnDropBtn.classList.remove('open'); }
            });
            if (spawnDropMenu) spawnDropMenu.addEventListener('click', (e) => {
                const item = e.target.closest('.viz-type-menu-item');
                if (!item) return;
                e.stopPropagation();
                selectConfettiSpawn(item.dataset.mode);
                spawnDropMenu.classList.remove('open');
                spawnDropBtn.classList.remove('open');
            });
            selectConfettiSpawn('top'); // default highlight

            // ── Sprinkler lines slider ────────────────────────────────────
            const sprinklerLinesSlider = document.getElementById('setting-confetti-sprinkler-lines');
            const sprinklerLinesLabel  = document.getElementById('setting-confetti-sprinkler-lines-label');
            if (sprinklerLinesSlider) sprinklerLinesSlider.addEventListener('input', () => {
                const v = parseInt(sprinklerLinesSlider.value);
                sprinklerLinesLabel.textContent = v;
                window.confettiSprinklerLines = v;
                appStorage.setItem('setting_confetti_sprinkler_lines', v);
            });

            // ── Beat sensitivity slider ───────────────────────────────────
            const sensitivitySlider = document.getElementById('setting-confetti-sensitivity');
            const sensitivityLabel  = document.getElementById('setting-confetti-sensitivity-label');
            if (sensitivitySlider) sensitivitySlider.addEventListener('input', () => {
                const v = parseFloat(sensitivitySlider.value);
                if (sensitivityLabel) sensitivityLabel.textContent = v.toFixed(1);
                window.confettiSensitivity = v;
                appStorage.setItem('setting_confetti_sensitivity', v);
            });

            // ── Gradient color pickers ────────────────────────────────
            const confettiC1 = document.getElementById('confetti-color1');
            const confettiC2 = document.getElementById('confetti-color2');
            const confettiC3 = document.getElementById('confetti-color3');
            function applyConfettiColors() {
                window.confettiColor1 = confettiC1.value;
                window.confettiColor2 = confettiC2.value;
                window.confettiColor3 = confettiC3.value;
                appStorage.setItem('setting_confetti_grad', JSON.stringify([confettiC1.value, confettiC2.value, confettiC3.value]));
                highlightActiveConfettiPreset();
            }
            confettiC1.addEventListener('input', applyConfettiColors);
            confettiC2.addEventListener('input', applyConfettiColors);
            confettiC3.addEventListener('input', applyConfettiColors);
            document.getElementById('confetti-grad-reset').addEventListener('click', () => {
                confettiC1.value = '#ff6b9d'; confettiC2.value = '#c44dff'; confettiC3.value = '#4daaff';
                applyConfettiColors();
            });
            const CONFETTI_PRESETS = [
                ['#ff6b9d','#c44dff','#4daaff'],
                ['#bb86fc','#4a90e2','#03dac6'],
                ['#ff9a3c','#ff6b35','#ffd700'],
                ['#2ecc71','#1abc9c','#a8ff78'],
                ['#e74c3c','#e91e8c','#bb86fc'],
                ['#ffffff','#e0e0e0','#bbbbbb'],
            ];
            function highlightActiveConfettiPreset() {
                document.querySelectorAll('#confetti-grad-presets .grad-preset').forEach((el, i) => {
                    const [p1,p2,p3] = CONFETTI_PRESETS[i] || [];
                    el.classList.toggle('active', p1 === confettiC1.value && p2 === confettiC2.value && p3 === confettiC3.value);
                });
            }
            document.querySelectorAll('#confetti-grad-presets .grad-preset').forEach((el, i) => {
                el.addEventListener('click', () => {
                    const [p1,p2,p3] = CONFETTI_PRESETS[i];
                    confettiC1.value = p1; confettiC2.value = p2; confettiC3.value = p3;
                    applyConfettiColors();
                });
            });

            // ── Intensity ─────────────────────────────────────────────
            const confettiIntSlider = document.getElementById('setting-confetti-intensity');
            const confettiIntLabel  = document.getElementById('setting-confetti-intensity-label');
            confettiIntSlider.addEventListener('input', () => {
                const v = parseFloat(confettiIntSlider.value);
                confettiIntLabel.textContent = v.toFixed(1);
                window.confettiIntensity = v;
                appStorage.setItem('setting_confetti_intensity', v);
            });

            // ── Gravity ───────────────────────────────────────────────
            const confettiGravSlider = document.getElementById('setting-confetti-gravity');
            const confettiGravLabel  = document.getElementById('setting-confetti-gravity-label');
            confettiGravSlider.addEventListener('input', () => {
                const v = parseFloat(confettiGravSlider.value);
                confettiGravLabel.textContent = v.toFixed(1);
                window.confettiGravity = v;
                appStorage.setItem('setting_confetti_gravity', v);
            });

            // ── Particle size ─────────────────────────────────────────
            const confettiSizeSlider = document.getElementById('setting-confetti-size');
            const confettiSizeLabel  = document.getElementById('setting-confetti-size-label');
            confettiSizeSlider.addEventListener('input', () => {
                const v = parseFloat(confettiSizeSlider.value);
                confettiSizeLabel.textContent = v.toFixed(1);
                window.confettiSizeScale = v;
                appStorage.setItem('setting_confetti_size', v);
            });

            // ── Swirl toggle + strength ───────────────────────────────
            const settingConfettiSwirl   = document.getElementById('setting-confetti-swirl');
            const confettiSwirlRow       = document.getElementById('confetti-swirl-row');
            const confettiSwirlStrSlider = document.getElementById('setting-confetti-swirl-str');
            const confettiSwirlStrLabel  = document.getElementById('setting-confetti-swirl-str-label');

            function applySwirlRowVisibility(enabled) {
                setSettingsBlockVisible(confettiSwirlRow, enabled, 'block');
            }
            settingConfettiSwirl.addEventListener('change', () => {
                window.confettiSwirl = settingConfettiSwirl.checked;
                applySwirlRowVisibility(settingConfettiSwirl.checked);
                appStorage.setItem('setting_confetti_swirl', settingConfettiSwirl.checked ? '1' : '0');
            });
            confettiSwirlStrSlider.addEventListener('input', () => {
                const v = parseFloat(confettiSwirlStrSlider.value);
                confettiSwirlStrLabel.textContent = v.toFixed(1);
                window.confettiSwirlStr = v;
                appStorage.setItem('setting_confetti_swirl_str', v);
            });

            // ── Idle state buttons ────────────────────────────────────
            const CONFETTI_IDLE_IDS = ['off','drift','pulse'];
            function selectConfettiIdle(state) {
                window.confettiIdleState = state;
                CONFETTI_IDLE_IDS.forEach(id => {
                    const btn = document.getElementById('confetti-idle-' + id);
                    if (!btn) return;
                    const active = id === state;
                    btn.style.background  = active ? 'var(--accent-color)' : 'var(--track-hover)';
                    btn.style.color       = active ? '#fff' : 'var(--text-color)';
                    btn.style.borderColor = active ? 'var(--accent-color)' : 'var(--border-color)';
                });
                appStorage.setItem('setting_confetti_idle', state);
            }
            CONFETTI_IDLE_IDS.forEach(id => {
                const btn = document.getElementById('confetti-idle-' + id);
                if (btn) btn.addEventListener('click', () => selectConfettiIdle(id));
            });
            selectConfettiIdle('drift'); // default highlight

            // ---- APPEARANCE: Visualizer intensity ----
            const vizIntSlider = document.getElementById('setting-viz-intensity');
            const vizIntLabel = document.getElementById('setting-viz-intensity-label');
            vizIntSlider.addEventListener('input', () => {
                const v = parseFloat(vizIntSlider.value);
                vizIntLabel.textContent = v.toFixed(1);
                window.vizIntensity = v;
                appStorage.setItem('setting_viz_intensity', v);
            });

            // ---- APPEARANCE: Glass blur ----
            // Управляет backdrop-filter на всех стеклянных элементах через CSS-класс body.no-blur
            const settingBlur = document.getElementById('setting-glass-blur');
            function applyBlurSetting(enabled) {
                document.body.classList.toggle('no-blur', !enabled);
            }
            settingBlur.addEventListener('change', () => {
                applyBlurSetting(settingBlur.checked);
                appStorage.setItem('setting_glass_blur', settingBlur.checked ? '1' : '0');
            });

            // ---- APPEARANCE: Custom background image ----
            const settingBgEnabled    = document.getElementById('setting-bg-image-enabled');
            const bgAdvancedSettings  = document.getElementById('bg-image-advanced-settings');
            const bgImageThumb        = document.getElementById('bg-image-thumb');
            const bgImageFilename     = document.getElementById('bg-image-filename');
            const btnChooseBgImage    = document.getElementById('btn-choose-bg-image');
            const btnRemoveBgImage    = document.getElementById('btn-remove-bg-image');
            const bgRecentRow         = document.getElementById('bg-recent-row');
            const bgRecentList        = document.getElementById('bg-recent-list');

            function applyBgImageEnabled(enabled) {
                window.bgImageEnabled = enabled;
                customBgLayer.style.opacity = enabled ? '1' : '0';
                setSettingsBlockVisible(bgAdvancedSettings, enabled, 'flex');
                // Видео не крутим вхолостую, когда фон выключен
                if (window.bgImageIsVideo && customBgVideoEl.getAttribute('src')) {
                    if (enabled) { const p = customBgVideoEl.play(); if (p && p.catch) p.catch(() => {}); }
                    else customBgVideoEl.pause();
                }
            }
            settingBgEnabled.addEventListener('change', () => {
                applyBgImageEnabled(settingBgEnabled.checked);
                appStorage.setItem('setting_bg_image_enabled', settingBgEnabled.checked ? '1' : '0');
            });

            const BG_VIDEO_EXTS = ['mp4', 'webm', 'mkv', 'mov', 'm4v', 'ogv', 'avi'];
            function isVideoBgFile(p) {
                const ext = (String(p).split('.').pop() || '').toLowerCase();
                return BG_VIDEO_EXTS.includes(ext);
            }

            // ── Статичный кадр из видео (для превью) ──────────────────────────
            // <video> не умеет рисовать кадры через CSS background-image, поэтому
            // декодируем один кадр в скрытом <video>, рисуем его на <canvas> и
            // получаем обычную картинку (data URL), которую уже можно показать
            // как превью — как для миниатюры в настройках, так и в «Недавних».
            function generateBgVideoThumbnail(fileUrl) {
                return new Promise((resolve) => {
                    const tempVideo = document.createElement('video');
                    tempVideo.muted = true;
                    tempVideo.preload = 'auto';
                    tempVideo.src = fileUrl;

                    let settled = false;
                    const finish = (result) => {
                        if (settled) return;
                        settled = true;
                        try { tempVideo.removeAttribute('src'); tempVideo.load(); } catch (e) {}
                        resolve(result);
                    };

                    tempVideo.addEventListener('loadeddata', () => {
                        try {
                            // Небольшой отступ от начала — у многих видео первый кадр чёрный
                            tempVideo.currentTime = Math.min(0.8, (tempVideo.duration || 1.6) / 4) || 0.05;
                        } catch (e) { finish(null); }
                    });
                    tempVideo.addEventListener('seeked', () => {
                        try {
                            const frameCanvas = document.createElement('canvas');
                            frameCanvas.width = tempVideo.videoWidth || 320;
                            frameCanvas.height = tempVideo.videoHeight || 180;
                            frameCanvas.getContext('2d').drawImage(tempVideo, 0, 0, frameCanvas.width, frameCanvas.height);
                            finish(frameCanvas.toDataURL('image/jpeg', 0.72));
                        } catch (e) {
                            finish(null); // например, кодек не поддерживается для рисования на canvas
                        }
                    });
                    tempVideo.addEventListener('error', () => finish(null));
                    setTimeout(() => finish(null), 4000); // защита от зависания на «битых» файлах
                });
            }

            // ── Недавние фоны (до 5, с превью; можно установить или удалить) ──
            const BG_RECENT_KEY = 'setting_bg_recent_list';
            const BG_RECENT_MAX = 5;

            function getRecentBackgrounds() {
                try {
                    const list = JSON.parse(appStorage.getItem(BG_RECENT_KEY) || '[]');
                    return Array.isArray(list) ? list : [];
                } catch (e) { return []; }
            }

            function saveRecentBackgrounds(list) {
                try { appStorage.setItem(BG_RECENT_KEY, JSON.stringify(list)); } catch (e) {}
            }

            // bumpToFront: true — поднять в начало списка (явный выбор пользователем);
            // false — тихо обновить запись (например, досчитанное превью при восстановлении),
            // не меняя порядок.
            function addRecentBackground(filePath, isVideo, thumb, bumpToFront) {
                let list = getRecentBackgrounds();
                const existingIdx = list.findIndex(it => it.path === filePath);
                const existing = existingIdx !== -1 ? list[existingIdx] : null;
                const entry = { path: filePath, isVideo, thumb: thumb || (existing ? existing.thumb : null) };

                if (existingIdx !== -1) list.splice(existingIdx, 1);
                if (bumpToFront || !existing) list.unshift(entry);
                else list.splice(existingIdx, 0, entry);

                if (list.length > BG_RECENT_MAX) list = list.slice(0, BG_RECENT_MAX);
                saveRecentBackgrounds(list);
                renderRecentBackgrounds();
            }

            function removeRecentBackground(filePath) {
                saveRecentBackgrounds(getRecentBackgrounds().filter(it => it.path !== filePath));
                renderRecentBackgrounds();
            }

            function renderRecentBackgrounds() {
                if (!bgRecentRow || !bgRecentList) return;
                const list = getRecentBackgrounds();
                bgRecentRow.style.display = list.length ? 'flex' : 'none';
                bgRecentList.innerHTML = '';

                list.forEach((item) => {
                    let thumbUrl = item.thumb;
                    if (!thumbUrl && !item.isVideo) {
                        try { thumbUrl = noctune.fs.toFileUrl(item.path); } catch (e) { thumbUrl = null; }
                    }
                    const isActive = window.bgImagePath === item.path;

                    const cell = document.createElement('div');
                    cell.className = 'bg-recent-item';
                    try { cell.title = noctune.fs.basename(item.path); } catch (e) {}
                    cell.style.cssText = `position:relative;width:52px;height:52px;border-radius:8px;overflow:hidden;cursor:pointer;flex-shrink:0;background-color:var(--track-hover);background-size:cover;background-position:center;background-repeat:no-repeat;border:2px solid ${isActive ? 'var(--accent-color)' : 'var(--border-color)'};`;
                    if (thumbUrl) cell.style.backgroundImage = `url("${thumbUrl}")`;

                    if (item.isVideo) {
                        const badge = document.createElement('div');
                        badge.style.cssText = 'position:absolute;bottom:2px;right:2px;background:rgba(0,0,0,0.55);border-radius:4px;padding:2px;display:flex;align-items:center;justify-content:center;';
                        badge.innerHTML = '<i data-lucide="video" style="width:11px;height:11px;color:#fff;"></i>';
                        cell.appendChild(badge);
                    }

                    const removeBtn = document.createElement('button');
                    removeBtn.type = 'button';
                    removeBtn.title = 'Удалить из недавних';
                    // Тёмный полупрозрачный фон + белая иконка — как у бейджа видео выше,
                    // намеренно НЕ завязано на тему/акцент (var(--bg-secondary)/var(--text-primary)
                    // раньше не существовали в палитре, из-за чего в светлой теме крестик
                    // становился практически невидимым — тёмно-серый фон + тёмная иконка).
                    removeBtn.style.cssText = 'position:absolute;top:-5px;right:-5px;width:18px;height:18px;border-radius:50%;background:rgba(0,0,0,0.65);border:1px solid rgba(255,255,255,0.25);display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;';
                    removeBtn.innerHTML = '<i data-lucide="x" style="width:10px;height:10px;color:#fff;"></i>';
                    removeBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        removeRecentBackground(item.path);
                    });
                    cell.appendChild(removeBtn);

                    cell.addEventListener('click', async () => {
                        try {
                            if (!(await noctune.fs.exists(item.path))) {
                                showNotification('Файл фона больше не найден на диске', 'error');
                                removeRecentBackground(item.path);
                                return;
                            }
                        } catch (e) {}
                        applyBgImagePath(item.path, true);
                    });

                    bgRecentList.appendChild(cell);
                });

                lucide.createIcons();
            }

            // ── Плавная смена обоев (кроссфейд) ───────────────────────────────
            // Делаем «снимок» того, что видно прямо сейчас (картинка — просто
            // её CSS background-image, видео — кадр, нарисованный на canvas),
            // показываем этот снимок сверху на полной непрозрачности, подменяем
            // реальный фон под ним, а затем плавно гасим снимок — снизу
            // проступает новый фон. Снаружи выглядит как обычный кроссфейд.
            function snapshotCurrentBgFrame() {
                try {
                    if (customBgVideoEl.style.display !== 'none' && customBgVideoEl.readyState >= 2 && customBgVideoEl.videoWidth) {
                        const c = document.createElement('canvas');
                        c.width = customBgVideoEl.videoWidth;
                        c.height = customBgVideoEl.videoHeight;
                        c.getContext('2d').drawImage(customBgVideoEl, 0, 0, c.width, c.height);
                        return `url("${c.toDataURL('image/jpeg', 0.82)}")`;
                    }
                    if (customBgImageEl.style.display !== 'none' && customBgImageEl.style.backgroundImage) {
                        return customBgImageEl.style.backgroundImage;
                    }
                } catch (e) {
                    // Например, SecurityError на некоторых видео — тогда просто без кроссфейда
                }
                return null;
            }

            let _bgCrossfadeClearTimer = null;
            function playBgCrossfade(prevSnapshotCss, prevFit) {
                if (!customBgImagePrevEl || !prevSnapshotCss) return;
                if (_bgCrossfadeClearTimer) { clearTimeout(_bgCrossfadeClearTimer); _bgCrossfadeClearTimer = null; }
                customBgImagePrevEl.style.transition = 'none';
                customBgImagePrevEl.style.backgroundSize = BG_FIT_CSS[prevFit] || 'cover';
                customBgImagePrevEl.style.backgroundImage = prevSnapshotCss;
                customBgImagePrevEl.style.opacity = '1';
                // Форсируем применение стилей без анимации, прежде чем включить transition
                void customBgImagePrevEl.offsetWidth;
                requestAnimationFrame(() => {
                    customBgImagePrevEl.style.transition = 'opacity 0.6s ease';
                    customBgImagePrevEl.style.opacity = '0';
                });
                _bgCrossfadeClearTimer = setTimeout(() => {
                    customBgImagePrevEl.style.backgroundImage = '';
                }, 650);
            }

            function applyBgImagePath(filePath, persist) {
                if (!filePath) return;
                try {
                    const fileUrl = noctune.fs.toFileUrl(filePath);
                    const isVideo = isVideoBgFile(filePath);

                    // Снимаем «слепок» текущего фона ДО подмены — но только если
                    // фон реально меняется на другой (а не повторно тот же самый),
                    // и это не первая загрузка фона за сеанс (иначе кроссфейд не
                    // от чего отталкивать, получится бесполезная вспышка).
                    const isRealChange = window.bgImagePath && window.bgImagePath !== filePath;
                    const prevSnapshot = isRealChange ? snapshotCurrentBgFrame() : null;
                    const prevFit = window.bgImageFit || 'cover';

                    window.bgImageIsVideo = isVideo;
                    // Выставляем заранее, чтобы подсветка «активного» в списке
                    // недавних фонов сразу указывала на верный элемент.
                    window.bgImagePath = filePath;

                    if (isVideo) {
                        // Видео-фон
                        customBgImageEl.style.backgroundImage = '';
                        customBgImageEl.style.display = 'none';
                        customBgVideoEl.setAttribute('src', fileUrl);
                        customBgVideoEl.style.display = 'block';
                        customBgVideoEl.load();
                        const p = customBgVideoEl.play();
                        if (p && p.catch) p.catch(() => {});

                        // Пока кадр не извлечён — нейтральный плейсхолдер вместо пустоты
                        bgImageThumb.style.backgroundImage = '';
                        generateBgVideoThumbnail(fileUrl).then((thumbDataUrl) => {
                            // Применяем превью только если за это время фон не сменился
                            if (thumbDataUrl && window.bgImagePath === filePath) {
                                bgImageThumb.style.backgroundImage = `url("${thumbDataUrl}")`;
                            }
                            addRecentBackground(filePath, true, thumbDataUrl, persist);
                            triggerAdaptiveRecompute();
                        });
                    } else {
                        // Картинка / GIF
                        customBgVideoEl.pause();
                        customBgVideoEl.removeAttribute('src');
                        customBgVideoEl.load();
                        customBgVideoEl.style.display = 'none';
                        customBgImageEl.style.backgroundImage = `url("${fileUrl}")`;
                        customBgImageEl.style.display = 'block';
                        bgImageThumb.style.backgroundImage = `url("${fileUrl}")`;
                        addRecentBackground(filePath, false, null, persist);
                        triggerAdaptiveRecompute();
                    }

                    // Применяем текущий режим подгона к активному элементу
                    applyBgFitToElements(window.bgImageFit || 'cover');

                    bgImageFilename.textContent = noctune.fs.basename(filePath);
                    btnRemoveBgImage.style.display = 'inline-flex';
                    if (persist) appStorage.setItem('setting_bg_image_path', filePath);

                    // Новый фон уже подставлен «под капотом» — теперь плавно
                    // убираем сверху снимок старого, открывая его.
                    if (prevSnapshot) playBgCrossfade(prevSnapshot, prevFit);
                } catch (e) {
                    console.error('Не удалось установить фон:', e);
                }
            }

            function clearBgImage() {
                const prevSnapshot = window.bgImagePath ? snapshotCurrentBgFrame() : null;
                const prevFit = window.bgImageFit || 'cover';

                customBgImageEl.style.backgroundImage = '';
                customBgImageEl.style.display = 'block';
                customBgVideoEl.pause();
                customBgVideoEl.removeAttribute('src');
                customBgVideoEl.load();
                customBgVideoEl.style.display = 'none';
                bgImageThumb.style.backgroundImage = '';
                bgImageFilename.textContent = 'Файл не выбран';
                btnRemoveBgImage.style.display = 'none';
                window.bgImagePath = null;
                window.bgImageIsVideo = false;
                appStorage.removeItem('setting_bg_image_path');
                renderRecentBackgrounds(); // снять подсветку «активного» с недавних

                // Плавно гасим снимок старого фона, открывая пустоту под ним,
                // вместо мгновенного исчезновения картинки.
                if (prevSnapshot) playBgCrossfade(prevSnapshot, prevFit);
            }

            btnChooseBgImage.addEventListener('click', async () => {
                try {
                    const filePath = await noctune.dialogOpenImage();
                    if (filePath) applyBgImagePath(filePath, true);
                } catch (e) {
                    console.error('Ошибка выбора изображения:', e);
                }
            });
            btnRemoveBgImage.addEventListener('click', clearBgImage);

            // ── Подгон по размеру (dropdown) ──
            const bgFitBtn   = document.getElementById('bg-fit-dropdown-btn');
            const bgFitMenu  = document.getElementById('bg-fit-dropdown-menu');
            const bgFitLabel = document.getElementById('bg-fit-label');
            const BG_FIT_CSS = { cover: 'cover', contain: 'contain', fill: '100% 100%' };
            const BG_FIT_OBJECT = { cover: 'cover', contain: 'contain', fill: 'fill' };

            function applyBgFitToElements(fit) {
                customBgImageEl.style.backgroundSize = BG_FIT_CSS[fit] || 'cover';
                customBgVideoEl.style.objectFit = BG_FIT_OBJECT[fit] || 'cover';
            }

            function selectBgFit(fit) {
                window.bgImageFit = fit;
                applyBgFitToElements(fit);
                const item = bgFitMenu.querySelector(`[data-fit="${fit}"]`);
                if (item) {
                    bgFitLabel.textContent = item.textContent.trim();
                    const iconName = item.dataset.icon;
                    bgFitBtn.querySelector('.pd-icon').innerHTML = `<i data-lucide="${iconName}" style="width:14px;height:14px;"></i>`;
                }
                bgFitMenu.querySelectorAll('.viz-type-menu-item').forEach(el =>
                    el.classList.toggle('active', el.dataset.fit === fit));
                appStorage.setItem('setting_bg_image_fit', fit);
                lucide.createIcons();
            }
            bgFitBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const open = bgFitMenu.classList.toggle('open');
                bgFitBtn.classList.toggle('open', open);
            });
            document.addEventListener('click', () => {
                bgFitMenu.classList.remove('open');
                bgFitBtn.classList.remove('open');
            });
            bgFitMenu.addEventListener('click', (e) => {
                const item = e.target.closest('.viz-type-menu-item');
                if (!item) return;
                e.stopPropagation();
                selectBgFit(item.dataset.fit);
                bgFitMenu.classList.remove('open');
                bgFitBtn.classList.remove('open');
            });

            // ── Пульсация под звук ──
            const settingBgPulse         = document.getElementById('setting-bg-pulse-enabled');
            const bgPulseIntensityRow    = document.getElementById('bg-pulse-intensity-row');
            const bgPulseIntensitySlider = document.getElementById('setting-bg-pulse-intensity');
            const bgPulseIntensityLabel  = document.getElementById('setting-bg-pulse-intensity-label');
            const bgPulseThresholdSlider = document.getElementById('setting-bg-pulse-threshold');
            const bgPulseThresholdLabel  = document.getElementById('setting-bg-pulse-threshold-label');

            function applyBgPulseRowVisibility(enabled) {
                setSettingsBlockVisible(bgPulseIntensityRow, enabled, 'block');
            }
            settingBgPulse.addEventListener('change', () => {
                window.bgPulseEnabled = settingBgPulse.checked;
                applyBgPulseRowVisibility(settingBgPulse.checked);
                appStorage.setItem('setting_bg_pulse_enabled', settingBgPulse.checked ? '1' : '0');
            });
            bgPulseIntensitySlider.addEventListener('input', () => {
                const v = parseFloat(bgPulseIntensitySlider.value);
                bgPulseIntensityLabel.textContent = v.toFixed(1);
                window.bgPulseIntensity = v;
                appStorage.setItem('setting_bg_pulse_intensity', v);
            });
            bgPulseThresholdSlider.addEventListener('input', () => {
                const v = parseFloat(bgPulseThresholdSlider.value);
                bgPulseThresholdLabel.textContent = v.toFixed(2);
                window.bgPulseThreshold = v;
                appStorage.setItem('setting_bg_pulse_threshold', v);
            });

            // ── Размытие под звук ──
            const settingBgBlur         = document.getElementById('setting-bg-blur-enabled');
            const bgBlurIntensityRow    = document.getElementById('bg-blur-intensity-row');
            const bgBlurIntensitySlider = document.getElementById('setting-bg-blur-intensity');
            const bgBlurIntensityLabel  = document.getElementById('setting-bg-blur-intensity-label');
            const bgBlurThresholdSlider = document.getElementById('setting-bg-blur-threshold');
            const bgBlurThresholdLabel  = document.getElementById('setting-bg-blur-threshold-label');

            function applyBgBlurRowVisibility(enabled) {
                setSettingsBlockVisible(bgBlurIntensityRow, enabled, 'block');
            }
            settingBgBlur.addEventListener('change', () => {
                window.bgBlurEnabled = settingBgBlur.checked;
                applyBgBlurRowVisibility(settingBgBlur.checked);
                appStorage.setItem('setting_bg_blur_enabled', settingBgBlur.checked ? '1' : '0');
            });
            bgBlurIntensitySlider.addEventListener('input', () => {
                const v = parseFloat(bgBlurIntensitySlider.value);
                bgBlurIntensityLabel.textContent = v.toFixed(1);
                window.bgBlurIntensity = v;
                appStorage.setItem('setting_bg_blur_intensity', v);
            });
            bgBlurThresholdSlider.addEventListener('input', () => {
                const v = parseFloat(bgBlurThresholdSlider.value);
                bgBlurThresholdLabel.textContent = v.toFixed(2);
                window.bgBlurThreshold = v;
                appStorage.setItem('setting_bg_blur_threshold', v);
            });

            // ── Свечение под звук ──
            const settingBgGlow         = document.getElementById('setting-bg-glow-enabled');
            const bgGlowIntensityRow    = document.getElementById('bg-glow-intensity-row');
            const bgGlowIntensitySlider = document.getElementById('setting-bg-glow-intensity');
            const bgGlowIntensityLabel  = document.getElementById('setting-bg-glow-intensity-label');
            const bgGlowThresholdSlider = document.getElementById('setting-bg-glow-threshold');
            const bgGlowThresholdLabel  = document.getElementById('setting-bg-glow-threshold-label');
            const bgGlowStyleBtn        = document.getElementById('bg-glow-style-dropdown-btn');
            const bgGlowStyleMenu       = document.getElementById('bg-glow-style-dropdown-menu');
            const bgGlowStyleLabel      = document.getElementById('bg-glow-style-label');
            const settingBgGlowCustomColor = document.getElementById('setting-bg-glow-custom-color');
            const bgGlowColorRow        = document.getElementById('bg-glow-color-row');
            const bgGlowColorPicker     = document.getElementById('bg-glow-color-picker');

            // Варианты «свечения»: разная форма градиента-сияния поверх обоев.
            // Цвет всегда подставляется снаружи (акцент или свой) — стиль лишь
            // задаёт форму/направление света.
            const BG_GLOW_STYLES = {
                center: { label: 'Из центра', icon: 'sun',           css: (c) => `radial-gradient(circle at 50% 50%, ${c} 0%, transparent 68%)` },
                edges:  { label: 'По краям',   icon: 'square',        css: (c) => `radial-gradient(circle at 50% 50%, transparent 38%, ${c} 115%)` },
                top:    { label: 'Сверху',     icon: 'arrow-down',    css: (c) => `linear-gradient(to bottom, ${c} 0%, transparent 65%)` },
                bottom: { label: 'Снизу',      icon: 'arrow-up',      css: (c) => `linear-gradient(to top, ${c} 0%, transparent 65%)` },
                ring:   { label: 'Кольцом',    icon: 'circle-dashed', css: (c) => `radial-gradient(circle at 50% 50%, transparent 30%, ${c} 55%, transparent 80%)` },
            };

            function applyBgGlowStyle() {
                if (!customBgGlowEl) return;
                const def = BG_GLOW_STYLES[window.bgGlowStyle] || BG_GLOW_STYLES.center;
                const color = window.bgGlowCustomColorEnabled ? (window.bgGlowCustomColor || '#bb86fc') : 'var(--accent-color)';
                customBgGlowEl.style.background = def.css(color);
            }

            function applyBgGlowRowVisibility(enabled) {
                setSettingsBlockVisible(bgGlowIntensityRow, enabled, 'block');
            }
            settingBgGlow.addEventListener('change', () => {
                window.bgGlowEnabled = settingBgGlow.checked;
                applyBgGlowRowVisibility(settingBgGlow.checked);
                appStorage.setItem('setting_bg_glow_enabled', settingBgGlow.checked ? '1' : '0');
                if (!settingBgGlow.checked && customBgGlowEl) customBgGlowEl.style.opacity = '0';
            });
            bgGlowIntensitySlider.addEventListener('input', () => {
                const v = parseFloat(bgGlowIntensitySlider.value);
                bgGlowIntensityLabel.textContent = v.toFixed(1);
                window.bgGlowIntensity = v;
                appStorage.setItem('setting_bg_glow_intensity', v);
            });
            bgGlowThresholdSlider.addEventListener('input', () => {
                const v = parseFloat(bgGlowThresholdSlider.value);
                bgGlowThresholdLabel.textContent = v.toFixed(2);
                window.bgGlowThreshold = v;
                appStorage.setItem('setting_bg_glow_threshold', v);
            });
            function selectBgGlowStyle(style) {
                window.bgGlowStyle = style;
                const def = BG_GLOW_STYLES[style] || BG_GLOW_STYLES.center;
                bgGlowStyleLabel.textContent = def.label;
                bgGlowStyleBtn.querySelector('.pd-icon').innerHTML = `<i data-lucide="${def.icon}" style="width:14px;height:14px;"></i>`;
                bgGlowStyleMenu.querySelectorAll('.viz-type-menu-item').forEach(el =>
                    el.classList.toggle('active', el.dataset.glowStyle === style));
                appStorage.setItem('setting_bg_glow_style', style);
                applyBgGlowStyle();
                lucide.createIcons();
            }
            bgGlowStyleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const open = bgGlowStyleMenu.classList.toggle('open');
                bgGlowStyleBtn.classList.toggle('open', open);
            });
            document.addEventListener('click', () => {
                bgGlowStyleMenu.classList.remove('open');
                bgGlowStyleBtn.classList.remove('open');
            });
            bgGlowStyleMenu.addEventListener('click', (e) => {
                const item = e.target.closest('.viz-type-menu-item');
                if (!item) return;
                e.stopPropagation();
                selectBgGlowStyle(item.dataset.glowStyle);
                bgGlowStyleMenu.classList.remove('open');
                bgGlowStyleBtn.classList.remove('open');
            });
            settingBgGlowCustomColor.addEventListener('change', () => {
                window.bgGlowCustomColorEnabled = settingBgGlowCustomColor.checked;
                setSettingsBlockVisible(bgGlowColorRow, settingBgGlowCustomColor.checked, 'flex');
                appStorage.setItem('setting_bg_glow_custom_color_enabled', settingBgGlowCustomColor.checked ? '1' : '0');
                applyBgGlowStyle();
            });
            bgGlowColorPicker.addEventListener('input', () => {
                window.bgGlowCustomColor = bgGlowColorPicker.value;
                appStorage.setItem('setting_bg_glow_custom_color', bgGlowColorPicker.value);
                applyBgGlowStyle();
            });

            // ── Тряска (наклон) под звук ──
            const settingBgTilt         = document.getElementById('setting-bg-tilt-enabled');
            const bgTiltIntensityRow    = document.getElementById('bg-tilt-intensity-row');
            const bgTiltIntensitySlider = document.getElementById('setting-bg-tilt-intensity');
            const bgTiltIntensityLabel  = document.getElementById('setting-bg-tilt-intensity-label');
            const bgTiltThresholdSlider = document.getElementById('setting-bg-tilt-threshold');
            const bgTiltThresholdLabel  = document.getElementById('setting-bg-tilt-threshold-label');
            const bgTiltSpeedSlider     = document.getElementById('setting-bg-tilt-speed');
            const bgTiltSpeedLabel      = document.getElementById('setting-bg-tilt-speed-label');
            const settingBgTiltRotation = document.getElementById('setting-bg-tilt-rotation');
            const settingBgTiltShift    = document.getElementById('setting-bg-tilt-shift');

            function applyBgTiltRowVisibility(enabled) {
                setSettingsBlockVisible(bgTiltIntensityRow, enabled, 'block');
            }
            settingBgTilt.addEventListener('change', () => {
                window.bgTiltEnabled = settingBgTilt.checked;
                applyBgTiltRowVisibility(settingBgTilt.checked);
                appStorage.setItem('setting_bg_tilt_enabled', settingBgTilt.checked ? '1' : '0');
            });
            bgTiltIntensitySlider.addEventListener('input', () => {
                const v = parseFloat(bgTiltIntensitySlider.value);
                bgTiltIntensityLabel.textContent = v.toFixed(1);
                window.bgTiltIntensity = v;
                appStorage.setItem('setting_bg_tilt_intensity', v);
            });
            bgTiltThresholdSlider.addEventListener('input', () => {
                const v = parseFloat(bgTiltThresholdSlider.value);
                bgTiltThresholdLabel.textContent = v.toFixed(2);
                window.bgTiltThreshold = v;
                appStorage.setItem('setting_bg_tilt_threshold', v);
            });
            bgTiltSpeedSlider.addEventListener('input', () => {
                const v = parseFloat(bgTiltSpeedSlider.value);
                bgTiltSpeedLabel.textContent = v.toFixed(1);
                window.bgTiltSpeed = v;
                appStorage.setItem('setting_bg_tilt_speed', v);
            });
            settingBgTiltRotation.addEventListener('change', () => {
                window.bgTiltRotation = settingBgTiltRotation.checked;
                appStorage.setItem('setting_bg_tilt_rotation', settingBgTiltRotation.checked ? '1' : '0');
            });
            settingBgTiltShift.addEventListener('change', () => {
                window.bgTiltShift = settingBgTiltShift.checked;
                appStorage.setItem('setting_bg_tilt_shift', settingBgTiltShift.checked ? '1' : '0');
            });

            // ── Следование за курсором (с подменю «Наклон за курсором») ──
            const settingBgCursor           = document.getElementById('setting-bg-cursor-enabled');
            const bgCursorSub               = document.getElementById('bg-cursor-sub');
            const bgCursorIntensityXSlider  = document.getElementById('setting-bg-cursor-intensity-x');
            const bgCursorIntensityXLabel   = document.getElementById('setting-bg-cursor-intensity-x-label');
            const bgCursorIntensityYSlider  = document.getElementById('setting-bg-cursor-intensity-y');
            const bgCursorIntensityYLabel   = document.getElementById('setting-bg-cursor-intensity-y-label');
            const settingBgCursorInvert     = document.getElementById('setting-bg-cursor-invert');
            const settingBgCursorTilt       = document.getElementById('setting-bg-cursor-tilt-enabled');
            const bgCursorTiltSub           = document.getElementById('bg-cursor-tilt-sub');
            const bgCursorTiltIntensitySlider = document.getElementById('setting-bg-cursor-tilt-intensity');
            const bgCursorTiltIntensityLabel  = document.getElementById('setting-bg-cursor-tilt-intensity-label');
            const settingBgCursorTiltInvert = document.getElementById('setting-bg-cursor-tilt-invert');

            function applyBgCursorTiltSub(enabled) {
                setSettingsBlockVisible(bgCursorTiltSub, enabled, 'block');
                if (settingBgCursorTilt) {
                    settingBgCursorTilt.disabled = !enabled;
                    if (!enabled) {
                        settingBgCursorTilt.checked = false;
                        window.bgCursorTiltEnabled = false;
                        appStorage.setItem('setting_bg_cursor_tilt_enabled', '0');
                    }
                }
            }
            function applyBgCursorSub(enabled) {
                setSettingsBlockVisible(bgCursorSub, enabled, 'block');
                if (settingBgCursorTilt) settingBgCursorTilt.disabled = !enabled;
                if (!enabled) applyBgCursorTiltSub(false);
            }
            settingBgCursor.addEventListener('change', () => {
                window.bgCursorEnabled = settingBgCursor.checked;
                applyBgCursorSub(settingBgCursor.checked);
                appStorage.setItem('setting_bg_cursor_enabled', settingBgCursor.checked ? '1' : '0');
                // При выключении возвращаем фон на место, чтобы он не «застыл»
                // со смещением, накопленным во время слежения.
                if (!settingBgCursor.checked) {
                    window._bgCursorTargetX = 0;
                    window._bgCursorTargetY = 0;
                }
            });
            bgCursorIntensityXSlider.addEventListener('input', () => {
                const v = parseFloat(bgCursorIntensityXSlider.value);
                bgCursorIntensityXLabel.textContent = v.toFixed(1);
                window.bgCursorIntensityX = v;
                appStorage.setItem('setting_bg_cursor_intensity_x', v);
            });
            bgCursorIntensityYSlider.addEventListener('input', () => {
                const v = parseFloat(bgCursorIntensityYSlider.value);
                bgCursorIntensityYLabel.textContent = v.toFixed(1);
                window.bgCursorIntensityY = v;
                appStorage.setItem('setting_bg_cursor_intensity_y', v);
            });
            settingBgCursorInvert.addEventListener('change', () => {
                window.bgCursorInvert = settingBgCursorInvert.checked;
                appStorage.setItem('setting_bg_cursor_invert', settingBgCursorInvert.checked ? '1' : '0');
            });
            settingBgCursorTilt.addEventListener('change', () => {
                window.bgCursorTiltEnabled = settingBgCursorTilt.checked;
                applyBgCursorTiltSub(settingBgCursorTilt.checked);
                appStorage.setItem('setting_bg_cursor_tilt_enabled', settingBgCursorTilt.checked ? '1' : '0');
            });
            bgCursorTiltIntensitySlider.addEventListener('input', () => {
                const v = parseFloat(bgCursorTiltIntensitySlider.value);
                bgCursorTiltIntensityLabel.textContent = v.toFixed(1);
                window.bgCursorTiltIntensity = v;
                appStorage.setItem('setting_bg_cursor_tilt_intensity', v);
            });
            settingBgCursorTiltInvert.addEventListener('change', () => {
                window.bgCursorTiltInvert = settingBgCursorTiltInvert.checked;
                appStorage.setItem('setting_bg_cursor_tilt_invert', settingBgCursorTiltInvert.checked ? '1' : '0');
            });

            // ====================================================
            // ИНТЕГРАЦИИ: Discord Rich Presence
            // ====================================================
            const settingDiscordRpc        = document.getElementById('setting-discord-rpc-enabled');
            const discordRpcBody           = document.getElementById('discord-rpc-body');
            const discordRpcClientIdInput  = document.getElementById('discord-rpc-client-id');
            const discordRpcStatusPill     = document.getElementById('discord-rpc-status-pill');
            const discordRpcStatusText     = document.getElementById('discord-rpc-status-text');
            const settingDiscordRpcProgress     = document.getElementById('setting-discord-rpc-progress');
            const settingDiscordRpcRadioButton  = document.getElementById('setting-discord-rpc-radio-button');
            const settingDiscordRpcManual       = document.getElementById('setting-discord-rpc-manual');
            const discordRpcManualRow           = document.getElementById('discord-rpc-manual-row');
            const discordRpcRedirectBaseInput   = document.getElementById('discord-rpc-redirect-base');

            // Значения по умолчанию — используются, когда «Ручная настройка» ВЫКЛЮЧЕНА,
            // независимо от того, что осталось введено в полях (поля просто скрыты,
            // но раньше их значения всё равно продолжали применяться — баг).
            const DISCORD_RPC_DEFAULT_CLIENT_ID     = '1519344685871792128';
            const DISCORD_RPC_DEFAULT_REDIRECT_BASE = 'https://noctune.lifeisafelony.by/redirect';

            function getDiscordRpcClientId() {
                if (settingDiscordRpcManual.checked) {
                    const v = discordRpcClientIdInput.value.trim();
                    if (v) return v;
                }
                return DISCORD_RPC_DEFAULT_CLIENT_ID;
            }
            function getDiscordRpcRedirectBase() {
                if (settingDiscordRpcManual.checked) {
                    return discordRpcRedirectBaseInput.value.trim();
                }
                return DISCORD_RPC_DEFAULT_REDIRECT_BASE;
            }

            function setDiscordRpcStatusPill(state, text) {
                discordRpcStatusPill.classList.remove('is-connected', 'is-error');
                if (state === 'connected') discordRpcStatusPill.classList.add('is-connected');
                else if (state === 'error') discordRpcStatusPill.classList.add('is-error');
                discordRpcStatusText.textContent = text;
            }

            function applyDiscordRpcBodyVisibility(enabled) {
                setSettingsBlockVisible(discordRpcBody, enabled, 'block');
            }

            settingDiscordRpc.addEventListener('change', async () => {
                const enabled = settingDiscordRpc.checked;
                window.discordRPCEnabled = enabled;
                applyDiscordRpcBodyVisibility(enabled);
                appStorage.setItem('setting_discord_rpc_enabled', enabled ? '1' : '0');

                window.discordRPCRedirectBase = getDiscordRpcRedirectBase();

                if (enabled) {
                    setDiscordRpcStatusPill('idle', 'Подключение…');
                    const res = await noctune.discordRpcConnect(getDiscordRpcClientId());
                    if (res && res.ok) {
                        pushDiscordActivity();
                    } else if (res && res.error === 'not-installed') {
                        setDiscordRpcStatusPill('error', 'Не установлен @xhayper/discord-rpc');
                    } else {
                        setDiscordRpcStatusPill('error', 'Discord не найден');
                    }
                } else {
                    await noctune.discordRpcDisconnect();
                    setDiscordRpcStatusPill('idle', 'Отключено');
                }
            });

            // Поле Application ID имеет значение только пока включена «Ручная
            // настройка» — при выключенном тумблере оно скрыто и не должно
            // влиять на то, к какому приложению идёт подключение.
            discordRpcClientIdInput.addEventListener('change', async () => {
                appStorage.setItem('setting_discord_rpc_client_id', discordRpcClientIdInput.value.trim());
                if (window.discordRPCEnabled && settingDiscordRpcManual.checked) {
                    setDiscordRpcStatusPill('idle', 'Подключение…');
                    const res = await noctune.discordRpcConnect(getDiscordRpcClientId());
                    if (res && res.ok) pushDiscordActivity();
                }
            });

            settingDiscordRpcProgress.addEventListener('change', () => {
                window.discordRPCShowProgress = settingDiscordRpcProgress.checked;
                appStorage.setItem('setting_discord_rpc_progress', settingDiscordRpcProgress.checked ? '1' : '0');
                pushDiscordActivity();
            });
            settingDiscordRpcRadioButton.addEventListener('change', () => {
                window.discordRPCShowRadioButton = settingDiscordRpcRadioButton.checked;
                appStorage.setItem('setting_discord_rpc_radio_button', settingDiscordRpcRadioButton.checked ? '1' : '0');
                pushDiscordActivity();
            });
            settingDiscordRpcManual.addEventListener('change', async () => {
                setSettingsBlockVisible(discordRpcManualRow, settingDiscordRpcManual.checked, 'block');
                appStorage.setItem('setting_discord_rpc_manual', settingDiscordRpcManual.checked ? '1' : '0');
                // Переключение "ручная/по умолчанию" меняет эффективный Application ID
                // и redirect-URL — переподключаемся и пересчитываем кнопку "Слушать".
                window.discordRPCRedirectBase = getDiscordRpcRedirectBase();
                if (window.discordRPCEnabled) {
                    setDiscordRpcStatusPill('idle', 'Подключение…');
                    const res = await noctune.discordRpcConnect(getDiscordRpcClientId());
                    if (res && res.ok) pushDiscordActivity();
                }
            });
            discordRpcRedirectBaseInput.addEventListener('change', () => {
                appStorage.setItem('setting_discord_rpc_redirect_base', discordRpcRedirectBaseInput.value.trim());
                if (settingDiscordRpcManual.checked) {
                    window.discordRPCRedirectBase = getDiscordRpcRedirectBase();
                    pushDiscordActivity();
                }
            });

            noctune.onDiscordRpcStatus((status) => {
                if (status.connected) setDiscordRpcStatusPill('connected', 'Подключено');
                else if (status.error) setDiscordRpcStatusPill('error', 'Ошибка подключения');
                else setDiscordRpcStatusPill('idle', 'Отключено');
            });

            // ====================================================
            // ИНТЕГРАЦИИ: Last.fm (скробблинг)
            // ====================================================
            const settingLastfmEnabled   = document.getElementById('setting-lastfm-enabled');
            const btnLastfmAuth          = document.getElementById('btn-lastfm-auth');
            const lastfmBody             = document.getElementById('lastfm-body');
            const lastfmCardDesc         = document.getElementById('lastfm-card-desc');
            const lastfmStatusPill       = document.getElementById('lastfm-status-pill');
            const lastfmStatusText       = document.getElementById('lastfm-status-text');
            const settingLastfmScrobble    = document.getElementById('setting-lastfm-scrobble');
            const settingLastfmNowPlaying  = document.getElementById('setting-lastfm-now-playing');
            const settingLastfmManual     = document.getElementById('setting-lastfm-manual');
            const lastfmManualRow        = document.getElementById('lastfm-manual-row');
            const lastfmManualKeyInput   = document.getElementById('lastfm-manual-key');
            const lastfmManualSecretInput = document.getElementById('lastfm-manual-secret');

            function setLastfmStatusPill(state, text) {
                lastfmStatusPill.classList.remove('is-connected', 'is-error');
                if (state === 'connected') lastfmStatusPill.classList.add('is-connected');
                else if (state === 'error') lastfmStatusPill.classList.add('is-error');
                lastfmStatusText.textContent = text;
            }

            // Единая точка обновления UI карточки по факту подключения —
            // вызывается и при старте приложения, и после успешной/неуспешной
            // авторизации, и при отключении аккаунта. Кнопка одна — её текст и
            // действие меняются в зависимости от состояния (вместо пары
            // Подключить/Отключить, как раньше).
            function refreshLastfmCardUI(connected, username) {
                window.lastfmConnected = connected;
                btnLastfmAuth.textContent = connected ? 'Отключить' : 'Авторизовать';
                if (connected) {
                    setLastfmStatusPill('connected', username ? `@${username}` : 'Подключено');
                    lastfmCardDesc.textContent = 'Отправка истории прослушиваний в ваш профиль Last.fm';
                } else {
                    setLastfmStatusPill('idle', 'Не авторизовано');
                    lastfmCardDesc.textContent = 'Отправка истории прослушиваний в ваш профиль Last.fm';
                }
            }

            let _lastfmAuthPollTimer = null;
            function stopLastfmAuthPoll() {
                if (_lastfmAuthPollTimer) { clearInterval(_lastfmAuthPollTimer); _lastfmAuthPollTimer = null; }
            }

            async function lastfmBeginAuthFlow() {
                btnLastfmAuth.disabled = true;
                setLastfmStatusPill('idle', 'Открываем браузер для подтверждения…');

                let res;
                try { res = await noctune.lastfm.beginAuth(); }
                catch (e) { res = { ok: false, error: String(e && e.message || e) }; }

                if (!res || !res.ok || !res.token) {
                    btnLastfmAuth.disabled = false;
                    setLastfmStatusPill('error', 'Не удалось начать авторизацию');
                    showNotification('Не удалось связаться с Last.fm — проверьте API key/secret и интернет-соединение', 'error');
                    return;
                }

                const token = res.token;
                // Пока пользователь не нажал «Разрешить доступ» на открывшейся странице,
                // auth.getSession отвечает ошибкой — это ожидаемо, поэтому опрашиваем
                // раз в 3 секунды, а не считаем первую неудачу финальной.
                let attemptsLeft = 40; // ~2 минуты на подтверждение в браузере
                _lastfmAuthPollTimer = setInterval(async () => {
                    attemptsLeft--;
                    let auth;
                    try { auth = await noctune.lastfm.completeAuth(token); } catch (e) { auth = { ok: false }; }

                    if (auth && auth.ok) {
                        stopLastfmAuthPoll();
                        btnLastfmAuth.disabled = false;
                        refreshLastfmCardUI(true, auth.username);
                        showNotification(`Last.fm подключён — аккаунт ${auth.username}`, 'info', 'Скробблинг включён');
                        return;
                    }
                    if (attemptsLeft <= 0) {
                        stopLastfmAuthPoll();
                        btnLastfmAuth.disabled = false;
                        setLastfmStatusPill('error', 'Время ожидания истекло');
                        showNotification('Не удалось подтвердить доступ к Last.fm — попробуйте ещё раз', 'error');
                    }
                }, 3000);
            }

            async function lastfmDoDisconnect(silent) {
                stopLastfmAuthPoll();
                try { await noctune.lastfm.disconnect(); } catch (e) {}
                refreshLastfmCardUI(false, null);
                if (!silent) showNotification('Аккаунт Last.fm отключён', 'info');
            }

            // Одна кнопка вместо пары «Подключить» / «Отключить» — действие
            // определяется текущим состоянием подключения.
            btnLastfmAuth.addEventListener('click', () => {
                if (window.lastfmConnected) lastfmDoDisconnect(false);
                else lastfmBeginAuthFlow();
            });

            settingLastfmEnabled.addEventListener('change', () => {
                setSettingsBlockVisible(lastfmBody, settingLastfmEnabled.checked, 'block');
                appStorage.setItem('setting_lastfm_enabled', settingLastfmEnabled.checked ? '1' : '0');
                window.lastfmEnabled = settingLastfmEnabled.checked;
            });

            settingLastfmScrobble.addEventListener('change', () => {
                window.lastfmScrobbleEnabled = settingLastfmScrobble.checked;
                appStorage.setItem('setting_lastfm_scrobble', settingLastfmScrobble.checked ? '1' : '0');
            });
            settingLastfmNowPlaying.addEventListener('change', () => {
                window.lastfmNowPlayingEnabled = settingLastfmNowPlaying.checked;
                appStorage.setItem('setting_lastfm_now_playing', settingLastfmNowPlaying.checked ? '1' : '0');
            });

            // Ручной API key/secret — как только меняются ключи (или сам режим
            // "ручная настройка" переключается), текущая сессия становится
            // недействительной для нового приложения-идентификатора на стороне
            // Last.fm, поэтому принудительно разлогиниваем и просим авторизоваться
            // заново — тихо переподключать нельзя, т.к. это требует подтверждения
            // пользователем в браузере.
            settingLastfmManual.addEventListener('change', async () => {
                setSettingsBlockVisible(lastfmManualRow, settingLastfmManual.checked, 'block');
                appStorage.setItem('setting_lastfm_manual', settingLastfmManual.checked ? '1' : '0');
                if (window.lastfmConnected) {
                    await lastfmDoDisconnect(true);
                    showNotification('Учётные данные Last.fm изменились — авторизуйтесь заново', 'warning');
                }
            });
            async function onLastfmManualCredsChanged() {
                appStorage.setItem('setting_lastfm_manual_key', lastfmManualKeyInput.value.trim());
                appStorage.setItem('setting_lastfm_manual_secret', lastfmManualSecretInput.value.trim());
                if (window.lastfmConnected) {
                    await lastfmDoDisconnect(true);
                    showNotification('Ключ Last.fm изменился — авторизуйтесь заново', 'warning');
                }
            }
            lastfmManualKeyInput.addEventListener('change', onLastfmManualCredsChanged);
            lastfmManualSecretInput.addEventListener('change', onLastfmManualCredsChanged);

            // Загрузка сохранённых настроек — единожды при старте (сам статус
            // подключения синхронизируется в refreshSettingsUI(), см. ниже по файлу,
            // чтобы переживать гонку с асинхронной инициализацией electron-store).
            // Поля ключа/секрета НЕ предзаполняются никаким встроенным значением —
            // только тем, что реально сохранил сам пользователь.
            const savedLastfmEnabled = appStorage.getItem('setting_lastfm_enabled');
            settingLastfmEnabled.checked = savedLastfmEnabled === '1';
            window.lastfmEnabled = settingLastfmEnabled.checked;
            setSettingsBlockVisible(lastfmBody, settingLastfmEnabled.checked, 'block');

            const savedLastfmScrobble = appStorage.getItem('setting_lastfm_scrobble');
            settingLastfmScrobble.checked = savedLastfmScrobble === null ? true : savedLastfmScrobble === '1';
            window.lastfmScrobbleEnabled = settingLastfmScrobble.checked;

            const savedLastfmNowPlaying = appStorage.getItem('setting_lastfm_now_playing');
            settingLastfmNowPlaying.checked = savedLastfmNowPlaying === null ? true : savedLastfmNowPlaying === '1';
            window.lastfmNowPlayingEnabled = settingLastfmNowPlaying.checked;

            settingLastfmManual.checked = appStorage.getItem('setting_lastfm_manual') === '1';
            setSettingsBlockVisible(lastfmManualRow, settingLastfmManual.checked, 'block');
            lastfmManualKeyInput.value = appStorage.getItem('setting_lastfm_manual_key') || '';
            lastfmManualSecretInput.value = appStorage.getItem('setting_lastfm_manual_secret') || '';

            async function refreshLastfmStatusFromMain() {
                try {
                    const status = await noctune.lastfm.status();
                    refreshLastfmCardUI(!!(status && status.connected), status && status.username);
                } catch (e) {
                    refreshLastfmCardUI(false, null);
                }
            }

            // ====================================================
            // ГОРЯЧИЕ КЛАВИШИ
            // ====================================================
            const HOTKEY_DEFS = [
                { id: 'togglePlay', label: 'Пауза / Воспроизведение' },
                { id: 'seekBack10', label: 'Перемотка назад на 10 сек' },
                { id: 'seekFwd10',  label: 'Перемотка вперёд на 10 сек' },
                { id: 'mute',       label: 'Выключить звук' },
                { id: 'prevTrack',  label: 'Предыдущий трек' },
                { id: 'nextTrack',  label: 'Следующий трек' },
                { id: 'volumeUp',   label: 'Громче на 5%' },
                { id: 'volumeDown', label: 'Тише на 5%' },
                { id: 'seekBack5',  label: 'Перемотка назад на 5 сек' },
                { id: 'seekFwd5',   label: 'Перемотка вперёд на 5 сек' },
            ];
            const HOTKEY_DISPLAY_MAP = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space' };
            const HOTKEY_MODIFIER_NAMES = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Win' };

            function formatComboForDisplay(combo) {
                if (!combo) return '—';
                return combo.split('+').map(part => {
                    if (HOTKEY_MODIFIER_NAMES[part]) return HOTKEY_MODIFIER_NAMES[part];
                    if (HOTKEY_DISPLAY_MAP[part]) return HOTKEY_DISPLAY_MAP[part];
                    if (part.startsWith('Key')) return part.slice(3);     // KeyK -> K
                    if (part.startsWith('Digit')) return part.slice(5);  // Digit5 -> 5
                    if (part.startsWith('Numpad')) return 'Num' + part.slice(6);
                    return part;
                }).join(' + ');
            }

            const hotkeysListEl = document.getElementById('hotkeys-list');

            function renderHotkeysList() {
                hotkeysListEl.innerHTML = '';
                HOTKEY_DEFS.forEach(def => {
                    const row = document.createElement('div');
                    row.className = 'hotkey-row';
                    row.innerHTML = `
                        <span class="hotkey-label">${def.label}</span>
                        <div class="hotkey-controls">
                            <span class="hotkey-chip" data-action="${def.id}" title="Нажмите, чтобы изменить">${formatComboForDisplay(window.hotkeyBindings[def.id])}</span>
                        </div>`;
                    hotkeysListEl.appendChild(row);
                });
                hotkeysListEl.querySelectorAll('.hotkey-chip').forEach(chip => {
                    chip.addEventListener('click', () => startListeningForHotkey(chip.dataset.action));
                });
            }

            function saveHotkeyBindings() {
                appStorage.setItem('setting_hotkeys', JSON.stringify(window.hotkeyBindings));
            }

            function startListeningForHotkey(actionId) {
                const chip = hotkeysListEl.querySelector(`.hotkey-chip[data-action="${actionId}"]`);
                if (!chip) return;
                window._hotkeyCaptureActive = true;
                chip.textContent = 'Нажмите клавишу…';
                chip.classList.add('listening');

                const captureHandler = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.key === 'Escape') { cleanup(); renderHotkeysList(); return; }
                    // Чистый модификатор без основной клавиши — ждём дальше
                    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

                    const combo = normalizeKeyCombo(e);
                    const conflictId = Object.keys(window.hotkeyBindings).find(
                        k => k !== actionId && window.hotkeyBindings[k] === combo
                    );
                    window.hotkeyBindings[actionId] = combo;
                    if (conflictId) {
                        delete window.hotkeyBindings[conflictId];
                        const conflictLabel = HOTKEY_DEFS.find(d => d.id === conflictId)?.label || conflictId;
                        showNotification(`«${formatComboForDisplay(combo)}» было снято с действия «${conflictLabel}»`, 'info');
                    }
                    saveHotkeyBindings();
                    cleanup();
                    renderHotkeysList();
                };
                function cleanup() {
                    window._hotkeyCaptureActive = false;
                    document.removeEventListener('keydown', captureHandler, true);
                }
                document.addEventListener('keydown', captureHandler, true);
            }

            document.getElementById('btn-reset-hotkeys').addEventListener('click', () => {
                window.hotkeyBindings = Object.assign({}, DEFAULT_HOTKEYS);
                saveHotkeyBindings();
                renderHotkeysList();
                showNotification('Горячие клавиши сброшены на стандартные', 'success');
            });

            renderHotkeysList();

            // ====================================================
            // APPEARANCE: Адаптивная палитра (цвета акцента/градиента из фона)
            // ====================================================
            const settingAdaptiveAccent   = document.getElementById('setting-adaptive-accent');
            const settingAdaptiveGradient = document.getElementById('setting-adaptive-gradient');

            function refreshAdaptiveControlsDisabledState() {
                const accentManualRow = document.getElementById('accent-manual-row');
                setSettingsBlockVisible(accentManualRow, !window.adaptiveAccentEnabled, '');

                const gradManualRow = document.getElementById('grad-manual-row');
                setSettingsBlockVisible(gradManualRow, !window.adaptiveGradientEnabled, '');
            }

            function rgbToHsl(r, g, b) {
                r /= 255; g /= 255; b /= 255;
                const max = Math.max(r, g, b), min = Math.min(r, g, b);
                let h = 0, s = 0;
                const l = (max + min) / 2;
                const d = max - min;
                if (d !== 0) {
                    s = d / (1 - Math.abs(2 * l - 1));
                    switch (max) {
                        case r: h = ((g - b) / d) % 6; break;
                        case g: h = (b - r) / d + 2; break;
                        default: h = (r - g) / d + 4;
                    }
                    h *= 60;
                    if (h < 0) h += 360;
                }
                return { h, s, l };
            }

            function rgbToHex(r, g, b) {
                const toHex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
                return '#' + toHex(r) + toHex(g) + toHex(b);
            }

            function colorDistance(a, b) {
                return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
            }

            // Извлекает несколько самых характерных цветов изображения/видеокадра.
            // Возвращает массив hex-строк, от самого выразительного к менее заметному.
            function extractPaletteFromSource(sourceEl) {
                const SIZE = 64;
                const canvas = document.createElement('canvas');
                canvas.width = SIZE;
                canvas.height = SIZE;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(sourceEl, 0, 0, SIZE, SIZE);

                let data;
                try {
                    data = ctx.getImageData(0, 0, SIZE, SIZE).data;
                } catch (e) {
                    return null;
                }

                const STEP = 24;
                const buckets = new Map();
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i + 3] < 200) continue; // прозрачные пиксели не учитываем
                    const r = data[i], g = data[i + 1], b = data[i + 2];
                    const key = (Math.round(r / STEP) * STEP) + ',' + (Math.round(g / STEP) * STEP) + ',' + (Math.round(b / STEP) * STEP);
                    const entry = buckets.get(key);
                    if (entry) { entry.count++; entry.r += r; entry.g += g; entry.b += b; }
                    else buckets.set(key, { count: 1, r, g, b });
                }

                const candidates = [];
                buckets.forEach((entry) => {
                    const r = entry.r / entry.count, g = entry.g / entry.count, b = entry.b / entry.count;
                    const { s, l } = rgbToHsl(r, g, b);
                    if (l < 0.07 || l > 0.94) return; // отбрасываем почти чёрные/белые тона
                    const vividness = s * (1 - Math.abs(l - 0.5) * 0.7);
                    const score = entry.count * (0.3 + vividness * 1.4);
                    candidates.push({ r, g, b, score });
                });
                candidates.sort((a, b) => b.score - a.score);
                if (!candidates.length) return null;

                const palette = [];
                for (const c of candidates) {
                    if (palette.length >= 8) break;
                    const tooClose = palette.some(p => colorDistance(p, c) < 36);
                    if (!tooClose) palette.push(c);
                }
                if (!palette.length) palette.push(candidates[0]);
                return palette.map(c => rgbToHex(c.r, c.g, c.b));
            }

            function loadImageForExtraction(url) {
                return new Promise((resolve, reject) => {
                    const img = new Image();
                    img.onload = () => resolve(img);
                    img.onerror = reject;
                    img.src = url;
                });
            }

            async function computeAdaptivePalette() {
                try {
                    if (window.bgImageIsVideo) {
                        if (!customBgVideoEl.videoWidth || customBgVideoEl.readyState < 2) return null;
                        return extractPaletteFromSource(customBgVideoEl);
                    }
                    const bgCss = customBgImageEl.style.backgroundImage || '';
                    const match = /^url\("?(.+?)"?\)$/.exec(bgCss);
                    if (!match) return null;
                    const img = await loadImageForExtraction(match[1]);
                    return extractPaletteFromSource(img);
                } catch (e) {
                    console.error('Не удалось получить палитру из фона:', e);
                    return null;
                }
            }

            async function applyAdaptivePalette() {
                const palette = await computeAdaptivePalette();
                if (!palette || !palette.length) {
                    showNotification('Не удалось определить цвета фона для адаптивной палитры', 'warning');
                    return;
                }
                window._adaptivePalette = palette;
                const n = palette.length;

                if (window.adaptiveAccentEnabled) {
                    setAccentColor(palette[0]);
                }
                if (window.adaptiveGradientEnabled) {
                    animateVizGradColorsTo(palette[0], palette[1 % n], palette[2 % n]);
                    highlightActiveGradPreset();
                }
            }

            function triggerAdaptiveRecompute() {
                if (window.adaptiveAccentEnabled || window.adaptiveGradientEnabled) {
                    applyAdaptivePalette();
                }
            }

            if (settingAdaptiveAccent) settingAdaptiveAccent.addEventListener('change', () => {
                window.adaptiveAccentEnabled = settingAdaptiveAccent.checked;
                appStorage.setItem('setting_adaptive_accent', settingAdaptiveAccent.checked ? '1' : '0');
                refreshAdaptiveControlsDisabledState();
                if (settingAdaptiveAccent.checked) applyAdaptivePalette();
            });

            if (settingAdaptiveGradient) settingAdaptiveGradient.addEventListener('change', () => {
                window.adaptiveGradientEnabled = settingAdaptiveGradient.checked;
                appStorage.setItem('setting_adaptive_gradient', settingAdaptiveGradient.checked ? '1' : '0');
                refreshAdaptiveControlsDisabledState();
                if (settingAdaptiveGradient.checked) applyAdaptivePalette();
            });

            // ====================================================
            // APPEARANCE: Экспорт / импорт тем (noctune:<код>)
            // Код хранит только цвета и поведение, без самого изображения/видео
            // фона — у каждого пользователя оно своё, переносить его смысла нет.
            // Ключи укорочены, чтобы итоговый код был как можно компактнее.
            // ====================================================
            const btnExportTheme    = document.getElementById('btn-export-theme');
            const btnImportTheme    = document.getElementById('btn-import-theme');
            const themeImportInput  = document.getElementById('theme-import-input');
            const THEME_PREFIX = 'noctune:';

            function safeParseJSON(str, fallback) {
                if (str === null || str === undefined) return fallback;
                try {
                    const parsed = JSON.parse(str);
                    return (parsed === null || parsed === undefined) ? fallback : parsed;
                } catch (e) { return fallback; }
            }

            function buildThemePayload() {
                const payload = {
                    v: 1,
                    d: document.body.getAttribute('data-theme') === 'dark',           // dark theme
                    a: appStorage.getItem('setting_accent_color') || '#4a90e2',     // accent
                    st: (appStorage.getItem('setting_show_stars') ?? '1') === '1',  // stars
                    gb: (appStorage.getItem('setting_glass_blur') ?? '1') === '1',  // glass blur
                    g: {                                                              // gradient
                        c: safeParseJSON(appStorage.getItem('setting_viz_grad'), ['#bb86fc', '#4a90e2', '#03dac6']),
                        r: (appStorage.getItem('setting_viz_rotate') ?? '1') === '1',
                        rs: parseFloat(appStorage.getItem('setting_viz_rotate_speed') || '1'),
                        sg: appStorage.getItem('setting_viz_scroll_grad') === '1',
                        ss: parseFloat(appStorage.getItem('setting_viz_scroll_speed') || '1'),
                        sw: appStorage.getItem('setting_viz_scroll_grad_wave') === '1',
                        sws: parseFloat(appStorage.getItem('setting_viz_scroll_speed_wave') || '1'),
                    },
                    ad: {                                                             // adaptive
                        a: appStorage.getItem('setting_adaptive_accent') === '1',
                        g: appStorage.getItem('setting_adaptive_gradient') === '1',
                    },
                    si: settingStarsInteractive.checked,                             // stars interactive
                    vint: parseFloat(appStorage.getItem('setting_viz_intensity') || '1'), // viz intensity
                    vsty: appStorage.getItem('setting_viz_style') || 'circle-smooth', // viz type
                    vin: (appStorage.getItem('setting_viz_inner') ?? '1') === '1',   // inner circle
                    vpk: (appStorage.getItem('setting_viz_peaks') ?? '1') === '1',   // bar peaks
                    w: {                                                              // waveform
                        tr: settingWaveTrail.checked,
                        tra: parseFloat(appStorage.getItem('setting_viz_wave_trail_amount') || '0.3'),
                        hs: settingWaveHideSilence.checked,
                        ln: parseInt(waveLineSlider.value, 10) || 1,
                        sn: parseFloat(waveSensSlider.value) || 1.5,
                    },
                    fw: {                                                             // fireworks
                        cm: appStorage.getItem('setting_fw_color_mode') || 'random',
                        cc: safeParseJSON(appStorage.getItem('setting_fw_custom_colors'), ['#ffaa33', '#ff5e7d', '#4da6ff']),
                        th: parseFloat(appStorage.getItem('setting_fw_threshold') || '0'),
                        fr: parseFloat(appStorage.getItem('setting_fw_frequency') || '1'),
                        id: (appStorage.getItem('setting_fw_idle_spawn') ?? '1') === '1',
                        br: (appStorage.getItem('setting_fw_beat_reactive') ?? '1') === '1',
                        bb: parseInt(appStorage.getItem('setting_fw_beat_burst') || '1', 10),
                        tl: parseInt(appStorage.getItem('setting_fw_trail') || '4', 10),
                    },
                    cf: {                                                             // confetti
                        en: settingConfetti.checked,
                        sp: appStorage.getItem('setting_confetti_spawn') || 'top',
                        gr: safeParseJSON(appStorage.getItem('setting_confetti_grad'), ['#ff6b9d', '#c44dff', '#4daaff']),
                        it: parseFloat(appStorage.getItem('setting_confetti_intensity') || '1'),
                        gv: parseFloat(appStorage.getItem('setting_confetti_gravity') || '1'),
                        sz: parseFloat(appStorage.getItem('setting_confetti_size') || '1'),
                        sl: parseInt(appStorage.getItem('setting_confetti_sprinkler_lines') || '4', 10),
                        sv: parseFloat(appStorage.getItem('setting_confetti_sensitivity') || '1'),
                        sw: settingConfettiSwirl.checked,
                        ss: parseFloat(appStorage.getItem('setting_confetti_swirl_str') || '1'),
                        id2: appStorage.getItem('setting_confetti_idle') || 'drift',
                    },
                    bg: null,
                };

                if (appStorage.getItem('setting_bg_image_enabled') === '1') {
                    payload.bg = {
                        f: appStorage.getItem('setting_bg_image_fit') || 'cover',
                        pe: (appStorage.getItem('setting_bg_pulse_enabled') ?? '1') === '1',
                        pi: parseFloat(appStorage.getItem('setting_bg_pulse_intensity') || '1'),
                        pt: parseFloat(appStorage.getItem('setting_bg_pulse_threshold') || '0'),
                        be: appStorage.getItem('setting_bg_blur_enabled') === '1',
                        bi: parseFloat(appStorage.getItem('setting_bg_blur_intensity') || '1'),
                        bt: parseFloat(appStorage.getItem('setting_bg_blur_threshold') || '0'),
                        ge: appStorage.getItem('setting_bg_glow_enabled') === '1',
                        gi: parseFloat(appStorage.getItem('setting_bg_glow_intensity') || '1'),
                        gt: parseFloat(appStorage.getItem('setting_bg_glow_threshold') || '0'),
                        gs: appStorage.getItem('setting_bg_glow_style') || 'center',
                        gce: appStorage.getItem('setting_bg_glow_custom_color_enabled') === '1',
                        gc: appStorage.getItem('setting_bg_glow_custom_color') || '#bb86fc',
                        te: appStorage.getItem('setting_bg_tilt_enabled') === '1',
                        ti: parseFloat(appStorage.getItem('setting_bg_tilt_intensity') || '1'),
                        tt: parseFloat(appStorage.getItem('setting_bg_tilt_threshold') || '0'),
                        ts: parseFloat(appStorage.getItem('setting_bg_tilt_speed') || '1'),
                        tr: (appStorage.getItem('setting_bg_tilt_rotation') ?? '1') === '1',
                        tsh: (appStorage.getItem('setting_bg_tilt_shift') ?? '1') === '1',
                        ce: appStorage.getItem('setting_bg_cursor_enabled') === '1',
                        cx: parseFloat(appStorage.getItem('setting_bg_cursor_intensity_x') || '3'),
                        cy: parseFloat(appStorage.getItem('setting_bg_cursor_intensity_y') || '3'),
                        ci: appStorage.getItem('setting_bg_cursor_invert') === '1',
                        cte: appStorage.getItem('setting_bg_cursor_tilt_enabled') === '1',
                        cti: parseFloat(appStorage.getItem('setting_bg_cursor_tilt_intensity') || '2'),
                        ctv: appStorage.getItem('setting_bg_cursor_tilt_invert') === '1',
                    };
                }

                return payload;
            }

            // Unicode-safe base64 без Node Buffer (недоступен в рендерере
            // после отключения nodeIntegration) — btoa/atob умеют только
            // Latin1, поэтому строку сначала гоним через UTF-8 байты.
            function utf8ToBase64(str) {
                const bytes = new TextEncoder().encode(str);
                let binary = '';
                for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                return btoa(binary);
            }
            function base64ToUtf8(b64) {
                const binary = atob(b64);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                return new TextDecoder().decode(bytes);
            }

            function encodeTheme(payload) {
                const json = JSON.stringify(payload);
                return THEME_PREFIX + utf8ToBase64(json);
            }

            function decodeTheme(code) {
                const trimmed = String(code || '').trim();
                if (!trimmed.startsWith(THEME_PREFIX)) throw new Error('bad-prefix');
                const json = base64ToUtf8(trimmed.slice(THEME_PREFIX.length));
                return JSON.parse(json);
            }

            function setCheckedAndFire(el, value) {
                if (!el) return;
                el.checked = !!value;
                el.dispatchEvent(new Event('change'));
            }

            function setValueAndFire(el, value) {
                if (!el || value === undefined || value === null || Number.isNaN(value)) return;
                el.value = value;
                el.dispatchEvent(new Event('input'));
            }

            async function applyThemePayload(payload) {
                if (typeof payload.d === 'boolean') setCheckedAndFire(settingDark, payload.d);
                if (payload.a) setAccentColor(payload.a);
                if (typeof payload.st === 'boolean') setCheckedAndFire(settingStars, payload.st);
                if (typeof payload.gb === 'boolean') setCheckedAndFire(settingBlur, payload.gb);

                if (payload.g) {
                    const g = payload.g;
                    if (Array.isArray(g.c) && g.c.length === 3) {
                        vizColor1.value = g.c[0];
                        vizColor2.value = g.c[1];
                        vizColor3.value = g.c[2];
                        applyVizColors();
                        highlightActiveGradPreset();
                    }
                    if (typeof g.r === 'boolean') setCheckedAndFire(settingVizRotate, g.r);
                    setValueAndFire(rotateSpeedSlider, g.rs);
                    if (typeof g.sg === 'boolean') setCheckedAndFire(settingScrollGrad, g.sg);
                    setValueAndFire(scrollSpeedSlider, g.ss);
                    if (typeof g.sw === 'boolean') setCheckedAndFire(settingScrollGradWave, g.sw);
                    setValueAndFire(scrollSpeedWaveSlider, g.sws);
                }

                if (payload.bg) {
                    setCheckedAndFire(settingBgEnabled, true);
                    if (payload.bg.f) selectBgFit(payload.bg.f);
                    if (typeof payload.bg.pe === 'boolean') setCheckedAndFire(settingBgPulse, payload.bg.pe);
                    setValueAndFire(bgPulseIntensitySlider, payload.bg.pi);
                    setValueAndFire(bgPulseThresholdSlider, payload.bg.pt);
                    if (typeof payload.bg.be === 'boolean') setCheckedAndFire(settingBgBlur, payload.bg.be);
                    setValueAndFire(bgBlurIntensitySlider, payload.bg.bi);
                    setValueAndFire(bgBlurThresholdSlider, payload.bg.bt);
                    if (typeof payload.bg.ge === 'boolean') setCheckedAndFire(settingBgGlow, payload.bg.ge);
                    setValueAndFire(bgGlowIntensitySlider, payload.bg.gi);
                    setValueAndFire(bgGlowThresholdSlider, payload.bg.gt);
                    if (payload.bg.gs) selectBgGlowStyle(payload.bg.gs);
                    if (typeof payload.bg.gce === 'boolean') setCheckedAndFire(settingBgGlowCustomColor, payload.bg.gce);
                    if (payload.bg.gc) { bgGlowColorPicker.value = payload.bg.gc; bgGlowColorPicker.dispatchEvent(new Event('input')); }
                    if (typeof payload.bg.te === 'boolean') setCheckedAndFire(settingBgTilt, payload.bg.te);
                    setValueAndFire(bgTiltIntensitySlider, payload.bg.ti);
                    setValueAndFire(bgTiltThresholdSlider, payload.bg.tt);
                    setValueAndFire(bgTiltSpeedSlider, payload.bg.ts);
                    if (typeof payload.bg.tr === 'boolean') setCheckedAndFire(settingBgTiltRotation, payload.bg.tr);
                    if (typeof payload.bg.tsh === 'boolean') setCheckedAndFire(settingBgTiltShift, payload.bg.tsh);
                    if (typeof payload.bg.ce === 'boolean') setCheckedAndFire(settingBgCursor, payload.bg.ce);
                    setValueAndFire(bgCursorIntensityXSlider, payload.bg.cx);
                    setValueAndFire(bgCursorIntensityYSlider, payload.bg.cy);
                    if (typeof payload.bg.ci === 'boolean') setCheckedAndFire(settingBgCursorInvert, payload.bg.ci);
                    if (typeof payload.bg.cte === 'boolean') setCheckedAndFire(settingBgCursorTilt, payload.bg.cte);
                    setValueAndFire(bgCursorTiltIntensitySlider, payload.bg.cti);
                    if (typeof payload.bg.ctv === 'boolean') setCheckedAndFire(settingBgCursorTiltInvert, payload.bg.ctv);
                    showNotification('Настройки фона применены — само изображение/видео тема не переносит, выберите его вручную', 'info');
                }

                if (typeof payload.si === 'boolean') setCheckedAndFire(settingStarsInteractive, payload.si);
                setValueAndFire(vizIntSlider, payload.vint);
                if (payload.vsty) selectVizType(payload.vsty);
                if (typeof payload.vin === 'boolean') setCheckedAndFire(settingVizInner, payload.vin);
                if (typeof payload.vpk === 'boolean') setCheckedAndFire(settingVizPeaks, payload.vpk);

                if (payload.w) {
                    const w = payload.w;
                    if (typeof w.tr === 'boolean') setCheckedAndFire(settingWaveTrail, w.tr);
                    setValueAndFire(waveTrailAmountSlider, w.tra);
                    if (typeof w.hs === 'boolean') setCheckedAndFire(settingWaveHideSilence, w.hs);
                    setValueAndFire(waveLineSlider, w.ln);
                    setValueAndFire(waveSensSlider, w.sn);
                }

                if (payload.fw) {
                    const fw = payload.fw;
                    if (fw.cm) selectFwColorMode(fw.cm);
                    if (Array.isArray(fw.cc) && fw.cc.length === 3) {
                        fwCustomColor1.value = fw.cc[0];
                        fwCustomColor2.value = fw.cc[1];
                        fwCustomColor3.value = fw.cc[2];
                        applyFwCustomColors();
                    }
                    setValueAndFire(fwThresholdSlider, fw.th);
                    setValueAndFire(fwFreqSlider, fw.fr);
                    if (typeof fw.id === 'boolean') setCheckedAndFire(fwIdleSpawnToggle, fw.id);
                    if (typeof fw.br === 'boolean') setCheckedAndFire(fwBeatToggle, fw.br);
                    setValueAndFire(fwBeatBurstSlider, fw.bb);
                    setValueAndFire(fwTrailSlider, fw.tl);
                }

                if (payload.cf) {
                    const cf = payload.cf;
                    if (typeof cf.en === 'boolean') setCheckedAndFire(settingConfetti, cf.en);
                    if (cf.sp) selectConfettiSpawn(cf.sp);
                    if (Array.isArray(cf.gr) && cf.gr.length === 3) {
                        confettiC1.value = cf.gr[0];
                        confettiC2.value = cf.gr[1];
                        confettiC3.value = cf.gr[2];
                        applyConfettiColors();
                    }
                    setValueAndFire(confettiIntSlider, cf.it);
                    setValueAndFire(confettiGravSlider, cf.gv);
                    setValueAndFire(confettiSizeSlider, cf.sz);
                    setValueAndFire(sprinklerLinesSlider, cf.sl);
                    setValueAndFire(sensitivitySlider, cf.sv);
                    if (typeof cf.sw === 'boolean') setCheckedAndFire(settingConfettiSwirl, cf.sw);
                    setValueAndFire(confettiSwirlStrSlider, cf.ss);
                    if (cf.id2) selectConfettiIdle(cf.id2);
                }

                // Адаптивные тумблеры применяем последними: если у импортирующего
                // уже есть свой фон, палитра пересчитается именно от него.
                if (payload.ad) {
                    setCheckedAndFire(settingAdaptiveAccent, !!payload.ad.a);
                    setCheckedAndFire(settingAdaptiveGradient, !!payload.ad.g);
                }
            }

            if (btnExportTheme) btnExportTheme.addEventListener('click', () => {
                try {
                    const payload = buildThemePayload();
                    const code = encodeTheme(payload);
                    if (themeImportInput) themeImportInput.value = code;

                    const announceCopied = () => showNotification('Код темы скопирован в буфер обмена', 'info', 'Тема экспортирована');
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(code).then(announceCopied).catch(() => {
                            if (themeImportInput) themeImportInput.select();
                            showNotification('Код темы готов — скопируйте его из поля ниже', 'info', 'Тема экспортирована');
                        });
                    } else if (themeImportInput) {
                        themeImportInput.select();
                        showNotification('Код темы готов — скопируйте его из поля ниже', 'info', 'Тема экспортирована');
                    }
                } catch (e) {
                    console.error('Не удалось экспортировать тему:', e);
                    showNotification('Не удалось экспортировать тему', 'error');
                }
            });

            if (btnImportTheme) btnImportTheme.addEventListener('click', async () => {
                if (!themeImportInput) return;
                let payload;
                try {
                    payload = decodeTheme(themeImportInput.value);
                    if (!payload || typeof payload !== 'object') throw new Error('empty');
                } catch (e) {
                    showNotification('Некорректный код темы. Проверьте, что он начинается с «noctune:» и скопирован полностью', 'error');
                    return;
                }
                try {
                    await applyThemePayload(payload);
                    showNotification('Тема успешно применена', 'info', 'Тема импортирована');
                } catch (e) {
                    console.error('Не удалось применить тему:', e);
                    showNotification('Не удалось применить тему', 'error');
                }
            });

            // ---- ABOUT: Version & update check ----
            // Кнопка "Проверить" и вся логика electron-updater теперь в
            // renderer/updater.js (единая точка правды, без дублирования
            // обработчиков на одной и той же кнопке).

            // ---- Restore saved settings on load ----
            function refreshSettingsUI() {
                // Dark theme
                settingDark.checked = document.body.getAttribute('data-theme') === 'dark';

                // EQ button
                const savedEqBtn = appStorage.getItem('setting_show_eq_btn');
                if (savedEqBtn !== null) settingShowEq.checked = savedEqBtn === '1';

                // Playback speed
                const savedSpeed = appStorage.getItem('setting_playback_speed');
                if (savedSpeed !== null) {
                    speedSlider.value = savedSpeed;
                    const v = parseFloat(savedSpeed);
                    speedLabel.textContent = v.toFixed(2).replace(/\.?0+$/, '') + '×';
                    const mainSlider = document.getElementById('main-speed-slider');
                    const mainLabel = document.getElementById('main-speed-label');
                    if (mainSlider) mainSlider.value = v;
                    if (mainLabel) mainLabel.textContent = v.toFixed(2).replace(/\.?0+$/, '') + '×';
                }

                // Balance
                const savedBal = appStorage.getItem('setting_balance');
                if (savedBal !== null) {
                    balanceSlider.value = savedBal;
                    applyBalance(parseInt(savedBal));
                }

                // Playback mode
                const savedPBMode = appStorage.getItem('setting_pb_mode') || 'stereo';
                selectPbMode(savedPBMode);

                // Accent color
                const savedAccent = appStorage.getItem('setting_accent_color');
                if (savedAccent) {
                    document.documentElement.style.setProperty('--accent-color', savedAccent);
                    document.body.style.setProperty('--accent-color', savedAccent);
                    colorPicker.value = savedAccent;
                    swatches.forEach(s => s.classList.toggle('active', s.dataset.color === savedAccent));
                } else {
                    swatches.forEach(s => s.classList.toggle('active', s.dataset.color === '#4a90e2'));
                }

                // Viz style
                const savedVizStyle = appStorage.getItem('setting_viz_style') || 'circle-smooth';
                selectVizType(savedVizStyle);

                // Viz peaks
                const savedPeaks = appStorage.getItem('setting_viz_peaks');
                if (savedPeaks !== null) { window.vizShowPeaks = savedPeaks === '1'; const el = document.getElementById('setting-viz-peaks'); if(el) el.checked = window.vizShowPeaks; }
                else { window.vizShowPeaks = true; }

                // Bars scroll gradient
                const savedScrollGrad = appStorage.getItem('setting_viz_scroll_grad');
                if (savedScrollGrad !== null) { window.vizScrollGrad = savedScrollGrad === '1'; const el = document.getElementById('setting-viz-scroll-grad'); if(el) el.checked = window.vizScrollGrad; applyScrollGradRowVisibility(window.vizScrollGrad); }
                else { window.vizScrollGrad = false; }

                // Bars scroll speed
                const savedScrollSpeed = appStorage.getItem('setting_viz_scroll_speed');
                if (savedScrollSpeed !== null) { window.vizScrollSpeed = parseFloat(savedScrollSpeed); const el = document.getElementById('setting-viz-scroll-speed'); const lb = document.getElementById('setting-viz-scroll-speed-label'); if(el) el.value = savedScrollSpeed; if(lb) lb.textContent = parseFloat(savedScrollSpeed).toFixed(1); }
                else { window.vizScrollSpeed = 1; }

                // Waveform scroll gradient
                const savedScrollGradWave = appStorage.getItem('setting_viz_scroll_grad_wave');
                if (savedScrollGradWave !== null) { window.vizScrollGradWave = savedScrollGradWave === '1'; const el = document.getElementById('setting-viz-scroll-grad-wave'); if(el) el.checked = window.vizScrollGradWave; applyScrollGradWaveRowVisibility(window.vizScrollGradWave); }
                else { window.vizScrollGradWave = false; }

                // Waveform scroll speed
                const savedScrollSpeedWave = appStorage.getItem('setting_viz_scroll_speed_wave');
                if (savedScrollSpeedWave !== null) { window.vizScrollSpeedWave = parseFloat(savedScrollSpeedWave); const el = document.getElementById('setting-viz-scroll-speed-wave'); const lb = document.getElementById('setting-viz-scroll-speed-wave-label'); if(el) el.value = savedScrollSpeedWave; if(lb) lb.textContent = parseFloat(savedScrollSpeedWave).toFixed(1); }
                else { window.vizScrollSpeedWave = 1; }

                // Waveform trail
                const savedWaveTrail = appStorage.getItem('setting_viz_wave_trail');
                if (savedWaveTrail !== null) {
                    window.vizWaveTrail = savedWaveTrail === '1';
                    const el = document.getElementById('setting-viz-wave-trail');
                    if (el) el.checked = window.vizWaveTrail;
                    applyWaveTrailRowVisibility(window.vizWaveTrail);
                } else { window.vizWaveTrail = false; }

                const savedWaveTrailAmount = appStorage.getItem('setting_viz_wave_trail_amount');
                if (savedWaveTrailAmount !== null) {
                    window.vizWaveTrailAmount = parseFloat(savedWaveTrailAmount);
                    const el = document.getElementById('setting-viz-wave-trail-amount');
                    const lb = document.getElementById('setting-viz-wave-trail-amount-label');
                    if (el) el.value = savedWaveTrailAmount;
                    if (lb) lb.textContent = parseFloat(savedWaveTrailAmount).toFixed(2);
                } else { window.vizWaveTrailAmount = 0.30; }

                // Waveform hide on silence
                const savedWaveHideSilence = appStorage.getItem('setting_viz_wave_hide_silence');
                if (savedWaveHideSilence !== null) {
                    window.vizHideOnSilence = savedWaveHideSilence === '1';
                    const el = document.getElementById('setting-viz-wave-hide-silence');
                    if (el) el.checked = window.vizHideOnSilence;
                } else { window.vizHideOnSilence = false; }

                checkWaveformPerfWarning();

                // Waveform lines
                const savedWaveLines = appStorage.getItem('setting_viz_wave_lines');
                if (savedWaveLines !== null) { window.vizWaveLines = parseInt(savedWaveLines); const el = document.getElementById('setting-viz-wave-lines'); const lb = document.getElementById('setting-viz-wave-lines-label'); if(el) el.value = savedWaveLines; if(lb) lb.textContent = savedWaveLines; }
                else { window.vizWaveLines = 1; }
                const savedWaveSens = appStorage.getItem('setting_viz_wave_sens');
                if (savedWaveSens !== null) { window.vizWaveSens = parseFloat(savedWaveSens); const el = document.getElementById('setting-viz-wave-sens'); const lb = document.getElementById('setting-viz-wave-sens-label'); if(el) el.value = savedWaveSens; if(lb) lb.textContent = parseFloat(savedWaveSens).toFixed(1); }
                else { window.vizWaveSens = 1.5; }

                // Rotate speed
                const savedRotateSpeed = appStorage.getItem('setting_viz_rotate_speed');
                if (savedRotateSpeed !== null) { window.vizRotateSpeed = parseFloat(savedRotateSpeed); const el = document.getElementById('setting-viz-rotate-speed'); const lb = document.getElementById('setting-viz-rotate-speed-label'); if(el) el.value = savedRotateSpeed; if(lb) lb.textContent = parseFloat(savedRotateSpeed).toFixed(1); }
                else { window.vizRotateSpeed = 1; }

                // Fireworks (Салют)
                selectFwColorMode(appStorage.getItem('setting_fw_color_mode') || 'random');
                const savedFwCustomColors = appStorage.getItem('setting_fw_custom_colors');
                if (savedFwCustomColors) {
                    try {
                        const arr = JSON.parse(savedFwCustomColors);
                        if (Array.isArray(arr) && arr.length === 3) {
                            fwCustomColor1.value = arr[0]; fwCustomColor2.value = arr[1]; fwCustomColor3.value = arr[2];
                            window.fireworksCustomColors = arr;
                        }
                    } catch (e) {}
                } else {
                    window.fireworksCustomColors = [fwCustomColor1.value, fwCustomColor2.value, fwCustomColor3.value];
                }
                const savedFwThreshold = appStorage.getItem('setting_fw_threshold');
                if (savedFwThreshold !== null) { fwThresholdSlider.value = savedFwThreshold; fwThresholdLabel.textContent = parseFloat(savedFwThreshold).toFixed(2); window.fireworksThreshold = parseFloat(savedFwThreshold); }
                else { window.fireworksThreshold = 0; }
                const savedFwFreq = appStorage.getItem('setting_fw_frequency');
                if (savedFwFreq !== null) { fwFreqSlider.value = savedFwFreq; fwFreqLabel.textContent = parseFloat(savedFwFreq).toFixed(1); window.fireworksFrequency = parseFloat(savedFwFreq); }
                else { window.fireworksFrequency = 1; }
                const savedFwIdleSpawn = appStorage.getItem('setting_fw_idle_spawn');
                fwIdleSpawnToggle.checked = savedFwIdleSpawn === null ? true : savedFwIdleSpawn === '1';
                window.fireworksIdleSpawn = fwIdleSpawnToggle.checked;
                const savedFwBeat = appStorage.getItem('setting_fw_beat_reactive');
                fwBeatToggle.checked = savedFwBeat === null ? true : savedFwBeat === '1';
                window.fireworksBeatReactive = fwBeatToggle.checked;
                applyFwBeatBurstRowVisibility(fwBeatToggle.checked);
                const savedFwBeatBurst = appStorage.getItem('setting_fw_beat_burst');
                if (savedFwBeatBurst !== null) { fwBeatBurstSlider.value = savedFwBeatBurst; fwBeatBurstLabel.textContent = savedFwBeatBurst; window.fireworksBeatBurstCount = parseInt(savedFwBeatBurst); }
                else { window.fireworksBeatBurstCount = 1; }
                const savedFwTrail = appStorage.getItem('setting_fw_trail');
                if (savedFwTrail !== null) { fwTrailSlider.value = savedFwTrail; fwTrailLabel.textContent = savedFwTrail; window.fireworksTrail = parseInt(savedFwTrail); }
                else { window.fireworksTrail = 4; }

                // Show viz
                const savedShowViz = appStorage.getItem('setting_show_viz');
                if (savedShowViz !== null) {
                    settingViz.checked = savedShowViz === '1';
                    applyVizVisibility(settingViz.checked);
                }

                // Show stars
                const savedShowStars = appStorage.getItem('setting_show_stars');
                if (savedShowStars !== null) {
                    settingStars.checked = savedShowStars === '1';
                    starCanvas.style.opacity = settingStars.checked ? '1' : '0';
                }
                window.starsInteractive = appStorage.getItem('setting_stars_interactive') === '1';
                if (settingStarsInteractive) settingStarsInteractive.checked = window.starsInteractive;
                applyStarsInteractiveRowVisibility(settingStars.checked);

                // Confetti
                const savedConfetti = appStorage.getItem('setting_confetti');
                if (savedConfetti !== null) {
                    settingConfetti.checked = savedConfetti === '1';
                    applyConfettiVisibility(settingConfetti.checked);
                }
                const savedConfettiGrad = appStorage.getItem('setting_confetti_grad');
                if (savedConfettiGrad) {
                    try {
                        const [c1,c2,c3] = JSON.parse(savedConfettiGrad);
                        confettiC1.value = c1; confettiC2.value = c2; confettiC3.value = c3;
                        window.confettiColor1 = c1; window.confettiColor2 = c2; window.confettiColor3 = c3;
                    } catch(e) {}
                } else {
                    window.confettiColor1 = '#ff6b9d'; window.confettiColor2 = '#c44dff'; window.confettiColor3 = '#4daaff';
                }
                highlightActiveConfettiPreset();
                const savedConfettiInt = appStorage.getItem('setting_confetti_intensity');
                if (savedConfettiInt !== null) {
                    confettiIntSlider.value = savedConfettiInt;
                    confettiIntLabel.textContent = parseFloat(savedConfettiInt).toFixed(1);
                    window.confettiIntensity = parseFloat(savedConfettiInt);
                }
                const savedConfettiIdle = appStorage.getItem('setting_confetti_idle');
                if (savedConfettiIdle) selectConfettiIdle(savedConfettiIdle);
                // Spawn mode
                const savedConfettiSpawn = appStorage.getItem('setting_confetti_spawn');
                if (savedConfettiSpawn) selectConfettiSpawn(savedConfettiSpawn);
                // Sprinkler lines
                const savedSprinklerLines = appStorage.getItem('setting_confetti_sprinkler_lines');
                if (savedSprinklerLines !== null) {
                    const v = parseInt(savedSprinklerLines);
                    window.confettiSprinklerLines = v;
                    if (sprinklerLinesSlider) sprinklerLinesSlider.value = v;
                    if (sprinklerLinesLabel)  sprinklerLinesLabel.textContent = v;
                }
                // Beat sensitivity
                const savedSens = appStorage.getItem('setting_confetti_sensitivity');
                if (savedSens !== null) {
                    const v = parseFloat(savedSens);
                    window.confettiSensitivity = v;
                    if (sensitivitySlider) sensitivitySlider.value = v;
                    if (sensitivityLabel)  sensitivityLabel.textContent = v.toFixed(1);
                }
                // Gravity
                const savedConfettiGrav = appStorage.getItem('setting_confetti_gravity');
                if (savedConfettiGrav !== null) {
                    confettiGravSlider.value = savedConfettiGrav;
                    confettiGravLabel.textContent = parseFloat(savedConfettiGrav).toFixed(1);
                    window.confettiGravity = parseFloat(savedConfettiGrav);
                }
                // Size
                const savedConfettiSize = appStorage.getItem('setting_confetti_size');
                if (savedConfettiSize !== null) {
                    confettiSizeSlider.value = savedConfettiSize;
                    confettiSizeLabel.textContent = parseFloat(savedConfettiSize).toFixed(1);
                    window.confettiSizeScale = parseFloat(savedConfettiSize);
                }
                // Swirl
                const savedConfettiSwirl = appStorage.getItem('setting_confetti_swirl');
                if (savedConfettiSwirl !== null) {
                    settingConfettiSwirl.checked = savedConfettiSwirl === '1';
                    window.confettiSwirl = settingConfettiSwirl.checked;
                    applySwirlRowVisibility(settingConfettiSwirl.checked);
                }
                const savedConfettiSwirlStr = appStorage.getItem('setting_confetti_swirl_str');
                if (savedConfettiSwirlStr !== null) {
                    confettiSwirlStrSlider.value = savedConfettiSwirlStr;
                    confettiSwirlStrLabel.textContent = parseFloat(savedConfettiSwirlStr).toFixed(1);
                    window.confettiSwirlStr = parseFloat(savedConfettiSwirlStr);
                }

                // Viz intensity
                const savedVizInt = appStorage.getItem('setting_viz_intensity');
                if (savedVizInt !== null) {
                    vizIntSlider.value = savedVizInt;
                    vizIntLabel.textContent = parseFloat(savedVizInt).toFixed(1);
                    window.vizIntensity = parseFloat(savedVizInt);
                }

                // Crossfade
                const savedCrossfade = appStorage.getItem('setting_crossfade');
                if (savedCrossfade !== null) {
                    crossfadeEnabled = savedCrossfade === '1';
                    settingCrossfade.checked = crossfadeEnabled;
                    crossfadeDurationRow.classList.toggle('visible', crossfadeEnabled);
                    document.getElementById('crossfade-fadein-row').classList.toggle('visible', crossfadeEnabled);
                }
                const savedCFOut = appStorage.getItem('setting_crossfade_out');
                if (savedCFOut !== null) {
                    crossfadeOutDuration = parseFloat(savedCFOut);
                    const el = document.getElementById('setting-crossfade-out');
                    const lb = document.getElementById('setting-crossfade-out-label');
                    if (el) el.value = crossfadeOutDuration;
                    if (lb) lb.textContent = crossfadeOutDuration.toFixed(1) + 'с';
                }
                const savedCFIn = appStorage.getItem('setting_crossfade_in');
                if (savedCFIn !== null) {
                    crossfadeInDuration = parseFloat(savedCFIn);
                    const el = document.getElementById('setting-crossfade-in');
                    const lb = document.getElementById('setting-crossfade-in-label');
                    if (el) el.value = crossfadeInDuration;
                    if (lb) lb.textContent = crossfadeInDuration.toFixed(1) + 'с';
                }

                // Remember track
                const savedRemember = appStorage.getItem('setting_remember_track');
                if (savedRemember !== null) settingRememberTrack.checked = savedRemember === '1';
                applyRememberTrackSub(settingRememberTrack.checked);

                // Autonext
                const savedAutoNext = appStorage.getItem('setting_autonext');
                if (savedAutoNext !== null) settingAutoNext.checked = savedAutoNext === '1';
                const savedAutoNextPl = appStorage.getItem('setting_autonext_playlist');
                if (savedAutoNextPl !== null) { const el = document.getElementById('setting-autonext-playlist'); if(el) el.checked = savedAutoNextPl === '1'; }
                const savedMTT = appStorage.getItem('setting_minimize_to_tray');
                if (savedMTT !== null) { const el = document.getElementById('setting-minimize-to-tray'); if(el) el.checked = savedMTT === '1'; }

                // Open links in external browser
                const savedOLE = appStorage.getItem('setting_open_links_external');
                { const el = document.getElementById('setting-open-links-external'); if(el) el.checked = savedOLE === null ? true : savedOLE === '1'; }

                // Notifications
                const savedNotif = appStorage.getItem('setting_notifications');
                if (savedNotif !== null) settingNotifications.checked = savedNotif === '1';
                else settingNotifications.checked = true;

                // Viz gradient colors
                const savedGrad = appStorage.getItem('setting_viz_grad');
                if (savedGrad) {
                    try {
                        const [c1, c2, c3] = JSON.parse(savedGrad);
                        vizColor1.value = c1; vizColor2.value = c2; vizColor3.value = c3;
                        window.vizGradColor1 = c1; window.vizGradColor2 = c2; window.vizGradColor3 = c3;
                    } catch(e) {}
                } else {
                    window.vizGradColor1 = '#bb86fc';
                    window.vizGradColor2 = '#4a90e2';
                    window.vizGradColor3 = '#03dac6';
                }
                highlightActiveGradPreset();

                // Viz rotate
                const savedVizRotate = appStorage.getItem('setting_viz_rotate');
                if (savedVizRotate !== null) {
                    settingVizRotate.checked = savedVizRotate === '1';
                    window.vizRotateColors = settingVizRotate.checked;
                } else {
                    window.vizRotateColors = true;
                    settingVizRotate.checked = true;
                }
                applyRotateSpeedRowVisibility(settingVizRotate.checked);

                // Viz inner
                const savedVizInner = appStorage.getItem('setting_viz_inner');
                if (savedVizInner !== null) {
                    settingVizInner.checked = savedVizInner === '1';
                    window.vizShowInner = settingVizInner.checked;
                } else {
                    window.vizShowInner = true;
                }

                updateInnerVizRowVisibility();

                // Glass blur
                const savedBlur = appStorage.getItem('setting_glass_blur');
                if (savedBlur !== null) {
                    settingBlur.checked = savedBlur === '1';
                    applyBlurSetting(settingBlur.checked);
                } else {
                    // По умолчанию blur включён
                    applyBlurSetting(true);
                }

                // Show cover art
                const savedCover = appStorage.getItem('setting_show_cover');
                if (savedCover !== null) {
                    settingShowCover.checked = savedCover === '1';
                    document.body.classList.toggle('show-covers', savedCover === '1');
                }

                // Custom background image — подгон, переключатель, недавние (сама загрузка
                // файла/данных из хранилища выполняется один раз при старте, см. restoreBackgroundFromStorage)
                selectBgFit(appStorage.getItem('setting_bg_image_fit') || 'cover');
                renderRecentBackgrounds();

                // Custom background image — общий переключатель
                const savedBgEnabled = appStorage.getItem('setting_bg_image_enabled');
                if (savedBgEnabled !== null) settingBgEnabled.checked = savedBgEnabled === '1';
                applyBgImageEnabled(settingBgEnabled.checked);

                // Пульсация под звук
                const savedBgPulse = appStorage.getItem('setting_bg_pulse_enabled');
                if (savedBgPulse !== null) settingBgPulse.checked = savedBgPulse === '1';
                window.bgPulseEnabled = settingBgPulse.checked;
                applyBgPulseRowVisibility(window.bgPulseEnabled);

                const savedBgPulseIntensity = appStorage.getItem('setting_bg_pulse_intensity');
                if (savedBgPulseIntensity !== null) {
                    bgPulseIntensitySlider.value = savedBgPulseIntensity;
                    bgPulseIntensityLabel.textContent = parseFloat(savedBgPulseIntensity).toFixed(1);
                    window.bgPulseIntensity = parseFloat(savedBgPulseIntensity);
                } else { window.bgPulseIntensity = 1; }

                const savedBgPulseThreshold = appStorage.getItem('setting_bg_pulse_threshold');
                if (savedBgPulseThreshold !== null) {
                    bgPulseThresholdSlider.value = savedBgPulseThreshold;
                    bgPulseThresholdLabel.textContent = parseFloat(savedBgPulseThreshold).toFixed(2);
                    window.bgPulseThreshold = parseFloat(savedBgPulseThreshold);
                } else { window.bgPulseThreshold = 0; }

                // Размытие под звук
                const savedBgBlur = appStorage.getItem('setting_bg_blur_enabled');
                if (savedBgBlur !== null) settingBgBlur.checked = savedBgBlur === '1';
                window.bgBlurEnabled = settingBgBlur.checked;
                applyBgBlurRowVisibility(window.bgBlurEnabled);

                const savedBgBlurIntensity = appStorage.getItem('setting_bg_blur_intensity');
                if (savedBgBlurIntensity !== null) {
                    bgBlurIntensitySlider.value = savedBgBlurIntensity;
                    bgBlurIntensityLabel.textContent = parseFloat(savedBgBlurIntensity).toFixed(1);
                    window.bgBlurIntensity = parseFloat(savedBgBlurIntensity);
                } else { window.bgBlurIntensity = 1; }

                const savedBgBlurThreshold = appStorage.getItem('setting_bg_blur_threshold');
                if (savedBgBlurThreshold !== null) {
                    bgBlurThresholdSlider.value = savedBgBlurThreshold;
                    bgBlurThresholdLabel.textContent = parseFloat(savedBgBlurThreshold).toFixed(2);
                    window.bgBlurThreshold = parseFloat(savedBgBlurThreshold);
                } else { window.bgBlurThreshold = 0; }

                // Свечение под звук
                const savedBgGlow = appStorage.getItem('setting_bg_glow_enabled');
                if (savedBgGlow !== null) settingBgGlow.checked = savedBgGlow === '1';
                window.bgGlowEnabled = settingBgGlow.checked;
                applyBgGlowRowVisibility(window.bgGlowEnabled);

                const savedBgGlowIntensity = appStorage.getItem('setting_bg_glow_intensity');
                if (savedBgGlowIntensity !== null) {
                    bgGlowIntensitySlider.value = savedBgGlowIntensity;
                    bgGlowIntensityLabel.textContent = parseFloat(savedBgGlowIntensity).toFixed(1);
                    window.bgGlowIntensity = parseFloat(savedBgGlowIntensity);
                } else { window.bgGlowIntensity = 1; }

                const savedBgGlowThreshold = appStorage.getItem('setting_bg_glow_threshold');
                if (savedBgGlowThreshold !== null) {
                    bgGlowThresholdSlider.value = savedBgGlowThreshold;
                    bgGlowThresholdLabel.textContent = parseFloat(savedBgGlowThreshold).toFixed(2);
                    window.bgGlowThreshold = parseFloat(savedBgGlowThreshold);
                } else { window.bgGlowThreshold = 0; }

                const savedBgGlowCustomColorEnabled = appStorage.getItem('setting_bg_glow_custom_color_enabled');
                settingBgGlowCustomColor.checked = savedBgGlowCustomColorEnabled === '1';
                window.bgGlowCustomColorEnabled = settingBgGlowCustomColor.checked;
                setSettingsBlockVisible(bgGlowColorRow, window.bgGlowCustomColorEnabled, 'flex');

                const savedBgGlowCustomColor = appStorage.getItem('setting_bg_glow_custom_color');
                window.bgGlowCustomColor = savedBgGlowCustomColor || '#bb86fc';
                bgGlowColorPicker.value = window.bgGlowCustomColor;

                selectBgGlowStyle(appStorage.getItem('setting_bg_glow_style') || 'center');

                // Тряска (наклон) под звук
                const savedBgTilt = appStorage.getItem('setting_bg_tilt_enabled');
                if (savedBgTilt !== null) settingBgTilt.checked = savedBgTilt === '1';
                window.bgTiltEnabled = settingBgTilt.checked;
                applyBgTiltRowVisibility(window.bgTiltEnabled);

                const savedBgTiltIntensity = appStorage.getItem('setting_bg_tilt_intensity');
                if (savedBgTiltIntensity !== null) {
                    bgTiltIntensitySlider.value = savedBgTiltIntensity;
                    bgTiltIntensityLabel.textContent = parseFloat(savedBgTiltIntensity).toFixed(1);
                    window.bgTiltIntensity = parseFloat(savedBgTiltIntensity);
                } else { window.bgTiltIntensity = 1; }

                const savedBgTiltThreshold = appStorage.getItem('setting_bg_tilt_threshold');
                if (savedBgTiltThreshold !== null) {
                    bgTiltThresholdSlider.value = savedBgTiltThreshold;
                    bgTiltThresholdLabel.textContent = parseFloat(savedBgTiltThreshold).toFixed(2);
                    window.bgTiltThreshold = parseFloat(savedBgTiltThreshold);
                } else { window.bgTiltThreshold = 0; }

                const savedBgTiltSpeed = appStorage.getItem('setting_bg_tilt_speed');
                if (savedBgTiltSpeed !== null) {
                    bgTiltSpeedSlider.value = savedBgTiltSpeed;
                    bgTiltSpeedLabel.textContent = parseFloat(savedBgTiltSpeed).toFixed(1);
                    window.bgTiltSpeed = parseFloat(savedBgTiltSpeed);
                } else { window.bgTiltSpeed = 1; }

                const savedBgTiltRotation = appStorage.getItem('setting_bg_tilt_rotation');
                settingBgTiltRotation.checked = savedBgTiltRotation === null ? true : savedBgTiltRotation === '1';
                window.bgTiltRotation = settingBgTiltRotation.checked;

                const savedBgTiltShift = appStorage.getItem('setting_bg_tilt_shift');
                settingBgTiltShift.checked = savedBgTiltShift === null ? true : savedBgTiltShift === '1';
                window.bgTiltShift = settingBgTiltShift.checked;

                // Следование за курсором
                const savedBgCursor = appStorage.getItem('setting_bg_cursor_enabled');
                if (savedBgCursor !== null) settingBgCursor.checked = savedBgCursor === '1';
                window.bgCursorEnabled = settingBgCursor.checked;
                applyBgCursorSub(window.bgCursorEnabled);

                const savedBgCursorIntensityX = appStorage.getItem('setting_bg_cursor_intensity_x');
                if (savedBgCursorIntensityX !== null) {
                    bgCursorIntensityXSlider.value = savedBgCursorIntensityX;
                    bgCursorIntensityXLabel.textContent = parseFloat(savedBgCursorIntensityX).toFixed(1);
                    window.bgCursorIntensityX = parseFloat(savedBgCursorIntensityX);
                } else { window.bgCursorIntensityX = 3; }

                const savedBgCursorIntensityY = appStorage.getItem('setting_bg_cursor_intensity_y');
                if (savedBgCursorIntensityY !== null) {
                    bgCursorIntensityYSlider.value = savedBgCursorIntensityY;
                    bgCursorIntensityYLabel.textContent = parseFloat(savedBgCursorIntensityY).toFixed(1);
                    window.bgCursorIntensityY = parseFloat(savedBgCursorIntensityY);
                } else { window.bgCursorIntensityY = 3; }

                const savedBgCursorInvert = appStorage.getItem('setting_bg_cursor_invert');
                settingBgCursorInvert.checked = savedBgCursorInvert === '1';
                window.bgCursorInvert = settingBgCursorInvert.checked;

                // Наклон за курсором (вложено в «Следование за курсором»)
                const savedBgCursorTilt = appStorage.getItem('setting_bg_cursor_tilt_enabled');
                if (savedBgCursorTilt !== null) settingBgCursorTilt.checked = savedBgCursorTilt === '1';
                settingBgCursorTilt.disabled = !window.bgCursorEnabled;
                window.bgCursorTiltEnabled = settingBgCursorTilt.checked && window.bgCursorEnabled;
                applyBgCursorTiltSub(window.bgCursorTiltEnabled);

                const savedBgCursorTiltIntensity = appStorage.getItem('setting_bg_cursor_tilt_intensity');
                if (savedBgCursorTiltIntensity !== null) {
                    bgCursorTiltIntensitySlider.value = savedBgCursorTiltIntensity;
                    bgCursorTiltIntensityLabel.textContent = parseFloat(savedBgCursorTiltIntensity).toFixed(1);
                    window.bgCursorTiltIntensity = parseFloat(savedBgCursorTiltIntensity);
                } else { window.bgCursorTiltIntensity = 2; }

                const savedBgCursorTiltInvert = appStorage.getItem('setting_bg_cursor_tilt_invert');
                settingBgCursorTiltInvert.checked = savedBgCursorTiltInvert === '1';
                window.bgCursorTiltInvert = settingBgCursorTiltInvert.checked;

                // Discord Rich Presence — только синхронизация UI/переменных, без
                // повторного подключения при каждом открытии настроек (само
                // подключение при старте приложения делает initDiscordRpcOnStartup()).
                const savedDiscordRpcEnabled = appStorage.getItem('setting_discord_rpc_enabled') === '1';
                settingDiscordRpc.checked = savedDiscordRpcEnabled;
                window.discordRPCEnabled = savedDiscordRpcEnabled;
                applyDiscordRpcBodyVisibility(savedDiscordRpcEnabled);

                const savedDiscordRpcManual = appStorage.getItem('setting_discord_rpc_manual') === '1';
                settingDiscordRpcManual.checked = savedDiscordRpcManual;
                setSettingsBlockVisible(discordRpcManualRow, savedDiscordRpcManual, 'block');

                discordRpcClientIdInput.value = appStorage.getItem('setting_discord_rpc_client_id') || DISCORD_RPC_DEFAULT_CLIENT_ID;

                const savedDiscordRpcProgress = appStorage.getItem('setting_discord_rpc_progress');
                settingDiscordRpcProgress.checked = savedDiscordRpcProgress === null ? true : savedDiscordRpcProgress === '1';
                window.discordRPCShowProgress = settingDiscordRpcProgress.checked;

                const savedDiscordRpcRadioButton = appStorage.getItem('setting_discord_rpc_radio_button');
                settingDiscordRpcRadioButton.checked = savedDiscordRpcRadioButton === null ? true : savedDiscordRpcRadioButton === '1';
                window.discordRPCShowRadioButton = settingDiscordRpcRadioButton.checked;

                discordRpcRedirectBaseInput.value = appStorage.getItem('setting_discord_rpc_redirect_base') || DISCORD_RPC_DEFAULT_REDIRECT_BASE;
                // Эффективный redirect-URL зависит от тумблера "Ручная настройка" —
                // считаем ПОСЛЕ того, как settingDiscordRpcManual.checked уже восстановлен выше.
                window.discordRPCRedirectBase = getDiscordRpcRedirectBase();

                if (savedDiscordRpcEnabled) {
                    noctune.discordRpcStatus().then((s) => {
                        if (s && s.connected) setDiscordRpcStatusPill('connected', 'Подключено');
                        else setDiscordRpcStatusPill('idle', 'Подключение…');
                    });
                } else {
                    setDiscordRpcStatusPill('idle', 'Отключено');
                }

                // Last.fm — статус подключения (сессия персистится в main-процессе)
                // спрашиваем заново при каждом открытии настроек: это же самое
                // защищает от гонки со стартовой асинхронной инициализацией store.
                refreshLastfmStatusFromMain();

                // Адаптивная палитра (акцент/градиент из фона) — только синхронизация галочек;
                // сам пересчёт палитры запускается лишь при смене фона или переключении тумблера,
                // а не при каждом открытии настроек (см. restoreBackgroundFromStorage и обработчики change)
                window.adaptiveAccentEnabled = appStorage.getItem('setting_adaptive_accent') === '1';
                if (settingAdaptiveAccent) settingAdaptiveAccent.checked = window.adaptiveAccentEnabled;
                window.adaptiveGradientEnabled = appStorage.getItem('setting_adaptive_gradient') === '1';
                if (settingAdaptiveGradient) settingAdaptiveGradient.checked = window.adaptiveGradientEnabled;
                refreshAdaptiveControlsDisabledState();

                const versionEl = document.getElementById('app-version');
                const verText = versionEl ? versionEl.textContent : 'v1.0.0';
                document.getElementById('settings-app-version').textContent = verText;
                document.getElementById('update-current-version').textContent = verText;

                // Playlist editor (if panel is active)
                if (document.getElementById('panel-general').classList.contains('active')) renderPlEditor();
            }

            // Восстанавливает реальный фон (картинку/видео) из настроек.
            // Вызывается ОДИН РАЗ при старте приложения. Если вызывать это при
            // каждом открытии настроек (как раньше), video.load() перезапускал
            // бы видео-фон и вызывал заметное мигание — поэтому загрузка файла
            // отделена от refreshSettingsUI(), которая теперь лишь синхронизирует
            // переключатели и ничего не перезагружает.
            function restoreBackgroundFromStorage() {
                const savedBgPath = appStorage.getItem('setting_bg_image_path');
                if (savedBgPath) {
                    noctune.fs.exists(savedBgPath).then((exists) => {
                        if (exists) {
                            applyBgImagePath(savedBgPath, false);
                        } else {
                            appStorage.removeItem('setting_bg_image_path');
                        }
                    }).catch(() => {});
                }
            }

            // Init on page load
            // Адаптивные флаги выставляем заранее: restoreBackgroundFromStorage() сама
            // запускает пересчёт палитры сразу после готовности картинки/видео фона.
            window.adaptiveAccentEnabled = appStorage.getItem('setting_adaptive_accent') === '1';
            window.adaptiveGradientEnabled = appStorage.getItem('setting_adaptive_gradient') === '1';
            restoreBackgroundFromStorage();
            refreshSettingsUI();
            // Discord Rich Presence — если было включено в прошлый раз, подключаемся
            // автоматически при старте приложения (без необходимости открывать настройки).
            (function initDiscordRpcOnStartup() {
                window.discordRPCEnabled = appStorage.getItem('setting_discord_rpc_enabled') === '1';
                window.discordRPCShowProgress = (appStorage.getItem('setting_discord_rpc_progress') ?? '1') === '1';
                window.discordRPCShowRadioButton = (appStorage.getItem('setting_discord_rpc_radio_button') ?? '1') === '1';
                // refreshSettingsUI() (вызван строкой выше) уже восстановил
                // settingDiscordRpcManual.checked и поля ввода — используем те же
                // помощники, чтобы при выключенной "Ручной настройке" всегда
                // подключались с ID/redirect-URL по умолчанию, а не тем, что
                // осталось в скрытых полях.
                window.discordRPCRedirectBase = getDiscordRpcRedirectBase();
                if (window.discordRPCEnabled) {
                    noctune.discordRpcConnect(getDiscordRpcClientId());
                }
            })();
            window.vizIntensity = window.vizIntensity || 1;
            window.vizStyle = window.vizStyle || 'circle-smooth';
            window.vizRotateColors = window.vizRotateColors !== undefined ? window.vizRotateColors : true;
            window.vizShowInner = window.vizShowInner !== undefined ? window.vizShowInner : true;

            // Init crossfade from storage before settings open
            (function() {
                const cf = appStorage.getItem('setting_crossfade');
                if (cf !== null) crossfadeEnabled = cf === '1';
                const cfo = appStorage.getItem('setting_crossfade_out');
                if (cfo !== null) crossfadeOutDuration = parseFloat(cfo);
                const cfi = appStorage.getItem('setting_crossfade_in');
                if (cfi !== null) crossfadeInDuration = parseFloat(cfi);
                const savedGrad = appStorage.getItem('setting_viz_grad');
                if (savedGrad) { try { const [c1,c2,c3] = JSON.parse(savedGrad); window.vizGradColor1=c1; window.vizGradColor2=c2; window.vizGradColor3=c3; } catch(e){} }
                else { window.vizGradColor1='#bb86fc'; window.vizGradColor2='#4a90e2'; window.vizGradColor3='#03dac6'; }
                const vr = appStorage.getItem('setting_viz_rotate'); if (vr !== null) window.vizRotateColors = vr === '1';
                const vi = appStorage.getItem('setting_viz_inner'); if (vi !== null) window.vizShowInner = vi === '1';
                const ss = appStorage.getItem('setting_viz_scroll_speed'); if (ss !== null) window.vizScrollSpeed = parseFloat(ss); else window.vizScrollSpeed = 1;
                const ssw = appStorage.getItem('setting_viz_scroll_speed_wave'); if (ssw !== null) window.vizScrollSpeedWave = parseFloat(ssw); else window.vizScrollSpeedWave = 1;
                const sgw = appStorage.getItem('setting_viz_scroll_grad_wave'); if (sgw !== null) window.vizScrollGradWave = sgw === '1'; else window.vizScrollGradWave = false;
                const rs = appStorage.getItem('setting_viz_rotate_speed'); if (rs !== null) window.vizRotateSpeed = parseFloat(rs); else window.vizRotateSpeed = 1;
                // Fireworks (Салют) early init
                const fcm = appStorage.getItem('setting_fw_color_mode'); if (fcm) window.fireworksColorMode = fcm;
                const fcc = appStorage.getItem('setting_fw_custom_colors'); if (fcc) { try { const arr = JSON.parse(fcc); if (Array.isArray(arr)) window.fireworksCustomColors = arr; } catch(e){} }
                const fthresh = appStorage.getItem('setting_fw_threshold'); if (fthresh !== null) window.fireworksThreshold = parseFloat(fthresh);
                const ffreq = appStorage.getItem('setting_fw_frequency'); if (ffreq !== null) window.fireworksFrequency = parseFloat(ffreq);
                const fidle = appStorage.getItem('setting_fw_idle_spawn'); if (fidle !== null) window.fireworksIdleSpawn = fidle === '1';
                const fbeat = appStorage.getItem('setting_fw_beat_reactive'); if (fbeat !== null) window.fireworksBeatReactive = fbeat === '1';
                const fburst = appStorage.getItem('setting_fw_beat_burst'); if (fburst !== null) window.fireworksBeatBurstCount = parseInt(fburst);
                const ftrail = appStorage.getItem('setting_fw_trail'); if (ftrail !== null) window.fireworksTrail = parseInt(ftrail);
                // Confetti early init
                const scf = appStorage.getItem('setting_confetti'); if (scf !== null) { window.confettiEnabled = scf === '1'; const el = document.getElementById('confetti-canvas'); if(el) el.style.opacity = window.confettiEnabled ? '1' : '0'; }
                const scfg = appStorage.getItem('setting_confetti_grad'); if (scfg) { try { const [c1,c2,c3]=JSON.parse(scfg); window.confettiColor1=c1; window.confettiColor2=c2; window.confettiColor3=c3; } catch(e){} }
                const scfi = appStorage.getItem('setting_confetti_intensity'); if (scfi !== null) window.confettiIntensity = parseFloat(scfi);
                const scfid = appStorage.getItem('setting_confetti_idle'); if (scfid) window.confettiIdleState = scfid;
                const scfsp = appStorage.getItem('setting_confetti_spawn'); if (scfsp) window.confettiSpawnMode = scfsp;
                const scfsl = appStorage.getItem('setting_confetti_sprinkler_lines'); if (scfsl !== null) window.confettiSprinklerLines = parseInt(scfsl);

                const scfsen = appStorage.getItem('setting_confetti_sensitivity'); if (scfsen !== null) window.confettiSensitivity = parseFloat(scfsen);
                const scfgv = appStorage.getItem('setting_confetti_gravity'); if (scfgv !== null) window.confettiGravity = parseFloat(scfgv);
                const scfsz = appStorage.getItem('setting_confetti_size'); if (scfsz !== null) window.confettiSizeScale = parseFloat(scfsz);
                const scfsw = appStorage.getItem('setting_confetti_swirl'); if (scfsw !== null) window.confettiSwirl = scfsw === '1';
                const scfss = appStorage.getItem('setting_confetti_swirl_str'); if (scfss !== null) window.confettiSwirlStr = parseFloat(scfss);
                const notif = appStorage.getItem('setting_notifications');
                if (notif === null) { const n = document.getElementById('setting-notifications'); if(n) n.checked = true; }
                const an = appStorage.getItem('setting_autonext');
                if (an !== null) { const el = document.getElementById('setting-autonext'); if(el) el.checked = an === '1'; }
                const anpl = appStorage.getItem('setting_autonext_playlist');
                if (anpl !== null) { const el = document.getElementById('setting-autonext-playlist'); if(el) el.checked = anpl === '1'; }

                const srp = appStorage.getItem('setting_restore_playback');
                if (srp !== null) { const el = document.getElementById('setting-restore-playback'); if(el) el.checked = srp === '1'; }
                const mtt = appStorage.getItem('setting_minimize_to_tray');
                if (mtt !== null) { const el = document.getElementById('setting-minimize-to-tray'); if(el) el.checked = mtt === '1'; }
                const rt = appStorage.getItem('setting_remember_track');
                if (rt !== null) { const el = document.getElementById('setting-remember-track'); if(el) el.checked = rt === '1'; }
                // Open links in external browser — default ON
                const ole = appStorage.getItem('setting_open_links_external');
                { const el = document.getElementById('setting-open-links-external'); if(el) el.checked = ole === null ? true : ole === '1'; }
                // Balance & channel mode are applied when AudioContext is created (initAudioEngine reads localStorage directly)
            })();

            // Intercept all http(s) link clicks.
            // • Capture phase (true) — fires before Electron processes target="_blank" navigation,
            //   so preventDefault() reliably prevents the window from opening / navigating away.
            // • Always call preventDefault to stop Electron from doing anything unexpected.
            // • When setting ON  → open in external browser via IPC.
            // • When setting OFF → click is suppressed (links do nothing); Electron's built-in
            //   behaviour for target="_blank" is inconsistent across versions so we block it.
            document.addEventListener('click', (e) => {
                const link = e.target.closest('a[href]');
                if (!link) return;
                const href = link.getAttribute('href');
                if (!href || !/^https?:\/\//i.test(href)) return;

                e.preventDefault();

                const settingEl = document.getElementById('setting-open-links-external');
                const enabled = settingEl ? settingEl.checked
                                           : (appStorage.getItem('setting_open_links_external') !== '0');
                if (enabled) {
                    noctune.openExternalUrl(href);
                } else {
                    noctune.openInternalUrl(href);
                }
            }, true); // capture phase

            // Открыто наружу для renderer/playlist-io.js — после импорта .m3u
            // нужно перерисовать список плейлистов прямо в открытых настройках.
            window.renderPlEditor = renderPlEditor;
        })();
