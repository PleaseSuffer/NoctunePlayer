const { app, BrowserWindow, powerSaveBlocker } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'tests/.artifacts/playback-keep-awake');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'user-data'));
BrowserWindow.prototype.show = function () {};
BrowserWindow.prototype.showInactive = function () {};
const ids = [];
const start = powerSaveBlocker.start.bind(powerSaveBlocker);
powerSaveBlocker.start = type => { const id = start(type); ids.push(id); return id; };
const active = () => ids.filter(id => powerSaveBlocker.isStarted(id)).length;
const wait = () => new Promise(resolve => setTimeout(resolve, 150));
app.on('browser-window-created', (_event, win) => {
    win.webContents.on('did-finish-load', async () => {
        if (!win.webContents.getURL().endsWith('/src/renderer/index.html')) return;
        try {
            await win.webContents.executeJavaScript(`appStorage.setItem('setting_keep_awake', '1')`);
            await wait(); assert.equal(active(), 0, 'enabled setting allows sleep while idle');
            // Real HTML audio exercises the renderer events, preload IPC and native blocker together.
            await win.webContents.executeJavaScript(`(() => {
                const bytes = new Uint8Array(44 + 8000 * 2 * 2), view = new DataView(bytes.buffer);
                const text = (offset, value) => [...value].forEach((c, i) => bytes[offset+i] = c.charCodeAt(0));
                text(0, 'RIFF'); view.setUint32(4, bytes.length-8, true); text(8, 'WAVE'); text(12, 'fmt ');
                view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
                view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
                text(36, 'data'); view.setUint32(40, bytes.length-44, true);
                isRadioMode = false; localAudioElement = new Audio(URL.createObjectURL(new Blob([bytes], {type:'audio/wav'})));
                trackPlaybackActivity(localAudioElement); return localAudioElement.play();
            })()`);
            await wait(); assert.equal(active(), 1, 'actual playback acquires native blocker');
            await win.webContents.executeJavaScript('localAudioElement.pause()');
            await wait(); assert.equal(active(), 0, 'pause releases native blocker');
            await win.webContents.executeJavaScript('localAudioElement.play()');
            await wait(); assert.equal(active(), 1, 'resume reacquires native blocker');
            await win.webContents.executeJavaScript(`new Promise(resolve => localAudioElement.addEventListener('ended', resolve, {once:true}))`);
            await wait(); assert.equal(active(), 0, 'natural completion allows sleep');
            const layout = await win.webContents.executeJavaScript(`(() => {
                document.getElementById('settings-fab').click();
                document.querySelector('[data-panel="panel-appearance"]').click();
                const gallery = document.getElementById('bg-presets-list'), card = gallery.closest('.settings-card');
                gallery.scrollIntoView({block:'center'});
                const g = gallery.getBoundingClientRect(), c = card.getBoundingClientRect(), style = getComputedStyle(card);
                return {left:g.left-c.left, right:c.right-g.right, padding:parseFloat(style.paddingLeft)+parseFloat(style.borderLeftWidth)};
            })()`);
            assert.ok(Math.abs(layout.left-layout.padding)<1 && Math.abs(layout.right-layout.padding)<1, 'builtin backgrounds fill the card content width');
            console.log('PASS: full app idle, actual audio playback, pause, resume, natural completion and full-width background gallery.');
            app.exit(0);
        } catch (error) { console.error(error); app.exit(1); }
    });
});
require('../src/main/index.js');
