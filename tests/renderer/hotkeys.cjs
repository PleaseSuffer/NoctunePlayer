const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
let played = 0, extension = 0, queueToggles = 0, handler;
const context = {
    window: {}, DEFAULT_HOTKEYS: { togglePlay: 'KeyK', mute: 'KeyM', toggleQueue: 'KeyQ' },
    appStorage: { getItem: () => '{"togglePlay":"ctrl+KeyP","addon:owner:run":"shift+KeyX"}', setItem() {} },
    document: { addEventListener: (_, value) => { handler = value; }, getElementById: id => id === 'btn-queue' ? { click: () => queueToggles++ } : null },
    togglePlayback: () => played++, toggleMute() {},
};
context.window.addonContributions = { hotkeys: () => [{ id: 'addon:owner:run' }] };
context.window.addonHost = { command: () => { extension++; return Promise.resolve(); } };
vm.runInNewContext(fs.readFileSync('src/renderer/ui/hotkeys.js', 'utf8'), context);
let prevented = 0;
const key = { code: 'KeyP', ctrlKey: true, preventDefault: () => prevented++ };
handler({ ...key, target: { tagName: 'INPUT' } }); assert.equal(played, 0);
context.window.handlePlayerHotkey(key); assert.equal(played, 1); assert.equal(prevented, 1);
context.window.handlePlayerHotkey({ code: 'KeyK', preventDefault() {} }); assert.equal(played, 1);
context.window.handlePlayerHotkey({ code: 'KeyX', shiftKey: true, preventDefault() {} }); assert.equal(extension, 1);
assert(context.window.getPlayerHotkeyCombos().includes('ctrl+KeyP'));
const queueKey = { code: 'KeyQ', key: 'й', preventDefault() {} };
context.window.handlePlayerHotkey(queueKey); assert.equal(queueToggles, 1, 'queue shortcut works with a Russian layout');
context.window.handlePlayerHotkey({ ...queueKey, target: { tagName: 'INPUT' } }); assert.equal(queueToggles, 1, 'typing does not toggle queue');
context.window.hotkeyBindings.toggleQueue = 'ctrl+shift+KeyQ';
context.window.handlePlayerHotkey(queueKey); assert.equal(queueToggles, 1, 'old binding is inactive after customization');
context.window.handlePlayerHotkey({ ...queueKey, ctrlKey: true, shiftKey: true }); assert.equal(queueToggles, 2);
assert(context.window.getPlayerHotkeyCombos().includes('ctrl+shift+KeyQ'));
context.window._hotkeyCaptureActive = true;
context.window.handlePlayerHotkey({ ...queueKey, ctrlKey: true, shiftKey: true }); assert.equal(queueToggles, 2, 'capturing a shortcut does not toggle queue');
context.window.handlePlayerHotkey(key); assert.equal(played, 1); assert.equal(context.window.getPlayerHotkeyCombos().length, 0);
console.log('PASS: shared hotkeys honor custom bindings, modifiers, extensions, capture and input focus');
