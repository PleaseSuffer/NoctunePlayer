const assert = require('node:assert/strict');
const { createImagePulsePool } = require('../../src/renderer/effects/image-audio-response');
for (const fps of [30,60,144]) {
    const pool = createImagePulsePool();
    assert.equal(pool.spawn(2),true);
    const first = pool.items[0];
    for (let frame=0;frame<fps/2;frame++) pool.advance(1/fps,.45);
    const radius = first.radius;
    assert.equal(pool.spawn(2),true);
    assert.equal(pool.items[0],first,'a new pulse preserves the previous instance');
    assert.equal(first.radius,radius,'a new pulse never resets previous progress');
    const second = pool.items[1];
    assert.equal(pool.spawn(2),false,'full pool ignores extra triggers');
    assert.deepEqual(pool.items,[first,second]);
    pool.advance(.025,.45);
    assert.ok(second.amplitude>0 && second.amplitude<.5,'new pulses fade in instead of jumping');
    assert.ok(first.radius>second.radius,'several independent wave fronts coexist');
    for(let frame=0;frame<fps*4;frame++) pool.advance(1/fps,.45);
    assert.equal(pool.items.length,0,'each pulse expires naturally');
    assert.equal(pool.spawn(2),true,'expired slots can be reused');
    pool.spawn(2);pool.trim(1);assert.equal(pool.items.length,1);
    pool.clear();assert.equal(pool.items.length,0);assert.equal(pool.cooldown,0);
}
console.log('PASS: independent concurrent pulses, bounded pools, no restarts on saturation, smooth appearance, expiry and cleanup at 30/60/144 FPS.');
