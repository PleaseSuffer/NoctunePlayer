/// <reference path="../../../src/renderer/effects/scene-sdk.d.ts" />
NoctuneScene.define({
    render(api, frame) {
        const source = api.bandsSource({ count: 80, minHz: 35, maxHz: 18000, attack: 18, release: 7, smoothing: .35 });
        const visualizer = () => {
            const options = { x: 40, y: 250, width: 560, height: 110, source, opacity: .85 };
            if (frame.parameters.style === 'line') api.line({ ...options, hideWhenSilent: true });
            else api.bars(options);
        };
        api.compose({
            background() {
                const c = api.ctx, gradient = c.createLinearGradient(0, 0, 0, 360);
                gradient.addColorStop(0, '#101425'); gradient.addColorStop(1, '#34305a');
                c.fillStyle = gradient; c.fillRect(0, 0, 640, 360);
                api.shootingStars({ color: '#d9d2ff', opacity: .6, glow: 10, stop: 'freeze' });
            },
            effects() {
                api.clipMask('towers', visualizer, { invert: true });
                api.reflection({ baseline: 260, height: 100, mask: 'water', distortion: Number(frame.parameters.waves), opacity: .4 }, visualizer);
                if (frame.parameters.crown) api.radialSpectrum({ x: 320, y: 115, radius: 40, height: 35, source });
                api.clipMask('water', () => api.waterRipple({ x: 450, y: 310, radius: 100, opacity: .15 }));
            },
            foreground() { api.layer('towers'); },
        });
    },
});
