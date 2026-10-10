const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const saved = new Map();
function createRenderer() {
    const elements = new Map(), events = {}, toasts = [];
    let downloads = 0, installs = 0;
    const updater = {
        check: async () => { events.onAvailable({ version: '1.4.0', silent: false }); return { ok: true }; },
        download: () => { downloads++; }, install: () => { installs++; },
    };
    for (const name of ['onChecking', 'onNotAvailable', 'onUnavailable', 'onError', 'onAvailable', 'onProgress', 'onDownloaded']) {
        updater[name] = callback => { events[name] = callback; };
    }
    vm.runInNewContext(fs.readFileSync('src/renderer/updates/updater.js', 'utf8'), {
        document: { getElementById(id) {
            if (!elements.has(id)) elements.set(id, {
                style: {}, addEventListener(name, callback) { this[name] = callback; }, querySelector() { return null; },
            });
            return elements.get(id);
        } },
        appStorage: { getItem: key => saved.get(key) ?? '0', setItem: (key, value) => saved.set(key, value) },
        noctune: { updater }, showNotification: (...args) => toasts.push(args),
        setInterval() {}, clearInterval() {}, setTimeout() {},
    });
    return { elements, events, toasts, get downloads() { return downloads; }, get installs() { return installs; } };
}
(async () => {
    let renderer = createRenderer();
    renderer.events.onAvailable({ version: '1.4.0', silent: true });
    assert.equal(renderer.toasts.length, 1);
    renderer.toasts[0][4].actions.find(action => action.label === 'Пропустить версию').onClick();
    assert.deepEqual(JSON.parse(saved.get('setting_skipped_update_versions')), ['1.4.0']);
    assert.equal(renderer.elements.get('btn-update-action').style.display, 'none');
    renderer.events.onAvailable({ version: '1.4.0', silent: true });
    assert.equal(renderer.toasts.length, 1);
    renderer = createRenderer();
    renderer.elements.get('setting-auto-download-updates').checked = true;
    renderer.events.onAvailable({ version: '1.4.0', silent: true });
    assert.equal(renderer.downloads, 0);
    assert.equal(renderer.toasts.length, 0);
    await renderer.elements.get('btn-check-updates').click();
    assert.equal(renderer.downloads, 1, 'manual check may download an ignored version');
    renderer = createRenderer();
    await renderer.elements.get('btn-check-updates').click();
    assert.equal(renderer.toasts.length, 1);
    renderer.toasts[0][4].actions.find(action => action.label === 'Скачать').onClick();
    assert.equal(renderer.downloads, 1);
    renderer.events.onDownloaded({ version: '1.4.0' });
    renderer.elements.get('btn-update-action').onclick();
    assert.equal(renderer.installs, 1);
    renderer.events.onAvailable({ version: '1.4.0', silent: true });
    assert.equal(renderer.elements.get('btn-update-action').style.display, 'none');
    await renderer.elements.get('btn-check-updates').click();
    assert.equal(renderer.elements.get('btn-update-action').textContent, 'Установить и перезапустить');
    renderer = createRenderer();
    renderer.events.onAvailable({ version: '1.5.0', silent: true });
    assert.equal(renderer.toasts.length, 1, 'the next release is still offered');
    saved.set('setting_skipped_update_versions', '{broken');
    renderer = createRenderer();
    renderer.events.onAvailable({ version: '1.4.0', silent: true });
    assert.equal(renderer.toasts.length, 1, 'corrupt settings do not break update checks');
    console.log('PASS: skip persists across restarts, suppresses automatic downloads/toasts, and permits manual installation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
