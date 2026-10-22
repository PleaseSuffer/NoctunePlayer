const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const p = require('../../src/main/addons/package');
const { createAddonStore } = require('../../src/main/addons/store');
const { createAddonCatalog, validateCatalog, CATALOG_FIELDS, CATALOG_URL } = require('../../src/main/addons/catalog');
const clone = value => JSON.parse(JSON.stringify(value));
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
(async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(),'noctune-catalog-'));
    try {
        const key = crypto.generateKeyPairSync('ed25519').privateKey.export({ type:'pkcs8',format:'pem' });
        const pkg = p.sign(await p.packDirectory('addons/examples/track-info'),key), bytes = p.canonical(pkg);
        const identity = p.signingIdentity(pkg,true), trustedPublisher = value => value === identity ? 'Noctune' : null;
        const metadata = Object.fromEntries(CATALOG_FIELDS.filter(field => pkg.manifest[field] !== undefined).map(field => [field,pkg.manifest[field]]));
        const packageUrl = 'https://github.com/PleaseSuffer/NoctunePlayer/releases/download/addon-test/track-info.noctaddon';
        const entry = { ...metadata,publisher:identity,sha256:digest(bytes),published:true,packageUrl,artwork:{} };
        const sign = value => p.sign(value,key);
        const builtin = sign({ format:'noctune-addon-catalog',formatVersion:1,channel:'official',revision:1,generatedAt:new Date().toISOString(),entries:[entry] });
        assert.equal(validateCatalog(require('../../addons/catalog/official.json')).channel,'official');
        assert.throws(() => validateCatalog(builtin),/доверенным/);
        for (const mutation of [
            value => { value.entries.push(clone(value.entries[0])); },
            value => { value.entries[0].publisher = 'a'.repeat(64); },
            value => { value.entries[0].packageUrl = 'https://127.0.0.1/test.noctaddon'; },
            value => { value.entries[0].packageUrl = 'https://github.com/Other/Repo/releases/download/one/test.noctaddon'; },
            value => { value.entries[0].maxNoctuneVersion = '1.0.0'; },
            value => { value.entries[0].artwork.icon = {mime:'image/svg+xml',data:'PHN2Zz4='}; },
            value => { value.entries[0].artwork.icon = {mime:'image/png',data:'PHN2Zz4='}; },
            value => { value.entries[0].permissions = ['unknown.permission']; },
            value => { value.entries[0].published = 'true'; },
            value => { value.channel = 'community'; },
        ]) { const changed = clone(builtin); mutation(changed); assert.throws(() => validateCatalog(sign(changed),trustedPublisher)); }
        const tampered = clone(builtin); tampered.entries[0].name += '!'; assert.throws(() => validateCatalog(tampered,trustedPublisher));
        const store = createAddonStore({directory,appVersion:'1.4.0'});
        let remote = sign({...builtin,revision:2}), body = bytes, calls = 0;
        const fetch = async (url,options) => { assert(options.limit > 0); if (url === CATALOG_URL) { calls++; return p.canonical(remote); } assert.equal(url,packageUrl); return body; };
        const options = {directory,appVersion:'1.4.0',store,builtin,trustedPublisher,fetch};
        const catalog = createAddonCatalog(options);
        assert.equal((await catalog.list()).source,'builtin');
        const results = await Promise.all([catalog.list(true),catalog.list(true)]);
        assert.equal(calls,1,'concurrent refresh is coalesced'); assert.equal(results[0].catalogRevision,2);
        assert.equal(results[1].source,'network');
        assert.equal((await createAddonCatalog(options).list()).source,'cache');
        assert.equal((await store.list()).length,0,'catalog download does not install anything');
        const candidate = await catalog.prepare(entry.id);
        assert.equal(candidate.source,'catalog'); assert.equal(candidate.state,'install');
        assert.equal((await store.list()).length,0,'package download still requires consent');
        await store.confirm(candidate.ticket);
        const installed = (await catalog.list()).entries[0]; assert.equal(installed.state,'installed'); assert.equal(installed.enabled,false);
        remote = builtin;
        const rollback = await createAddonCatalog(options).list(true);
        assert.equal(rollback.catalogRevision,2); assert(rollback.message.includes('сохранённая'));
        body += ' ';
        await assert.rejects(catalog.prepare(entry.id),/Контрольная сумма/);
        const newer = { ...builtin,revision:3,entries:[{...entry,published:false}] };
        const unpublished = createAddonCatalog({...options,builtin:sign(newer)});
        await assert.rejects(unpublished.prepare(entry.id),/не опубликован/);
        body = p.canonical(p.sign({...pkg,manifest:{...pkg.manifest,name:'Different name'}},key));
        const substituted = createAddonCatalog({...options,builtin:sign({...builtin,revision:3,entries:[{...entry,sha256:digest(body)}]})});
        await assert.rejects(substituted.prepare(entry.id),/карточке/);
        const otherKey = crypto.generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'});
        body = p.canonical(p.sign(pkg,otherKey));
        const wrongPublisher = createAddonCatalog({...options,builtin:sign({...builtin,revision:3,entries:[{...entry,sha256:digest(body)}]})});
        await assert.rejects(wrongPublisher.prepare(entry.id),/карточке/);
        const conflict = createAddonCatalog({...options,store:{list:async()=>[{id:entry.id,publisher:'a'.repeat(64),revision:1}]}});
        assert.equal((await conflict.list()).entries[0].state,'conflict');
        const offline = createAddonCatalog({...options,fetch:async()=>{throw new Error('Offline');}});
        const fallback = await offline.list(true); assert.equal(fallback.source,'cache'); assert(fallback.message);
        await fs.writeFile(path.join(directory,'catalog-official.json'),'{broken');
        assert.equal((await createAddonCatalog(options).list()).source,'builtin');
        console.log('PASS: signed catalog, pinned publisher, bounded metadata/artwork, cache/offline fallback, coalescing, rollback protection, package hash/identity/metadata and explicit install consent.');
    } finally { await fs.rm(directory,{recursive:true,force:true}); }
})().catch(error => {console.error(error);process.exitCode=1;});
