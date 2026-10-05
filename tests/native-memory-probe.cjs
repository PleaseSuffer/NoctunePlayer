'use strict';
const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createWaveformCache } = require('../src/main/cache/waveform-cache');
const { resizeArtwork } = require('../src/preload/artwork');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noctune-native-memory-'));
app.setPath('userData', path.join(root, 'profile'));
const cacheDirectory = path.join(root, 'waveforms');
const cache = createWaveformCache({ directory: () => cacheDirectory });
ipcMain.handle('probe:waveform-get', (_, filePath) => cache.get(filePath));
ipcMain.handle('probe:waveform-set', (_, payload) => cache.set(payload.filePath, payload.key, payload.peaks));
function makeWav(filePath) {
    const seconds = 240, rate = 44100, channels = 2, bytes = seconds * rate * channels * 2;
    const header = Buffer.alloc(44); header.write('RIFF'); header.writeUInt32LE(bytes + 36, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22); header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * channels * 2, 28); header.writeUInt16LE(channels * 2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(bytes, 40);
    const chunk = Buffer.alloc(rate * channels * 2);
    for (let i = 0; i < rate; i++) { const sample = Math.round(Math.sin(i * 2 * Math.PI * 440 / rate) * 12000); chunk.writeInt16LE(sample, i * 4); chunk.writeInt16LE(sample, i * 4 + 2); }
    const fd = fs.openSync(filePath, 'w'); fs.writeSync(fd, header);
    for (let i = 0; i < seconds; i++) fs.writeSync(fd, chunk);
    fs.closeSync(fd);
}
app.whenReady().then(async () => {
    let win, baselineWindow, preloadWindow;
    try {
        const files = ['A.wav', 'B.wav', 'C.wav'].map(name => path.join(root, name)); files.forEach(makeWav);
        const png = fs.readFileSync(path.join(__dirname, '../resources/app.png'));
        const large = nativeImage.createFromBuffer(png).resize({ width: 3000, height: 2000 });
        const thumbnail = resizeArtwork({ data: large.toPNG() }, nativeImage, 96, 75);
        const full = resizeArtwork({ data: large.toPNG() }, nativeImage, 1024, 85);
        assert.equal(nativeImage.createFromDataURL(thumbnail).getSize().width, 96);
        assert.equal(nativeImage.createFromDataURL(full).getSize().width, 1024);
        win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false } });
        const page = path.join(root, 'probe.html'); fs.writeFileSync(page, '<html><body></body></html>');
        await win.loadFile(page);
        await win.webContents.executeJavaScript('window.probeFiles = ' + JSON.stringify(files));
        await win.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname, '../src/renderer/effects/waveform.js'), 'utf8'));
        const results = await win.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname, 'native-memory-renderer.js'), 'utf8'));
        assert.equal(results.maxConcurrent, 1); assert.equal(results.sampleRate, 8000); assert.equal(results.peakBytes, 200); assert.equal(results.cacheAvoidedDecode, true);
        assert(fs.readdirSync(cacheDirectory).some(name => fs.statSync(path.join(cacheDirectory, name)).size === 200));
        baselineWindow = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false } });
        await baselineWindow.loadFile(page);
        await baselineWindow.webContents.executeJavaScript('window.probeFiles = ' + JSON.stringify(files));
        const baseline = await baselineWindow.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname, 'native-memory-baseline.js'), 'utf8'));
        preloadWindow = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: false, preload: path.join(__dirname, '../src/preload/index.js') } });
        await preloadWindow.loadFile(page);
        const preloadResult = await preloadWindow.webContents.executeJavaScript('Promise.all([noctune.metadata.parseFile(' + JSON.stringify(files[0]) + ', "A.wav"), noctune.metadata.thumbnail(' + JSON.stringify(large.toDataURL()) + ')])');
        assert.equal(preloadResult[0].duration, 240);
        assert.equal(preloadResult[0].coverDataUrl, null);
        assert.equal(nativeImage.createFromDataURL(preloadResult[1]).getSize().width, 96);
        console.log(JSON.stringify({ preload: 'PASS', status: 'PASS', thumbnailWidth: 96, activeArtworkWidth: 1024, optimized: results, baseline }));
    } catch (error) { console.error(error); process.exitCode = 1; }
    finally {
        if (win && !win.isDestroyed()) win.destroy();
        if (baselineWindow && !baselineWindow.isDestroyed()) baselineWindow.destroy();
        if (preloadWindow && !preloadWindow.isDestroyed()) preloadWindow.destroy();
        const relative = path.relative(os.tmpdir(), root);
        if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
        app.exit(process.exitCode || 0);
    }
});
