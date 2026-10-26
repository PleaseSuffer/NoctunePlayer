const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = path.resolve(__dirname, '.artifacts/file-audio-options');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(output, 'profile-')));
BrowserWindow.prototype.show = function () {};
BrowserWindow.prototype.showInactive = function () {};
const chunk = (id, data) => {
    const header = Buffer.alloc(8); header.write(id); header.writeUInt32LE(data.length, 4);
    return Buffer.concat([header, data, Buffer.alloc(data.length % 2)]);
};
const format = Buffer.alloc(16);
format.writeUInt16LE(1, 0); format.writeUInt16LE(1, 2); format.writeUInt32LE(8000, 4);
format.writeUInt32LE(16000, 8); format.writeUInt16LE(2, 12); format.writeUInt16LE(16, 14);
const pcm = Buffer.alloc(8000 * 20 * 2);
for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.round(.1 * 32767 * Math.sin(2 * Math.PI * 440 * i / 8000)), i * 2);
const info = chunk('LIST', Buffer.concat([Buffer.from('INFO'), chunk('INAM', Buffer.from('Embedded title\0')), chunk('IART', Buffer.from('Embedded artist\0'))]));
const body = Buffer.concat([Buffer.from('WAVE'), chunk('fmt ', format), info, chunk('data', pcm)]);
const header = Buffer.alloc(8); header.write('RIFF'); header.writeUInt32LE(body.length, 4);
const fixture = path.join(output, 'Filename artist - Filename title.wav');
fs.writeFileSync(fixture, Buffer.concat([header, body]));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
app.on('browser-window-created', (_, win) => win.webContents.on('did-finish-load', async () => {
    if (!win.webContents.getURL().endsWith('/renderer/index.html')) return;
    const run = code => win.webContents.executeJavaScript(code);
    const wait = async (code, label) => {
        for (let i = 0; i < 100; i++) { if (await run(code)) return; await delay(100); }
        throw Error(label);
    };
    try {
        await run(`appStorage.setItem('setting_read_tags', '1'); appStorage.setItem('setting_replaygain', '0'); window.replayGainEnabled=false;
            fileEntries=[{kind:'file',path:${JSON.stringify(fixture)},name:'Filename artist - Filename title.wav'}]; playlistOrder=[0]; parsedMetadataCache={};
            playTrack(0)`);
        await wait(`isPlaying && trackTitle.textContent === 'Embedded title'`, 'actual RIFF tags and playback');
        assert.equal(await run(`document.getElementById('setting-normalize').disabled || document.getElementById('setting-read-tags').disabled`), false);
        await run(`const normalize=document.getElementById('setting-normalize');normalize.checked=true;normalize.dispatchEvent(new Event('change'))`);
        await wait(`window._currentNormalizationGain > 1.5 && window._currentNormalizationGain < 2`, 'real PCM analysis increases quiet track gain');
        assert.equal(await run(`appStorage.getItem('setting_normalize')`), '1');
        const position = await run(`localAudioElement.currentTime`);
        await run(`const tags=document.getElementById('setting-read-tags');tags.checked=false;tags.dispatchEvent(new Event('change'))`);
        await wait(`trackTitle.textContent === 'Filename title'`, 'tag toggle updates current playback');
        assert.equal(await run(`trackArtist.textContent`), 'Filename artist');
        assert(await run(`isPlaying && localAudioElement.currentTime >= ${position}`), 'tag toggle keeps audio playing');
        await run(`document.getElementById('setting-read-tags').checked=true;document.getElementById('setting-read-tags').dispatchEvent(new Event('change'))`);
        await wait(`trackTitle.textContent === 'Embedded title'`, 'embedded tags restored');
        await run(`document.getElementById('setting-normalize').checked=false;document.getElementById('setting-normalize').dispatchEvent(new Event('change'))`);
        await delay(800);
        assert(Math.abs(await run('window.replayGainNode.gain.value') - 1) < .01);
        console.log('PASS: real Electron WAV tags, PCM decoding, normalization gain, active switches, persistence and metadata toggles without interrupting playback.');
        app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
}));
require('../src/main/index.js');
