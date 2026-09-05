        function applyBgThreshold(level, threshold) {
            if (!threshold || threshold <= 0) return level;
            if (level <= threshold) return 0;
            return (level - threshold) / (1 - threshold);
        }

        // ── Следование фона за курсором: отдельный цикл анимации ──────
        // Главный цикл visualize() пишет transform фона только при живом
        // аудио (есть analyzer). Пока музыка не играет, transform никто бы
        // не обновлял — поэтому у курсора свой лёгкий rAF, который сглаживает
        // позицию и применяет смещение, когда аудио-реактивные эффекты не
        // активны. Во время воспроизведения этот цикл лишь обновляет
        // сглаженные координаты, а сам transform пишет visualize(), складывая
        // смещение с пульсацией/размытием/свечением/тряской.
        function updateBgCursor() {
            requestAnimationFrame(updateBgCursor);
            if (window._rafSuspended) return; // окно свёрнуто в трей — не тратим CPU впустую
            // Сглаживание целевой позиции — всегда, чтобы при включении
            // эффекта не было рывка с произвольного значения.
            const tx = window._bgCursorTargetX || 0;
            const ty = window._bgCursorTargetY || 0;
            window._bgCursorX = (window._bgCursorX || 0) + (tx - (window._bgCursorX || 0)) * 0.08;
            window._bgCursorY = (window._bgCursorY || 0) + (ty - (window._bgCursorY || 0)) * 0.08;

            if (!window.bgImageEnabled || !window.bgImagePath || !window.bgCursorEnabled) return;
            // Если аудио живо — transform пишет visualize(), не вмешиваемся.
            if (analyzer) return;

            const sign = window.bgCursorInvert ? -1 : 1;
            const amtX = (typeof window.bgCursorIntensityX === 'number') ? window.bgCursorIntensityX : 3;
            const amtY = (typeof window.bgCursorIntensityY === 'number') ? window.bgCursorIntensityY : 3;
            const cx = sign * (window._bgCursorX || 0) * amtX * ((window.innerWidth || 1) / 100);
            const cy = sign * (window._bgCursorY || 0) * amtY * ((window.innerHeight || 1) / 100);
            // Наклон фона за курсором: 3D-вращение rotateX/rotateY вокруг
            // центра, фон «наклоняется» в сторону курсора. Перспектива задана
            // на #custom-bg-layer. Инверсия меняет знак наклона.
            let tiltCss = '';
            if (window.bgCursorTiltEnabled) {
                const tSign = window.bgCursorTiltInvert ? -1 : 1;
                const tAmt  = (typeof window.bgCursorTiltIntensity === 'number') ? window.bgCursorTiltIntensity : 2;
                const rx = tSign * (window._bgCursorY || 0) * tAmt * 0.75;
                const ry = tSign * (window._bgCursorX || 0) * tAmt * 0.75;
                tiltCss = ` rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
            }
            const css = `perspective(1200px) translate(${cx.toFixed(2)}px, ${cy.toFixed(2)}px) scale(1)${tiltCss}`;
            customBgImageEl.style.transform = css;
            customBgVideoEl.style.transform = css;
            customBgImageEl.style.filter = 'none';
            customBgVideoEl.style.filter = 'none';
            if (customBgGlowEl) customBgGlowEl.style.opacity = '0';
        }
        requestAnimationFrame(updateBgCursor);

        function visualize() {
            requestAnimationFrame(visualize);
            if (window._rafSuspended) return; // окно свёрнуто в трей — не тратим CPU впустую
            if (!analyzer) return;

            const bufferLength = analyzer.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            analyzer.getByteFrequencyData(dataArray);

            // ── Bass-reactive confetti level ──────────────────────────────
            if (window.confettiEnabled) {
                // fftSize=512 → 256 bins → ~86 Hz/bin at 44100 Hz.
                // 0–250 Hz is only 3 bins, too few & noisy.
                // Use 0–400 Hz (~5 bins) for a reliable bass signal.
                const sampleRate = analyzer.context.sampleRate || 44100;
                const nyquist    = sampleRate / 2;
                const bassEnd    = Math.max(3, Math.round(bufferLength * 400 / nyquist));

                let bassSum = 0, bassPeak = 0;
                for (let i = 0; i < bassEnd; i++) {
                    bassSum += dataArray[i];
                    if (dataArray[i] > bassPeak) bassPeak = dataArray[i];
                }
                const bassAvg = bassSum / bassEnd; // 0-255

                // Self-normalising: track running peak of bass, fast-rise / slow-fall.
                // This adapts to the actual volume of the current track automatically.
                window._confettiRunMax = Math.max(
                    (window._confettiRunMax || 60) * 0.9992, // decays ~5% per second @ 60fps
                    bassPeak
                );
                // Floor at 50 so we never divide by near-zero (below this = effectively silent)
                const norm = Math.max(50, window._confettiRunMax);

                // Normalised to 0-1 relative to the music's own peak bass level
                const bassRaw = Math.min(1, bassPeak / norm);

                // Fast attack (~5 frames), long decay (~50 frames) @ 60 fps
                const prevLevel = window._confettiAudioLevel || 0;
                window._confettiAudioLevel = bassRaw > prevLevel
                    ? bassRaw * 0.65 + prevLevel * 0.35   // rise
                    : bassRaw * 0.02 + prevLevel * 0.98;  // fall

                // ── Beat detection (energy spike above running average) ────
                const bassEnergy = bassAvg / 128; // 0-2 normalised at half-scale
                if (!window._beatAvg || window._beatAvg < 0.001) window._beatAvg = bassEnergy;
                window._beatAvg  = window._beatAvg * 0.90 + bassEnergy * 0.10;
                const sens        = window.confettiSensitivity || 1.0;
                const multiplier  = Math.max(1.05, 1.6 - sens * 0.35);
                const minThresh   = Math.max(0.01, 0.06 / sens);
                const threshold   = Math.max(minThresh, window._beatAvg * multiplier);
                window._isBeat    = bassEnergy > threshold;
                window._beatCooldown = Math.max(0, window._beatCooldown - (1000 / 60));
            }

            // ── Реакция фона на звук (пульсация / размытие / свечение / тряска) ──
            // Без самонормализации к недавнему пику трека: одинаковая громкость
            // всегда даёт одинаковый, предсказуемый отклик — фон остаётся
            // преимущественно статичным и не «подстраивается» адаптивно под
            // конкретный трек, как раньше.
            // Свечение — единственный из пяти эффектов, не завязанный на
            // bgImageEnabled/bgImagePath: это самостоятельный radial-gradient
            // поверх слоя фона (см. #custom-bg-glow), а не манипуляция самой
            // картинкой/видео, поэтому работает и без своего фона — просто на
            // обычном чёрном/белом фоне плеера.
            const bgHasImage = window.bgImageEnabled && window.bgImagePath;
            if (window.bgGlowEnabled ||
                (bgHasImage && (window.bgPulseEnabled || window.bgBlurEnabled || window.bgTiltEnabled || window.bgCursorEnabled))) {
                // Общий уровень звука по всему спектру (0..1) — без выделения
                // отдельных полос частот и без скользящей самонормализации.
                let soundSum = 0;
                for (let i = 0; i < bufferLength; i++) soundSum += dataArray[i];
                const soundLevel = (soundSum / bufferLength) / 255;

                // Плавное сглаживание: быстрый, но небольшой подъём и медленный
                // спад — убирает покадровое дёрганье, эффект остаётся мягким.
                const prevLevel = window._bgSoundLevel || 0;
                window._bgSoundLevel = soundLevel > prevLevel
                    ? soundLevel * 0.35 + prevLevel * 0.65
                    : soundLevel * 0.05 + prevLevel * 0.95;
                const bgFx = window._bgSoundLevel;

                // Нелинейный множитель интенсивности: возле значений слайдера ~1
                // эффект остаётся сдержанным (как и раньше), но при значениях
                // около 2 и выше отклик становится заметно сильнее и активнее —
                // рост идёт по квадрату интенсивности, а не линейно. Та же
                // квадратичная зависимость применена ниже к размытию, свечению
                // и тряске — по аналогии с пульсацией. У каждого из четырёх
                // эффектов также свой минимальный порог срабатывания: тихие
                // моменты ниже порога не вызывают вообще никакой реакции.
                const pulseAmt     = window.bgPulseIntensity || 1;
                const bgFxPulse    = applyBgThreshold(bgFx, window.bgPulseThreshold || 0);
                const bgPulseScale = window.bgPulseEnabled ? 1 + bgFxPulse * 0.035 * pulseAmt * pulseAmt : 1;

                const blurAmt  = window.bgBlurIntensity || 1;
                const bgFxBlur = applyBgThreshold(bgFx, window.bgBlurThreshold || 0);
                const bgBlurPx = window.bgBlurEnabled ? bgFxBlur * 7 * blurAmt * blurAmt : 0;

                const glowAmt       = window.bgGlowIntensity || 1;
                const bgFxGlow      = applyBgThreshold(bgFx, window.bgGlowThreshold || 0);
                const bgGlowOpacity = window.bgGlowEnabled ? Math.min(1, bgFxGlow * 1.4 * glowAmt * glowAmt) : 0;

                // Тряска/наклон (tilt): небольшое вращение + дрожание по X/Y,
                // амплитуда которых нарастает по квадрату интенсивности и
                // громкости. Фаза крутится непрерывно (со своей регулируемой
                // скоростью), поэтому направление «шатания» естественно
                // меняется, а не застывает в одном крене. Вращение и смещение
                // можно включать/выключать по отдельности.
                let tiltDeg = 0, tiltTx = 0, tiltTy = 0;
                if (window.bgTiltEnabled) {
                    const tiltAmt   = window.bgTiltIntensity || 1;
                    const tiltSpeed = window.bgTiltSpeed || 1;
                    const bgFxTilt  = applyBgThreshold(bgFx, window.bgTiltThreshold || 0);
                    window._bgTiltPhase = (window._bgTiltPhase || 0) + 0.1 * tiltSpeed;
                    const tiltMag = bgFxTilt * 3.2 * tiltAmt * tiltAmt;
                    if (window.bgTiltRotation !== false) {
                        tiltDeg = Math.sin(window._bgTiltPhase) * tiltMag;
                    }
                    if (window.bgTiltShift !== false) {
                        tiltTx = Math.sin(window._bgTiltPhase * 1.3 + 1.1) * tiltMag * 1.8;
                        tiltTy = Math.cos(window._bgTiltPhase * 1.7 + 0.4) * tiltMag * 1.3;
                    }
                }

                // Смещение от следования за курсором прибавляется к тряске.
                // Сглаженные координаты поддерживает отдельный цикл
                // updateBgCursor; здесь мы лишь переводим их в пиксели и
                // складываем с translate от тряски. Инверсия меняет знак —
                // фон «убегает» от курсора вместо того, чтобы тянуться за ним.
                let cursorTx = 0, cursorTy = 0;
                if (window.bgCursorEnabled) {
                    const sign = window.bgCursorInvert ? -1 : 1;
                    const amtX = (typeof window.bgCursorIntensityX === 'number') ? window.bgCursorIntensityX : 3;
                    const amtY = (typeof window.bgCursorIntensityY === 'number') ? window.bgCursorIntensityY : 3;
                    cursorTx = sign * (window._bgCursorX || 0) * amtX * ((window.innerWidth || 1) / 100);
                    cursorTy = sign * (window._bgCursorY || 0) * amtY * ((window.innerHeight || 1) / 100);
                }

                // Наклон фона за курсором (3D rotateX/rotateY) — складывается
                // с 2D-вращением тряски в общем transform. Перспектива задана
                // на #custom-bg-layer, поэтому чисто 2D-эффекты не искажаются.
                let cursorTiltCss = '';
                if (window.bgCursorTiltEnabled) {
                    const tSign = window.bgCursorTiltInvert ? -1 : 1;
                    const tAmt  = (typeof window.bgCursorTiltIntensity === 'number') ? window.bgCursorTiltIntensity : 2;
                    const rx = tSign * (window._bgCursorY || 0) * tAmt * 0.75;
                    const ry = tSign * (window._bgCursorX || 0) * tAmt * 0.75;
                    cursorTiltCss = ` rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
                }

                const _bgScaleCss  = `perspective(1200px) translate(${(tiltTx + cursorTx).toFixed(2)}px, ${(tiltTy + cursorTy).toFixed(2)}px) rotate(${tiltDeg.toFixed(3)}deg) scale(${bgPulseScale.toFixed(4)})${cursorTiltCss}`;
                const _bgFilterCss = bgBlurPx > 0.05 ? `blur(${bgBlurPx.toFixed(2)}px)` : 'none';
                customBgImageEl.style.transform = _bgScaleCss;
                customBgImageEl.style.filter = _bgFilterCss;
                customBgVideoEl.style.transform = _bgScaleCss;
                customBgVideoEl.style.filter = _bgFilterCss;
                if (customBgGlowEl) customBgGlowEl.style.opacity = bgGlowOpacity.toFixed(3);
                window._bgEffectActive = true;
            } else if (window._bgEffectActive) {
                customBgImageEl.style.transform = 'scale(1)';
                customBgImageEl.style.filter = 'none';
                customBgVideoEl.style.transform = 'scale(1)';
                customBgVideoEl.style.filter = 'none';
                if (customBgGlowEl) customBgGlowEl.style.opacity = '0';
                window._bgSoundLevel = 0;
                window._bgEffectActive = false;
                // Сбрасываем сглаженные координаты курсора, чтобы при повторном
                // включении эффекта фон не «прыгал» с устаревшей позиции.
                window._bgCursorX = 0;
                window._bgCursorY = 0;
            }

            ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

            const style = window.vizStyle || 'circle-smooth';
            if (style !== 'fireworks' && ((window._fwFireworks && window._fwFireworks.length) || (window._fwParticles && window._fwParticles.length))) {
                window._fwFireworks.length = 0;
                window._fwParticles.length = 0;
            }
            const intensity = window.vizIntensity || 1;
            const rotateColors = window.vizRotateColors !== false;
            const showInner = window.vizShowInner !== false;

            // Get gradient colors
            const gc1 = window.vizGradColor1 || '#bb86fc';
            const gc2 = window.vizGradColor2 || '#4a90e2';
            const gc3 = window.vizGradColor3 || '#03dac6';

            const centerX = canvas.clientWidth / 2;
            const centerY = canvas.clientHeight / 2;
            const staticRadius = Math.min(canvas.clientWidth, canvas.clientHeight) * 0.25;
            const totalPoints = Math.floor(bufferLength * 0.55);

            // Накапливаемый таймер через deltaTime — не зависит от Date.now()
            const now = performance.now();
            const dt = Math.min((now - (window._vizLastTime || now)) / 1000, 0.1); // сек, макс 100мс
            window._vizLastTime = now;
            // Угол для кругового вращения (радианы)
            window._vizAngle = ((window._vizAngle || 0) + dt * 0.6 * (window.vizRotateSpeed || 1)) % (Math.PI * 2);
            // Смещение горизонтального градиента для полос (пиксели)
            const W_canvas = canvas.clientWidth;
            window._vizGradOffset = ((window._vizGradOffset || 0) + dt * W_canvas * 0.07 * (window.vizScrollSpeed || 1)) % W_canvas;
            // Смещение для осциллографа (независимая скорость)
            window._vizGradOffsetWave = ((window._vizGradOffsetWave || 0) + dt * W_canvas * 0.07 * (window.vizScrollSpeedWave || 1)) % W_canvas;
            const gradOffset = window._vizGradOffset;
            const gradOffsetWave = window._vizGradOffsetWave;
            const time = window._vizAngle;

            // Build gradient
            function makeGradient(x0, y0, x1, y1) {
                const g = ctx.createLinearGradient(x0, y0, x1, y1);
                g.addColorStop(0, gc1 + 'e6');
                g.addColorStop(0.5, gc2 + 'e6');
                g.addColorStop(1, gc3 + 'e6');
                return g;
            }

            function makeRadialGradient(cx, cy, r0, r1) {
                const g = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
                g.addColorStop(0, gc1 + 'e6');
                g.addColorStop(0.5, gc2 + 'e6');
                g.addColorStop(1, gc3 + 'e6');
                return g;
            }

            let gradX0, gradY0, gradX1, gradY1;
            if (rotateColors) {
                gradX0 = centerX + Math.cos(time) * staticRadius;
                gradY0 = centerY + Math.sin(time) * staticRadius;
                gradX1 = centerX + Math.cos(time + Math.PI) * staticRadius;
                gradY1 = centerY + Math.sin(time + Math.PI) * staticRadius;
            } else {
                gradX0 = centerX - staticRadius;
                gradY0 = centerY;
                gradX1 = centerX + staticRadius;
                gradY1 = centerY;
            }

            const mainGradient = makeGradient(gradX0, gradY0, gradX1, gradY1);
            const rotationOffset = Math.PI / 2;

            if (style === 'circle-smooth' || style === 'circle-lines') {
                // Inner glow
                if (showInner) {
                    ctx.save();
                    ctx.filter = 'blur(75px)';
                    ctx.beginPath();
                    const innerBaseRadius = staticRadius * 0.65;
                    if (window.innerDelayBuffer === undefined) window.innerDelayBuffer = [];
                    for (let i = 0; i < totalPoints; i++) {
                        const angle = ((i / totalPoints) * Math.PI * 2) + rotationOffset;
                        let amp = dataArray[i] * 0.52 * intensity;
                        if (window.innerDelayBuffer[i] === undefined) window.innerDelayBuffer[i] = 0;
                        if (amp >= window.innerDelayBuffer[i]) window.innerDelayBuffer[i] = amp;
                        else { window.innerDelayBuffer[i] = (window.innerDelayBuffer[i] * 0.985) - 0.08; if (window.innerDelayBuffer[i] < 0) window.innerDelayBuffer[i] = 0; }
                        const r = innerBaseRadius + window.innerDelayBuffer[i];
                        const x = centerX + Math.cos(angle) * r;
                        const y = centerY + Math.sin(angle) * r;
                        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                    }
                    ctx.closePath();
                    ctx.fillStyle = mainGradient;
                    ctx.globalAlpha = 0.65;
                    ctx.fill();
                    ctx.restore();
                } else {
                    window.innerDelayBuffer = new Array(totalPoints).fill(0);
                }

                // Outer line
                ctx.save();
                ctx.beginPath();
                ctx.strokeStyle = mainGradient;
                ctx.lineWidth = style === 'circle-lines' ? 2 : 4;
                ctx.lineJoin = 'round';
                ctx.lineCap = 'round';
                if (window.freqFallStorage === undefined) window.freqFallStorage = [];
                for (let i = 0; i < totalPoints; i++) {
                    const angle = ((i / totalPoints) * Math.PI * 2) + rotationOffset;
                    let windowing = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (totalPoints - 1)));
                    let amp = dataArray[i] * 0.62 * windowing * intensity;
                    if (window.freqFallStorage[i] === undefined) window.freqFallStorage[i] = 0;
                    if (amp >= window.freqFallStorage[i]) window.freqFallStorage[i] = amp;
                    else { window.freqFallStorage[i] *= 0.95; if (window.freqFallStorage[i] < 0.5) window.freqFallStorage[i] = 0; }
                    const r = staticRadius + window.freqFallStorage[i];
                    const x = centerX + Math.cos(angle) * r;
                    const y = centerY + Math.sin(angle) * r;
                    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                }
                ctx.closePath();

                if (style === 'circle-lines') {
                    // Draw radial lines from center circle to outer
                    ctx.restore();
                    const lineCount = Math.min(totalPoints, 128);
                    for (let i = 0; i < lineCount; i++) {
                        const angle = ((i / lineCount) * Math.PI * 2) + rotationOffset;
                        const amp = (window.freqFallStorage[Math.floor(i * totalPoints / lineCount)] || 0);
                        const rInner = staticRadius * 0.7;
                        const rOuter = staticRadius + amp;
                        ctx.beginPath();
                        ctx.strokeStyle = mainGradient;
                        ctx.lineWidth = 2;
                        ctx.globalAlpha = 0.8;
                        ctx.moveTo(centerX + Math.cos(angle) * rInner, centerY + Math.sin(angle) * rInner);
                        ctx.lineTo(centerX + Math.cos(angle) * rOuter, centerY + Math.sin(angle) * rOuter);
                        ctx.stroke();
                    }
                    ctx.globalAlpha = 1;
                } else {
                    ctx.stroke();
                    ctx.restore();
                }

            } else if (style === 'bars-bottom') {
                const barCount = Math.min(bufferLength, 80);
                const barWidth = (canvas.clientWidth / barCount) * 0.8;
                const gap = (canvas.clientWidth / barCount) * 0.2;
                const maxBarH = canvas.clientHeight * 0.7;
                const W = canvas.clientWidth, H = canvas.clientHeight;
                if (window.barFall === undefined || window.barFall.length !== barCount) window.barFall = new Array(barCount).fill(0);
                if (window.barPeaks === undefined || window.barPeaks.length !== barCount) window.barPeaks = new Array(barCount).fill(0);

                const scrollGradBB = window.vizScrollGrad;

                let bbGrad;
                if (scrollGradBB) {
                    // Рисуем один цикл gc1→gc2→gc3→gc1 на offscreen-canvas шириной W,
                    // создаём паттерн с repeat и сдвигаем только его transform.
                    // Столбцы рисуются на своих позициях — двигаются только цвета.
                    const off = new OffscreenCanvas(W, 1);
                    const offCtx = off.getContext('2d');
                    const og = offCtx.createLinearGradient(0, 0, W, 0);
                    og.addColorStop(0,    gc1 + 'dd');
                    og.addColorStop(0.33, gc2 + 'dd');
                    og.addColorStop(0.66, gc3 + 'dd');
                    og.addColorStop(1,    gc1 + 'dd'); // gc1 на обоих концах — бесшовный повтор
                    offCtx.fillStyle = og;
                    offCtx.fillRect(0, 0, W, 1);
                    const pat = ctx.createPattern(off, 'repeat');
                    const m = new DOMMatrix();
                    m.translateSelf(gradOffset % W, 0);
                    pat.setTransform(m);
                    bbGrad = pat;
                } else {
                    const g = ctx.createLinearGradient(0, H, 0, H - maxBarH);
                    g.addColorStop(0,   gc1 + 'dd');
                    g.addColorStop(0.5, gc2 + 'dd');
                    g.addColorStop(1,   gc3 + 'dd');
                    bbGrad = g;
                }

                for (let i = 0; i < barCount; i++) {
                    const skipBins = 3;
                    const val = Math.pow(dataArray[skipBins + Math.floor(i * (bufferLength * 0.45 - skipBins) / barCount)] / 255, 0.7);
                    const targetH = val * maxBarH * intensity;
                    if (targetH > window.barFall[i]) window.barFall[i] = targetH;
                    else { window.barFall[i] *= 0.92; if (window.barFall[i] < 0.5) window.barFall[i] = 0; }
                    if (targetH > window.barPeaks[i]) window.barPeaks[i] = targetH;
                    else { window.barPeaks[i] -= 1.2; if (window.barPeaks[i] < 0) window.barPeaks[i] = 0; }

                    const x = i * (barWidth + gap);
                    const h = window.barFall[i];
                    ctx.fillStyle = bbGrad;
                    ctx.globalAlpha = 0.85;
                    ctx.beginPath();
                    ctx.roundRect(x, H - h, barWidth, h, [3, 3, 0, 0]);
                    ctx.fill();
                    if (window.vizShowPeaks !== false) {
                        ctx.globalAlpha = 0.9;
                        ctx.fillStyle = gc3;
                        ctx.fillRect(x, H - window.barPeaks[i] - 2, barWidth, 2);
                    }
                }
                ctx.globalAlpha = 1;

            } else if (style === 'bars-center') {
                const barCount = Math.min(bufferLength, 80);
                const barWidth = (canvas.clientWidth / barCount) * 0.8;
                const gap = (canvas.clientWidth / barCount) * 0.2;
                const maxBarH = canvas.clientHeight * 0.35;
                const midY = canvas.clientHeight / 2;
                const scrollGrad = window.vizScrollGrad;
                if (window.barFall2 === undefined || window.barFall2.length !== barCount) window.barFall2 = new Array(barCount).fill(0);
                if (window.barPeaks2 === undefined || window.barPeaks2.length !== barCount) window.barPeaks2 = new Array(barCount).fill(0);
                const W_bc = canvas.clientWidth;

                let gradCenter;
                if (scrollGrad) {
                    const off = new OffscreenCanvas(W_bc, 1);
                    const offCtx = off.getContext('2d');
                    const og = offCtx.createLinearGradient(0, 0, W_bc, 0);
                    og.addColorStop(0,    gc1 + 'dd');
                    og.addColorStop(0.33, gc2 + 'dd');
                    og.addColorStop(0.66, gc3 + 'dd');
                    og.addColorStop(1,    gc1 + 'dd');
                    offCtx.fillStyle = og;
                    offCtx.fillRect(0, 0, W_bc, 1);
                    const pat = ctx.createPattern(off, 'repeat');
                    const m = new DOMMatrix();
                    m.translateSelf(gradOffset % W_bc, 0);
                    pat.setTransform(m);
                    gradCenter = pat;
                } else {
                    gradCenter = ctx.createLinearGradient(0, midY - maxBarH, 0, midY + maxBarH);
                    gradCenter.addColorStop(0,   gc3 + 'dd');
                    gradCenter.addColorStop(0.5, gc2 + 'dd');
                    gradCenter.addColorStop(1,   gc1 + 'dd');
                }

                for (let i = 0; i < barCount; i++) {
                    const skipBins = 3;
                    const val = Math.pow(dataArray[skipBins + Math.floor(i * (bufferLength * 0.45 - skipBins) / barCount)] / 255, 0.7);
                    const targetH = val * maxBarH * intensity;
                    if (targetH > window.barFall2[i]) window.barFall2[i] = targetH;
                    else { window.barFall2[i] *= 0.92; if (window.barFall2[i] < 0.5) window.barFall2[i] = 0; }
                    if (targetH > window.barPeaks2[i]) window.barPeaks2[i] = targetH;
                    else { window.barPeaks2[i] -= 1.2; if (window.barPeaks2[i] < 0) window.barPeaks2[i] = 0; }
                    const x = i * (barWidth + gap);
                    const h = window.barFall2[i];
                    ctx.fillStyle = gradCenter;
                    ctx.globalAlpha = 0.85;
                    ctx.beginPath();
                    ctx.roundRect(x, midY - h, barWidth, h * 2, 2);
                    ctx.fill();
                    if (window.vizShowPeaks !== false) {
                        ctx.globalAlpha = 0.9;
                        ctx.fillStyle = gc3;
                        ctx.fillRect(x, midY - window.barPeaks2[i] - 2, barWidth, 2);
                        ctx.fillRect(x, midY + window.barPeaks2[i],     barWidth, 2);
                    }
                }
                ctx.globalAlpha = 1;

            } else if (style === 'waveform') {
                // ── Осциллограф с историей кадров ────────────────────────────
                if (!analyzer) return;
                if (!window._waveBuf || window._waveBuf.length !== analyzer.fftSize) {
                    window._waveBuf = new Uint8Array(analyzer.fftSize);
                }
                analyzer.getByteTimeDomainData(window._waveBuf);

                const W = canvas.clientWidth, H = canvas.clientHeight;
                const midY = H / 2;
                const lineCount = Math.max(1, window.vizWaveLines || 1);
                const sens = window.vizWaveSens || 1.5;

                // Детектируем тишину: максимальное отклонение от 128 в текущем буфере
                let currentMaxDev = 0;
                for (let i = 0; i < window._waveBuf.length; i++) {
                    const d = Math.abs(window._waveBuf[i] - 128);
                    if (d > currentMaxDev) currentMaxDev = d;
                }
                const isSilent = currentMaxDev < 3;

                // Плавное гашение альфы при тишине (если опция включена)
                if (window.vizHideOnSilence) {
                    window._waveAlpha = window._waveAlpha ?? 1;
                    if (isSilent) {
                        window._waveAlpha = Math.max(0, window._waveAlpha - dt * 3); // затухание ~0.33с
                    } else {
                        window._waveAlpha = Math.min(1, window._waveAlpha + dt * 8); // появление ~0.12с
                    }
                    if (window._waveAlpha <= 0) { ctx.globalAlpha = 1; return; }
                } else {
                    window._waveAlpha = 1;
                }
                const waveAlphaMult = window._waveAlpha;

                // Хранилище истории: кольцевой буфер из lineCount снимков
                if (!window._waveHistory || window._waveHistory.length !== lineCount ||
                    window._waveHistory[0].length !== window._waveBuf.length) {
                    window._waveHistory = Array.from({length: lineCount},
                        () => new Uint8Array(window._waveBuf.length).fill(128));
                }
                // Обновляем историю только при не-тишине (или выключенной опции),
                // чтобы не копить плоские кадры при паузе
                if (!window.vizHideOnSilence || !isSilent) {
                    for (let k = lineCount - 1; k > 0; k--) {
                        window._waveHistory[k].set(window._waveHistory[k - 1]);
                    }
                    window._waveHistory[0].set(window._waveBuf);
                }

                const scrollGradW = window.vizScrollGradWave;
                let wGrad;
                if (scrollGradW) {
                    const off = new OffscreenCanvas(W, 1);
                    const offCtx = off.getContext('2d');
                    const og = offCtx.createLinearGradient(0, 0, W, 0);
                    og.addColorStop(0,    gc1 + 'ff');
                    og.addColorStop(0.33, gc2 + 'ff');
                    og.addColorStop(0.66, gc3 + 'ff');
                    og.addColorStop(1,    gc1 + 'ff');
                    offCtx.fillStyle = og;
                    offCtx.fillRect(0, 0, W, 1);
                    const pat = ctx.createPattern(off, 'repeat');
                    const m = new DOMMatrix();
                    m.translateSelf(gradOffsetWave % W, 0);
                    pat.setTransform(m);
                    wGrad = pat;
                } else {
                    wGrad = ctx.createLinearGradient(0, 0, W, 0);
                    wGrad.addColorStop(0,   gc1 + 'ff');
                    wGrad.addColorStop(0.5, gc2 + 'ff');
                    wGrad.addColorStop(1,   gc3 + 'ff');
                }

                const trailEnabled  = !!window.vizWaveTrail;
                // Ползунок 0.02–3.00 с → длительность напрямую в секундах
                const rawAmount     = window.vizWaveTrailAmount !== undefined ? window.vizWaveTrailAmount : 0.30;
                const trailDuration = rawAmount;
                const now           = performance.now() / 1000;

                // ── Временно́й буфер следа ──────────────────────────────────
                // Хранит последние N кадров с метками времени (независимо от lineCount)
                // Размер: столько кадров, сколько нужно для покрытия trailDuration при 60fps
                const TRAIL_MAX = 120;
                if (!window._waveTrailBuf) window._waveTrailBuf = [];

                if (!window.vizHideOnSilence || !isSilent) {
                    // Добавляем кадр каждый тик (нужна плотная выборка для выбора по времени)
                    window._waveTrailBuf.unshift({ data: new Uint8Array(window._waveBuf), time: now });
                    if (window._waveTrailBuf.length > TRAIL_MAX) window._waveTrailBuf.pop();
                }

                if (!trailEnabled) {
                    // Сбрасываем буфер чтобы при включении не было старых призраков
                    window._waveTrailBuf = [];
                }

                // Вспомогательная функция рисования одной линии
                function drawWaveLine(src, lineW, alpha) {
                    if (alpha < 0.005) return;
                    let maxDev = 0;
                    for (let i = 0; i < src.length; i++) {
                        const d = Math.abs(src[i] - 128);
                        if (d > maxDev) maxDev = d;
                    }
                    // Мягкий апскейл тихих сигналов — не более чем до 30% высоты canvas.
                    // Громкие сигналы не скейлятся (scale=1): они просто выйдут за drawRange
                    // и естественно срежутся краем canvas без горизонтальной линии.
                    const minTarget = H * 0.04; // минимальная амплитуда 4% высоты
                    const scale     = maxDev > 0 ? Math.min(1, minTarget / maxDev) : 1;
                    const drawRange = H * 0.48; // ±48% высоты — небольшой запас до края

                    ctx.globalAlpha = alpha * waveAlphaMult;
                    ctx.lineWidth   = lineW;
                    ctx.beginPath();

                    const step = W / src.length;
                    // Прямое линейное отображение без tanh:
                    // при перегрузке кривая просто уходит за край canvas (не плато)
                    const y0 = midY + ((src[0] / 128) - 1) * sens * intensity * (1 + scale) * drawRange;
                    ctx.moveTo(0, y0);
                    for (let i = 1; i < src.length - 1; i++) {
                        const x1 = (i - 1) * step;
                        const y1 = midY + ((src[i - 1] / 128) - 1) * sens * intensity * (1 + scale) * drawRange;
                        const x2 = i * step;
                        const y2 = midY + ((src[i]     / 128) - 1) * sens * intensity * (1 + scale) * drawRange;
                        ctx.quadraticCurveTo(x1, y1, (x1 + x2) / 2, (y1 + y2) / 2);
                    }
                    const yLast = midY + ((src[src.length - 1] / 128) - 1) * sens * intensity * (1 + scale) * drawRange;
                    ctx.lineTo((src.length - 1) * step, yLast);
                    ctx.stroke();
                }

                ctx.strokeStyle = wGrad;
                ctx.lineJoin    = 'round';
                ctx.lineCap     = 'round';

                if (trailEnabled && window._waveTrailBuf.length > 1) {
                    // ── Режим следа: рисуем lineCount призраков из временно́го буфера ──
                    // Берём lineCount равномерно распределённых кадров в окне trailDuration
                    for (let n = lineCount; n >= 1; n--) {
                        // Целевой возраст этого призрака
                        const targetAge = (n / lineCount) * trailDuration;
                        // Ищем ближайший кадр в буфере
                        let best = null, bestDiff = Infinity;
                        for (let i = 0; i < window._waveTrailBuf.length; i++) {
                            const age  = now - window._waveTrailBuf[i].time;
                            const diff = Math.abs(age - targetAge);
                            if (diff < bestDiff) { bestDiff = diff; best = window._waveTrailBuf[i]; }
                            if (age > trailDuration * 1.2) break; // дальше нет смысла искать
                        }
                        if (!best) continue;

                        // t=1 → свежий, t=0 → старый; квадратичное угасание
                        const t     = 1 - (n / (lineCount + 1));
                        const alpha = t * t * 0.85;
                        const lw    = Math.max(0.3, 2 * t);
                        drawWaveLine(best.data, lw, alpha);
                    }
                } else {
                    // ── Обычный режим: lineCount эхо-линий из _waveHistory ──
                    for (let k = lineCount - 1; k >= 1; k--) {
                        const alpha = 0.95 * Math.pow(0.9, k);
                        const lw    = Math.max(0.5, 2 - k * 0.15);
                        drawWaveLine(window._waveHistory[k], lw, alpha);
                    }
                }

                // Основная линия — всегда поверх
                drawWaveLine(window._waveHistory[0], 2, 0.95);
                ctx.globalAlpha = 1;
            } else if (style === 'fireworks') {
                // ── Салют, реагирующий на музыку ────────────────────────────
                const W = canvas.clientWidth, H = canvas.clientHeight;

                // «Запускать во время паузы» — если музыка не играет и опция
                // выключена, новые ракеты не стартуют (уже летящие/взорвавшиеся
                // продолжают анимацию до конца, просто без новых запусков).
                const fwCanSpawn = isPlaying || window.fireworksIdleSpawn;

                if (fwCanSpawn) {
                    // Средний уровень баса (0..1) с применённым порогом срабатывания.
                    // Считаем один раз и используем сразу для двух вещей: доп. залпов
                    // на ударах и приглушения базового авто-запуска в тихих местах —
                    // раньше порог влиял только на первое, а основная масса залпов
                    // шла из базового авто-запуска с постоянной частотой, из-за чего
                    // ползунок казался нерабочим.
                    const sr = analyzer.context.sampleRate || 44100;
                    const nyq = sr / 2;
                    const bassEnd = Math.max(3, Math.round(bufferLength * 400 / nyq));
                    let bassSum = 0;
                    for (let i = 0; i < bassEnd; i++) bassSum += dataArray[i];
                    const bassRaw = (bassSum / bassEnd) / 255;
                    const fwThreshold = window.fireworksThreshold || 0;
                    const bassGated = applyBgThreshold(bassRaw, fwThreshold);

                    // Доп. запуски залпов на сильных ударах баса
                    if (window.fireworksBeatReactive) {
                        if (window._fwBeatAvg === undefined) window._fwBeatAvg = bassGated;
                        window._fwBeatAvg = window._fwBeatAvg * 0.9 + bassGated * 0.1;
                        window._fwBeatCooldown = Math.max(0, (window._fwBeatCooldown || 0) - 16.7);
                        if (bassGated > window._fwBeatAvg * 1.5 && bassGated > 0.16 && window._fwBeatCooldown <= 0) {
                            window._fwBeatCooldown = 260;
                            const burst = Math.max(1, window.fireworksBeatBurstCount || 1);
                            for (let b = 0; b < burst; b++) spawnFirework(W, H);
                        }
                    }

                    // Базовый авто-запуск, регулируется настройкой «Частота запуска».
                    // При пороге 0 частота не меняется (как и раньше); при пороге > 0
                    // залпы заметно реже случаются в тихих местах трека.
                    const fwFreq = window.fireworksFrequency !== undefined ? window.fireworksFrequency : 1;
                    let baseSpawnChance = 0.018 * fwFreq;
                    if (fwThreshold > 0 && isPlaying) baseSpawnChance *= bassGated;
                    if (Math.random() < baseSpawnChance) spawnFirework(W, H);
                }

                ctx.save();
                ctx.globalCompositeOperation = 'lighter';
                for (let i = window._fwFireworks.length - 1; i >= 0; i--) {
                    window._fwFireworks[i].update(window._fwFireworks, i);
                    if (window._fwFireworks[i]) window._fwFireworks[i].draw();
                }
                for (let i = window._fwParticles.length - 1; i >= 0; i--) {
                    window._fwParticles[i].update(window._fwParticles, i);
                    if (window._fwParticles[i]) window._fwParticles[i].draw();
                }
                ctx.restore();
            }
        }

