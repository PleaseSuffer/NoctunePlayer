'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createLastfmCoverClient, coverUrl } = require('../../src/main/integrations/lastfm/cover-service');
async function waitFor(predicate) {
    const deadline = Date.now() + 5000;
    while (!predicate()) {
        assert(Date.now() < deadline, 'cover lookup did not reach the expected state');
        await new Promise(resolve => setTimeout(resolve, 5));
    }
}
(async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'noctune-cover-test-'));
    const musicDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'noctune-cover-music-test-'));
    try {
        const url = 'https://lastfm-img.freetls.fastly.net/i/u/300x300/cover.png';
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
        const image = { size: 'extralarge', '#text': url };
        const state = { enabled: true, cache: true };
        let calls = 0, downloads = 0;
        const options = {
            wait: async () => {},
            settings: () => state, cacheDirectory: () => directory,
            request: async () => { calls++; return { album: { image: [image] } }; },
            fetchImpl: async address => { downloads++; assert.equal(address, url); return { ok: true, headers: { get: () => null }, body: (async function* () { yield png; })() }; },
        };
        const track = { artist: 'Artist', title: 'Song', album: 'Album' };
        let client = createLastfmCoverClient(options);
        const progress = [], sharedProgress = [];
        const [a, b] = await Promise.all([client.get(track, item => progress.push(item)), client.get(track, item => sharedProgress.push(item))]);
        assert.equal(a.status, 'found'); assert.deepEqual(a, b); assert.equal(calls, 1); assert.equal(downloads, 1);
        assert(progress.some(item => item.phase === 'downloading'));
        assert(sharedProgress.some(item => item.phase === 'downloading'), 'deduplicated requests share download progress');
        const initialStats = await client.stats();
        assert(initialStats.bytes > png.length); assert.equal(initialStats.count, 1); assert.equal(initialStats.limitMB, 30);
        await client.get({ ...track, title: 'Other song from same album' }); assert.equal(calls, 1);
        client = createLastfmCoverClient({ ...options, request: async () => { throw new Error('offline'); } });
        assert.equal((await client.get(track)).status, 'found', 'disk cache works after restarting offline');
        await client.clear(); assert.equal((await fs.readdir(directory)).length, 0);
        assert.equal((await client.get(track)).status, 'error');
        client = createLastfmCoverClient(options); state.cache = false;
        const before = calls; await client.get(track); await client.get(track); assert.equal(calls, before + 2);
        assert.equal((await fs.readdir(directory)).length, 0);
        state.cache = true; state.limitMB = 10;
        client = createLastfmCoverClient({ ...options, cacheDirectory: payload => payload?.music ? musicDirectory : directory });
        const beforeFolders = calls;
        await client.get(track); await client.get({ ...track, music: true });
        assert.equal(calls, beforeFolders + 2, 'each storage folder has its own cache');
        await client.clear({ music: true });
        assert.equal((await client.stats({ music: true })).count, 0);
        assert.equal((await client.stats()).count, 1, 'clearing one location preserves the other');
        await client.clear();
        const oldFile = path.join(directory, 'a'.repeat(64) + '.json');
        const recentFile = path.join(directory, 'b'.repeat(64) + '.json');
        await fs.writeFile(oldFile, Buffer.alloc(6 * 1024 * 1024));
        await fs.utimes(oldFile, new Date(0), new Date(0));
        await fs.writeFile(recentFile, Buffer.alloc(6 * 1024 * 1024));
        await fs.writeFile(path.join(directory, 'keep.txt'), 'unrelated');
        const trimmed = await client.configure();
        assert.equal(trimmed.bytes, 6 * 1024 * 1024); assert.equal(trimmed.limitMB, 10);
        assert.equal((await fs.readdir(directory)).includes(path.basename(oldFile)), false, 'oldest covers removed to respect limit');
        await client.clear();
        assert.equal(await fs.readFile(path.join(directory, 'keep.txt'), 'utf8'), 'unrelated', 'only managed cover files removed');
        await fs.unlink(path.join(directory, 'keep.txt'));
        state.enabled = false; assert.equal((await client.get(track)).status, 'disabled');
        state.enabled = true; state.cache = true;
        const methods = [];
        client = createLastfmCoverClient({ ...options, request: async params => { methods.push(params.method); return params.method === 'album.getInfo' ? { album: { image: [] } } : { track: { album: { image: [image] } } }; } });
        assert.equal((await client.get(track)).status, 'found'); assert.deepEqual(methods, ['album.getInfo', 'track.getInfo']);
        await client.clear();
        let release;
        client = createLastfmCoverClient({ ...options, request: () => new Promise(resolve => { release = resolve; }) });
        state.cache = false;
        const pending = client.get(track); await waitFor(() => release); await client.clear(); release({ album: { image: [image] } });
        assert.equal((await pending).status, 'disabled', 'clearing invalidates in-flight requests');
        assert.equal((await fs.readdir(directory)).length, 0);
        assert.equal(coverUrl([{ size: 'mega', '#text': 'https://example.com/private' }]), null);
        assert.equal(coverUrl([image]), url, 'accept actual Last.fm image CDN');
        assert.equal(coverUrl([{ size: 'mega', '#text': 'https://lastfm-img.freetls.fastly.net.example.com/i/u/cover.png' }]), null);
        assert.equal(coverUrl([{ size: 'mega', '#text': 'https://lastfm.freetls.fastly.net/i/u/2a96cbd8b46e442fc41c2b86b821562f.png' }]), null);
        let metadataAttempts = 0, imageAttempts = 0;
        client = createLastfmCoverClient({ ...options,
            request: async () => {
                if (++metadataAttempts < 3) throw Object.assign(new Error('temporary'), { code: 16 });
                return { album: { image: [image] } };
            },
            fetchImpl: async address => {
                if (++imageAttempts === 1) return { ok: false, status: 503, headers: { get: () => null } };
                return options.fetchImpl(address);
            },
        });
        assert.equal((await client.get(track)).status, 'found');
        assert.equal(metadataAttempts, 3); assert.equal(imageAttempts, 2, 'retry metadata and image download independently');
        metadataAttempts = 0;
        client = createLastfmCoverClient({ ...options, request: async () => { metadataAttempts++; throw Object.assign(new Error('invalid-key'), { code: 10 }); } });
        assert.equal((await client.get(track)).status, 'error'); assert.equal(metadataAttempts, 1, 'permanent API errors are not retried');
        metadataAttempts = 0;
        client = createLastfmCoverClient({ ...options, request: async () => { metadataAttempts++; throw new Error('offline'); } });
        assert.equal((await client.get(track)).status, 'error'); assert.equal(metadataAttempts, 3, 'network retries are bounded');
        let delays = 0;
        client = createLastfmCoverClient({ ...options,
            request: async () => { throw new Error('offline'); },
            wait: async () => { delays++; await client.clear(); },
        });
        assert.equal((await client.get(track)).status, 'disabled'); assert.equal(delays, 1, 'cache reset cancels scheduled retries');
        state.cache = true;
        metadataAttempts = 0;
        client = createLastfmCoverClient({ ...options, request: async () => { metadataAttempts++; return { album: { image: [] } }; } });
        await client.get(track); await client.get(track);
        assert.equal(metadataAttempts, 2, 'valid misses use short negative cache');
        await client.get({ ...track, title: 'Another song' });
        assert.equal(metadataAttempts, 4, 'one missing song does not block other tracks from the album');
        const hash = require('node:crypto').createHash('sha256').update(JSON.stringify(['artist', 'album', ''])).digest('hex');
        await fs.writeFile(path.join(directory, hash + '.json'), JSON.stringify({ expires: Date.now() + 86400000, result: { status: 'missing' } }));
        client = createLastfmCoverClient(options);
        assert.equal((await client.get(track)).status, 'found', 'old false-negative caches are ignored automatically');
        assert.equal((await client.cached(track)).cached, true, 'individual cover status reads disk cache');
        const otherAlbum = { ...track, album: 'Another album' };
        await client.get(otherAlbum);
        await client.remove({ ...track, artist: ' ARTIST ', title: 'Another song from the album' });
        assert.equal((await client.cached(track)).cached, false, 'album cache removal also invalidates memory');
        assert.equal((await client.cached(otherAlbum)).cached, true, 'other albums remain cached');
        assert.equal((await client.stats()).count, 1, 'only the selected cover file is removed');
        await client.remove(track);
        assert.equal((await client.remove({ artist: '../unsafe', title: '../../file' })).ok, true, 'cache paths are generated from hashes');
        assert.equal((await client.remove({})).ok, false, 'invalid requests cannot remove files');
        await client.clear();
        client = createLastfmCoverClient({ ...options, request: async () => ({ album: { image: [] } }) });
        await client.get(track);
        assert.equal((await client.cached(track)).cached, false, 'negative lookup is not a cached cover');
        await client.remove(track);
        const lookups = [];
        client = createLastfmCoverClient({ ...options, request: () => new Promise(resolve => lookups.push(resolve)) });
        const stale = client.get(track);
        await waitFor(() => lookups.length === 1);
        const unrelated = client.get(otherAlbum);
        await waitFor(() => lookups.length === 2);
        await client.remove(track);
        const fresh = client.get(track);
        await waitFor(() => lookups.length === 3);
        lookups[0]({ album: { image: [image] } });
        assert.equal((await stale).status, 'disabled', 'removal cancels the old cover lookup');
        assert.equal((await client.cached(track)).cached, false, 'old request cannot restore deleted cover');
        const shared = client.get(track);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(lookups.length, 3, 'old cleanup preserves deduplication of the new lookup');
        lookups[1]({ album: { image: [image] } });
        lookups[2]({ album: { image: [image] } });
        assert.equal((await unrelated).status, 'found', 'individual removal does not cancel another album');
        assert.equal((await fresh).status, 'found');
        assert.equal((await shared).status, 'found');
        assert.equal((await client.cached(track)).cached, true, 'explicit refresh restores the cover cache');
        console.log('PASS: fallback, download progress, concurrent deduplication, offline cache, storage isolation, cache statistics, size limit eviction, safe clear, in-flight invalidation and URL validation.');
    } finally {
        for (const folder of [directory, musicDirectory]) {
            for (const name of await fs.readdir(folder)) await fs.unlink(path.join(folder, name));
            await fs.rmdir(folder);
        }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
