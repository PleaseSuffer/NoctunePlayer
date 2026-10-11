// Repeatable scheduling regression; no historical source snapshots or FPS benchmarks.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createSceneThemeStore } = require('../src/main/scene-themes');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'tests/.artifacts/scene-performance');
fs.mkdirSync(out, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(out, 'profile-')));
const marker = path.join(root, 'themes/user/.legacy-migrated');
const hadMarker = fs.existsSync(marker);
const showInactive = BrowserWindow.prototype.showInactive;
BrowserWindow.prototype.show = function () {};
BrowserWindow.prototype.showInactive = function () {};
BrowserWindow.prototype.focus = function () {};
let domTheme = false, finished = false;
function finish(code) {
    if (finished) return;
    finished = true;
    if (!hadMarker && fs.existsSync(marker)) fs.unlinkSync(marker);
    app.exit(code);
}
setTimeout(() => { console.error('Scene regression test timed out'); finish(1); }, 30000);
app.on('browser-window-created', (_event, win) => win.webContents.on('did-finish-load', async () => {
    if (!win.webContents.getURL().endsWith('/renderer/index.html')) return;
    try {
        win.webContents.setBackgroundThrottling(false);
        win.setOpacity(0); showInactive.call(win);
        const result = await win.webContents.executeJavaScript(`(async()=>{
            window._rafSuspended=false;effectsPerformance.setFps(60);
            const wait=ms=>new Promise(r=>setTimeout(r,ms));
            const until=async predicate=>{const end=performance.now()+3000;while(!predicate()){if(performance.now()>end)throw new Error('Scene scheduling did not settle');await wait(20);}};
            const theme=(await noctune.sceneThemes.list()).themes.find(t=>t.id==='builtin-rain-window');
            await sceneThemes.activate(theme);
            await until(()=>sceneThemes.performance.frames>2);
            const worker=sceneThemes.performance;
            document.getElementById('settings-fab').click();
            await until(()=>sceneThemes.performance.frameLimit===30);const panel=sceneThemes.performance;
            document.getElementById('settings-close-btn').click();
            await until(()=>sceneThemes.performance.frameLimit===60);const restored=sceneThemes.performance;
            appStorage.setItem('setting_scene_motion','0');sceneThemes.preferencesChanged();sceneThemes.audio(null,44100,false);await wait(2200);
            const staticBefore=sceneThemes.performance.frames;await wait(250);const staticAfter=sceneThemes.performance.frames;
            appStorage.setItem('setting_scene_motion','1');sceneThemes.preferencesChanged();
            await until(()=>sceneThemes.performance.frames>staticAfter);
            window._rafSuspended=true;await wait(100);const hiddenBefore=sceneThemes.performance.frames;await wait(250);const hiddenAfter=sceneThemes.performance.frames;
            window._rafSuspended=false;await until(()=>sceneThemes.performance.frames>hiddenAfter);
            return {worker,panel,restored,staticBefore,staticAfter,hiddenBefore,hiddenAfter,resumed:sceneThemes.performance.frames};
        })()`);
        assert.equal(result.worker.runtime, 'worker');
        assert.equal(result.panel.frameLimit, 30); assert.equal(result.restored.frameLimit, 60);
        assert.equal(result.staticBefore, result.staticAfter); assert.equal(result.hiddenBefore, result.hiddenAfter);
        assert.ok(result.resumed > result.hiddenAfter);
        domTheme = true;
        const fallback = await win.webContents.executeJavaScript(`(async()=>{
            const theme=(await noctune.sceneThemes.list()).themes.find(t=>t.id==='builtin-rain-window');
            await sceneThemes.activate(theme);const runtime=sceneThemes.performance.runtime;
            sceneThemes.deactivate();return {runtime,remaining:document.querySelectorAll('.scene-frame').length};
        })()`);
        assert.equal(fallback.runtime, 'iframe'); assert.equal(fallback.remaining, 0);
        console.log('PASS: Worker rendering, panel frame budget, cadence restoration, static/tray suspension, resume, DOM fallback and teardown.');
        finish(0);
    } catch (error) { console.error(error); finish(1); }
}));
require('../src/main/index.js');
// Fixture scripts exercise the real host without rewriting or loading a second copy of it.
const store = createSceneThemeStore({
    directory: () => path.join(out, 'themes'), builtinDirectory: path.join(root, 'themes/builtin'),
    sdkFile: path.join(root, 'src/renderer/effects/scene-sdk.js'), presetsDirectory: path.join(root, 'themes/backgrounds'),
});
ipcMain.removeHandler('scene-themes:read');
ipcMain.handle('scene-themes:read', async (_event, id) => {
    const pkg = await store.read(id);
    if (domTheme) pkg.script = 'document.title="DOM compatibility";\n' + pkg.script;
    pkg.script += '\nconst original=window.__noctuneScene.render;window.__noctuneScene.render=(api,frame)=>{const end=performance.now()+12;while(performance.now()<end){};return original(api,frame)};';
    return pkg;
});
