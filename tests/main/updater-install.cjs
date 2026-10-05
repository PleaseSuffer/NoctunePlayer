const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/main/index.js', 'utf8');
const start = source.indexOf("ipcMain.handle('updater:install'");
assert(start >= 0);
const handlerSource = source.slice(start, source.indexOf('\n});', start) + 4);
let handler;
const calls = [];
const context = {
    isQuiting: false,
    ipcMain: { handle: (channel, callback) => { assert.equal(channel, 'updater:install'); handler = callback; } },
    autoUpdater: { quitAndInstall: (...args) => { assert.equal(context.isQuiting, true); calls.push(args); } },
};
vm.runInNewContext(handlerSource, context);
assert.equal(handler().ok, true);
assert.deepEqual(calls, [[true, true]], 'updates install silently and relaunch without the tray intercepting quit');
console.log('PASS: updater installation uses silent mode, forced relaunch and proper app quit state.');
