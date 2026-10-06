const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const elements = new Map();
const events = {};
const toasts = [];
let response = { ok: true, status: 'unavailable', reason: 'development' };
const updater = { check: async () => response };
for (const name of ['onChecking', 'onNotAvailable', 'onUnavailable', 'onError', 'onAvailable', 'onProgress', 'onDownloaded']) {
    updater[name] = callback => { events[name] = callback; };
}
const context = {
    document: { getElementById(id) {
        if (!elements.has(id)) elements.set(id, {
            style: {}, addEventListener(name, callback) { this[name] = callback; }, querySelector() { return null; },
        });
        return elements.get(id);
    } },
    appStorage: { getItem: () => '0', setItem() {} },
    noctune: { updater }, showNotification: (...args) => toasts.push(args),
    setInterval() {}, clearInterval() {}, setTimeout() {},
};
vm.runInNewContext(fs.readFileSync('src/renderer/updates/updater.js', 'utf8'), context);
(async () => {
    const button = elements.get('btn-check-updates');
    const status = elements.get('update-status-msg');
    await button.click();
    assert.equal(status.textContent, 'Автообновление недоступно при запуске из исходников.');
    assert.equal(button.disabled, false);
    assert.equal(toasts.length, 0, 'unavailable updater is an informational state');
    events.onChecking();
    events.onUnavailable({ reason: 'installation' });
    assert.equal(status.textContent, 'Автообновление недоступно для этого способа установки.');
    assert.equal(elements.get('btn-update-action').style.display, 'none');
    const details = 'Cannot find latest-linux.yml in the latest release artifacts\n' + 'details'.repeat(1000);
    response = { ok: false, error: details };
    updater.check = async () => { events.onError(details); return response; };
    await button.click();
    assert.equal(status.textContent, 'Автообновление для этой платформы пока недоступно.');
    assert.equal(toasts.length, 1, 'IPC and error event produce one toast');
    assert.equal(toasts[0][3], details, 'diagnostics remain available for copying');
    updater.check = async () => { events.onNotAvailable(); return { ok: true }; };
    await button.click();
    assert.equal(status.textContent, 'У вас установлена самая свежая версия.');
    assert.equal(button.disabled, false);
    console.log('PASS: manual/background skipped checks leave loading state; concise metadata errors and normal results remain supported.');
})().catch(error => { console.error(error); process.exitCode = 1; });
