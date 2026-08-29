        // ========================
        // FIREWORKS VISUALIZER ("Салют")
        // Портировано из fireworks.html и подключено как один из типов
        // визуализатора: рисуется прямо на основном #visualizer canvas
        // (см. ветку style === 'fireworks' внутри visualize()) и реагирует
        // на музыку — базовый авто-запуск ракет плюс дополнительные залпы
        // на сильных ударах баса.
        // ========================
        window._fwFireworks = [];
        window._fwParticles = [];
        window.fireworksColorMode    = 'random'; // random | accent | custom
        window.fireworksCustomColors = ['#ffaa33', '#ff5e7d', '#4da6ff'];
        window.fireworksFrequency    = 1;         // множитель базовой частоты авто-запуска
        window.fireworksIdleSpawn    = true;      // запускать ли салют, пока музыка не играет
        window.fireworksBeatReactive = true;
        window.fireworksBeatBurstCount = 1;       // сколько ракет запускать за один удар баса
        window.fireworksThreshold    = 0;         // порог срабатывания на реакцию баса
        window.fireworksTrail        = 4;         // длина следа искр (maxHistory)

        function fwRandom(min, max) { return Math.random() * (max - min) + min; }
        function fwRandomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

        // Переводит hex-цвет в оттенок (hue, 0-360) для использования в hsl/hsla —
        // так салют можно красить в цвета градиента визуализатора, акцент или
        // произвольный выбранный пользователем цвет, а не только случайно.
        function hexToHueValue(hex) {
            hex = (hex || '#ffffff').replace('#', '');
            if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
            const r = parseInt(hex.substr(0, 2), 16) / 255;
            const g = parseInt(hex.substr(2, 2), 16) / 255;
            const b = parseInt(hex.substr(4, 2), 16) / 255;
            const max = Math.max(r, g, b), min = Math.min(r, g, b);
            let h = 0;
            const d = max - min;
            if (d !== 0) {
                switch (max) {
                    case r: h = ((g - b) / d) % 6; break;
                    case g: h = (b - r) / d + 2; break;
                    default: h = (r - g) / d + 4;
                }
                h *= 60;
                if (h < 0) h += 360;
            }
            return h;
        }

        function fwExplosionHue() {
            const mode = window.fireworksColorMode || 'random';
            if (mode === 'accent') {
                // Читаем с <body>, а не с <html>: тёмная тема и адаптивный акцент
                // переопределяют --accent-color именно на body ([data-theme="dark"]
                // и setAccentColor() выставляют переменную на body), поэтому чтение
                // с documentElement возвращало устаревший/неверный цвет.
                const accent = getComputedStyle(document.body).getPropertyValue('--accent-color').trim() || '#4a90e2';
                return hexToHueValue(accent);
            }
            if (mode === 'custom') {
                const cols = (window.fireworksCustomColors && window.fireworksCustomColors.length)
                    ? window.fireworksCustomColors : ['#ffaa33'];
                return hexToHueValue(cols[Math.floor(Math.random() * cols.length)]);
            }
            return fwRandomInt(0, 360);
        }

        // Насколько сильно «дрожит» оттенок отдельных искр вокруг базового цвета
        // взрыва. Для случайного/акцентного режима лёгкая дисперсия добавляет
        // живости, а для явно выбранной пользователем палитры вариацию держим
        // небольшой, чтобы, например, голубой не «съезжал» в синий.
        function fwHueJitterAmount() {
            return (window.fireworksColorMode === 'custom') ? 5 : 15;
        }

        // --- Взлетающий снаряд ---
        class FwFirework {
            constructor(W, H) {
                this.x = fwRandom(W * 0.15, W * 0.85);
                this.y = H;
                this.targetY = fwRandom(H * 0.12, H * 0.42);
                this.speed = fwRandom(6, 9);
                this.angle = Math.PI / 2 + fwRandom(-0.04, 0.04);
                this.vx = Math.cos(this.angle) * this.speed;
                this.vy = -Math.sin(this.angle) * this.speed;
                this.hue = fwExplosionHue();
                this.history = [];
                this.maxHistory = 6;
            }
            update(arr, index) {
                this.history.push({ x: this.x, y: this.y });
                if (this.history.length > this.maxHistory) this.history.shift();

                this.vy += 0.035;
                this.x += this.vx;
                this.y += this.vy;

                if (this.vy >= -0.5 || this.y <= this.targetY) {
                    createFwExplosion(this.x, this.y, this.hue);
                    arr.splice(index, 1);
                }
            }
            draw() {
                if (this.history.length < 2) return;
                ctx.beginPath();
                ctx.moveTo(this.history[0].x, this.history[0].y);
                for (let i = 1; i < this.history.length; i++) ctx.lineTo(this.history[i].x, this.history[i].y);
                ctx.strokeStyle = `hsl(${this.hue}, 100%, 75%)`;
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        }

        // --- Частица взрыва ---
        class FwParticle {
            constructor(x, y, hue, vx, vy, options = {}) {
                this.x = x;
                this.y = y;
                this.vx = vx;
                this.vy = vy;
                this.hue = hue + fwRandom(-fwHueJitterAmount(), fwHueJitterAmount());
                this.brightness = options.brightness || fwRandom(65, 85);
                this.alpha = 1;

                this.decay = options.decay || fwRandom(0.007, 0.013);
                this.gravity = options.gravity || 0.04;
                this.friction = options.friction || 0.965;
                this.size = options.size || fwRandom(1.5, 2.5);

                this.history = [];
                this.maxHistory = options.maxHistory || (window.fireworksTrail || 4);

                this.flickerTimer = fwRandom(0, 100);
                this.flickerSpeed = fwRandom(0.15, 0.3);
            }
            update(arr, index) {
                this.history.push({ x: this.x, y: this.y });
                if (this.history.length > this.maxHistory) this.history.shift();

                this.vx *= this.friction;
                this.vy *= this.friction;
                this.vy += this.gravity;

                this.x += this.vx;
                this.y += this.vy;
                this.alpha -= this.decay;
                this.flickerTimer += this.flickerSpeed;

                if (this.alpha <= 0) arr.splice(index, 1);
            }
            draw() {
                if (this.alpha <= 0) return;
                const flicker = Math.sin(this.flickerTimer) * 0.3 + 0.7;
                const currentAlpha = Math.max(0, this.alpha * flicker);

                if (this.history.length > 1) {
                    ctx.beginPath();
                    ctx.moveTo(this.history[0].x, this.history[0].y);
                    for (let i = 1; i < this.history.length; i++) ctx.lineTo(this.history[i].x, this.history[i].y);
                    ctx.strokeStyle = `hsla(${this.hue}, 100%, ${this.brightness}%, ${currentAlpha * 0.35})`;
                    ctx.lineWidth = this.size * 0.8;
                    ctx.stroke();
                }

                const glowRadius = this.size * 3;
                const grad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, glowRadius);
                grad.addColorStop(0, `hsla(${this.hue}, 100%, ${this.brightness}%, ${currentAlpha})`);
                grad.addColorStop(0.4, `hsla(${this.hue}, 100%, 50%, ${currentAlpha * 0.4})`);
                grad.addColorStop(1, `hsla(${this.hue}, 100%, 50%, 0)`);

                ctx.beginPath();
                ctx.arc(this.x, this.y, glowRadius, 0, Math.PI * 2);
                ctx.fillStyle = grad;
                ctx.fill();
            }
        }

        function spawnFirework(W, H) {
            if (!window._fwFireworks) window._fwFireworks = [];
            if (window._fwFireworks.length >= 24) return; // внутренний предохранитель от накопления слишком многих ракет разом
            window._fwFireworks.push(new FwFirework(W, H));
        }

        // Формы взрыва — портированы 1:1 из fireworks.html; количество частиц
        // масштабируется общим ползунком «Интенсивность» визуализатора.
        function createFwExplosion(x, y, hue) {
            if (!window._fwParticles) window._fwParticles = [];
            const types = ['circle', 'star', 'willow', 'doubleCircle', 'ring'];
            const type = types[Math.floor(Math.random() * types.length)];
            const intensity = window.vizIntensity || 1;
            const count = Math.max(20, Math.min(160, Math.round(65 * intensity)));

            switch (type) {
                case 'circle': {
                    const speed = fwRandom(3, 5.5);
                    for (let i = 0; i < count; i++) {
                        const angle = (Math.PI * 2 / count) * i;
                        const s = speed * fwRandom(0.85, 1.15);
                        window._fwParticles.push(new FwParticle(x, y, hue, Math.cos(angle) * s, Math.sin(angle) * s));
                    }
                    break;
                }
                case 'star': {
                    const points = 5;
                    for (let i = 0; i < count; i++) {
                        const angle = (Math.PI * 2 / count) * i;
                        const r = Math.sin(points * angle);
                        const speed = 1.5 + Math.abs(r) * 3.5;
                        window._fwParticles.push(new FwParticle(x, y, hue, Math.cos(angle) * speed, Math.sin(angle) * speed));
                    }
                    break;
                }
                case 'willow': {
                    const willowHue = (window.fireworksColorMode === 'random') ? fwRandomInt(35, 50) : hue;
                    for (let i = 0; i < count * 1.1; i++) {
                        const angle = fwRandom(0, Math.PI * 2);
                        const speed = fwRandom(0.5, 3.5);
                        window._fwParticles.push(new FwParticle(x, y, willowHue, Math.cos(angle) * speed, Math.sin(angle) * speed, {
                            gravity: 0.02,
                            friction: 0.975,
                            decay: 0.005,
                            brightness: 85,
                            size: fwRandom(1.2, 2.2),
                            maxHistory: (window.fireworksTrail || 4) + 4
                        }));
                    }
                    break;
                }
                case 'doubleCircle': {
                    // В случайном режиме зафиксированный сдвиг оттенка даёт приятный
                    // двухцветный эффект. Но в режимах «Акцентный»/«Свой цвет» такой
                    // жёсткий сдвиг игнорирует выбор пользователя (например, голубой
                    // превращался в синий) — поэтому там второй слой берёт цвет через
                    // тот же fwExplosionHue(), оставаясь в рамках выбранной палитры.
                    const hue2 = (window.fireworksColorMode === 'random') ? hue + 40 : fwExplosionHue();
                    for (let i = 0; i < count; i++) {
                        const angle = (Math.PI * 2 / count) * i;
                        window._fwParticles.push(new FwParticle(x, y, hue, Math.cos(angle) * 2, Math.sin(angle) * 2));
                        window._fwParticles.push(new FwParticle(x, y, hue2, Math.cos(angle) * 4.5, Math.sin(angle) * 4.5));
                    }
                    break;
                }
                case 'ring':
                default: {
                    const speed = fwRandom(3, 4);
                    for (let i = 0; i < count; i++) {
                        const angle = fwRandom(0, Math.PI * 2);
                        const s = speed * fwRandom(0.2, 1);
                        window._fwParticles.push(new FwParticle(x, y, hue, Math.cos(angle) * s, Math.sin(angle) * s));
                    }
                    break;
                }
            }

            // Защита от бесконтрольного роста при долгом простое/паузе
            if (window._fwParticles.length > 1400) {
                window._fwParticles.splice(0, window._fwParticles.length - 1400);
            }
        }

