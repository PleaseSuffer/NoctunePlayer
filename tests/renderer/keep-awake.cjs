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
