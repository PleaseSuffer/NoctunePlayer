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
let domTheme = false, apiV2Mode = null, finished = false;
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
        for (const mode of ['worker','iframe']) {
            apiV2Mode=mode;
            const v2=await win.webContents.executeJavaScript(`(async()=>{
                const theme=(await noctune.sceneThemes.list()).themes.find(t=>t.id==='builtin-rain-window');
                sceneThemes.diagnostics(true);await sceneThemes.activate(theme);
                sceneThemes.setParameter('waves',1.2000000000000002);
                const tail={value:sceneThemes.parameters.waves,text:document.querySelector('[data-parameter-value="waves"]').textContent,
                    saved:JSON.parse(appStorage.getItem('setting_scene_preferences'))[sceneThemes.metadata.packageId].waves};
                sceneThemes.setParameter('waves',1.74);sceneThemes.setParameter('crown',false);sceneThemes.setParameter('style','unknown');
                document.getElementById('settings-fab').click();document.querySelector('[data-panel="panel-appearance"]').click();
                document.getElementById('scene-custom-waves').closest('.settings-row').scrollIntoView({block:'center'});
                await new Promise(r=>setTimeout(r,160));
                const result={performance:sceneThemes.performance,parameters:sceneThemes.parameters,apiVersion:sceneThemes.metadata.apiVersion,
                    ui:document.querySelector('[data-parameter="waves"]')?.value,tail,
                    styledToggle:document.querySelector('[data-parameter="crown"]').parentElement.classList.contains('toggle-switch'),
                    sliderWidth:document.querySelector('[data-parameter="waves"]').getBoundingClientRect().width,
                    builtinWidth:document.getElementById('scene-glowIntensity').getBoundingClientRect().width,
                    selectRadius:getComputedStyle(document.querySelector('[data-parameter="style"]')).borderRadius};
                document.getElementById('settings-close-btn').click();
                await sceneThemes.activate(theme);result.restored=sceneThemes.parameters;
                sceneThemes.deactivate();result.remaining=document.querySelectorAll('.scene-frame').length;return result;
            })()`);
            assert.equal(v2.performance.runtime,mode);assert.equal(v2.apiVersion,2);assert.equal(v2.remaining,0);
            assert.ok(Math.abs(v2.parameters.waves-1.7)<1e-9);assert.equal(v2.parameters.crown,false);assert.equal(v2.parameters.style,'line');
            assert.ok(Math.abs(v2.restored.waves-1.7)<1e-9);assert.ok(Math.abs(Number(v2.ui)-1.7)<1e-9);
            assert.deepEqual(v2.tail,{value:1.2,text:'1.2',saved:1.2});assert.equal(v2.styledToggle,true);
            assert.ok(v2.sliderWidth>200);assert.ok(Math.abs(v2.sliderWidth-v2.builtinWidth)<1);assert.equal(v2.selectRadius,'6px');
            assert.ok(Number.isFinite(v2.performance.p95));
            if(mode==='iframe')assert.equal(v2.performance.fallbackReason,'runtimeRequirements.dom');
        }
        apiV2Mode='demo';
        await win.webContents.executeJavaScript(`(async()=>{
            const theme=(await noctune.sceneThemes.list()).themes.find(t=>t.id==='builtin-rain-window');
            await sceneThemes.activate(theme);document.getElementById('settings-fab').click();document.querySelector('[data-panel="panel-appearance"]').click();
            document.getElementById('scene-custom-waves').closest('.settings-row').scrollIntoView({block:'center'});
            const dark=document.getElementById('setting-dark-theme');dark.checked=true;dark.dispatchEvent(new Event('change'));await new Promise(r=>setTimeout(r,500));
        })()`);
        fs.writeFileSync(path.join(out,'theme-settings-dark.png'),(await win.webContents.capturePage()).toPNG());
        await win.webContents.executeJavaScript(`(async()=>{const dark=document.getElementById('setting-dark-theme');dark.checked=false;dark.dispatchEvent(new Event('change'));await new Promise(r=>setTimeout(r,500));})()`);
        fs.writeFileSync(path.join(out,'theme-settings-light.png'),(await win.webContents.capturePage()).toPNG());
        await win.webContents.executeJavaScript(`sceneThemes.deactivate();document.getElementById('settings-close-btn').click();`);
        const demo=await win.webContents.executeJavaScript(`(async()=>{
            const theme=(await noctune.sceneThemes.list()).themes.find(t=>t.id==='builtin-rain-window');
            appStorage.setItem('setting_scene_motion','1');sceneThemes.preferencesChanged();await sceneThemes.activate(theme);
            sceneThemes.audio(new Uint8Array(4096).fill(180),48000,true);await new Promise(r=>setTimeout(r,300));
            return {runtime:sceneThemes.performance.runtime,parameters:sceneThemes.parameters};
        })()`);
        assert.equal(demo.runtime,'worker');assert.equal(demo.parameters.waves,2);
        await win.webContents.executeJavaScript(`document.querySelector('.scene-frame').style.zIndex='10000'`);
        fs.writeFileSync(path.join(out,'api-v2-demo.png'),(await win.webContents.capturePage()).toPNG());
        console.log('PASS: Worker rendering, panel/static/tray scheduling, DOM fallback; API v2 in Worker/iframe, Canvas mask/inverse pixels, callback isolation, typed controls, persisted values, diagnostics and teardown.');
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
    if(apiV2Mode==='demo')return {...JSON.parse(fs.readFileSync(path.join(root,'themes/packages/api-v2-demo.noctheme'),'utf8')),sdk:pkg.sdk};
    if(apiV2Mode){
        pkg.apiVersion=2;Object.assign(pkg.manifest,{apiVersion:2,width:320,height:180,runtimeRequirements:{dom:apiV2Mode==='iframe'},
            parameterSchema:{waves:{type:'slider',label:'Waves',min:0,max:2,step:.1,default:1},crown:{type:'toggle',label:'Crown',default:true},style:{type:'select',label:'Style',default:'line',options:[{value:'line',label:'Line'},{value:'bars',label:'Bars'}]}}});
        pkg.script=`NoctuneScene.define({
            init(api){
                if(api.apiVersion!==2)throw Error('Wrong API version');
                const mask=api.createSurface(320,180);const ctx=mask.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,160,180);api.replaceImage('outside',mask);
            },
            render(api,frame){
                const c=api.ctx,transform=c.getTransform();c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,api.canvas.width,api.canvas.height);
                // Pixel tests run at logical resolution independently of the viewport cover transform.
                const original=api.canvas;const target=api.createSurface(320,180);api.ctx=target.getContext('2d');
                try{
                    api.ctx.fillStyle='#0000ff';api.ctx.fillRect(0,0,320,180);
                    const red=()=>{api.ctx.fillStyle='#ff0000';api.ctx.fillRect(0,0,320,180);};
                    api.clipMask('outside',red);
                    let left=api.ctx.getImageData(40,90,1,1).data,right=api.ctx.getImageData(240,90,1,1).data;
                    if(left[0]!==255||right[2]!==255||right[0]!==0)throw Error('Mask alpha pixels');
                    api.ctx.fillStyle='#0000ff';api.ctx.fillRect(0,0,320,180);api.clipMask('outside',red,{invert:true});
                    left=api.ctx.getImageData(40,90,1,1).data;right=api.ctx.getImageData(240,90,1,1).data;
                    if(left[2]!==255||left[0]!==0||right[0]!==255)throw Error('Inverse mask pixels');
                    const before=api.ctx;try{api.clipMask('outside',()=>{throw Error('expected');});}catch(e){if(e.message!=='expected')throw e;}if(api.ctx!==before)throw Error('Context leaked');
                    const source=api.bandsSource({count:32});api.bars({x:0,y:100,width:320,height:80,source});api.line({x:0,y:100,width:320,height:80,source});
                    api.radialSpectrum({x:160,y:90,radius:30,height:20,source});api.waterRipple({x:160,y:140});
                    api.reflection({baseline:100,height:70,mask:'outside',invert:true},red);
                    const p=api.sceneToScreen(100,80),q=api.screenToScene(p.x,p.y);if(Math.abs(q.x-100)>.001||Math.abs(q.y-80)>.001)throw Error('Coordinates');
                }finally{api.ctx=c;api.releaseSurface(target);}
                c.setTransform(transform);api.layer('outside');
            }
        });`;
        return pkg;
    }
    if (domTheme) pkg.script = 'document.title="DOM compatibility";\n' + pkg.script;
    pkg.script += '\nconst original=window.__noctuneScene.render;window.__noctuneScene.render=(api,frame)=>{const end=performance.now()+12;while(performance.now()<end){};return original(api,frame)};';
    return pkg;
});
