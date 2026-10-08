const assert = require('node:assert/strict');
const { createImageAudioResponse } = require('../../src/renderer/effects/image-audio-response');
for (const fps of [30, 60, 144]) {
    const meter = createImageAudioResponse(), dt = 1/fps;
    const attack = meter.sample([.5,.5,.5],dt);
    for (let frame=0;frame<fps*2;frame++) meter.sample([.5,.5,.5],dt);
    const sustain = meter.sample([.5,.5,.5],dt);
    assert.ok(attack[0].response > sustain[0].response * 4, 'sustained loud audio does not saturate the glow');
    const treble = meter.sample([.5,.5,.9],dt);
    assert.ok(treble[2].response > sustain[2].response + .5, 'treble transients are detected independently of bass');
    assert.ok(Math.abs(treble[0].response-sustain[0].response)<.01);
    const silent = meter.sample([0,0,0],dt);
    assert.ok(silent.every(band=>band.response===0), 'silence has no residual input');
    meter.reset();
    assert.ok(meter.sample([0,0,0],dt).every(band=>band.response===0));
}
console.log('PASS: independent frequency transients, sustained audio contrast, silence and reset at 30/60/144 FPS.');
