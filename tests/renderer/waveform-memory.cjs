const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const flush = () => new Promise(resolve => setImmediate(resolve));
(async () => {
    let active = 0, peak = 0, decodes = 0;
    const releases = [], saved = [], renders = [], fetched = [];
    let disk = null;
    class Decoder {
        constructor(channels, length, sampleRate) { assert.equal(sampleRate, 8000); }
        async decodeAudioData() {
            decodes++; active++; peak = Math.max(peak, active);
            await new Promise(resolve => releases.push(resolve));
            active--;
            return { getChannelData: () => Float32Array.from({ length: 2000 }, (_, i) => Math.sin(i / 10)) };
        }
    }
    const context = {
        window: { waveformEnabled: true, OfflineAudioContext: Decoder }, _loadToken: 1,
        AbortController, document: { getElementById: () => null },
        noctune: { fs: { toFileUrl: value => value }, waveform: { get: async () => ({ key: 'fingerprint', peaks: disk }), set: async payload => saved.push(payload) } },
        fetch: async path => { fetched.push(path); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; },
    };
    vm.createContext(context); vm.runInContext(fs.readFileSync('src/renderer/effects/waveform.js', 'utf8'), context);
    context.renderWaveform = peaks => { if (peaks) renders.push(peaks); };
    const first = context.loadTrackWaveform('A', 1); await flush();
    context._loadToken = 2; const second = context.loadTrackWaveform('B', 2);
    context._loadToken = 3; const third = context.loadTrackWaveform('C', 3);
    releases.shift()(); await flush();
    assert.equal(decodes, 2);
    assert.deepEqual(fetched, ['A', 'C'], 'obsolete queued files are never read or decoded');
    releases.shift()(); await Promise.all([first, second, third]);
    assert.equal(peak, 1, 'native PCM decodes never overlap');
    assert.equal(renders.length, 1, 'obsolete results are never displayed');
    assert.equal(saved.length, 1);
    assert.equal(saved[0].peaks.length, 200);
    assert.equal(context.window._waveformCache.get('C').byteLength, 200);
    assert(saved[0].peaks.every(value => Number.isInteger(value) && value >= 0 && value <= 255));
    disk = saved[0].peaks;
    await context.loadTrackWaveform('C', 3);
    assert.equal(decodes, 2, 'disk hit avoids reading and decoding the audio');
    disk = null;
    const stopped = context.loadTrackWaveform('D', 3); await flush();
    context.cancelTrackWaveform(); releases.shift()(); await stopped;
    assert.equal(saved.length, 1, 'stop discards an in-flight decode');
    const silence = context.compactWaveform(new Float32Array(5));
    assert.equal(silence.byteLength, 200); assert([...silence].every(value => value === 0));
    console.log('PASS: one PCM decode, obsolete queue cancellation, low sample rate, 200-byte peaks, cache hits and stop cleanup.');
})().catch(error => { console.error(error); process.exitCode = 1; });
