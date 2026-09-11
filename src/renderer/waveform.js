        // ══════════════════════════════════════════════════════════════════
        // WAVEFORM ЗА ОБЛОЖКОЙ
        // ══════════════════════════════════════════════════════════════════
        // Разово декодируем весь локальный файл через decodeAudioData —
        // ТОЛЬКО ради формы волны, никак не влияет на реальное воспроизведение
        // (оно идёт через отдельный <audio>/MediaElementSourceNode). Результат
        // сжимается до WAVEFORM_BARS пиковых значений и кешируется по пути
        // файла (сырые, ненормализованные под "чувствительность" — та
        // применяется на отрисовке, чтобы её можно было крутить вживую без
        // повторного декодирования). Прогресс обновляется не через RAF, а
        // через CSS-transition поверх clip-path/transform — дёшево и
        // достаточно плавно при апдейте раз в 250мс (см. audio-engine.js).
        const WAVEFORM_BARS = 200;
        window._waveformCache = new Map();      // filePath -> Float32Array(N) пиков 0..1 (сырые, до sensitivity)
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

            const peaks = applyWaveformSensitivity(rawPeaks, window.waveformSensitivity);
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

        async function loadTrackWaveform(filePath, ownerToken) {
            window._waveformCurrentFilePath = filePath;
            window._waveformLastFraction = 0;

            if (!window.waveformEnabled) { renderWaveform(null); return; }

            if (window._waveformCache.has(filePath)) {
                renderWaveform(window._waveformCache.get(filePath));
                return;
            }

            // Пока трек декодируется — ничего не показываем, а не старую форму.
            renderWaveform(null);

            const myToken = ++window._waveformDecodeToken;
            try {
                const url = noctune.fs.toFileUrl(filePath);
                const res = await fetch(url);
                const arrayBuffer = await res.arrayBuffer();

                // Отдельный OfflineAudioContext только для декодирования —
                // не трогает основной audioCtx воспроизведения.
                const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
                const decodeCtx = OfflineCtx ? new OfflineCtx(1, 1, 44100) : new (window.AudioContext)();
                const audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer);

                // Трек уже сменился, пока мы декодировали — результат никому не нужен.
                if (myToken !== window._waveformDecodeToken) return;
                if (typeof _loadToken !== 'undefined' && ownerToken !== _loadToken) return;

                const channelData = audioBuffer.getChannelData(0);
                // RMS (среднеквадратичное), а не пик-максимум, по каждому
                // отрезку — пик-максимум на крупных отрезках почти всегда
                // упирается в потолок (в любые 1-2 секунды почти наверняка
                // попадёт транзиент), из-за чего все столбики выходят
                // одинаково высокими. RMS отражает реальную энергию отрезка —
                // ровно то, что даёт плавный, изрезанный по громкости контур
                // как у референсных плееров (AIMP и т.п.), а не частокол пиков.
                const peaks = new Float32Array(WAVEFORM_BARS);
                const samplesPerBar = Math.max(1, Math.floor(channelData.length / WAVEFORM_BARS));
                for (let i = 0; i < WAVEFORM_BARS; i++) {
                    let sumSquares = 0;
                    const start = i * samplesPerBar;
                    const end = Math.min(channelData.length, start + samplesPerBar);
                    const count = end - start;
                    for (let j = start; j < end; j++) {
                        const v = channelData[j];
                        sumSquares += v * v;
                    }
                    peaks[i] = count > 0 ? Math.sqrt(sumSquares / count) : 0;
                }
                // Лёгкое сглаживание соседних столбиков (3-точечное среднее) —
                // убирает остаточную "рубленость" между соседними отрезками.
                const smoothed = new Float32Array(WAVEFORM_BARS);
                for (let i = 0; i < WAVEFORM_BARS; i++) {
                    const prev = peaks[Math.max(0, i - 1)];
                    const next = peaks[Math.min(WAVEFORM_BARS - 1, i + 1)];
                    smoothed[i] = (prev + peaks[i] * 2 + next) / 4;
                }
                for (let i = 0; i < WAVEFORM_BARS; i++) peaks[i] = smoothed[i];
                // Нормализуем к максимуму трека — иначе тихо сведённые записи
                // дают почти плоскую линию вместо читаемой формы. Это
                // отдельно от "чувствительности" (та применяется поверх, на
                // отрисовке) — тут только выравниваем общий масштаб трека.
                let peakMax = 0;
                for (let i = 0; i < peaks.length; i++) if (peaks[i] > peakMax) peakMax = peaks[i];
                if (peakMax > 0.001) {
                    for (let i = 0; i < peaks.length; i++) peaks[i] = peaks[i] / peakMax;
                }

                window._waveformCache.set(filePath, peaks);
                // Кеш не бесконечный — не даём расти безгранично за долгую сессию.
                if (window._waveformCache.size > 60) {
                    const firstKey = window._waveformCache.keys().next().value;
                    window._waveformCache.delete(firstKey);
                }

                if (typeof _loadToken === 'undefined' || ownerToken === _loadToken) renderWaveform(peaks);
            } catch (e) {
                // Файл не удалось раскодировать (повреждён/необычный формат) —
                // просто не показываем waveform для этого трека, не роняем воспроизведение.
            }
        }
