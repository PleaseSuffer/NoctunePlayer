const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createAddonServices } = require('../../src/main/addons/services');
const { expand } = require('../../src/shared/addon-permissions');
(async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'noctune-services-'));
    try {
        const filename = path.join(directory, 'chosen.txt'); await fs.writeFile(filename, 'original');
        const grants = expand(['files.*','clipboard.*','system.*','network.*']);
        let enabled = true, copied = '', opened = '';
        const store = { async context(id, hash, permission) { if (!enabled || id !== 'test-addon' || hash !== 'active' || permission && !grants.includes(permission)) throw new Error('Denied'); return { manifest: { name: 'Test', network: { origins: ['https://example.com'] } }, grants }; } };
        const service = createAddonServices({ store, directory, safeStorage: { isEncryptionAvailable: () => false }, getWindow: () => null,
            dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [filename] }), showSaveDialog: async () => ({ canceled: false, filePath: filename }) },
            clipboard: { readText: () => copied, writeText: text => { copied = text; } },
            shell: { openExternal: async url => { opened = url; }, openPath: async value => { opened = value; return ''; }, showItemInFolder: value => { opened = value; } },
        });
        const invoke = (method, args = {}) => service.invoke('test-addon', 'active', method, args);
        const chosen = await invoke('files.select'); assert.equal(chosen.name, 'chosen.txt'); assert.equal(chosen.path, undefined);
        assert.equal((await invoke('files.read', { handle: chosen.handle })).data, 'original');
        await assert.rejects(invoke('files.write', { handle: chosen.handle, data: 'denied' }));
        await assert.rejects(invoke('files.read', { handle: filename }));
        const saved = await invoke('files.save'); await invoke('files.write', { handle: saved.handle, data: 'new' });
        assert.equal(await fs.readFile(filename, 'utf8'), 'new');
        await invoke('system.openFile', { handle: chosen.handle }); assert.equal(opened, filename);
        await invoke('clipboard.write', { text: 'copied' }); assert.equal(await invoke('clipboard.read'), 'copied');
        await assert.rejects(invoke('clipboard.write', { text: 'x'.repeat(65537) }));
        await assert.rejects(invoke('system.openExternal', { url: 'file:///tmp/a' }));
        await invoke('system.openExternal', { url: 'https://example.com/path' }); assert.equal(opened, 'https://example.com/path');
        await assert.rejects(invoke('network.request', { url: 'https://example.com/path', headers: { Authorization: 'spoofed' } }));
        await assert.rejects(invoke('network.request', { url: 'https://evil.example/path' }));
        await fs.rename(filename, filename + '.old'); await fs.symlink(filename + '.old', filename);
        // POSIX rejects the link itself. Windows has no O_NOFOLLOW; the
        // descriptor identity still limits access to the originally granted file.
        if (constants.O_NOFOLLOW) await assert.rejects(invoke('files.read', { handle: chosen.handle }), /ELOOP|изменился/);
        else assert.equal((await invoke('files.read', { handle: chosen.handle })).data, 'new');
        const other = path.join(directory, 'not-selected.txt');
        await fs.writeFile(other, 'not authorized');
        await fs.unlink(filename); await fs.symlink(other, filename);
        for (const [method, args] of [
            ['files.read', { handle: chosen.handle }],
            ['files.write', { handle: saved.handle, data: 'must not be written' }],
            ['files.reveal', { handle: chosen.handle }],
            ['system.openFile', { handle: chosen.handle }],
        ]) await assert.rejects(invoke(method, args), /ELOOP|изменился/, method + ' rejects a link to an unselected file');
        assert.equal(await fs.readFile(other, 'utf8'), 'not authorized');
        assert.equal(opened, 'https://example.com/path', 'rejected shell actions never reach the shell');
        await fs.unlink(filename); await fs.writeFile(filename, 'replacement');
        await assert.rejects(invoke('files.read', { handle: chosen.handle }), /изменился/, 'regular file replacement also invalidates the grant');
        await assert.rejects(invoke('files.write', { handle: saved.handle, data: 'must not be written' }), /изменился/);
        assert.equal(await fs.readFile(filename, 'utf8'), 'replacement');
        service.cancel('test-addon'); await assert.rejects(invoke('files.read', { handle: chosen.handle }));
        enabled = false; await assert.rejects(invoke('clipboard.read'));
        console.log('PASS: user-selected opaque file handles, separate write grants, platform-aware same-file links, rejection of foreign symlink/regular-file replacements for reads/writes/shell actions, cleanup, clipboard bounds, HTTPS opening and forbidden headers.');
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
