// Analyse local audio independently of playback and of embedded ReplayGain tags.
// Gated RMS ignores silent blocks; peak headroom prevents the gain from clipping.
function measureNormalizationGain(buffer) {
    const blockSize = Math.max(1, Math.round(buffer.sampleRate * 0.4));
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    let energy = 0, samples = 0, peak = 0;
    for (let start = 0; start < buffer.length; start += blockSize) {
        const end = Math.min(buffer.length, start + blockSize);
        let sum = 0;
        for (const channel of channels) {
            for (let i = start; i < end; i++) {
                const value = channel[i];
                sum += value * value;
                peak = Math.max(peak, Math.abs(value));
            }
        }
        const count = (end - start) * channels.length;
        if (sum / count > 1e-6) { energy += sum; samples += count; }
    }
    if (!samples || !peak) return 1;
    return Math.min(Math.pow(10, -18 / 20) / Math.sqrt(energy / samples), 0.95 / peak, 4);
}

window.normalizationEnabled = appStorage.getItem('setting_normalize') === '1';
let normalizationTrack = null;
let normalizationRequest = 0;
let normalizationAbort = null;
let normalizationBusy = false;
const normalizationCache = new Map();

function cancelNormalization() {
    normalizationRequest++;
    normalizationAbort?.abort();
    normalizationTrack = null;
    window._currentNormalizationGain = 1;
    if (typeof applyReplayGainNow === 'function') applyReplayGainNow();
}

function prepareNormalization(filePath, ownerToken, duration = 0) {
    cancelNormalization();
    if (!filePath) return;
    normalizationTrack = { filePath, ownerToken, duration };
    void updateNormalization();
}

async function updateNormalization() {
    if (typeof applyReplayGainNow === 'function') applyReplayGainNow();
    if (!window.normalizationEnabled) {
        normalizationRequest++;
        normalizationAbort?.abort();
        return;
    }
    if (normalizationBusy || !normalizationTrack) return;
    const track = normalizationTrack;
    const request = ++normalizationRequest;
    const current = () => request === normalizationRequest && track === normalizationTrack &&
        track.ownerToken === _loadToken && window.normalizationEnabled;
    normalizationBusy = true;
    let context;
    try {
        const stats = await noctune.fs.stat(track.filePath);
        if (!current()) return;
        const key = JSON.stringify([track.filePath, stats.size, stats.mtimeMs]);
        let gain = normalizationCache.get(key);
        if (gain === undefined) {
            // Bound compressed input and decoded PCM for unusually large recordings.
            if (stats.size > 128 * 1024 * 1024 || track.duration > 1800) return;
            normalizationAbort = new AbortController();
            const response = await fetch(noctune.fs.toFileUrl(track.filePath), { signal: normalizationAbort.signal });
            if (!response.ok || !current()) return;
            const data = await response.arrayBuffer();
            if (!current()) return;
            const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
            if (!OfflineCtx) return;
            context = new OfflineCtx(2, 1, 22050);
            const buffer = await context.decodeAudioData(data);
            if (!current()) return;
            gain = measureNormalizationGain(buffer);
            normalizationCache.set(key, gain);
            if (normalizationCache.size > 100) normalizationCache.delete(normalizationCache.keys().next().value);
        }
        if (current()) {
            window._currentNormalizationGain = gain;
            applyReplayGainNow();
        }
    } catch (_) {
        // Unsupported or damaged files continue at their original level.
    } finally {
        if (context?.close) await context.close().catch(() => {});
        normalizationBusy = false;
        normalizationAbort = null;
        if (normalizationTrack !== track || request !== normalizationRequest) void updateNormalization();
    }
}
