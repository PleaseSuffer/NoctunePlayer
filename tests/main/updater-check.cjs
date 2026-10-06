const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/main/index.js', 'utf8');
const start = source.indexOf("ipcMain.handle('updater:check'");
assert(start >= 0);
const handlerSource = source.slice(start, source.indexOf('\n});', start) + 4);
let handler;
let checkResult = null;
let checkError = null;
const sent = [];
const context = {
    app: { isPackaged: false },
    store: { get: () => '0' },
    Notification: { isSupported: () => false },
    sendToRenderer: (...args) => sent.push(args),
    ipcMain: { handle: (channel, callback) => { assert.equal(channel, 'updater:check'); handler = callback; } },
    autoUpdater: {
        checkForUpdates: async () => { if (checkError) throw checkError; return checkResult; },
    },
};
vm.runInNewContext(handlerSource, context);
(async () => {
    for (const silent of [false, true]) {
        sent.length = 0;
        const result = await handler(null, silent);
        assert.equal(result.ok, true);
        assert.equal(result.status, 'unavailable');
        assert.equal(result.reason, 'development');
        assert.equal(sent[0][0], 'updater:unavailable', 'skipped checks complete in the renderer even in the background');
    }
    context.app.isPackaged = true;
    assert.equal((await handler(null, false)).reason, 'installation');
    sent.length = 0;
    checkResult = { updateInfo: { version: '1.4.0' } };
    const supported = await handler(null, false);
    assert.equal(supported.ok, true);
    assert.equal(supported.status, undefined, 'supported Linux builds keep the normal update path');
    assert.equal(sent.length, 0, 'normal updater events remain responsible for supported checks');
    checkError = new Error('Cannot find latest-linux.yml in the latest release artifacts');
    const failed = await handler(null, false);
    assert.equal(failed.ok, false);
    assert.equal(failed.error, checkError.message);
    assert.equal(sent[0][0], 'updater:error');
    console.log('PASS: skipped development/installation checks complete explicitly; future updates and metadata errors retain their normal paths.');
})().catch(error => { console.error(error); process.exitCode = 1; });
