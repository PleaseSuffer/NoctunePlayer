const assert = require('node:assert/strict');
const { normalizeSlider, formatSlider } = require('../../src/renderer/core/scene-parameter-values');
const schema = { min: 0, max: 2, step: .1, default: .7 };
assert.equal(normalizeSlider(1.2000000000000002, schema), 1.2);
assert.equal(formatSlider(1.2000000000000002, schema), '1.2');
assert.equal(normalizeSlider(.30000000000000004, schema), .3);
assert.equal(normalizeSlider(1.74, schema), 1.7);
assert.equal(normalizeSlider(2.2, schema), 2);
assert.equal(normalizeSlider(-1, schema), 0);
assert.equal(normalizeSlider(NaN, schema), .7);
assert.equal(normalizeSlider(undefined, schema), .7);
assert.equal(normalizeSlider(Infinity, schema), .7);
assert.equal(normalizeSlider(.26, { min: .05, max: 1, step: .1, default: .05 }), .25);
assert.equal(normalizeSlider(-.3, { min: -.5, max: 1, step: .1, default: 0 }), -.3);
assert.equal(formatSlider(.00000030000000004, { min: 0, max: 1, step: 1e-7, default: 0 }), '3e-7');
assert.equal(formatSlider(.0003, { min: 0, max: 1, step: 1e-4, default: 0 }), '0.0003');
assert.equal(formatSlider(.3, { min: 0, max: 1, step: .25, default: 0 }), '0.25');
assert.equal(normalizeSlider(0, { min: -.1, max: .1, step: .1, default: 0 }), 0);
// An endpoint need not lie on the step grid; clamp first, then choose a valid step.
assert.equal(normalizeSlider(10, { min: 0, max: .95, step: .2, default: 0 }), .8);
for(let i=0;i<=20;i++){
    const value=normalizeSlider(i*.1,schema);
    assert.equal(value,Number((i/10).toFixed(1)));
    assert.equal(normalizeSlider(value,schema),value,'normalization is stable on reload');
    assert.equal(JSON.parse(JSON.stringify({value})).value,value,'saved values stay normalized');
}
console.log('PASS: decimal step normalization, floating point tails, nonzero/negative min, exponent steps, bounds, invalid values and reload stability.');
