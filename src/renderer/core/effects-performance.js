(function () {
    const allowedFps = [0, 30, 60];
    const storedFps = Number(appStorage.getItem('setting_effects_fps') ?? 60);
    let fps = allowedFps.includes(storedFps) ? storedFps : 60;
    const pending = new Set();
    let raf = null, lastFrame = -Infinity;
    function cancel() {
        if (raf !== null) cancelAnimationFrame(raf);
        raf = null;
    }
    function schedule() {
        if (!pending.size || raf !== null) return;
        raf = requestAnimationFrame(now => {
            raf = null;
            const interval = fps ? 1000 / fps : 0;
            const elapsed = now - lastFrame;
            if (interval && elapsed < interval - 0.5) { schedule(); return; }
            lastFrame = interval && Number.isFinite(elapsed) ? lastFrame + Math.max(1, Math.floor((elapsed + 0.5) / interval)) * interval : now;
            const batch = [...pending];
            pending.clear();
            // Schedule only after the entire batch; all effect loops share one frame.
            for (const callback of batch) {
                try { callback(now); } catch (error) { console.error('Effect animation failed', error); }
            }
            schedule();
        });
    }
    window.requestEffectsFrame = callback => { pending.add(callback); schedule(); };
    window.effectsPerformance = {
        get fps() { return fps; },
        setFps(value) {
            const next = Number(value);
            if (!allowedFps.includes(next)) return;
            fps = next;
            appStorage.setItem('setting_effects_fps', fps);
            cancel(); lastFrame = -Infinity; schedule();
        }
    };
})();
