        // ══════════════════════════════════════════════════════════════════
        // WAVEFORM ЗА ОБЛОЖКОЙ
        // ══════════════════════════════════════════════════════════════════
        // Разово декодируем весь локальный файл через decodeAudioData —
        // ТОЛЬКО ради формы волны, никак не влияет на реальное воспроизведение
        // (оно идёт через отдельный <audio>/MediaElementSourceNode). Результат
        // сжимается до WAVEFORM_BARS байт и сохраняется на диске по версии
        // файла (сырые, ненормализованные под "чувствительность" — та
        // применяется на отрисовке, чтобы её можно было крутить вживую без
        // повторного декодирования). Прогресс обновляется не через RAF, а
        // через CSS-transition поверх clip-path/transform — дёшево и
        // достаточно плавно при апдейте раз в 250мс (см. audio-engine.js).
        const WAVEFORM_BARS = 200;
        window._waveformCache = new Map();      // filePath -> Uint8Array(N) пиков 0..255 (сырые, до sensitivity)
        window._waveformDecodeToken = 0;        // отмена устаревшего decode, если трек уже сменился
        window._waveformLastFraction = 0;       // последняя известная позиция 0..1 — нужна при смене режима/цвета без ре-декода

        function waveformHasBackground() {
            return !!(window.bgImageEnabled && window.bgImagePath);
        }

        function getWaveformColor() {
            if (window.waveformColorMode === 'custom') {
                return window.waveformCustomColor || '#4a90e2';
            }
            // Адаптивный режим — если есть свой фон, берём текущий акцент (он
            // либо уже посчитан от этого же фона, либо выбран пользователем
            // вручную — в обоих случаях осмысленно связан с тем, что видно на
            // экране). Без фона акценту неоткуда быть "адаптивным" — вместо
            // произвольного цвета берём нейтральный, однозначно читаемый на
            // фоне текущей темы.
            if (waveformHasBackground()) {
                return getComputedStyle(document.body).getPropertyValue('--accent-color').trim() || '#4a90e2';
            }
            const isDark = document.body.getAttribute('data-theme') === 'dark';
            return isDark ? '#e8e8e8' : '#2b2b2b';
        }

        function hexToRgba(hex, alpha) {
            let h = (hex || '#4a90e2').replace('#', '');
            if (h.length === 3) h = h.split('').map(c => c + c).join('');
            const r = parseInt(h.substr(0, 2), 16) || 0;
            const g = parseInt(h.substr(2, 2), 16) || 0;
            const b = parseInt(h.substr(4, 2), 16) || 0;
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }

        // "Чувствительность" — гамма-кривая поверх сырых (0..1, уже
        // нормализованных к максимуму трека) пиков. sensitivity=1 — как есть.
        // Выше 1 — приподнимает тихие участки (кривая выпуклая, видно больше
        // нюансов); ниже 1 — приглушает всё, кроме самых громких пиков.
        function applyWaveformSensitivity(peaks, sensitivity) {
            const s = sensitivity || 1;
            if (Math.abs(s - 1) < 0.01) return peaks;
            const out = new Float32Array(peaks.length);
            const gamma = 1 / s;
            for (let i = 0; i < peaks.length; i++) out[i] = Math.pow(peaks[i], gamma);
            return out;
        }

        // Плавное затухание к краям — множитель альфы 0..1 в зависимости от
        // позиции бара. Считается прямо по альфе каждого бара (а не отдельным
        // div-оверлеем поверх): работает гарантированно при любом фоне под
        // канвасом, в отличие от подхода с градиентом в цвет контейнера.
        function edgeFadeMultiplier(index, count) {
            const fadeZone = 0.22; // доля ширины с каждого края, где идёт затухание
            const t = count > 1 ? index / (count - 1) : 0.5;
            if (t < fadeZone) return t / fadeZone;
            if (t > 1 - fadeZone) return (1 - t) / fadeZone;
            return 1;
        }

        function drawWaveformBars(canvas, peaks, colorHex, baseAlpha, barW, gap) {
            const dpr = window.devicePixelRatio || 1;
            const rect = canvas.getBoundingClientRect();
            const w = rect.width, h = rect.height;
            if (w <= 0 || h <= 0) return;
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);

            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, w, h);

            // Столбики не растягиваем на всю высоту контейнера — даже самый
            // громкий момент трека оставляет отступ сверху/снизу, как в
            // референсе (AIMP и т.п.), а не упирается в края.
            const maxBarH = h * 0.82;

            for (let i = 0; i < peaks.length; i++) {
                const barH = Math.max(2, peaks[i] * maxBarH);
                const x = i * (barW + gap);
                const y = (h - barH) / 2;
                ctx.fillStyle = hexToRgba(colorHex, baseAlpha * edgeFadeMultiplier(i, peaks.length));
                if (ctx.roundRect) {
                    ctx.beginPath();
                    ctx.roundRect(x, y, barW, barH, barW / 2);
                    ctx.fill();
                } else {
                    ctx.fillRect(x, y, barW, barH);
                }
            }
        }

        function renderWaveform(rawPeaks) {
            const wrap = document.getElementById('waveform-wrap');
            const canvasBase = document.getElementById('waveform-canvas-base');
            const canvasProgress = document.getElementById('waveform-canvas-progress');
            if (!wrap || !canvasBase || !canvasProgress) return;

            if (!rawPeaks || !window.waveformEnabled) {
                wrap.style.opacity = '0';
                return;
            }

            const normalized = Float32Array.from(rawPeaks, value => value / 255);
            const peaks = applyWaveformSensitivity(normalized, window.waveformSensitivity);
            const color = getWaveformColor();
            const scrollMode = window.waveformMode === 'scroll';
            wrap.classList.toggle('mode-scroll', scrollMode);

            const rect = wrap.getBoundingClientRect();
            let barW, gap, totalW;
            if (scrollMode) {
                barW = 4; gap = 2;
                totalW = peaks.length * (barW + gap);
            } else {
                gap = 2;
                barW = Math.max(1, (rect.width / peaks.length) - gap);
                totalW = rect.width;
            }

            // Заливка прогресса — одним и тем же clip-path (в процентах от
            // собственной ширины канваса) для обоих режимов: в "Прокрутке"
            // канвас шире вьюпорта и целиком едет через translateX, а разрез
            // остаётся привязан к его собственным координатам и просто
            // едет вместе с ним — поэтому граница "сыграно/впереди" всегда
            // корректна независимо от того, что видно в текущем окне.
            // Без неё на самом старте/конце трека (когда прокрутка упирается
            // в край и не центрируется) непонятно, в каком именно месте
            // сейчас находится воспроизведение — только эта заливка это и
            // показывает.
            [canvasBase, canvasProgress].forEach(c => { c.style.width = totalW + 'px'; });
            drawWaveformBars(canvasBase, peaks, color, 0.12, barW, gap);
            drawWaveformBars(canvasProgress, peaks, color, scrollMode ? 0.42 : 0.30, barW, gap);

            const f = window._waveformLastFraction;
            [canvasBase, canvasProgress].forEach(c => { c.style.transition = 'none'; });
            if (scrollMode) {
                positionScrollCanvas([canvasBase, canvasProgress], rect.width, totalW, f);
            } else {
                canvasBase.style.transform = 'translateX(0)';
                canvasProgress.style.transform = 'translateX(0)';
            }
            canvasProgress.style.clipPath = `inset(0 ${(1 - f) * 100}% 0 0)`;
            void canvasProgress.offsetWidth; // форсируем reflow перед возвратом transition
            [canvasBase, canvasProgress].forEach(c => { c.style.transition = ''; });

            wrap.style.opacity = '1';
        }

        function positionScrollCanvas(canvases, viewportW, totalW, fraction) {
            const desired = viewportW / 2 - fraction * totalW;
            const minTranslate = Math.min(0, viewportW - totalW); // правый край трека — не тянуть пустоту
            const maxTranslate = 0;                                // левый край трека — не тянуть пустоту
            const clamped = Math.max(minTranslate, Math.min(maxTranslate, desired));
            canvases.forEach(c => { c.style.transform = `translateX(${clamped}px)`; });
        }

        function updateWaveformProgress(fraction) {
            const f = Math.max(0, Math.min(1, fraction || 0));
            window._waveformLastFraction = f;
            if (!window.waveformEnabled) return;

            const wrap = document.getElementById('waveform-wrap');
            const canvasBase = document.getElementById('waveform-canvas-base');
            const canvasProgress = document.getElementById('waveform-canvas-progress');
            if (!wrap || !canvasBase || !canvasProgress) return;

            if (window.waveformMode === 'scroll') {
                const totalW = parseFloat(canvasBase.style.width) || 0;
                if (!totalW) return;
                const rect = wrap.getBoundingClientRect();
                positionScrollCanvas([canvasBase, canvasProgress], rect.width, totalW, f);
            }
            canvasProgress.style.clipPath = `inset(0 ${(1 - f) * 100}% 0 0)`;
        }

        // Перерисовка при смене темы/акцента/режима/чувствительности — без
        // этого цвет/форма волны остались бы «залипшими» на момент загрузки трека.
        function refreshWaveformColorIfNeeded() {
            const filePath = window._waveformCurrentFilePath;
            if (!filePath || !window._waveformCache.has(filePath)) return;
            renderWaveform(window._waveformCache.get(filePath));
        }

        let waveformJob = null, waveformBusy = false, waveformFetch = null;
        function cancelTrackWaveform() {
            window._waveformDecodeToken++;
            waveformFetch?.abort();
            if (waveformJob) waveformJob.resolve();
            waveformJob = null;
            window._waveformCurrentFilePath = null;
            renderWaveform(null);
        }
        function loadTrackWaveform(filePath, ownerToken) {
            cancelTrackWaveform();
            window._waveformCurrentFilePath = filePath;
            window._waveformLastFraction = 0;
            if (!window.waveformEnabled) return Promise.resolve();
            return new Promise(resolve => {
                waveformJob = { filePath, ownerToken, token: window._waveformDecodeToken, resolve };
                processWaveformJobs();
            });
        }
        async function processWaveformJobs() {
            if (waveformBusy) return;
            waveformBusy = true;
            try {
                while (waveformJob) {
                    const job = waveformJob; waveformJob = null;
                    const current = () => job.token === window._waveformDecodeToken && window.waveformEnabled && (typeof _loadToken === 'undefined' || job.ownerToken === _loadToken);
                    let decodeCtx = null, arrayBuffer = null, audioBuffer = null;
                    try {
                        const cached = await noctune.waveform.get(job.filePath);
                        if (!current()) continue;
                        if (cached?.peaks?.length === WAVEFORM_BARS) {
                            const compact = Uint8Array.from(cached.peaks);
                            rememberWaveform(job.filePath, compact); renderWaveform(compact); continue;
                        }
                        waveformFetch = new AbortController();
                        const response = await fetch(noctune.fs.toFileUrl(job.filePath), { signal: waveformFetch.signal });
                        if (!response.ok || !current()) continue;
                        arrayBuffer = await response.arrayBuffer();
                        if (!current()) continue;
                        // Only one decoder at a time; 8 kHz is sufficient for a 200-bar envelope.
                        const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
                        if (!OfflineCtx) continue;
                        decodeCtx = new OfflineCtx(1, 1, 8000);
                        audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer);
                        arrayBuffer = null;
                        if (!current()) continue;
                        const compact = compactWaveform(audioBuffer.getChannelData(0));
                        audioBuffer = null; decodeCtx = null;
                        if (!current()) continue;
                        rememberWaveform(job.filePath, compact); renderWaveform(compact);
                        if (cached?.key) await noctune.waveform.set({ filePath: job.filePath, key: cached.key, peaks: Array.from(compact) });
                    } catch (_) {
                        // A failed waveform must never interfere with audio playback.
                    } finally {
                        arrayBuffer = null; audioBuffer = null;
                        if (decodeCtx?.close) await decodeCtx.close().catch(() => {});
                        decodeCtx = null; waveformFetch = null; job.resolve();
                    }
                }
            } finally { waveformBusy = false; }
        }
        function rememberWaveform(filePath, compact) {
            window._waveformCache.delete(filePath); window._waveformCache.set(filePath, compact);
            if (window._waveformCache.size > 60) window._waveformCache.delete(window._waveformCache.keys().next().value);
        }
        function compactWaveform(channelData) {
            const rms = new Float32Array(WAVEFORM_BARS);
            for (let i = 0; i < WAVEFORM_BARS; i++) {
                const start = Math.floor(i * channelData.length / WAVEFORM_BARS);
                const end = Math.floor((i + 1) * channelData.length / WAVEFORM_BARS);
                let sum = 0;
                for (let j = start; j < end; j++) sum += channelData[j] * channelData[j];
                rms[i] = end > start ? Math.sqrt(sum / (end - start)) : 0;
            }
            const smoothed = Float32Array.from(rms, (value, i) => (rms[Math.max(0, i - 1)] + value * 2 + rms[Math.min(WAVEFORM_BARS - 1, i + 1)]) / 4);
            const max = Math.max(...smoothed);
            return Uint8Array.from(smoothed, value => Math.round((max > 0.001 ? value / max : value) * 255));
        }
