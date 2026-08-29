        // ========================
        // CONFETTI PARTICLE SYSTEM
        // ========================
        const confettiCanvas = document.getElementById('confetti-canvas');
        const confettiCtx = confettiCanvas.getContext('2d');

        // ── Default globals ──────────────────────────────────────────────
        window.confettiColor1       = '#ff6b9d';
        window.confettiColor2       = '#c44dff';
        window.confettiColor3       = '#4daaff';
        window.confettiEnabled      = false;
        window.confettiIntensity    = 1;       // 0.2–3
        window.confettiGravity      = 1;       // -3..3  (positive = down)
        window.confettiSizeScale    = 1;       // 0.5–3
        window.confettiSwirl        = false;
        window.confettiSwirlStr     = 1;       // swirl amplitude
        window.confettiSpawnMode    = 'top';   // top|bottom|sides|center|corners|random
        window.confettiIdleState    = 'drift'; // off|drift|pulse
        window._confettiAudioLevel  = 0;

        const CONFETTI_SHAPES = ['rect', 'circle', 'diamond'];

        // ── Resolve the effective spawn mode ────────────────────────────
        function resolveSpawnMode() {
            return window.confettiSpawnMode || 'top';
        }

        class ConfettiParticle {
            constructor(isIdle) { this.reset(isIdle); }

            reset(isIdle) {
                const W = confettiCanvas.clientWidth || window.innerWidth;
                const H = confettiCanvas.clientHeight || window.innerHeight;
                const mode = isIdle ? 'top' : resolveSpawnMode(); // idle always falls from top
                const baseSpeed = 0.6 + Math.random() * 1.4;

                if (mode === 'top') {
                    this.x  = Math.random() * W;
                    this.y  = isIdle ? Math.random() * H : -10 - Math.random() * 80;
                    this.vx = (Math.random() - 0.5) * 1.4;
                    this.vy = baseSpeed;
                } else if (mode === 'bottom') {
                    this.x  = Math.random() * W;
                    this.y  = H + 10 + Math.random() * 80;
                    this.vx = (Math.random() - 0.5) * 1.4;
                    this.vy = -baseSpeed;
                } else if (mode === 'sides') {
                    const left = Math.random() < 0.5;
                    this.x  = left ? -10 - Math.random() * 40 : W + 10 + Math.random() * 40;
                    this.y  = Math.random() * H;
                    this.vx = left ? baseSpeed : -baseSpeed;
                    this.vy = (Math.random() - 0.5) * 1.2;
                } else if (mode === 'center') {
                    const spread = window.confettiIntensity || 1;
                    const jitter = 30 * spread;
                    this.x  = W / 2 + (Math.random() - 0.5) * jitter;
                    this.y  = H / 2 + (Math.random() - 0.5) * jitter;
                    const angle = Math.random() * Math.PI * 2;
                    const spd   = (1 + Math.random() * 2) * spread;
                    this.vx = Math.cos(angle) * spd;
                    this.vy = Math.sin(angle) * spd;
                } else if (mode === 'corners') {
                    const corner = Math.floor(Math.random() * 4); // 0=TL 1=TR 2=BL 3=BR
                    this.x  = (corner === 0 || corner === 2) ? -8 : W + 8;
                    this.y  = (corner === 0 || corner === 1) ? -8 : H + 8;
                    const dirX = this.x < W / 2 ? 1 : -1;
                    const dirY = this.y < H / 2 ? 1 : -1;
                    const spd  = baseSpeed * (0.6 + Math.random() * 0.8);
                    this.vx = dirX * spd * (0.5 + Math.random() * 0.7);
                    this.vy = dirY * spd * (0.5 + Math.random() * 0.7);
                } else if (mode === 'random') {
                    // Spawn at a truly random position anywhere on screen, fly in a random direction
                    this.x  = Math.random() * W;
                    this.y  = Math.random() * H;
                    const angle = Math.random() * Math.PI * 2;
                    const spd   = baseSpeed * (0.8 + Math.random() * 1.5);
                    this.vx = Math.cos(angle) * spd;
                    this.vy = Math.sin(angle) * spd;
                } else { // fallback = top (also handles 'sprinkler' – those particles are created separately)
                    this.x  = Math.random() * W;
                    this.y  = -10 - Math.random() * 80;
                    this.vx = (Math.random() - 0.5) * 1.4;
                    this.vy = baseSpeed;
                }

                const sizeScale = window.confettiSizeScale || 1;
                this.size   = (4 + Math.random() * 5) * sizeScale;
                this.angle  = Math.random() * Math.PI * 2;
                this.spin   = (Math.random() - 0.5) * 0.14;
                this.shape  = CONFETTI_SHAPES[Math.floor(Math.random() * CONFETTI_SHAPES.length)];
                this.color  = ConfettiParticle.lerpGradient(Math.random());
                this.alpha  = 0.65 + Math.random() * 0.35;
                // Swirl / pulse phase (per-particle random offset)
                this.swirlPhase  = Math.random() * Math.PI * 2;
                this.swirlFreq   = 0.7 + Math.random() * 0.9;
                this.pulsePhase  = Math.random() * Math.PI * 2;
                this.pulseSpeed  = 0.8 + Math.random() * 1.2;
            }

            static lerpGradient(t) {
                const c1 = window.confettiColor1 || '#ff6b9d';
                const c2 = window.confettiColor2 || '#c44dff';
                const c3 = window.confettiColor3 || '#4daaff';
                return t < 0.5
                    ? ConfettiParticle.lerpHex(c1, c2, t * 2)
                    : ConfettiParticle.lerpHex(c2, c3, (t - 0.5) * 2);
            }
            static lerpHex(h1, h2, t) {
                const r1=parseInt(h1.slice(1,3),16), g1=parseInt(h1.slice(3,5),16), b1=parseInt(h1.slice(5,7),16);
                const r2=parseInt(h2.slice(1,3),16), g2=parseInt(h2.slice(3,5),16), b2=parseInt(h2.slice(5,7),16);
                return '#'
                    + Math.round(r1+(r2-r1)*t).toString(16).padStart(2,'0')
                    + Math.round(g1+(g2-g1)*t).toString(16).padStart(2,'0')
                    + Math.round(b1+(b2-b1)*t).toString(16).padStart(2,'0');
            }

            // Returns false when the particle should be removed
            update(dt, audioLevel, idleMode) {
                const intensity = window.confettiIntensity || 1;
                const gravity   = window.confettiGravity !== undefined ? window.confettiGravity : 1;
                const audioBoost = 1 + audioLevel * 2.5 * intensity;

                if (idleMode === 'pulse') {
                    // Float in place, pulse alpha, audio-reactive nudge
                    this.pulsePhase += dt * this.pulseSpeed;
                    this.swirlPhase += dt * this.swirlFreq;
                    this.x += this.vx * dt * 20 * (1 + audioLevel * 0.8);
                    this.y += this.vy * dt * 10 * (1 + audioLevel * 0.8);
                    // gentle gravity in pulse mode
                    this.vy += gravity * dt * 8;
                    this.angle += this.spin * dt * 30;
                    this.alpha = 0.35 + 0.45 * Math.abs(Math.sin(this.pulsePhase * 0.7 + audioLevel * 2));
                } else {
                    // Full physics
                    // Apply gravity (accumulates into vy)
                    this.vy += gravity * dt * 55 * intensity;
                    // Audio-reactive speed burst
                    this.x  += this.vx * dt * 55 * intensity * audioBoost;
                    this.y  += this.vy * dt * 55 * intensity * audioBoost;
                    this.angle += this.spin * dt * 65 * audioBoost;
                    // Swirl: sinusoidal X drift
                    if (window.confettiSwirl) {
                        this.swirlPhase += dt * this.swirlFreq * 2.5;
                        const swirlStr = (window.confettiSwirlStr || 1) * intensity;
                        this.x += Math.sin(this.swirlPhase) * swirlStr * dt * 55;
                    }
                    // Fade out slowly (cosmetic)
                    this.alpha = Math.max(0, this.alpha - dt * 0.04);
                }

                const W = confettiCanvas.clientWidth || window.innerWidth;
                const H = confettiCanvas.clientHeight || window.innerHeight;
                const m = 80; // margin
                return !(this.x < -m || this.x > W+m || this.y < -m || this.y > H+m || this.alpha <= 0.02);
            }

            draw(ctx) {
                ctx.save();
                ctx.globalAlpha = this.alpha;
                ctx.fillStyle   = this.color;
                ctx.translate(this.x, this.y);
                ctx.rotate(this.angle);
                const s = this.size;
                if (this.shape === 'rect') {
                    ctx.fillRect(-s * 0.5, -s * 0.3, s, s * 0.6);
                } else if (this.shape === 'circle') {
                    ctx.beginPath();
                    ctx.arc(0, 0, s * 0.45, 0, Math.PI * 2);
                    ctx.fill();
                } else { // diamond
                    ctx.beginPath();
                    ctx.moveTo(0, -s * 0.55);
                    ctx.lineTo(s * 0.4, 0);
                    ctx.lineTo(0, s * 0.55);
                    ctx.lineTo(-s * 0.4, 0);
                    ctx.closePath();
                    ctx.fill();
                }
                ctx.restore();
            }
        }

        let confettiParticles = [];
        let _confettiLastTime = performance.now();

        // ── Sprinkler globals ─────────────────────────────────────────────
        window.confettiSprinklerLines = 4;
        window._sprinklerAngle        = 0;
        window._sprinklerCooldown     = 0;
        // ── Frequency & beat detection globals ────────────────────────────

        window.confettiSensitivity    = 1.0;  // beat trigger sensitivity (0.2–3)
        window._beatAvg               = 0;
        window._beatCooldown          = 0;
        window._isBeat                = false;

        // Factory for sprinkler burst particles (pre-built with a specific angle)
        ConfettiParticle.makeSprinkler = function(angle) {
            const p = Object.create(ConfettiParticle.prototype);
            const W = confettiCanvas.clientWidth  || window.innerWidth;
            const H = confettiCanvas.clientHeight || window.innerHeight;
            const sizeScale  = window.confettiSizeScale || 1;
            const intensity  = window.confettiIntensity || 1;
            const spread     = 0.28; // angular spread per burst (radians)
            const spd        = (2.5 + Math.random() * 3.5) * intensity;
            const a          = angle + (Math.random() - 0.5) * spread;
            p.x     = W / 2 + (Math.random() - 0.5) * 24;
            p.y     = H / 2 + (Math.random() - 0.5) * 24;
            p.vx    = Math.cos(a) * spd;
            p.vy    = Math.sin(a) * spd;
            p.size  = (4 + Math.random() * 5) * sizeScale;
            p.angle = Math.random() * Math.PI * 2;
            p.spin  = (Math.random() - 0.5) * 0.18;
            p.shape = CONFETTI_SHAPES[Math.floor(Math.random() * CONFETTI_SHAPES.length)];
            p.color = ConfettiParticle.lerpGradient(Math.random());
            p.alpha = 0.85 + Math.random() * 0.15;
            p.swirlPhase = Math.random() * Math.PI * 2;
            p.swirlFreq  = 0.7 + Math.random() * 0.9;
            p.pulsePhase = Math.random() * Math.PI * 2;
            p.pulseSpeed = 0.8 + Math.random() * 1.2;
            return p;
        };

        function getConfettiTargetCount() {
            const base       = 65;
            const audioLevel = window._confettiAudioLevel || 0;
            const intensity  = window.confettiIntensity   || 1;
            const sensitivity = window.confettiSensitivity || 1;
            return Math.round(base * intensity * (1 + audioLevel * sensitivity * 3));
        }

        function animateConfetti() {
            requestAnimationFrame(animateConfetti);

            if (!window.confettiEnabled) {
                if (confettiParticles.length > 0) {
                    confettiCtx.clearRect(0, 0,
                        confettiCanvas.clientWidth || window.innerWidth,
                        confettiCanvas.clientHeight || window.innerHeight);
                    confettiParticles = [];
                }
                return;
            }

            const now = performance.now();
            const dt  = Math.min((now - _confettiLastTime) / 1000, 0.05);
            _confettiLastTime = now;

            const audioLevel = window._confettiAudioLevel || 0;
            const idleState  = window.confettiIdleState   || 'drift';
            const isPlaying  = window._confettiIsPlaying  || false;

            const W = confettiCanvas.clientWidth  || window.innerWidth;
            const H = confettiCanvas.clientHeight || window.innerHeight;
            confettiCtx.clearRect(0, 0, W, H);

            if (!isPlaying && idleState === 'off') {
                confettiParticles = [];
                return;
            }

            // ── Sprinkler mode: beat-triggered burst spawning ─────────────
            const spawnMode = window.confettiSpawnMode || 'top';
            if (spawnMode === 'sprinkler' && isPlaying) {
                const intensity  = window.confettiIntensity || 1;
                const audioLevel = window._confettiAudioLevel || 0;
                const lines      = Math.max(1, window.confettiSprinklerLines || 4);
                // Fire a burst on every detected beat (with min cooldown to avoid double-trigger)
                const beatReady  = window._isBeat && window._beatCooldown <= 0;
                // Fallback: if no audio (audioLevel < 0.05), use a slow metronome burst
                const fallbackTimer = window._sprinklerFallback = (window._sprinklerFallback || 0) - dt * 1000;
                const fallbackFire  = audioLevel < 0.05 && fallbackTimer <= 0;
                if (beatReady || fallbackFire) {
                    // Size scales with beat strength above the threshold
                    const beatStrength = Math.max(0, (window._beatAvg > 0 ? (window._confettiAudioLevel - window._beatAvg) / window._beatAvg : 0));
                    const burstSize    = Math.round((4 + intensity * 5) * (1 + beatStrength * 1.2));
                    for (let k = 0; k < lines; k++) {
                        const lineAngle = window._sprinklerAngle + k * Math.PI / lines;
                        // Two opposite directions per line
                        for (let dir = 0; dir < 2; dir++) {
                            const a = lineAngle + dir * Math.PI;
                            for (let b = 0; b < burstSize; b++) {
                                confettiParticles.push(ConfettiParticle.makeSprinkler(a));
                            }
                        }
                    }
                    window._sprinklerAngle  += 0.22 + beatStrength * 0.3;
                    window._beatCooldown     = 120; // ms – minimum gap between bursts
                    window._sprinklerFallback = 500 / intensity;
                }
                // Cap total particle count to avoid slowdown
                const cap = 700;
                if (confettiParticles.length > cap) confettiParticles.splice(0, confettiParticles.length - cap);
            } else if (spawnMode !== 'sprinkler') {
                // Normal mode: maintain a target pool of continuous particles
                const target = isPlaying
                    ? getConfettiTargetCount()
                    : Math.round(32 * (window.confettiIntensity || 1));
                while (confettiParticles.length < target) {
                    confettiParticles.push(new ConfettiParticle(!isPlaying));
                }
                if (confettiParticles.length > target + 40) {
                    confettiParticles.splice(target + 40);
                }
            }

            const activeMode = isPlaying ? 'active' : idleState;
            confettiParticles = confettiParticles.filter(p => {
                const alive = p.update(dt, isPlaying ? audioLevel : 0, activeMode);
                if (alive) p.draw(confettiCtx);
                return alive;
            });
        }

        // Keep in sync with playback state
        Object.defineProperty(window, '_confettiIsPlaying', {
            get() { return typeof isPlaying !== 'undefined' ? isPlaying : false; },
            configurable: true
        });

        // Keep confetti canvas resized alongside the others
        const _origUpdateAllCanvasSizes = updateAllCanvasSizes;
        updateAllCanvasSizes = function() {
            _origUpdateAllCanvasSizes();
            resizeCanvasToDisplaySize(confettiCanvas);
        };
        resizeCanvasToDisplaySize(confettiCanvas);
        animateConfetti();

