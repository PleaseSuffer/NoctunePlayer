const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { KEY, createKeepAwake } = require('../../src/main/keep-awake');
const active = new Set(), starts = [], stops = [];
const controller = createKeepAwake({
    start(type) { const id = starts.length; starts.push(type); active.add(id); return id; },
    stop(id) { stops.push(id); active.delete(id); },
    isStarted: id => active.has(id),
});
controller.setEnabled(false);
assert.equal(starts.length, 0, 'default off acquires no inhibitor');
controller.setEnabled(true);
controller.setEnabled(true);
assert.deepEqual(starts, ['prevent-display-sleep'], 'one blocker keeps both display and system awake');
controller.setEnabled(false);
controller.setEnabled(false);
assert.deepEqual(stops, [0], 'zero is a valid blocker ID and duplicate disables are harmless');
controller.setEnabled(true);
active.clear();
controller.setEnabled(true);
assert.equal(starts.length, 3, 'a lost blocker is reacquired');
controller.setEnabled(false);
assert.equal(active.size, 0);

const source = fs.readFileSync('src/main/index.js', 'utf8');
const callbacks = new Map(), saved = new Map(), applied = [];
const context = {
    store: { get: key => saved.get(key), set: (key, value) => saved.set(key, value), delete: key => saved.delete(key) },
    KEEP_AWAKE_KEY: KEY, keepAwake: { setEnabled: value => applied.push(value) },
    backgroundMaskCache: { prune: async () => {} },
    ipcMain: { on: (channel, callback) => callbacks.set(channel, callback) },
};
vm.createContext(context);
const handlers = source.slice(source.indexOf("ipcMain.on('store:set'"), source.indexOf('function getDisplayVersion()'));
vm.runInContext(handlers, context);
callbacks.get('store:set')(null, KEY, '1');
assert.equal(saved.get(KEY), '1');
assert.equal(applied.at(-1), true);
callbacks.get('store:set')(null, KEY, '0');
assert.equal(applied.at(-1), false);
callbacks.get('store:set')(null, KEY, true);
assert.equal(applied.at(-1), false, 'only the explicit saved opt-in enables keep-awake');
callbacks.get('store:delete')(null, KEY);
assert.equal(saved.has(KEY), false);
assert.equal(applied.at(-1), false, 'removing the setting also releases the inhibitor');
const shutdown = source.match(/app\.on\('will-quit', [^\n]+/)[0];
let quit;
context.app = { on: (_event, callback) => { quit = callback; } };
vm.runInContext(shutdown, context);
quit();
assert.equal(applied.at(-1), false);
const restore = source.match(/keepAwake\.setEnabled\(store\.get\(KEEP_AWAKE_KEY\)[^;]+;/)[0];
for (const value of [undefined, '0', '1', 'invalid']) {
    saved.set(KEY, value);
    vm.runInContext(restore, context);
    assert.equal(applied.at(-1), value === '1', 'startup restores only a valid saved opt-in');
}
console.log('PASS: keep-awake defaults off, idempotent display/system inhibitor, live persistence, removal, startup and quit cleanup.');
