'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createBackgroundMaskCache, MAX_PIXELS } = require('../../src/main/cache/background-mask-cache');
(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'noctune-masks-'));
    const dir = path.join(root, 'cache');
    let retained = [];
    const cache = createBackgroundMaskCache({ directory: () => dir, retainedPaths: () => retained });
    try {
        const image = path.join(root, 'картинка с пробелом.png');
        await fs.writeFile(image, 'test-image'); retained = [image];
        const miss = await cache.get(image);
        assert.equal(miss.staticImage, true); assert.equal(miss.mask, null);
        const payload = { file:image, key:miss.key, revision:miss.revision, width:3, height:2, data:new Uint8Array([1,2,3,4,5,6,7,8,9,10,11,12]) };
        assert.equal(await cache.set(payload), true);
        assert.deepEqual((await cache.get(image)).mask.data, payload.data);
        const restarted = createBackgroundMaskCache({ directory:() => dir, retainedPaths:() => retained });
        assert.deepEqual((await restarted.get(image)).mask.data, payload.data, 'cache persists across restarts');
        await fs.writeFile(image, 'updated-image-content');
        const changed = await cache.get(image);
        assert.notEqual(changed.key, miss.key); assert.equal(changed.mask, null);
        assert.equal((await fs.readdir(dir)).length, 0, 'replaced file discards obsolete mask');
        assert.equal(await cache.set(payload), false, 'obsolete file fingerprint cannot be written');
        const current = { ...payload, key:changed.key, revision:changed.revision };
        assert.equal(await cache.set({ ...current, width:MAX_PIXELS + 1 }), false);
        assert.equal(await cache.set({ ...current, data:new Uint8Array(2) }), false);
        assert.equal(await cache.set(current), true);
        const pending = cache.set(current);
        const deletion = cache.remove(image);
        await pending; await deletion;
        assert.equal((await cache.get(image)).mask, null, 'delete wins over queued writes');
        assert.equal(await cache.set(current), false, 'deleted mask cannot be recreated by an old request');
        for (let i=0;i<6;i++) {
            const file = path.join(root, i + '.jpg'); await fs.writeFile(file, 'image-' + i);
            retained = [file, ...retained].slice(0,5); await cache.prune();
            const entry = await cache.get(file);
            assert.equal(await cache.set({ ...payload, file, key:entry.key, revision:entry.revision }), true);
        }
        assert.equal((await fs.readdir(dir)).length, 5, 'background limit also limits masks');
        retained = []; await cache.prune();
        assert.equal((await fs.readdir(dir)).length, 0, 'removing backgrounds removes masks');
        assert.equal(await cache.set(current), false, 'unretained image cannot populate cache');
        const animated = path.join(root, 'animated.webp'); await fs.writeFile(animated, 'RIFF....WEBPANIM');
        assert.equal((await cache.get(animated)).staticImage, false);
        const gifHeader = Buffer.concat([Buffer.from('GIF89a'),Buffer.from([1,0,1,0,0,0,0])]);
        const gifFrame = Buffer.from([0x2c,0,0,0,0,1,0,1,0,0,2,2,0x44,1,0]);
        const stillGif = path.join(root,'static.gif');
        await fs.writeFile(stillGif,Buffer.concat([gifHeader,gifFrame,Buffer.from([0x3b])]));
        assert.equal((await cache.get(stillGif)).staticImage,true,'single-frame GIF is a static image');
        await fs.writeFile(stillGif,Buffer.concat([gifHeader,gifFrame,gifFrame,Buffer.from([0x3b])]));
        assert.equal((await cache.get(stillGif)).staticImage,false,'animated GIF is excluded');
        assert.equal((await cache.get(path.join(root,'video.mp4'))).staticImage, false);
        assert.equal((await cache.get(path.join(root,'missing.png'))).staticImage, false);
        console.log('PASS: persistent image masks, replacement invalidation, delete/write races, five-background eviction, bounded payloads and static-only eligibility.');
    } finally { await fs.rm(root, { recursive:true, force:true }); }
})().catch(error => { console.error(error); process.exitCode=1; });
