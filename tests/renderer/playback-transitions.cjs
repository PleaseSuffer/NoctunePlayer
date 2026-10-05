const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/renderer/playback/audio-engine.js', 'utf8');
function extract(name) {
    const start = source.search(new RegExp('        (?:async )?function ' + name + '\\('));
    assert(start >= 0);
    return source.slice(start, source.indexOf('\n        }', start) + 10);
}
function context(overrides = {}) {
    const calls = [];
    const settings = { 'setting-autonext': { checked: true }, 'setting-autonext-playlist': { checked: false } };
    const c = {
        calls, _loadToken: 1, _navigationToken: 0, _trackEndHandledToken: -1, _trackLoading: false, _endFadeActive: false,
        isPlaying: true, isRadioMode: false, activePlaylistId: 'a', currentPlaylistId: 'a', currentIndex: 0,
        repeatMode: 0, playNextIndex: -1, playlistOrder: [10, 20], userPlaylists: [],
        getNextTrackIndex: () => 1, document: { getElementById: id => settings[id] },
        navigator: {}, window: {}, localAudioElement: null, radioAudioElement: null,
        updatePlayIcons: () => {}, statusText: {}, selectPlaylist: async () => {},
        playTrack: (i, pos) => calls.push([i, pos]),
        ...overrides,
    };
    c.stopTrack = () => { c.isPlaying = false; c._loadToken++; };
    vm.createContext(c);
    vm.runInContext(extract('handleTrackEnded'), c);
    return c;
}
(async () => {
    let c = context();
    await c.handleTrackEnded(); await c.handleTrackEnded();
    assert.deepEqual(c.calls, [[1, 0]], 'natural completion advances once');
    c = context({ repeatMode: 1 }); await c.handleTrackEnded(); assert.deepEqual(c.calls, [[0, 0]]);
    c = context({ playNextIndex: 20 }); await c.handleTrackEnded(); assert.deepEqual(c.calls, [[1, 0]]); assert.equal(c.playNextIndex, -1);
    c = context({ getNextTrackIndex: () => -1 }); await c.handleTrackEnded(); assert.deepEqual(c.calls, []); assert.equal(c.currentIndex, -1);
    c = context(); c.document.getElementById = () => ({ checked: false }); await c.handleTrackEnded(); assert.deepEqual(c.calls, []);
    let release;
    c = context({ currentPlaylistId: 'b', selectPlaylist: () => new Promise(resolve => { release = resolve; }) });
    const pending = c.handleTrackEnded(); c._loadToken++; release(); await pending; assert.deepEqual(c.calls, [], 'stale completion cannot restart playback');
    const gainValues = [];
    c = { window: { volumeNode: { gain: { cancelScheduledValues() {}, setValueAtTime(v) { gainValues.push(v); } } } }, audioCtx: { currentTime: 0 }, isRadioMode: false, localAudioElement: { duration: 100, currentTime: 98 }, currentTrackDuration: 100, crossfadeEnabled: true, crossfadeOutDuration: 4, crossfadeIntensity: 1, _endFadeActive: false, isMuted: false, volumeSlider: { value: 1 }, volumeSliderToGain: v => v };
    vm.createContext(c); vm.runInContext(extract('fadeEnvelope'), c); vm.runInContext(extract('applyTrackEndFade'), c);
    c.applyTrackEndFade(); assert.equal(gainValues.at(-1), 0.5);
    c.crossfadeIntensity = 2; c.applyTrackEndFade(); assert.equal(gainValues.at(-1), 0.25);
    assert.equal(c.fadeEnvelope(0), 0); assert.equal(c.fadeEnvelope(1), 1);
    c.crossfadeIntensity = 0.5; c.applyTrackEndFade(); assert(gainValues.at(-1) > 0.5);
    c.crossfadeIntensity = 1;
    c.localAudioElement.currentTime = 100; c.applyTrackEndFade(); assert.equal(gainValues.at(-1), 0);
    c.localAudioElement.currentTime = 50; c.applyTrackEndFade(); assert.equal(gainValues.at(-1), 1);
    c.localAudioElement.currentTime = 99; c.isMuted = true; c.applyTrackEndFade(); assert.equal(gainValues.at(-1), 0);
    c.isMuted = false; c.crossfadeEnabled = false; c.applyTrackEndFade(); assert.equal(gainValues.at(-1), 1);
    // Stop cancels pending loads, old ended events and progress updates together.
    let releasedRadio = false, releasedAudioBuffers = 0;
    c = { window: { clearRadioArtwork() { releasedRadio = true; } }, _loadToken: 2, _navigationToken: 0, _trackLoading: true, _endFadeActive: true, progressInterval: 123, clearInterval() {}, audioBufferSource: null, localAudioElement: { pause() {}, removeAttribute() {}, load() { releasedAudioBuffers++; } }, radioAudioElement: { pause() {}, removeAttribute() {}, load() { releasedAudioBuffers++; } }, radioMetadataAbort: null, isPlaying: true };
    vm.createContext(c); vm.runInContext(extract('stopTrack'), c); c.stopTrack(); assert.equal(c._loadToken, 3); assert.equal(c._trackLoading, false); assert.equal(c.progressInterval, null); assert.equal(c.isPlaying, false); assert.equal(releasedRadio, true); assert.equal(releasedAudioBuffers, 2);
    for (const name of fs.readdirSync('src/renderer', { recursive: true }).filter(n => n.endsWith('.js'))) new vm.Script(fs.readFileSync('src/renderer/' + name, 'utf8'), { filename: name });
    console.log('PASS: completion deduplication, repeat, queue, playlist end, autonext off, stale async completion, fade envelope, seek, mute, disable, stop cancellation and renderer syntax.');
})().catch(err => { console.error(err); process.exitCode = 1; });
