'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { createCoverCacheDirectoryResolver } = require('../../src/main/cache/cover-cache-location');
(async () => {
    const first = path.resolve('music-a', 'song.mp3');
    const second = path.resolve('music-b', 'song.flac');
    const state = { location: 'music' };
    const userData = path.resolve('app-data');
    const resolver = createCoverCacheDirectoryResolver({
        settings: () => state, userData: () => userData,
        statFile: async file => ({ isFile: () => [first, second].includes(file) }),
    });
    const a = await resolver({ filePath: first });
    const b = await resolver({ filePath: second });
    assert.equal(a, path.join(path.dirname(first), '.noctune-cache', 'covers'));
    assert.equal(b, path.join(path.dirname(second), '.noctune-cache', 'covers'));
    assert.notEqual(a, b, 'different music folders never share their cache');
    assert.equal(await resolver({ filePath: first }), a, 'switching back restores the original folder');
    assert.equal(await resolver(), a, 'folder actions without a track use the last music folder');
    const local = path.join(userData, 'lastfm-cover-cache');
    state.location = 'app'; assert.equal(await resolver({ filePath: second }), local);
    state.location = 'custom'; state.customPath = path.resolve('chosen-cache');
    assert.equal(await resolver({ filePath: first }), state.customPath);
    assert.equal(await resolver({ filePath: second }), state.customPath, 'custom cache intentionally shared across playlists');
    state.customPath = 'relative-path'; assert.equal(await resolver({ filePath: first }), local);
    state.location = 'music'; assert.equal(await resolver({ filePath: path.resolve('missing.mp3') }), local);
    assert.equal(await resolver({ filePath: 'relative.mp3' }), local);
    console.log('PASS: per-music-folder cache, playlist switches, last folder actions, app/custom locations and invalid-path fallback.');
})().catch(error => { console.error(error); process.exitCode = 1; });
