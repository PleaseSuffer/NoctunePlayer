        // ========================
        // CROSSFADE STATE
        // ========================
        let crossfadeEnabled = false;
        let crossfadeOutDuration = 3;
        let crossfadeInDuration = 0;
        let _crossfadeTimeout = null;
        let currentDecodedBuffer = null;   // остаётся для совместимости seek/tooltip (хранит длительность)
        let currentTrackDuration = 0;      // длительность текущего трека (секунды)
        let isEqBypassed = false;
        let isMuted = false;
        let savedVolumeMute = 0.8;
        let currentSelectedPresetName = "Обычный";
        let _loadToken = 0;                // токен отмены: каждый новый вызов playTrack инкрементирует
        window.preampNode = null;
        
        const stars = [];
        const customBgLayer = document.getElementById('custom-bg-layer');
        const customBgImageEl = document.getElementById('custom-bg-image');
        const customBgVideoEl = document.getElementById('custom-bg-video');
        const customBgGlowEl = document.getElementById('custom-bg-glow');
        const customBgImagePrevEl = document.getElementById('custom-bg-image-prev');
        const starCanvas = document.getElementById('star-canvas');
        const starCtx = starCanvas.getContext('2d');

        // Курсор для интерактивного звёздного неба (canvas сам не получает событий мыши,
        // т.к. у него pointer-events:none, поэтому координаты следим на document)
        let starMouseX = -9999, starMouseY = -9999;
        document.addEventListener('mousemove', (e) => { starMouseX = e.clientX; starMouseY = e.clientY; });
        document.addEventListener('mouseleave', () => { starMouseX = -9999; starMouseY = -9999; });

        // ── Координаты курсора для эффекта «следование фона» ──
        // Нормализованные -1..1 от центра окна. _bgCursorTarget* — «мгновенная»
        // цель, _bgCursor* — сглаженное значение, которое читает цикл анимации
        // фона (visualize / updateBgCursor), чтобы сдвиг был мягким, без рывков.
        window._bgCursorTargetX = 0;
        window._bgCursorTargetY = 0;
        window._bgCursorX = 0;
        window._bgCursorY = 0;
        document.addEventListener('mousemove', (e) => {
            const w = window.innerWidth || document.documentElement.clientWidth || 1;
            const h = window.innerHeight || document.documentElement.clientHeight || 1;
            window._bgCursorTargetX = (e.clientX / w) * 2 - 1;
            window._bgCursorTargetY = (e.clientY / h) * 2 - 1;
        });
        document.addEventListener('mouseleave', () => {
            window._bgCursorTargetX = 0;
            window._bgCursorTargetY = 0;
        });
        window.addEventListener('blur', () => {
            window._bgCursorTargetX = 0;
            window._bgCursorTargetY = 0;
        });
        const STAR_INTERACT_RADIUS = 140;   // px — радиус реакции на курсор
        const STAR_REPEL_STRENGTH = 1.1;    // сила «толчка» от курсора
        const STAR_VISCOSITY = 0.90;        // затухание скорости смещения за кадр (без упругого отскока)
        const STAR_RETURN = 0.95;           // плавный возврат смещения к естественной траектории

        const frequencies = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 12000, 16000, 20000];
        
        let presets = {
            "Обычный": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            "Супер Бас": [0, 9, 7, 5, 2, 0, -1, -2, -1, 0, 1, 2, 2],
            "Поп": [0, -2, -1, 1, 3, 4, 3, 1, -1, -2, -2, -1, -1],
            "Рок": [0, 5, 4, 2, -1, -2, 0, 2, 4, 5, 4, 3, 3],
            "Акустика": [0, 2, 1, 2, 3, 1, 2, 3, 2, 3, 2, 1, 0]
        };

        btnMinimize.addEventListener('click', () => {
            mainPlayer.classList.add('minimized');
            miniPlayer.classList.add('active');
            triggerMiniMarquee();
        });

        btnExpand.addEventListener('click', () => {
            mainPlayer.classList.remove('minimized');
            miniPlayer.classList.remove('active');
        });

        function resizeCanvasToDisplaySize(canvasElem) {
            const rect = canvasElem.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            const targetWidth = Math.floor(rect.width * dpr);
            const targetHeight = Math.floor(rect.height * dpr);

            if (canvasElem.width !== targetWidth || canvasElem.height !== targetHeight) {
                canvasElem.width = targetWidth;
                canvasElem.height = targetHeight;
                const c = canvasElem.getContext('2d');
                c.setTransform(dpr, 0, 0, dpr, 0, 0);
                return true;
            }
            return false;
        }

        function updateAllCanvasSizes() {
            resizeCanvasToDisplaySize(starCanvas);
            resizeCanvasToDisplaySize(canvas);
        }

        window.addEventListener('resize', () => {
            updateAllCanvasSizes();
            stars.forEach(star => star.reset());
        });

        class Star {
            constructor() {
                this.reset();
                this.ox = 0; this.oy = 0;   // смещение от «вязкой» реакции на курсор
                this.ovx = 0; this.ovy = 0; // скорость этого смещения
            }
            reset() {
                this.x = Math.random() * starCanvas.clientWidth;
                this.y = Math.random() * starCanvas.clientHeight;
                this.vx = (Math.random() - 0.5) * 0.5;
                this.vy = (Math.random() - 0.5) * 0.5;
                this.size = Math.random() * 2 + 1;
            }
            update() {
                this.x += this.vx; this.y += this.vy;
                if (this.x < 0 || this.x > starCanvas.clientWidth || this.y < 0 || this.y > starCanvas.clientHeight) {
                    this.reset();
                    this.ox = 0; this.oy = 0; this.ovx = 0; this.ovy = 0;
                    return;
                }

                if (window.starsInteractive) {
                    const rx = this.x + this.ox, ry = this.y + this.oy;
                    const dx = rx - starMouseX, dy = ry - starMouseY;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < STAR_INTERACT_RADIUS && dist > 0.01) {
                        const force = (1 - dist / STAR_INTERACT_RADIUS) * STAR_REPEL_STRENGTH;
                        this.ovx += (dx / dist) * force;
                        this.ovy += (dy / dist) * force;
                    }
                }
                // Вязкое движение: высокое сопротивление гасит скорость смещения без
                // упругого отскока, а само смещение медленно стягивается к нулю —
                // звезда плавно «выплывает» обратно на свою естественную траекторию.
                this.ovx *= STAR_VISCOSITY;
                this.ovy *= STAR_VISCOSITY;
                this.ox = (this.ox + this.ovx) * STAR_RETURN;
                this.oy = (this.oy + this.ovy) * STAR_RETURN;
            }
        }

        for (let i = 0; i < 60; i++) stars.push(new Star());

        function animateStars() {
            starCtx.clearRect(0, 0, starCanvas.clientWidth, starCanvas.clientHeight);
            const isDark = document.body.getAttribute('data-theme') === 'dark';
            const color = isDark ? '255, 255, 255' : '100, 100, 100';

            stars.forEach((star, i) => {
                star.update();
                const sx = star.x + star.ox, sy = star.y + star.oy;
                starCtx.fillStyle = `rgba(${color}, 0.8)`;
                starCtx.beginPath();
                starCtx.arc(sx, sy, star.size, 0, Math.PI * 2);
                starCtx.fill();

                for (let j = i + 1; j < stars.length; j++) {
                    const otherX = stars[j].x + stars[j].ox, otherY = stars[j].y + stars[j].oy;
                    const dx = otherX - sx, dy = otherY - sy;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 150) {
                        starCtx.strokeStyle = `rgba(${color}, ${1 - dist / 150})`;
                        starCtx.lineWidth = 0.5;
                        starCtx.beginPath();
                        starCtx.moveTo(sx, sy);
                        starCtx.lineTo(otherX, otherY);
                        starCtx.stroke();
                    }
                }
            });
            requestAnimationFrame(animateStars);
        }
        
        updateAllCanvasSizes();
        animateStars();

