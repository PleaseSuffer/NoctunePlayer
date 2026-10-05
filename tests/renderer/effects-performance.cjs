const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const stored = {};
const listeners = {};
const frames = new Map();
let nextId = 0, resizes = 0;
const videoListeners = {};
const video = {
    src: 'file:///background.mp4', currentTime: 42, duration: 90, plays: 0, loads: 0, pauses: 0,
    getAttribute() { return this.src; }, setAttribute(_, value) { this.src = value; }, removeAttribute() { this.src = null; },
    pause() { this.pauses++; }, load() { this.loads++; }, play() { this.plays++; return Promise.resolve(); },
    addEventListener(name, callback) { videoListeners[name] = callback; }
};
const canvases = Object.fromEntries(['star-canvas', 'confetti-canvas', 'visualizer'].map(id => [id, { width: 1920, height: 1080 }]));
const document = { hidden: false, getElementById: id => id === 'custom-bg-video' ? video : canvases[id], addEventListener(name, fn) { listeners[name] = fn; } };
const window = { bgImagePath: 'background.mp4', bgImageIsVideo: true, bgImageEnabled: true };
const context = { window, document, appStorage: { getItem: key => stored[key], setItem: (key, value) => stored[key] = String(value) },
    requestAnimationFrame: fn => { frames.set(++nextId, fn); return nextId; }, cancelAnimationFrame: id => frames.delete(id),
    updateAllCanvasSizes: () => { resizes++; for (const canvas of Object.values(canvases)) { canvas.width = 1920; canvas.height = 1080; } }
};
vm.createContext(context);
const source = fs.readFileSync('src/renderer/core/effects-performance.js', 'utf8');
vm.runInContext(source, context);
function tick(time) { const batch = [...frames.values()]; frames.clear(); for (const fn of batch) fn(time); }
let count = 0;
function loop() {
    window.requestEffectsFrame(loop);
    if (window._rafSuspended) return;
    count++;
}
window.effectsPerformance.setFps(30);
window.requestEffectsFrame(loop);
for (let i = 0; i < 120; i++) tick(i * 1000 / 120);
assert.ok(count >= 29 && count <= 31, `30 FPS on 120 Hz screen: ${count}`);
count = 0; window.effectsPerformance.setFps(60);
for (let i = 120; i < 240; i++) tick(i * 1000 / 120);
assert.ok(count >= 59 && count <= 61, `60 FPS on 120 Hz screen: ${count}`);
window.effectsPerformance.setFps(0); count = 0;
for (let i = 240; i < 360; i++) tick(i * 1000 / 120);
assert.equal(count, 120);
window._rafSuspended = true;
count = 0;
for (let i = 360; i < 480; i++) tick(i * 1000 / 120);
assert.equal(count, 0, 'existing tray suspension still skips drawing');
window._rafSuspended = false;
tick(4000);
assert.equal(count, 1, 'drawing resumes with the existing tray flag');
assert.equal(video.src, 'file:///background.mp4');
assert.equal(video.currentTime, 42);
assert.equal(video.loads, 0, 'video is never reloaded by the FPS scheduler');
assert.equal(video.pauses, 0);
assert.equal(resizes, 0, 'canvas buffers stay allocated');
for (const canvas of Object.values(canvases)) assert.equal(canvas.width, 1920);
assert.equal(stored.setting_effects_fps, '0');
// Saved choices are applied on the next renderer launch.
const restored = { ...context, window: {}, requestAnimationFrame: () => 1 };
vm.createContext(restored); vm.runInContext(source, restored);
assert.equal(restored.window.effectsPerformance.fps, 0);
console.log('PASS: 30/60 FPS on 120 Hz, unlimited mode, original tray suspension, no video reload/canvas release and FPS persistence.');
