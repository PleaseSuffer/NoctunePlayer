const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { expand } = require('../../src/shared/addon-permissions');
const settings = require('../../src/shared/addon-settings');
const { createVault } = require('../../src/main/addons/vault');
const { createOAuth } = require('../../src/main/addons/oauth');
const { createAddonStore } = require('../../src/main/addons/store');
const p = require('../../src/main/addons/package');
(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'noctune-sdk-'));
    try {
        assert(expand(['themes.*']).includes('themes.switch'));
        assert(!expand(['themes.apply']).includes('themes.switch'));
        const schema = { enabled: { type: 'toggle', label: 'Enable', default: true }, amount: { type: 'slider', label: 'Amount', min: 0, max: 1, step: .1, default: .5 }, style: { type: 'select', label: 'Style', options: [{ value: 'a', label: 'A' }], default: 'a' } };
        settings.validate(schema); assert.equal(settings.normalize(schema, { amount: .37 }).amount, .4);
        assert.throws(() => settings.normalize(schema, { enabled: 'true' }));
        assert.throws(() => settings.normalize(schema, { style: 'unknown' }));
        const pkg = await p.packDirectory('addons/examples/track-info');
        pkg.manifest.apiVersion = 1; pkg.manifest.settings = schema; pkg.manifest.permissions = ['storage.read','settings.*','themes.*'];
        p.validatePackage(pkg);
        const store = createAddonStore({ directory: root, appVersion: '1.4.0' });
        await store.confirm((await store.preparePackage(pkg)).ticket); await store.setEnabled(pkg.manifest.id, true);
        let runtime = (await store.runtime())[0];
        assert.deepEqual(runtime.grants, expand(pkg.manifest.permissions));
        await assert.rejects(store.invoke(pkg.manifest.id, runtime.digest, 'storage.set', { key: 'probe', value: true }));
        assert.equal((await store.settings(pkg.manifest.id)).amount, .5);
        await store.setSettings(pkg.manifest.id, { enabled: false, amount: .2, style: 'a' });
        assert.equal((await store.settings(pkg.manifest.id)).enabled, false);
        const storageFixture = await p.packDirectory('addons/examples/track-info'); storageFixture.manifest.id = 'json-storage-test';
        await store.confirm((await store.preparePackage(storageFixture)).ticket); await store.setEnabled(storageFixture.manifest.id, true);
        const jsonRuntime = (await store.runtime()).find(item => item.manifest.id === storageFixture.manifest.id);
        await store.invoke(storageFixture.manifest.id, jsonRuntime.digest, 'storage.set', { key: 'json', value: { good: true, omitted: undefined, array: [undefined, 1] } });
        assert.deepEqual(await store.invoke(storageFixture.manifest.id, jsonRuntime.digest, 'storage.get', { key: 'json' }), { good: true, array: [null, 1] });
        const update = structuredClone(pkg); update.manifest.revision++; update.manifest.version = '1.1.0'; update.manifest.permissions.push('playback.seek');
        const preview = await store.preparePackage(update); assert.deepEqual(preview.addedPermissions, ['playback.seek']);
        await store.confirm(preview.ticket); await store.rollback(pkg.manifest.id);
        assert(!(await store.runtime())[0].grants.includes('playback.seek'));
        // Test encryption contract using AES-GCM, without depending on the test machine's keyring.
        const aesKey = crypto.randomBytes(32);
        const safeStorage = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'test-keyring', encryptString(value) { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv); const data = Buffer.concat([cipher.update(value), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), data]); }, decryptString(value) { const cipher = crypto.createDecipheriv('aes-256-gcm', aesKey, value.subarray(0, 12)); cipher.setAuthTag(value.subarray(12, 28)); return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString(); } };
        const vault = createVault({ directory: root, safeStorage });
        await Promise.all([vault.set('test-addon', 'user:first', 'secret-first'), vault.set('test-addon', 'user:second', 'secret-second')]);
        assert.equal(await vault.get('test-addon', 'user:first'), 'secret-first');
        assert.equal((await fs.readFile(path.join(root, 'secrets/test-addon.enc'))).includes(Buffer.from('secret-first')), false);
        assert.equal(createVault({ directory: root, safeStorage: { ...safeStorage, getSelectedStorageBackend: () => 'basic_text' } }).available(), false);
        let authUrl, exchanges = 0;
        const config = { name: 'Test', flow: 'authorization_code', clientId: 'public-client', authorizationUrl: 'https://accounts.example/authorize', tokenUrl: 'https://accounts.example/token', scopes: ['music:read'], resourceOrigins: ['https://api.example'] };
        const request = url => new Promise((resolve, reject) => { http.get(url, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); }).on('error', reject); });
        const oauth = createOAuth({ vault, approve: async () => true, assertActive: async () => {}, openExternal: async url => {
            authUrl = new URL(url); assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
            const redirect = new URL(authUrl.searchParams.get('redirect_uri')); assert.equal(redirect.hostname, '127.0.0.1');
            redirect.searchParams.set('state', 'wrong'); redirect.searchParams.set('code', 'wrong'); assert.equal(await request(redirect), 400);
            redirect.searchParams.set('state', authUrl.searchParams.get('state')); redirect.searchParams.set('code', 'test-code'); assert.equal(await request(redirect), 200);
        }, fetch: async (url, options) => {
            exchanges++; const body = new URLSearchParams(options.body);
            if (body.get('grant_type') === 'authorization_code') { assert.equal(body.get('code'), 'test-code'); assert.equal(crypto.createHash('sha256').update(body.get('code_verifier')).digest('base64url'), authUrl.searchParams.get('code_challenge')); }
            else { assert.equal(body.get('refresh_token'), 'refresh-secret'); await new Promise(resolve => setTimeout(resolve, 5)); }
            return { status: 200, body: JSON.stringify({ access_token: 'access-secret-' + exchanges, refresh_token: 'refresh-secret', expires_in: exchanges === 1 ? 1 : 3600, token_type: 'Bearer' }) };
        } });
        await oauth.authorize('test-addon', 'hash', 'test-provider', config, 'Test');
        const status = await oauth.status('test-addon', 'test-provider', config); assert.equal(status.connected, true); assert.equal(status.access, undefined);
        const tokens = await Promise.all([oauth.token('test-addon', 'hash', 'test-provider', config), oauth.token('test-addon', 'hash', 'test-provider', config)]);
        assert.equal(tokens[0], tokens[1]); assert.equal(exchanges, 2, 'refresh is coalesced');
        assert.equal((await oauth.status('test-addon', 'test-provider', { ...config, scopes: ['different'] })).connected, false);
        await oauth.disconnect('test-addon', 'test-provider'); assert.equal((await oauth.status('test-addon', 'test-provider', config)).connected, false);
        console.log('PASS: SDK 1 settings, granular/frozen grants, rollback, encrypted vault, plaintext-backend rejection, OAuth PKCE/state, token isolation and coalesced refresh.');
    } finally { await fs.rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
