'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createWaveformCache } = require('../../src/main/cache/waveform-cache');
(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'noctune-waveform-'));
    const directory = path.join(root, 'cache');
    const track = path.join(root, 'track.wav');
    try {
        await fs.writeFile(track, 'test-audio');
        const cache = createWaveformCache({ directory: () => directory, maxEntries: 2 });
        const miss = await cache.get(track);
        assert.equal(miss.peaks, null);
        const peaks = Array.from({ length: 200 }, (_, i) => i);
        assert.equal(await cache.set(track, miss.key, peaks), true);
        assert.equal((await fs.stat(path.join(directory, miss.key + '.bin'))).size, 200);
        assert.deepEqual((await cache.get(track)).peaks, peaks);
        const restarted = createWaveformCache({ directory: () => directory });
        assert.deepEqual((await restarted.get(track)).peaks, peaks);
        await fs.writeFile(track, 'different-audio-content');
        const changed = await cache.get(track);
        assert.notEqual(changed.key, miss.key);
        assert.equal(changed.peaks, null);
        assert.equal(await cache.set(track, miss.key, peaks), false, 'modified audio rejects stale peaks');
        assert.equal(await cache.set(track, changed.key, [999]), false);
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(path.join(directory, changed.key + '.bin'), 'broken');
        assert.equal((await cache.get(track)).peaks, null);
        assert.equal(await cache.set(track, changed.key, peaks), true);
        await fs.writeFile(track, 'third-generation-audio-content');
        const third = await cache.get(track);
        await cache.set(track, third.key, peaks);
        assert.equal((await fs.readdir(directory)).length, 2, 'disk cache is bounded');
        assert.equal(await cache.get(path.join(root, 'missing.wav')), null);
        console.log('PASS: 200-byte waveform persistence, file invalidation, corruption, invalid input and bounded cache.');
    } finally {
        for (const name of await fs.readdir(directory).catch(() => [])) await fs.unlink(path.join(directory, name));
        await fs.rmdir(directory).catch(() => {}); await fs.unlink(track); await fs.rmdir(root);
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
