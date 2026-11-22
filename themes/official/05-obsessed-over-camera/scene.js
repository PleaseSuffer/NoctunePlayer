NoctuneScene.define({
    render(api) {
        api.layer('background');
        const c = api.ctx, shade = c.createLinearGradient(0, 0, api.width, api.height);
        shade.addColorStop(0, '#080914dd'); shade.addColorStop(.65, '#1e153b55'); shade.addColorStop(1, '#070911bb');
        c.fillStyle = shade; c.fillRect(0, 0, api.width, api.height);
        api.flicker([[1422,423,25,'#d6c8ff',.10],[1494,397,22,'#b7daff',.10],[1450,480,24,'#e2c3f8',.10],[1562,391,20,'#f2bbdd',.10],[1598,443,25,'#c9bcff',.10],[1623,480,22,'#f1c9e8',.10],[1270,268,85,'#ab9aff',.05]]);
        api.light(1000, 320, 560, api.energy * .08 + api.pulse * .14);
        api.character('character', { anchor: 930, hairY: [0, 580], contour: true, eyeGlow: [[883, 339, 32], [1018, 244, 32]] });
    },
});
