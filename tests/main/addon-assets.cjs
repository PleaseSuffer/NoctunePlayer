const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const p = require('../../src/main/addons/package');
const assets = require('../../src/shared/addon-assets');
const permissions = require('../../src/shared/addon-permissions');
const { createAddonStore } = require('../../src/main/addons/store');
(async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'noctune-assets-'));
    try {
        const pkg = await p.packDirectory('addons/examples/auto-appearance');
        assert.equal(pkg.files['assets/logo.png'].encoding, 'base64');
        assert.equal(assets.resource(pkg.files, pkg.manifest.icon).mime, 'image/png');
        assert.equal(assets.resource(pkg.files, pkg.manifest.icon).size, (await fs.stat('resources/app.png')).size);
        assert.equal(Buffer.from(assets.resource(pkg.files, pkg.manifest.icon).base64, 'base64').equals(await fs.readFile('resources/app.png')), true);
        const invalid = change => { const value = structuredClone(pkg); change(value); assert.throws(() => p.validatePackage(value)); };
        invalid(value => { value.manifest.icon = 'https://remote.example/icon.png'; });
        invalid(value => { value.manifest.banner = 'main.js'; });
        invalid(value => { value.files['../escape.png'] = value.files['assets/logo.png']; });
        invalid(value => { value.files['assets/logo.png'].data = '%%%%'; });
        invalid(value => { value.files['assets/logo.png'].data = 'Zh=='; }); // non-canonical trailing bits
        invalid(value => { value.files['assets/logo.png'].path = '/etc/passwd'; });
        invalid(value => { value.files['assets/logo.png'] = '<script>'; });
        invalid(value => { value.files['bad.svg'] = { encoding: 'base64', data: 'PHN2Zz4=' }; });
        invalid(value => { value.files['big.png'] = { encoding: 'base64', data: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64') }; });
        const large = structuredClone(pkg); large.files['sample.woff2'] = { encoding: 'base64', data: Buffer.alloc(2 * 1024 * 1024).toString('base64') }; p.validatePackage(large);
        const key = crypto.generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' });
        const signed = p.sign(pkg, key); signed.files['assets/logo.png'].data = Buffer.from('tampered').toString('base64'); assert.throws(() => p.validatePackage(signed));
        const store = createAddonStore({ directory, appVersion: '1.4.0' });
        const preview = await store.preparePackage(pkg); assert.equal(preview.artwork.icon, assets.url(pkg.files, pkg.manifest.icon));
        await store.confirm(preview.ticket); assert.equal((await store.list())[0].artwork.banner, preview.artwork.banner);
        let groups = permissions.grouped(['themes.*','playback.read','playback.seek']);
        assert.equal(groups.find(group => group.namespace === 'themes').full, true);
        assert.equal(groups.find(group => group.namespace === 'playback').full, false);
        assert.deepEqual(groups.find(group => group.namespace === 'playback').used, ['playback.read','playback.seek']);
        assert.equal(permissions.grouped(permissions.expand(['themes.*']))[0].full, true, 'explicit complete list counts as full');
        assert.equal(permissions.grouped(['themes.*'], ['themes.list'])[0].full, false, 'frozen grants are authoritative');
        console.log('PASS: binary packaging/MIME/roundtrip/limits, canonical base64, artwork snapshots, signed asset integrity and full/partial permission grouping.');
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
