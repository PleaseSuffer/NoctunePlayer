const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { registerAddonIpc } = require('../../src/main/addons/ipc');
(async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'noctune-addon-ipc-'));
    try {
        const handlers = new Map(), contents = { mainFrame: {} }, window = { webContents: contents, isDestroyed: () => false };
        registerAddonIpc({ ipcMain: { handle: (id, callback) => handlers.set(id, callback), on: (id, callback) => handlers.set(id, callback) }, dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }, getWindow: () => window, directory, appVersion: '1.4.0' });
        for (const handler of handlers.values()) {
            await assert.rejects(async () => handler({ sender: {}, senderFrame: contents.mainFrame }), /Недоступно/);
            await assert.rejects(async () => handler({ sender: contents, senderFrame: {} }), /Недоступно/);
        }
        const event = { sender: contents, senderFrame: contents.mainFrame };
        assert.deepEqual(await handlers.get('addons:list')(event), []);
        assert.equal(await handlers.get('addons:prepare-file')(event), null);
        window.isDestroyed = () => true;
        assert.throws(() => handlers.get('addons:list')(event), /Недоступно/);
        console.log('PASS: all addon IPC endpoints reject foreign windows, subframes and destroyed windows; canceled install has no side effects.');
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
