const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/renderer/playback/playback-controls.js', 'utf8');
const toggle = source.match(/function toggleRepeat\(\) \{[^\n]+\}/)[0];
const context = { repeatMode: 0, setRepeatMode(value) { context.repeatMode = value; } };
vm.createContext(context); vm.runInContext(toggle, context);
const seen = [];
for (let index = 0; index < 6; index++) { context.toggleRepeat(); seen.push(context.repeatMode); }
assert.deepEqual(seen, [2, 1, 0, 2, 1, 0], 'off → playlist → track; persisted and SDK numeric meanings stay unchanged');
console.log('PASS: repeat cycle and backwards-compatible saved/API mode values.');
