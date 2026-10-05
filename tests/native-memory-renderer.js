(async () => {
    const { ipcRenderer } = require('electron');
    let active = 0, maxConcurrent = 0, decodes = 0, pcmBytes = 0, sampleRate = 0;
    const Original = window.OfflineAudioContext;
    window.OfflineAudioContext = function(...args) {
        const context = new Original(...args), originalDecode = context.decodeAudioData.bind(context);
        context.decodeAudioData = async bytes => {
            decodes++; active++; maxConcurrent = Math.max(maxConcurrent, active);
            try { const buffer = await originalDecode(bytes); pcmBytes = buffer.length * buffer.numberOfChannels * 4; sampleRate = buffer.sampleRate; return buffer; }
            finally { active--; }
        };
        return context;
    };
    window.waveformEnabled = true; window._loadToken = 1;
    window.noctune = { fs: { toFileUrl: file => require('url').pathToFileURL(file).href }, waveform: { get: file => ipcRenderer.invoke('probe:waveform-get', file), set: payload => ipcRenderer.invoke('probe:waveform-set', payload) } };
    renderWaveform = () => {};
    const files = window.probeFiles;
    const before = await process.getProcessMemoryInfo();
    const first = loadTrackWaveform(files[0], 1);
    const deadline = Date.now() + 30000;
    while (decodes === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    if (!decodes) throw new Error('decoder failed to start');
    window._loadToken = 2; const second = loadTrackWaveform(files[1], 2);
    window._loadToken = 3; const third = loadTrackWaveform(files[2], 3);
    await Promise.all([first, second, third]);
    const afterDecode = await process.getProcessMemoryInfo();
    const decodeCount = decodes;
    await loadTrackWaveform(files[2], 3);
    const cacheAvoidedDecode = decodeCount === decodes;
    return { before, afterDecode, sampleRate, pcmBytes, maxConcurrent, decodes, cacheAvoidedDecode, peakBytes: window._waveformCache.get(files[2])?.byteLength };
})()
