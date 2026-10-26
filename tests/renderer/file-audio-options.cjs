const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const storage = new Map();
const context = {
    appStorage: { getItem: key => storage.get(key) ?? null },
    window: {}, document: { getElementById: () => null },
    fileEntries: [], parsedMetadataCache: {}, AbortController,
    _loadToken: 1, isRadioMode: false, audioCtx: { currentTime: 0 },
    noctune: { metadata: { parseFile: async () => ({ title: 'Tagged', artist: 'Artist', duration: 10 }) } },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('src/renderer/playback/file-metadata.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('src/renderer/playback/normalization.js', 'utf8'), context);
const source = fs.readFileSync('src/renderer/playback/audio-engine.js', 'utf8');
const start = source.indexOf('        function applyReplayGainNow()');
vm.runInContext(source.slice(start, source.indexOf('\n        }', start) + 10), context);
const tagged = { title: 'Tag title', artist: 'Tag artist', album: 'Album', hasEmbeddedCover: true,
    coverThumbnailDataUrl: 'data:cover', duration: 30, replayGainTrackDb: -6 };
let view = context.fileMetadataView(tagged, 'File artist - File title.flac');
assert.equal(view.title, 'Tag title');
storage.set('setting_read_tags', '0');
view = context.fileMetadataView(view, 'File artist - File title.flac');
assert.equal(view.title, 'File title');
assert.equal(view.artist, 'File artist');
assert.equal(view.coverThumbnailDataUrl, null);
assert.equal(view.album, '');
assert.equal(view.duration, 30);
assert.equal(view.replayGainTrackDb, -6, 'ReplayGain remains independent of descriptive tags');
storage.set('setting_read_tags', '1');
view = context.fileMetadataView(view, 'File artist - File title.flac');
assert.equal(view.title, 'Tag title');
assert.equal(view.coverThumbnailDataUrl, 'data:cover');
const pcm = (amplitude, silence = false) => {
    const data = Float32Array.from({ length: 8000 }, (_, i) => silence && i < 4000 ? 0 : amplitude * Math.sin(i * Math.PI / 4));
    return { sampleRate: 1000, numberOfChannels: 1, length: data.length, getChannelData: () => data };
};
const quietGain = context.measureNormalizationGain(pcm(.1));
const loudGain = context.measureNormalizationGain(pcm(.5));
assert(Math.abs(quietGain * .1 - loudGain * .5) < 1e-6, 'quiet and loud tracks reach the same level');
assert.equal(context.measureNormalizationGain(pcm(0)), 1, 'silence is never amplified');
assert.equal(context.measureNormalizationGain(pcm(.001)), 1, 'noise below the gate is ignored');
assert.equal(context.measureNormalizationGain(pcm(.002)), 4, 'boost is bounded');
assert(Math.abs(context.measureNormalizationGain(pcm(.1, true)) - quietGain) < 1e-6, 'silent intro does not skew gain');
let applied;
context.window.replayGainNode = { gain: { cancelScheduledValues() {}, setTargetAtTime: value => { applied = value; } } };
context.window.normalizationEnabled = true;
context.window._currentNormalizationGain = quietGain;
context.applyReplayGainNow();
assert.equal(applied, quietGain);
context.window.replayGainEnabled = true;
context.window._currentTrackReplayGainDb = -6;
context.applyReplayGainNow();
assert.equal(applied, Math.pow(10, -6 / 20), 'ReplayGain takes priority without double correction');
context.isRadioMode = true; context.applyReplayGainNow(); assert.equal(applied, 1);
context.isRadioMode = false;
context.window.replayGainEnabled = false;
context.window.normalizationEnabled = false;
context.applyReplayGainNow(); assert.equal(applied, 1);

(async () => {
    storage.set('setting_read_tags', '0');
    assert.equal((await context.readFileMetadata('/music/test.ogg', 'Filename.ogg')).title, 'Filename');
    let finishDecode;
    context.window.normalizationEnabled = true;
    context.noctune.fs = { stat: async () => ({ size: 100, mtimeMs: 1 }), toFileUrl: value => value };
    context.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
    context.window.OfflineAudioContext = class { decodeAudioData() { return new Promise(resolve => { finishDecode = resolve; }); } };
    context.prepareNormalization('/old.wav', 1);
    for (let i = 0; i < 20 && !finishDecode; i++) await Promise.resolve();
    assert(finishDecode, 'analysis starts in the background');
    context.cancelNormalization();
    context._loadToken++;
    finishDecode(pcm(.1));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(context.window._currentNormalizationGain, 1, 'stale analysis cannot alter the new track');
    console.log('PASS: file tags toggle/fallback/artwork, RMS level matching, silence gate, boost bounds, ReplayGain priority, radio bypass and stale decode cancellation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
