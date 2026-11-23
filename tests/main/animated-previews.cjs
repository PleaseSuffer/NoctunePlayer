const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const crypto = require('node:crypto');
const p = require('../../src/main/addons/package');
const { createPreviews, validateIndex, validateVideo, INDEX_URL, PREFIX } = require('../../src/main/addons/previews');
(async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(),'noctune-previews-'));
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    const key = privateKey.export({format:'pem',type:'pkcs8'});
    const bytes = Buffer.from('1a45dfa301020304', 'hex');
    const entry = { id:'test-theme', version:'1.0.0', kind:'theme', channel:'community', url:PREFIX+'test-theme/1.0.0/preview.webm', mime:'video/webm', width:640, height:360, duration:4, size:bytes.length, sha256:crypto.createHash('sha256').update(bytes).digest('hex') };
    const seed = { format:'noctune-previews', formatVersion:1, revision:1, entries:[] };
    const signed = p.sign({...seed,revision:2,entries:[entry]},key);
    const trust = identity => identity === p.signingIdentity(signed) ? 'Noctune' : null;
    let videos = 0, indexes = 0;
    const fetch = async (url, options) => {
        if (url === INDEX_URL) { indexes++; assert.equal(options.limit,128*1024); return JSON.stringify(signed); }
        videos++; assert.equal(url,entry.url); assert.equal(options.binary,true); assert.equal(options.limit,bytes.length);
        assert.throws(()=>options.validateUrl('https://evil.example/video.webm'));
        options.validateUrl(entry.url);
        return bytes;
    };
    try {
        validateIndex(signed,false,trust);
        validateIndex({...seed,entries:[{...entry,width:1280,height:720}]},true);
        assert.throws(()=>validateIndex({...seed,entries:[{...entry,width:1281,height:720}]},true));
        assert.throws(()=>validateIndex({...seed,entries:[{...entry,width:1280,height:721}]},true));
        assert.throws(()=>validateIndex({...signed,entries:[]},false,trust));
        assert.throws(()=>validateIndex({...seed,entries:[entry]}));
        for (const patch of [{duration:10},{size:100000000},{url:'http://127.0.0.1/v'},{mime:'image/gif'},{width:4000},{channel:'other'}]) assert.throws(()=>validateIndex({...seed,entries:[{...entry,...patch}]},true));
        assert.throws(()=>validateVideo(Buffer.alloc(bytes.length),entry));
        const store = createPreviews({directory,fetch,builtin:seed,trustedPublisher:trust});
        assert.deepEqual(await store.list([entry]),[entry]); assert.equal(videos,0);
        const list = await store.list([entry,{...entry,id:'no-video'}],true);
        assert(list[0].animatedPreview); assert(!list[1].animatedPreview); assert.equal(videos,0); assert.equal(indexes,1);
        assert.deepEqual(Buffer.from((await store.load(entry)).bytes),bytes);
        assert.deepEqual(await store.stats(),{bytes:bytes.length,limit:50_000_000});
        await store.load(entry); assert.equal(videos,1,'repeat hover reads disk cache');
        await assert.rejects(store.load({...entry,version:'2.0.0'}),/unavailable/);
        await assert.rejects(store.load(entry,AbortSignal.abort()),/unavailable/);
        await fs.writeFile(path.join(directory,'previews',entry.sha256+'.webm'),Buffer.alloc(bytes.length));
        await store.load(entry); assert.equal(videos,2,'corrupt cache is downloaded again');
        await store.clear();
        assert.deepEqual(await store.stats(),{bytes:0,limit:50_000_000});
        const oldCache = path.join(directory,'previews','a'.repeat(64)+'.webm');
        const handle = await fs.open(oldCache,'w'); await handle.truncate(50_000_000); await handle.close();
        await fs.utimes(oldCache,new Date(0),new Date(0));
        await store.load(entry); assert.equal(videos,3);
        await assert.rejects(fs.access(oldCache),'old videos are evicted when the disk budget is exceeded');
        const offline = createPreviews({directory,builtin:seed,trustedPublisher:trust,fetch:async()=>{throw new Error('offline');}});
        assert((await offline.list([entry],true))[0].animatedPreview,'signed saved index survives network failure');
        assert.deepEqual(Buffer.from((await offline.load(entry)).bytes),bytes);
        let release;
        const racing = createPreviews({directory:path.join(directory,'race'),builtin:signed,trustedPublisher:trust,fetch:()=>new Promise(resolve=>release=()=>resolve(bytes))});
        const loading = racing.load(entry); while(!release)await new Promise(resolve=>setImmediate(resolve));
        await racing.clear(); release(); await assert.rejects(loading,/canceled/,'clearing during download cannot repopulate the cache');
        console.log('PASS: optional signed preview index, legacy entries, no eager videos, identity/version matching, limits, redirect restriction, binary hash validation, disk reuse, corruption recovery, cancellation and offline cache.');
    } finally { await fs.rm(directory,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1;});
