const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const p = require('../../src/main/addons/package');
const { httpsUrl, publicAddress } = require('../../src/main/addons/network');
const clone = value => JSON.parse(JSON.stringify(value));
(async () => {
    const pkg = await p.packDirectory('addons/examples/track-info');
    assert.equal(pkg.manifest.id, 'track-info-demo');
    assert.equal(p.compatible(pkg.manifest, '1.4.0'), true);
    assert.equal(p.compatible(pkg.manifest, '1.2.0'), false);
    for (const change of [
        value => { value.manifest.apiVersion = 2; },
        value => { value.manifest.permissions.push('filesystem'); },
        value => { value.files['../escape.js'] = ''; },
        value => { value.manifest.entry = 'missing.js'; },
        value => { value.manifest.id = 'constructor'; },
        value => { value.manifest.revision = 1.5; },
        value => { value.manifest.commands.push(value.manifest.commands[0]); },
        value => { value.manifest.permissions.push('network.request'); value.manifest.network = { origins: ['https://example.com/path'] }; },
        value => { value.manifest.minNoctuneVersion = 'unknown'; },
        value => { value.files['main.js'] = 'x'.repeat(512 * 1024 + 1); },
    ]) { const value = clone(pkg); change(value); assert.throws(() => p.validatePackage(value)); }
    const key = crypto.generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' });
    const signed = p.sign(pkg, key);
    assert.equal(p.signingIdentity(signed, true).length, 64);
    assert.equal(p.signingIdentity(JSON.parse(p.canonical(signed)), true), p.signingIdentity(signed));
    const tampered = clone(signed); tampered.files['main.js'] += '\n// changed';
    assert.throws(() => p.validatePackage(tampered));
    assert.throws(() => p.signingIdentity(pkg, true));
    for (const url of ['http://example.com', 'https://user:pass@example.com', 'https://example.com:8443', 'https://example.com/#token']) assert.throws(() => httpsUrl(url));
    for (const address of ['127.0.0.1','0.0.0.0','10.0.0.1','100.100.100.200','169.254.169.254','192.168.1.1','224.0.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1']) assert.equal(publicAddress(address), false, address);
    assert.equal(publicAddress('1.1.1.1'), true);
    assert.equal(publicAddress('2606:4700:4700::1111'), true);
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'noctune-addon-packing-'));
    try {
        await fs.writeFile(path.join(temp, 'manifest.json'), JSON.stringify(pkg.manifest));
        await fs.symlink(path.resolve('addons/examples/track-info/main.js'), path.join(temp, 'main.js'));
        await assert.rejects(p.packDirectory(temp));
    } finally { await fs.rm(temp, { recursive: true, force: true }); }
    console.log('PASS: addon manifest/permissions/paths/compatibility, Ed25519 integrity, bounded files and public HTTPS validation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
