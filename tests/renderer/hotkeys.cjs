const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
let played = 0, extension = 0, handler;
const context = {
    window: {}, DEFAULT_HOTKEYS: { togglePlay: 'KeyK', mute: 'KeyM' },
    appStorage: { getItem: () => '{"togglePlay":"ctrl+KeyP","addon:owner:run":"shift+KeyX"}', setItem() {} },
    document: { addEventListener: (_, value) => { handler = value; } },
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
context.window._hotkeyCaptureActive = true;
context.window.handlePlayerHotkey(key); assert.equal(played, 1); assert.equal(context.window.getPlayerHotkeyCombos().length, 0);
console.log('PASS: shared hotkeys honor custom bindings, modifiers, extensions, capture and input focus');
