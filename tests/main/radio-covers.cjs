'use strict';
const assert = require('node:assert/strict');
const { createLastfmCoverClient } = require('../../src/main/integrations/lastfm/cover-service');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
const image = { size: 'large', '#text': 'https://lastfm-img.freetls.fastly.net/i/u/300x300/radio.png' };
const state = { enabled: true, cache: true };
const payload = { artist: 'Artist', title: 'Song', transient: true };
let lookups = 0, downloads = 0;
const options = {
    settings: () => state,
    cacheDirectory() { throw new Error('Radio must never access the cache'); },
    wait: async () => {},
    request: async params => { lookups++; return params.method === 'track.search' ? { results: { trackmatches: { track: [{ artist: 'Artist' }] } } } : { track: { album: { image: [image] } } }; },
    fetchImpl: async () => { downloads++; return { ok: true, headers: { get: () => null }, body: (async function* () { yield png; })() }; },
};
(async () => {
    let client = createLastfmCoverClient(options);
    assert.equal((await client.get(payload)).status, 'found');
    assert.equal((await client.get(payload)).status, 'found');
    assert.equal(lookups, 2, 'radio images are not retained between requests');
    assert.equal(downloads, 2);
    assert.equal((await client.get({ ...payload, artist: '' })).status, 'found', 'title-only streams search for an artist');
    state.enabled = false;
    assert.equal((await client.get(payload)).status, 'disabled');
    state.enabled = true;
    const jobs = [];
    client = createLastfmCoverClient({ ...options, request: (_params, signal) => new Promise(resolve => jobs.push({ resolve, signal })) });
    const old = client.get(payload);
    const current = client.get({ ...payload, title: 'Next Song' });
    assert.equal(jobs[0].signal.aborted, true, 'next radio song aborts the previous lookup');
    jobs[0].resolve({ track: { album: { image: [image] } } });
    jobs[1].resolve({ track: { album: { image: [image] } } });
    assert.equal((await old).status, 'disabled');
    assert.equal((await current).status, 'found');
    const stopped = client.get(payload);
    client.cancelRadio();
    assert.equal(jobs[2].signal.aborted, true);
    jobs[2].resolve({ track: { album: { image: [image] } } });
    assert.equal((await stopped).status, 'disabled');
    let retries = 0;
    client = createLastfmCoverClient({ ...options, request: async () => { retries++; throw new Error('offline'); } });
    assert.equal((await client.get(payload)).status, 'error');
    assert.equal(retries, 3, 'offline retries are bounded');
    client = createLastfmCoverClient({ ...options, request: async () => null });
    assert.equal((await client.get(payload)).status, 'missing');
    let downloadStarted;
    const started = new Promise(resolve => downloadStarted = resolve);
    client = createLastfmCoverClient({ ...options, fetchImpl: (_url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
        downloadStarted();
    }) });
    const downloading = client.get(payload);
    await started; client.cancelRadio();
    assert.equal((await downloading).status, 'disabled', 'in-flight image download is aborted');
    console.log('PASS: radio covers bypass all caches, title-only lookup, bounded offline retries, missing covers, station/track cancellation and download abort.');
})().catch(error => { console.error(error); process.exitCode = 1; });
