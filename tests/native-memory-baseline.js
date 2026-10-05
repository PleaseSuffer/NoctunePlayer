(async () => {
    const before = await process.getProcessMemoryInfo();
    let buffers = await Promise.all(window.probeFiles.map(async file => {
        const response = await fetch(require('url').pathToFileURL(file).href);
        const bytes = await response.arrayBuffer();
        const decoder = new OfflineAudioContext(1, 1, 44100);
        return decoder.decodeAudioData(bytes);
    }));
    const pcmBytes = buffers.reduce((sum, buffer) => sum + buffer.length * buffer.numberOfChannels * 4, 0);
    buffers = null;
    return { before, afterDecode: await process.getProcessMemoryInfo(), pcmBytes };
})()
