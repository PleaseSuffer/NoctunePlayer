(function (root) {
    // Per-band transients prevent a sustained, loud spectrum from saturating the glow.
    function createImageAudioResponse() {
        const mean = [0, 0, 0], previous = [0, 0, 0], peaks = [.08, .08, .08];
        return {
            reset() { mean.fill(0); previous.fill(0); peaks.fill(.08); },
            sample(bands, dt) {
                return bands.map((raw, i) => {
                    const level = Math.max(0, raw - .025);
                    const rise = Math.max(0, level - previous[i]);
                    const contrast = Math.max(0, level - mean[i]);
                    const impulse = Math.max(rise * 3, contrast * 1.4);
                    peaks[i] = Math.max(.08, impulse, peaks[i] * Math.exp(-dt * .7));
                    const transient = Math.min(1, impulse / peaks[i]);
                    previous[i] = level;
                    mean[i] += (level - mean[i]) * (1 - Math.exp(-dt * 5));
                    return { level, transient, response: Math.min(1, level * .18 + transient * .82) };
                });
            }
        };
    }
    function createImagePulsePool() {
        return {
            items: [], cooldown: 0,
            clear() { this.items = []; this.cooldown = 0; },
            trim(limit) { this.items.length = Math.min(this.items.length, Math.floor(limit)); },
            advance(dt, speed) {
                this.cooldown = Math.max(0, this.cooldown-dt);
                for (const pulse of this.items) {
                    pulse.age += dt; pulse.radius += dt*speed;
                    pulse.amplitude = Math.min(1, pulse.age/.06) * Math.max(0, 1-pulse.radius/1.8);
                }
                this.items = this.items.filter(pulse=>pulse.radius<1.8);
            },
            spawn(limit) {
                // Keep existing animations intact when all slots are occupied.
                if (this.items.length >= Math.floor(limit)) return false;
                this.items.push({ age: 0, radius: 0, amplitude: 0 });
                return true;
            }
        };
    }
    function imageAudioGate(level, threshold) {
        if (threshold <= 0) return 1;
        // Gate absolute band loudness before adaptive transient normalization.
        const progress = Math.max(0, Math.min(1, (level-threshold)/.08));
        return progress*progress*(3-2*progress);
    }
    if (typeof module !== 'undefined') module.exports = { createImageAudioResponse, createImagePulsePool, imageAudioGate };
    else { root.createImageAudioResponse = createImageAudioResponse; root.createImagePulsePool = createImagePulsePool; root.imageAudioGate = imageAudioGate; }
})(typeof window !== 'undefined' ? window : globalThis);
