const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { createAddonInstaller } = require('../../src/main/addons/installer');
const { createAddonStore } = require('../../src/main/addons/store');
const { packDirectory } = require('../../src/main/addons/package');
(async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'noctune-addon-installer-'));
    try {
        const handlers = new Map(), windows = [];
        class Window extends EventEmitter {
            constructor(options) {
                super(); this.options = options;
                this.webContents = new EventEmitter(); this.webContents.mainFrame = {};
                this.webContents.setWindowOpenHandler = callback => { this.openHandler = callback; };
                windows.push(this);
            }
            setMenu() {} show() {} focus() {}
            loadFile(file) { this.file = file; return Promise.resolve(); }
            destroy() { this.emit('closed'); }
            close() { let prevented = false; this.emit('close', { preventDefault() { prevented = true; } }); if (!prevented) this.destroy(); }
        }
        const store = createAddonStore({ directory, appVersion: '1.4.0' });
        const installer = createAddonInstaller({ BrowserWindow: Window, ipcMain: { handle: (id, handler) => handlers.set(id, handler), on: (id, handler) => handlers.set(id, handler) }, store });
        const pkg = await packDirectory('addons/examples/track-info');
        let candidate = await store.preparePackage(pkg);
        let task = installer.open(candidate.ticket), window = windows.at(-1);
        const event = () => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
        assert.equal(window.options.parent, undefined); assert.equal(window.options.modal, undefined);
        assert.equal(window.options.webPreferences.sandbox, true);
        assert.equal(window.options.webPreferences.contextIsolation, true);
        assert.equal(window.options.webPreferences.nodeIntegration, false);
        assert.equal(installer.open(candidate.ticket), task, 'duplicate request focuses the existing installer');
        assert.equal(windows.length, 1);
        assert.equal(handlers.get('addon-install:details')(event()).name, pkg.manifest.name);
        await assert.rejects(async () => handlers.get('addon-install:confirm')({ sender: {}, senderFrame: window.webContents.mainFrame }), /Недоступно/);
        assert.throws(() => handlers.get('addon-install:details')({ ...event(), senderFrame: {} }), /Недоступно/);
        assert.deepEqual(window.openHandler({ url: 'https://example.com/' }), { action: 'deny' });
        assert.equal((await store.list()).length, 0);
        handlers.get('addon-install:cancel')(event()); assert.equal(await task, null);
        assert.throws(() => store.preview(candidate.ticket), /истекло/);
        assert.throws(() => handlers.get('addon-install:details')(event()), /Недоступно/);
        candidate = await store.preparePackage(pkg);
        task = installer.open(candidate.ticket); window = windows.at(-1);
        pkg.manifest.name = 'Changed after preview'; pkg.files['main.js'] = 'invalid code';
        assert.equal((await handlers.get('addon-install:confirm')(event())).ok, true);
        assert.equal((await task).name, 'Информация о треке', 'installs only the snapshot approved in the installer');
        assert.equal((await store.list())[0].enabled, false);
        candidate = await store.preparePackage(await packDirectory('addons/examples/track-info'));
        task = installer.open(candidate.ticket); window = windows.at(-1);
        assert.equal(handlers.get('addon-install:details')(event()).state, 'installed');
        assert.equal((await handlers.get('addon-install:confirm')(event())).installed, true);
        handlers.get('addon-install:cancel')(event()); await task;
        assert.throws(() => installer.open('unknown-ticket'), /истекло/);
        console.log('PASS: separate sandboxed addon installer, duplicate focus, main-frame-only IPC, cancellation, immutable preview and already-installed state.');
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
