const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Control {
    constructor(type) {
        this.type = type; this.listeners = {}; this.classes = new Set(); this.captured = null;
        this.classList = { toggle: (key, on) => on ? this.classes.add(key) : this.classes.delete(key) };
        this.style = { setProperty(key, value) { this[key] = value; } };
        this.parentElement = { style: this.style, classList: this.classList };
    }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    getBoundingClientRect() { return { left: 100, width: 200 }; }
    focus() {}
    setPointerCapture(id) { this.captured = id; }
    hasPointerCapture(id) { return this.captured === id; }
    releasePointerCapture() { this.captured = null; }
}
const elements = Object.fromEntries(['progress-wrapper', 'mini-progress-track', 'lyrics-seek', 'progress-fill', 'mini-progress-fill'].map(id => [id, new Control(id === 'lyrics-seek' ? 'range' : '')]));
const audio = { currentTime: 0, duration: 200, getAttribute: () => 'song.mp3' };
const playingSeeks = [], smtc = [];
const c = { window: {}, document: { getElementById: id => elements[id] }, localAudioElement: audio,
    currentTrackDuration: 200, isRadioMode: false, _trackLoading: false, _loadToken: 1, isPlaying: false,
    pausedAt: 0, timeCurrent: {}, formatTime: String, updateSMTCPosition: value => smtc.push(value),
    startSourceAt: value => { playingSeeks.push(value); audio.currentTime = value; },
};
vm.createContext(c); vm.runInContext(fs.readFileSync('src/renderer/playback/seek-controls.js', 'utf8'), c);
const event = (x, overrides = {}) => ({ clientX: x, pointerId: 1, button: 0, isPrimary: true, preventDefault() {}, ...overrides });
for (const id of ['progress-wrapper', 'mini-progress-track', 'lyrics-seek']) {
    const control = elements[id];
    c.window.attachPlaybackSeek(control);
    control.listeners.pointerdown(event(150));
    assert.equal(audio.currentTime, 50, `${id}: click seeks while paused`);
    assert.equal(c.pausedAt, 50); assert.equal(smtc.at(-1), 50);
    assert.equal(control.captured, 1);
    assert(!control.classes.has('seek-dragging'), 'click retains animation');
    assert.equal(elements['progress-fill'].style.width, '25%');
    assert.equal(elements['mini-progress-fill'].style.width, '25%');
    assert.equal(elements['lyrics-seek'].value, 25, 'all players stay in sync');
    control.listeners.pointermove(event(250, { pointerId: 2 }));
    assert.equal(audio.currentTime, 50, 'unrelated pointers ignored');
    control.listeners.pointermove(event(250)); assert.equal(audio.currentTime, 150);
    assert(control.classes.has('seek-dragging'), 'drag follows the pointer without easing');
    control.listeners.pointermove(event(150)); assert.equal(audio.currentTime, 50, 'drag can return to its starting point');
    control.listeners.pointermove(event(500)); assert.equal(audio.currentTime, 200, 'capture allows dragging beyond right edge');
    control.listeners.pointerup(event(50)); assert.equal(audio.currentTime, 0, 'release clamps left edge');
    assert.equal(control.captured, null); assert(!control.classes.has('seek-dragging'));
    c.isPlaying = true;
    control.listeners.pointerdown(event(200)); assert.equal(playingSeeks.at(-1), 100);
    control.listeners.pointercancel(event(200)); assert.equal(control.captured, null);
    c.isPlaying = false;
    for (const key of ['isRadioMode', '_trackLoading']) {
        c[key] = true; control.listeners.pointerdown(event(250));
        assert.equal(control.captured, null, `${key} prevents seek`); c[key] = false;
    }
    control.listeners.pointerdown(event(200)); c._loadToken++;
    control.listeners.pointermove(event(250)); assert.equal(audio.currentTime, 100, 'track change cancels stale drag');
    assert.equal(control.captured, null);
}
elements['lyrics-seek'].value = 75; elements['lyrics-seek'].listeners.input();
assert.equal(audio.currentTime, 150, 'native range keyboard input still seeks');
console.log('PASS: seek clicks, capture, dragging in all players, synchronization, pause/play, cancellation, bounds, radio/loading guards and keyboard input.');
