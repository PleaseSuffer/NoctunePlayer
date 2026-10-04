'use strict';
const assert = require('node:assert/strict');
const { createLyricsClient, parseLrc } = require('../../src/main/integrations/lrclib/lyrics-service');
const response = (status, body, retry = null) => ({ status, ok: status >= 200 && status < 300, headers: { get: () => retry }, text: async () => JSON.stringify(body) });
const track = { artist: 'Artist', title: 'Song', album: 'Album', duration: 120 };
(async () => {
    assert.deepEqual(parseLrc('[offset:-500]\n[00:01.50][00:03.5]Two stamps\n[00:02.005]Unicode: Привет\n[00:61]invalid'), [
        { time: 1, text: 'Two stamps' }, { time: 1.505, text: 'Unicode: Привет' }, { time: 3, text: 'Two stamps' },
    ]);
    assert.deepEqual(parseLrc('[ar:Artist]\nPlain text'), []);
    let requests = 0;
    let client = createLyricsClient({ userAgent: 'Noctune/test', fetchImpl: async (url, options) => {
        requests++; assert.equal(new URL(url).hostname, 'lrclib.net'); assert.equal(options.headers['User-Agent'], 'Noctune/test');
        return response(200, { plainLyrics: '<b>Untrusted text</b>', syncedLyrics: '[00:01]Line' });
    } });
    const [first, second] = await Promise.all([client.get(track), client.get(track)]);
    assert.equal(requests, 1); assert.deepEqual(first, second); assert.equal(first.lines[0].time, 1);
    await client.get(track); assert.equal(requests, 1);
    client = createLyricsClient({ userAgent: 'test', fetchImpl: async url => new URL(url).pathname.endsWith('/get') ? response(404, {}) : response(200, [
        { artistName: 'Other', trackName: 'Song', duration: 120, plainLyrics: 'Wrong artist' },
        { artistName: 'Artist', trackName: 'Song', duration: 180, plainLyrics: 'Wrong version' },
        { artistName: 'Artist', trackName: 'Song', albumName: 'Album', duration: 121, plainLyrics: 'Correct' },
    ]) });
    assert.equal((await client.get(track)).plain, 'Correct');
    client = createLyricsClient({ userAgent: 'test', fetchImpl: async () => response(200, { instrumental: true }) });
    assert.equal((await client.get(track)).status, 'instrumental');
    requests = 0;
    client = createLyricsClient({ userAgent: 'test', fetchImpl: async () => { requests++; return response(404, {}); } });
    assert.equal((await client.get(track)).status, 'missing'); await client.get(track); assert.equal(requests, 2);
    requests = 0;
    client = createLyricsClient({ userAgent: 'test', now: () => 0, fetchImpl: async () => { requests++; return response(429, {}, '120'); } });
    assert.equal((await client.get(track)).status, 'rate-limit'); assert.equal((await client.get({ ...track, title: 'Other' })).status, 'rate-limit'); assert.equal(requests, 1);
    client = createLyricsClient({ userAgent: 'test', wait: async () => {}, fetchImpl: async () => { throw new Error('network'); } });
    assert.equal((await client.get(track)).status, 'error');
    assert.equal((await client.get({ artist: 'Неизвестный исполнитель', title: 'Song' })).status, 'invalid');
    for (const failure of [() => response(503, {}), () => { throw new DOMException('Timed out', 'TimeoutError'); }, () => { throw new TypeError('fetch failed'); }]) {
        requests = 0;
        const delays = [];
        client = createLyricsClient({ userAgent: 'test', wait: async ms => { delays.push(ms); }, fetchImpl: async () => {
            requests++;
            return requests === 1 ? failure() : response(200, { plainLyrics: 'Recovered' });
        } });
        const results = await Promise.all([client.get(track), client.get(track)]);
        assert.equal(results[0].plain, 'Recovered'); assert.deepEqual(results[0], results[1]);
        assert.equal(requests, 2); assert.deepEqual(delays, [600]);
        await client.get(track); assert.equal(requests, 2, 'recovered lyrics are cached');
    }
    requests = 0;
    client = createLyricsClient({ userAgent: 'test', wait: async () => {}, fetchImpl: async () => { requests++; return response(400, {}); } });
    assert.equal((await client.get(track)).status, 'error'); assert.equal(requests, 1, 'permanent errors are not retried');
    requests = 0;
    client = createLyricsClient({ userAgent: 'test', wait: async () => {}, fetchImpl: async () => { requests++; return response(503, {}); } });
    assert.equal((await client.get(track)).status, 'error'); assert.equal(requests, 2, 'retry count is bounded');
    console.log('PASS: LRC timestamps and offset, cache, concurrent deduplication, request headers, matching and version filter, instrumental, missing, rate limit, network error and metadata validation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
