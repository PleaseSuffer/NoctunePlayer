const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/renderer/playback/audio-engine.js', 'utf8');
const start = source.indexOf('        async function startRadioMetadataReader(');
const readerSource = source.slice(start, source.indexOf('\n        }', start) + 10);
async function run(rawTitle, stale = false) {
    const metadata = Buffer.from("StreamTitle='" + rawTitle + "';");
    const blocks = Math.ceil(metadata.length / 16);
    const chunk = Buffer.alloc(2 + blocks * 16);
    chunk[1] = blocks;
    metadata.copy(chunk, 2);
    const calls = [];
    let read = false;
    const context = {
        _loadToken: 7, isRadioMode: true, radioMetadataAbort: null, currentRadioTrack: '',
        AbortController, TextDecoder, console, navigator: {},
        window: { setLyricsTrack: (track, token) => calls.push({ track, token }) },
        trackTitle: {}, trackArtist: {}, miniTrackTitle: {}, statusText: {},
        triggerMiniMarquee() {}, pushDiscordActivity() {},
        fetch: async () => ({ headers: { get: () => '1' }, body: { getReader: () => ({ read: async () => {
            if (read) return { done: true };
            read = true;
            if (stale) context._loadToken++;
            return { value: chunk, done: false };
        } }) } }),
    };
    vm.createContext(context);
    vm.runInContext(readerSource, context);
    await context.startRadioMetadataReader('https://example.invalid/radio', 'Test FM');
    return { context, calls };
}
(async () => {
    let result = await run('Artist - Song - Remix');
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0].track.artist, 'Artist');
    assert.equal(result.calls[0].track.title, 'Song - Remix');
    assert.equal(result.calls[0].track.stationName, 'Test FM');
    assert.equal(result.calls[0].token, 7);
    result = await run('Song only');
    assert.equal(result.calls[0].track.artist, '');
    assert.equal(result.calls[0].track.title, 'Song only');
    result = await run('Old Artist - Old Song', true);
    assert.equal(result.calls.length, 0, 'previous station cannot overwrite current track');
    console.log('PASS: radio artist/title forwarding, station label, title-only metadata and stale stream isolation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
