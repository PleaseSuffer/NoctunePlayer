NoctuneScene.define({
    render(api) {
        const sx=api.width/1672,sy=api.height/941;
        api.layer('sky');
        api.shootingStars({ minInterval: 4, maxInterval: 9 });
        api.bars({ x: 0, y: 642*sy, width: api.width, height: 220*sy, count: 128, opacity: .65, smoothing: .8 });
        api.layer('land');
        api.flicker([[135,729,20,'#9beaff'],[248,713,24,'#edc09a'],[361,687,18,'#aabaff'],[485,692,19,'#f1b89c'],[615,710,22,'#89d5ff'],[726,683,20,'#a0baff'],[827,692,25,'#f0c19f'],[950,695,18,'#9ae6ff'],[1080,689,26,'#ddb0fa'],[1175,673,21,'#f3c3a0'],[315,758,23,'#bdb0ff'],[556,780,25,'#a0e0ff'],[838,765,26,'#eac0ac'],[1005,738,22,'#a7ceff']].map(([x,y,r,...rest])=>[x*sx,y*sy,r*sx,...rest]));
        api.character('character', { anchor: 850*sy, hairY: [208*sy, 440*sy], blink: 'blink', eyes: [[1299*sx, 290*sy, 43*sx, 35*sy]] });
    },
});
