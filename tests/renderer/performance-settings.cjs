const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const flush = () => new Promise(resolve => setImmediate(resolve));
const ids = ['setting-hardware-acceleration', 'hardware-acceleration-notice', 'hardware-acceleration-status', 'hardware-acceleration-restart', 'setting-effects-fps', 'effects-fps-menu', 'effects-fps-label', 'effects-fps-dropdown'];
function element() {
    const classes = new Set();
    return { hidden: true, disabled: true, checked: true, listeners: {}, attributes: {},
        classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name) },
        setAttribute(name, value) { this.attributes[name] = value; }, focus() {}, contains() { return false; },
        addEventListener(name, callback) { this.listeners[name] = callback; }
    };
}
const elements = Object.fromEntries(ids.map(id => [id, element()]));
const options = ['30', '60', '0'].map(fps => Object.assign(element(), { dataset: { fps }, textContent: fps === '0' ? 'Без ограничения' : fps + ' FPS' }));
elements['effects-fps-menu'].querySelectorAll = () => options;
let saved = true, startup = true, failed = false, restarts = 0;
const state = () => ({ enabled: saved, restartRequired: saved !== startup });
const performance = {
    getHardwareAcceleration: async () => state(),
    setHardwareAcceleration: async enabled => { if (failed) throw new Error('cannot-save'); saved = enabled; return state(); },
    restart: async () => { restarts++; },
};
const context = { document: { getElementById: id => elements[id], addEventListener() {} }, noctune: { performance }, window: { effectsPerformance: { fps: 60, setFps(value) { this.fps = Number(value); } } } };
vm.createContext(context); vm.runInContext(fs.readFileSync('src/renderer/ui/performance-settings.js', 'utf8'), context);
(async () => {
    await flush();
    assert.equal(elements['effects-fps-label'].textContent, '60 FPS');
    elements['setting-effects-fps'].listeners.click();
    assert.equal(elements['setting-effects-fps'].attributes['aria-expanded'], 'true');
    options[0].listeners.click();
    assert.equal(context.window.effectsPerformance.fps, 30);
    assert.equal(elements['effects-fps-label'].textContent, '30 FPS');
    assert.equal(options[0].attributes['aria-selected'], 'true');
    assert.equal(elements['setting-effects-fps'].attributes['aria-expanded'], 'false');
    const toggle = elements[ids[0]], notice = elements[ids[1]], restart = elements[ids[3]];
    assert.equal(toggle.disabled, false); assert.equal(toggle.checked, true); assert.equal(notice.hidden, true);
    toggle.checked = false; await toggle.listeners.change();
    assert.equal(saved, false); assert.equal(notice.hidden, false); assert.equal(restart.hidden, false);
    toggle.checked = true; await toggle.listeners.change();
    assert.equal(notice.hidden, true, 'returning to startup value removes restart notice');
    failed = true; toggle.checked = false; await toggle.listeners.change();
    assert.equal(toggle.checked, true, 'failed save rolls back checkbox'); assert.equal(toggle.disabled, false);
    failed = false; startup = false; saved = false;
    toggle.checked = true; await toggle.listeners.change();
    assert.equal(restart.hidden, false, 'enabling also requires restart');
    await restart.listeners.click(); assert.equal(restarts, 1); assert.equal(restart.disabled, true);
    console.log('PASS: hardware switch loading, saved state, restart notice, rollback and restart action.');
})().catch(error => { console.error(error); process.exitCode = 1; });
