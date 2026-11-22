const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { installI18n } = require('../../src/main/i18n');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'noctune-i18n-'));
const handles = {}, events = {}, saved = [], broadcasts = [];
const main = { isDestroyed: () => false, webContents: { mainFrame: {}, send: (...args) => broadcasts.push(args) } };
const dialog = { isDestroyed: () => false, webContents: { mainFrame: {}, send: (...args) => broadcasts.push(args) } };
const event = window => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
let failSave = false;
const i18n = installI18n({ app: { getPath: () => directory },
    ipcMain: { handle: (name, fn) => { handles[name] = fn; }, on: (name, fn) => { events[name] = fn; } },
    BrowserWindow: { fromWebContents: contents => [main, dialog].find(w => w.webContents === contents), getAllWindows: () => [main, dialog] },
    getMainWindow: () => main, getStore: async () => ({ set(value) { if (failSave) throw new Error('Disk failure'); saved.push(value); } }),
});
(async () => {
    const initial = event(dialog); events['i18n:initial'](initial); assert.equal(initial.returnValue.locale, 'ru');
    const frame = { sender: main.webContents, senderFrame: {} };
    events['i18n:initial'](frame); assert.equal(frame.returnValue, null, 'subframe receives no privileged snapshot');
    await assert.rejects(handles['i18n:set'](frame, { locale: 'en' }));
    await assert.rejects(handles['i18n:set'](event(dialog), { locale: 'en' }));
    assert.equal(saved.length, 0);
    await handles['i18n:set'](event(main), { locale: 'en' });
    assert.equal(i18n.locale, 'en'); assert.deepEqual(saved[0], { language: 'en', languagePack: null });
    assert.equal(broadcasts.length, 2, 'every app window is notified');
    failSave = true;
    await assert.rejects(handles['i18n:set'](event(main), { locale: 'ru' }), /Disk failure/);
    assert.equal(i18n.locale, 'en', 'failed persistence restores active locale');
    assert.equal(broadcasts.length, 2, 'failed persistence never reloads windows');
    failSave = false;
    await assert.rejects(handles['i18n:set'](event(main), { locale: 'en-GB', pack: { locale: 'ru', name: 'Bad', messages: {} } }));
    i18n.setLocale('ru');
    console.log('PASS: locale IPC sender isolation, safe synchronous snapshot, atomic preference update, rollback and all-window notification.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(directory, { recursive: true, force: true }));
