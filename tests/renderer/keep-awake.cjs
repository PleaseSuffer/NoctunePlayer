const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const settings = fs.readFileSync('src/renderer/ui/settings.js', 'utf8');
const block = settings.slice(settings.indexOf('// ---- GENERAL: Keep screen and system awake ----'), settings.indexOf('// ---- PLAYER: Autonext playlist ----'));
const storage = new Map();
function load() {
    const toggle = { checked: false, addEventListener(_event, callback) { this.change = callback; } };
    vm.runInNewContext(block, {
        document: { getElementById: id => { assert.equal(id, 'setting-keep-awake'); return toggle; } },
        appStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    });
    return toggle;
}
let toggle = load();
assert.equal(toggle.checked, false);
toggle.checked = true; toggle.change();
assert.equal(storage.get('setting_keep_awake'), '1');
toggle = load();
assert.equal(toggle.checked, true);
toggle.checked = false; toggle.change();
assert.equal(storage.get('setting_keep_awake'), '0');
assert.equal(load().checked, false);
console.log('PASS: keep-awake toggle defaults off and persists across renderer restarts.');
const engine = fs.readFileSync('src/renderer/playback/audio-engine.js', 'utf8');
const activity = engine.slice(engine.indexOf('        function reportPlaybackActive('), engine.indexOf('        function stopTrack('));
const updates = [];
function audio() {
    const handlers = new Map();
    return { addEventListener: (event, cb) => handlers.set(event, cb), emit: event => handlers.get(event)() };
}
const local = audio(), radio = audio();
const context = { noctune: { setPlaybackActive: value => updates.push(value) }, localAudioElement: local, radioAudioElement: radio, isRadioMode: false };
vm.createContext(context); vm.runInContext(activity, context);
context.trackPlaybackActivity(local); context.trackPlaybackActivity(radio);
local.emit('playing'); assert.equal(updates.at(-1), true);
for (const event of ['pause', 'ended', 'emptied', 'error', 'waiting']) {
    local.emit(event); assert.equal(updates.at(-1), false, event + ' allows sleep');
    local.emit('playing'); assert.equal(updates.at(-1), true, 'resume blocks sleep');
}
context.isRadioMode = true;
radio.emit('playing'); local.emit('pause'); assert.equal(updates.at(-1), true, 'inactive local audio cannot release radio blocker');
radio.emit('error'); assert.equal(updates.at(-1), false, 'radio failure allows sleep');
context.localAudioElement = audio(); context.isRadioMode = false;
local.emit('playing'); assert.equal(updates.at(-1), false, 'old track cannot acquire a blocker');
console.log('PASS: actual local/radio playback controls keep-awake; pause, end, empty, failure, buffering and stale media events release or preserve it correctly.');
