const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const source = fs.readFileSync('src/main/index.js', 'utf8');
const start = source.indexOf('autoUpdater.autoDownload = false;');
const end = source.indexOf("ipcMain.handle('updater:download'", start);
const settings = new Map([['setting_skipped_update_versions', '["1.4.0"]'], ['setting_auto_download_updates', '1']]);
const events = [], notifications = [];
const updater = new EventEmitter();
let version = '1.4.0', handler;
updater.checkForUpdates = async () => {
    updater.emit('checking-for-update');
    updater.emit('update-available', { version });
    return { updateInfo: { version } };
};
class Notification {
    static isSupported() { return true; }
    constructor(options) { this.options = options; }
    on() {}
    show() { notifications.push(this.options); }
}
vm.runInNewContext(source.slice(start, end), {
    autoUpdater: updater, store: { get: key => settings.get(key) }, Notification,
    win: { isDestroyed: () => false, webContents: { send: (...args) => events.push(args) } },
    app: { isPackaged: true }, iconPath: 'icon',
    ipcMain: { handle: (_channel, callback) => { handler = callback; } },
});
(async () => {
    await handler(null, true);
    assert.equal(events.at(-1)[1].skipped, true);
    assert.equal(notifications.length, 0);
    assert.equal(updater.autoDownload, false, 'renderer filters before downloading');
    await handler(null, false);
    assert.equal(events.at(-1)[1].skipped, false);
    assert.equal(events.at(-1)[1].silent, false);
    version = '1.5.0';
    await handler(null, true);
    assert.equal(events.at(-1)[1].skipped, false);
    assert.equal(notifications.length, 1);
    assert.equal(updater.listenerCount('update-available'), 1);
    version = '1.4.0';
    let finishCheck;
    const pending = new Promise(resolve => { finishCheck = resolve; });
    updater.checkForUpdates = () => pending;
    const backgroundCheck = handler(null, true);
    const manualCheck = handler(null, false);
    updater.emit('update-available', { version });
    assert.equal(events.at(-1)[1].silent, false, 'manual check takes priority over a concurrent background check');
    assert.equal(events.at(-1)[1].skipped, false);
    finishCheck({ updateInfo: { version } });
    await Promise.all([backgroundCheck, manualCheck]);
    updater.emit('update-available', { version });
    assert.equal(events.at(-1)[1].silent, false, 'completed checks leave no stale background context');
    console.log('PASS: native notifications respect skips; manual checks and newer releases remain available.');
})().catch(error => { console.error(error); process.exitCode = 1; });
