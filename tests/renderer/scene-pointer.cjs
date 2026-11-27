const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const events = {}, documentEvents = {};
let iframe;
const manifest = { id: 'pointer-test', palette: { background: '#000000' }, capabilities: { motion: true, visualizer: 'none' } };
const context = {
    window: { addEventListener: (name, fn) => { events[name] = fn; }, requestEffectsFrame() {} },
    document: { addEventListener: (name, fn) => { documentEvents[name] = fn; }, getElementById: () => null,
        createElement: () => (iframe = { style: {}, setAttribute() {}, remove() {} }), body: { prepend() {}, classList: { contains: () => false } } },
    matchMedia: () => ({ matches: false }), appStorage: { getItem: () => null },
    noctune: { sceneThemes: { read: async () => ({ apiVersion: 2, manifest }) } },
    innerWidth: 1000, innerHeight: 500, devicePixelRatio: 1,
    crypto: require('node:crypto').webcrypto, TextEncoder, Uint8Array,
    btoa: value => Buffer.from(value, 'binary').toString('base64'), setTimeout: () => 0, clearTimeout() {},
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../src/renderer/effects/scene-host.js'), 'utf8'), context);
async function readPointer() {
    // Inspect the actual sandbox init payload, rather than an internal host variable.
    context.window.sceneThemes.activate({ id: manifest.id }).catch(() => {});
    await new Promise(resolve => setImmediate(resolve));
    const encoded = iframe.srcdoc.match(/type="application\/octet-stream">([^<]+)/)[1];
    return JSON.parse(Buffer.from(encoded, 'base64').toString()).initialFrame.pointer;
}
(async () => {
    assert.deepEqual(await readPointer(), { x: 0, y: 0, active: false });
    events.pointermove({ pointerType: 'mouse', clientX: 750, clientY: 125 });
    assert.deepEqual(await readPointer(), { x: .5, y: -.5, active: true });
    events.pointermove({ pointerType: 'touch', clientX: 0, clientY: 0 });
    assert.deepEqual(await readPointer(), { x: .5, y: -.5, active: true });
    events.pointermove({ pointerType: 'mouse', clientX: 2000, clientY: -100 });
    assert.deepEqual(await readPointer(), { x: 1, y: -1, active: true });
    documentEvents.pointerleave();
    assert.deepEqual(await readPointer(), { x: 0, y: 0, active: false });
    events.pointermove({ pointerType: 'mouse', clientX: 0, clientY: 500 }); events.blur();
    assert.deepEqual(await readPointer(), { x: 0, y: 0, active: false });
    console.log('PASS: sandbox cursor normalization, bounds, touch exclusion, leave and blur.');
})().catch(error => { console.error(error); process.exitCode = 1; });
