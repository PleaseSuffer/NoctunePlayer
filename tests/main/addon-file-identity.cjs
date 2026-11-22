const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAddonServices } = require('../../src/main/addons/services');

(async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'noctune-file-identity-'));
    const filename = path.join(directory, 'selected.txt');
    await fs.writeFile(filename, 'old');
    const originalStat = fs.stat, originalOpen = fs.open;
    let closed = 0;
    const originalId = 9007199254740992n, replacementId = originalId + 1n;
    assert.equal(Number(originalId), Number(replacementId), 'Number loses the distinguishing bit');
    try {
        const stats = ino => ({ dev: 1n, ino, size: 3n, isFile: () => true });
        fs.stat = async (_file, options) => { assert.equal(options.bigint, true); return stats(originalId); };
        fs.open = async () => ({
            stat: async options => { assert.equal(options.bigint, true); return stats(replacementId); },
            close: async () => { closed++; },
            readFile: async () => { throw new Error('Replacement must never be read'); },
        });
        const services = createAddonServices({ directory, safeStorage: {}, store: { context: async () => ({ grants: ['files.read'], manifest: {} }) } });
        const grant = await services.grantFile('test', 'hash', filename);
        assert.equal(grant.size, 3, 'public SDK size stays serializable');
        await assert.rejects(services.invoke('test', 'hash', 'files.read', { handle: grant.handle }), /изменился/);
        assert.equal(closed, 1);
        console.log('PASS: exact 64-bit file identity rejects replacements whose IDs collide as Number.');
    } finally {
        fs.stat = originalStat; fs.open = originalOpen;
        await fs.rm(directory, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
