const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const elements = new Map();
function element(id) {
    if (!elements.has(id)) {
        const classes = new Set();
        elements.set(id, {
            value: '0.8', textContent: '', listeners: {}, classes,
            classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
            addEventListener(name, callback, options) { this.listeners[name] = { callback, options }; },
        });
    }
    return elements.get(id);
}
const timers = new Map();
let nextTimer = 0, updates = 0;
const context = {
    isMuted: false,
    lucide: { createIcons({root}) { assert.equal(root, element('volume-wheel-icon')); } },
    document: { getElementById: element, querySelector: element },
    volumeSlider: element('volume-slider'), miniVolumeSlider: element('mini-volume-slider'),
    lyricsVolume: element('lyrics-volume'),
    setTimeout(callback, delay) { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
    updateVolume(value) {
        context.volumeSlider.value = String(value);
        context.miniVolumeSlider.value = String(value);
    },
    updatePlayback() { updates++; context.lyricsVolume.value = context.volumeSlider.value; },
};
vm.createContext(context);
const hotkeys = fs.readFileSync('src/renderer/ui/hotkeys.js', 'utf8');
vm.runInContext(hotkeys.slice(hotkeys.indexOf('        function adjustVolume('), hotkeys.indexOf('        const HOTKEY_ACTIONS')), context);
const radio = fs.readFileSync('src/renderer/integrations/radio-search.js', 'utf8');
vm.runInContext(radio.slice(radio.indexOf('        const volumeWheelIndicator'), radio.indexOf('        // Мягкий')), context);
const lyrics = fs.readFileSync('src/renderer/integrations/lyrics.js', 'utf8');
vm.runInContext(lyrics.split('\n').filter(line => line.includes("addEventListener('wheel'") && line.includes('handleVolumeWheel')).join('\n'), context);

const indicator = element('volume-wheel-indicator');
const value = element('volume-wheel-value');
const icon = element('volume-wheel-icon');
function wheel(control, deltaY) {
    let prevented = false;
    control.listeners.wheel.callback({ deltaY, preventDefault() { prevented = true; } });
    assert(prevented, 'volume scroll prevents page scrolling');
}
for (const id of ['volume-slider', 'mini-volume-slider', 'main-volume-btn', '.mini-volume-zone button', 'lyrics-volume', 'lyrics-volume-button']) {
    const control = element(id);
    assert.equal(control.listeners.wheel.options.passive, false, id);
    context.updateVolume(0.8);
    wheel(control, -120);
    assert.equal(context.volumeSlider.value, '0.81', `${id}: one percent per wheel event`);
    assert.equal(context.miniVolumeSlider.value, '0.81');
    assert.equal(value.textContent, '81%');
    assert.match(icon.innerHTML, /volume-2/);
    assert(indicator.classes.has('visible'));
    const oldTimer = [...timers.keys()][0];
    wheel(control, 120);
    assert.equal(context.volumeSlider.value, '0.8');
    assert.equal(value.textContent, '80%');
    assert(!timers.has(oldTimer), 'continued scrolling cancels the previous hide timer');
    assert.equal(timers.size, 1, 'only one hide timer remains');
    const timer = [...timers.values()][0];
    assert.equal(timer.delay, 250);
    timer.callback(); timers.clear();
    assert(!indicator.classes.has('visible'), 'indicator hides after scrolling stops');
    wheel(control, 0);
    assert.equal(context.volumeSlider.value, '0.8', 'horizontal-only scroll leaves volume unchanged');
    assert(!indicator.classes.has('visible'));
    context.updateVolume(1); wheel(control, -1);
    assert.equal(value.textContent, '100%', 'upper bound');
    context.updateVolume(0); wheel(control, 1);
    assert.equal(value.textContent, '0%', 'lower bound');
    assert.match(icon.innerHTML, /volume-x/);
    timers.clear();
}
for(const [volume,name] of [[.2,'volume'],[.5,'volume-1'],[.8,'volume-2']]){
    context.updateVolume(volume);wheel(element('volume-slider'),-1);
    assert.equal(icon.innerHTML, `<i data-lucide="${name}"></i>`);
}
context.isMuted=true;wheel(element('volume-slider'),-1);assert.match(icon.innerHTML,/volume-x/);
context.isMuted=false;timers.clear();context.updateVolume(.8);
vm.runInContext('adjustVolume(.05)',context);
assert.equal(value.textContent,'85%');assert(indicator.classes.has('visible'));
const keyboardTimer=[...timers.keys()][0];
vm.runInContext('adjustVolume(-.05)',context);
assert.equal(value.textContent,'80%');assert(!timers.has(keyboardTimer));assert.equal(timers.size,1);
context.updateVolume(0);vm.runInContext('adjustVolume(-.05)',context);
assert.equal(value.textContent,'0%');assert.match(icon.innerHTML,/volume-x/);
context.updateVolume(1);vm.runInContext('adjustVolume(.05)',context);assert.equal(value.textContent,'100%');
assert(updates > 0, 'lyrics controls update their playback UI immediately');
console.log('PASS: wheel volume on all six controls, step, bounds, synchronization, indicator updates and hide timer reset.');
