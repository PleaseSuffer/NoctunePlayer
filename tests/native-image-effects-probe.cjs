const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { createBackgroundMaskCache } = require('../src/main/cache/background-mask-cache');
app.whenReady().then(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'noctune-image-probe-'));
    let win;
    let retained = [], writes = 0;
    const cacheDir = path.join(root,'masks');
    const cache = createBackgroundMaskCache({ directory:() => cacheDir, retainedPaths:() => retained });
    try {
        const project = path.resolve(__dirname,'..');
        const renderer = path.join(project,'src/renderer');
        const html = await fs.readFile(path.join(renderer,'index.html'),'utf8');
        const css = await fs.readFile(path.join(renderer,'styles/app.css'),'utf8');
        const settingsCode = await fs.readFile(path.join(renderer,'ui/settings.js'),'utf8');
        const settingsNavigation = settingsCode.slice(0,settingsCode.indexOf('            // ---- GENERAL: Playlist editor ----')) + '})();';
        const audioCode = await fs.readFile(path.join(renderer,'effects/image-audio-response.js'),'utf8');
        let code = (await fs.readFile(path.join(renderer,'effects/image-effects.js'),'utf8')).replace('const palette = getPalette();', 'window.imageProbe={levels:[...levels],input:[...input],reactive:{...reactive},waveRadii:pulses.waves.items.map(p=>p.radius),rippleRadii:pulses.ripple.items.map(p=>p.radius),particleCount:particles.length,channelShift:[...channelShift],playing,config:{...config},width:overlay.width,height:overlay.height,sourceWidth:source.width,sourceHeight:source.height,maskWidth:sharp.width,maskHeight:sharp.height,sharp:!!sharp};const palette = getPalette();');
        code = code.replace('gl.drawArrays(gl.TRIANGLES,0,6);', 'gl.drawArrays(gl.TRIANGLES,0,6);if(window.checkQuality){const pixels=new Uint8Array(48*4);gl.readPixels(400,100,48,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels);window.checkerRed=Array.from(pixels).filter((_,i)=>i%4===0);}');
        const controls = html.slice(html.indexOf('<div id="image-effects-settings"'),html.indexOf('<div class="settings-section-title">Waveform</div>'));
        const dialog = html.slice(html.indexOf('<dialog id="image-mask-dialog"'),html.indexOf('</dialog>',html.indexOf('<dialog id="image-mask-dialog"'))+9);
        const preload = path.join(root,'preload.cjs');
        await fs.writeFile(preload, `const {contextBridge,ipcRenderer}=require('electron'); const {pathToFileURL}=require('node:url'); contextBridge.exposeInMainWorld('noctune',{fs:{toFileUrl:file=>pathToFileURL(file).href},backgroundMasks:{get:file=>ipcRenderer.invoke('mask:get',file),set:payload=>ipcRenderer.invoke('mask:set',payload),remove:file=>ipcRenderer.invoke('mask:remove',file)}});`);
        ipcMain.handle('mask:get', (_e,file) => cache.get(file));
        ipcMain.handle('mask:set', async (_e,payload) => { const result=await cache.set(payload); if(result) writes++; return result; });
        ipcMain.handle('mask:remove', (_e,file) => cache.remove(file));
        const page = path.join(root,'index.html');
        await fs.writeFile(page, `<html><head><base href="${pathToFileURL(path.join(renderer,'index.html')).href}"><style>${css} body{display:block;padding:12px;} #custom-bg-image{position:relative;height:360px;width:640px;} #image-effects-settings{width:640px;} .settings-row{padding:8px 0;}</style></head><body data-theme="dark"><div id="custom-bg-image"></div><button id="settings-fab"></button><div id="settings-overlay"><button id="settings-close-btn"></button><div class="settings-content"><div class="settings-panel active"><div class="settings-section-title">Фон</div>${controls}<div class="settings-section-title">Waveform</div></div></div><div id="settings-toc"></div></div>${dialog}</body></html>`);
        win = new BrowserWindow({ show:true, width:900,height:950, webPreferences:{ preload, sandbox:false, backgroundThrottling:false } });
        win.webContents.on('console-message', event => { if (['error','warning'].includes(event.level)) console.error(event.message); });
        await win.loadFile(page);
        const png = await win.webContents.executeJavaScript(`(() => { const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const c=canvas.getContext('2d');c.fillStyle='#13283d';c.fillRect(0,0,640,360);c.fillStyle='#e9edf5';c.beginPath();c.arc(490,70,36,0,Math.PI*2);c.fill();for(let i=0;i<8;i++){c.fillStyle=i%2?'#253754':'#3c536d';c.fillRect(i*80,150+i%3*20,65,210);c.fillStyle='#ffeeaa';for(let y=170;y<330;y+=35)c.fillRect(i*80+18,y,14,18);}return canvas.toDataURL('image/png').split(',')[1];})()`);
        const image=path.join(root,'фон с пробелом.png'); await fs.writeFile(image,Buffer.from(png,'base64')); retained=[image];
        await win.webContents.executeJavaScript(`window.appStorage={data:{},getItem(k){return this.data[k]??null},setItem(k,v){this.data[k]=String(v)}};window.requestEffectsFrame=callback=>requestAnimationFrame(callback);window.bgImageEnabled=true;window.bgImageIsVideo=false;window.bgImageFit='cover';window.isPlaying=true;window.gpuDraws=0;const originalGetContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,options){if(type==='webgl')return ${process.argv.includes('--fallback')?'null':"originalGetContext.call(this,type,{...options,preserveDrawingBuffer:true})"};return originalGetContext.call(this,type,options)};const originalDraw=WebGLRenderingContext.prototype.drawArrays;WebGLRenderingContext.prototype.drawArrays=function(...args){window.gpuDraws++;return originalDraw.apply(this,args)};${settingsNavigation};${audioCode};${code}`);
        async function evaluate(code) { return win.webContents.executeJavaScript(code); }
        async function waitFor(condition) {
            const until=Date.now()+10000;
            while(Date.now()<until) { if(await evaluate(condition)) return; await new Promise(resolve=>setTimeout(resolve,40)); }
            throw new Error('Timeout: '+condition+'; '+await evaluate("document.getElementById('image-effects-status').textContent"));
        }
        await evaluate(`window.fixture=${JSON.stringify(image)};document.getElementById('custom-bg-image').style.backgroundImage='url('+noctune.fs.toFileUrl(window.fixture)+')';imageEffects.select(window.fixture)`);
        assert.equal(await evaluate("document.getElementById('image-effects-settings').hidden"),false);
        assert.ok(await evaluate("[...document.querySelectorAll('.settings-toc-item')].some(item=>item.textContent==='Визуальные эффекты')"),'section navigation updates immediately after selecting the image');
        assert.ok(await evaluate("document.querySelector('#image-effects-settings > .settings-card').getBoundingClientRect().top-document.querySelector('#image-effects-settings > .settings-section-title').getBoundingClientRect().bottom>=20"),'section title has the common 20px gap');
        assert.equal(writes,0,'disabled effects do not prepare masks');
        await evaluate("imageEffects.applyAppearance({enabled:true,contours:true,waves:true,highlights:true,sparks:true,ripple:true,chromatic:true,strength:1});imageEffects.audio(new Uint8Array(256).fill(200),44100,true)");
        await waitFor("document.getElementById('image-effects-status').textContent==='' || document.getElementById('image-effects-status').textContent.includes('Упрощённая')");
        assert.equal(writes,1,'first image analysis persists exactly one base mask');
        await waitFor("window.gpuDraws>0 || document.getElementById('image-effects-status').textContent.includes('Упрощённая')");
        const gpu = await evaluate('window.gpuDraws>0');
        // Preview and per-image sensitivity, including persistence and right-click reset.
        await evaluate("document.getElementById('image-effects-edit-mask').click()");
        await waitFor("document.getElementById('image-mask-preview').width===640 && document.getElementById('image-mask-status').textContent===''");
        const pixelsBefore=await evaluate("document.getElementById('image-mask-preview').toDataURL()");
        await evaluate("const sensitivity=document.getElementById('image-mask-sensitivity');sensitivity.value=90;sensitivity.dispatchEvent(new Event('input'))");
        await new Promise(resolve=>setTimeout(resolve,250));
        const pixelsAfter=await evaluate("document.getElementById('image-mask-preview').toDataURL()");
        assert.notEqual(pixelsBefore,pixelsAfter,'one slider changes the actual preview mask');
        assert.equal(await evaluate("JSON.parse(appStorage.getItem('setting_bg_mask_tuning'))[window.fixture]"),90);
        await evaluate("document.getElementById('image-mask-sensitivity').dispatchEvent(new MouseEvent('contextmenu',{cancelable:true,button:2}));document.getElementById('image-mask-close').click()");
        assert.equal(await evaluate("JSON.parse(appStorage.getItem('setting_bg_mask_tuning'))[window.fixture]"),50);
        await evaluate('imageEffects.select(window.fixture)');
        await waitFor("document.getElementById('image-effects-status').textContent==='' || document.getElementById('image-effects-status').textContent.includes('Упрощённая')");
        assert.equal(writes,1,'cached image does not repeat pixel analysis');
        await evaluate(`(async()=>{
            window.sceneImage=new Image();sceneImage.src=noctune.fs.toFileUrl(window.fixture);await sceneImage.decode();
            window.snapshotEffect=()=>{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const c=canvas.getContext('2d');c.drawImage(sceneImage,0,0,640,360);for(const overlay of document.querySelectorAll('#custom-bg-image > canvas'))if(!overlay.hidden)c.drawImage(overlay,0,0,640,360);return canvas.toDataURL()};
        })()`);
        const none={enabled:true,contours:false,waves:false,highlights:false,sparks:false,ripple:false,chromatic:false,strength:2};
        await evaluate('imageEffects.applyAppearance('+JSON.stringify(none)+')');
        const plain=await evaluate('window.snapshotEffect()');
        const signatures=[];
        for(const effect of ['contours','waves','highlights','sparks','ripple','chromatic']) {
            await evaluate('imageEffects.applyAppearance('+JSON.stringify({...none,[effect]:true})+');imageEffects.select(window.fixture)');
            await waitFor("document.getElementById('image-effects-status').textContent==='' || document.getElementById('image-effects-status').textContent.includes('Упрощённая')");
            await evaluate('imageEffects.audio(new Uint8Array(256).fill(255),44100,true)');
            await new Promise(resolve=>setTimeout(resolve,170));
            const signature=await evaluate('window.snapshotEffect()');
            assert.ok(signature!==plain,effect+' visibly changes the rendered image; '+JSON.stringify(await evaluate('window.imageProbe')));
            signatures.push(signature);
        }
        assert.equal(new Set(signatures).size,6,'each effect has distinct rendered output');
        await evaluate('imageEffects.applyAppearance({enabled:true,contours:true,waves:true,highlights:true,sparks:true,ripple:true,chromatic:true,strength:1})');
        for (const fit of ['cover','contain','fill']) for (const theme of ['dark','light']) {
            await evaluate(`window.bgImageFit='${fit}';document.body.setAttribute('data-theme','${theme}');imageEffects.layout();imageEffects.audio(new Uint8Array(256).fill(180),44100,true)`);
            await new Promise(resolve=>setTimeout(resolve,80));
            assert.equal(await evaluate("document.getElementById('image-effects-settings').hidden"),false);
        }
        // Sustain settles; fresh treble-only audio must still pulse chromatic separation.
        await evaluate('imageEffects.applyAppearance({enabled:true,contours:true,chromatic:true});imageEffects.audio(new Uint8Array(256).fill(100),44100,true)');
        await new Promise(resolve=>setTimeout(resolve,1800));
        const steady=await evaluate('window.imageProbe.reactive');
        await evaluate('const treble=new Uint8Array(256).fill(100);treble.fill(250,35,140);imageEffects.audio(treble,44100,true)');
        await new Promise(resolve=>setTimeout(resolve,100));
        const accent=await evaluate('window.imageProbe.reactive');
        assert.ok(accent.chromatic>steady.chromatic*2,'mid/treble transient visibly drives chromatic without a bass change: '+JSON.stringify({steady,accent}));
        assert.ok(accent.contours>steady.contours*1.7,'contour glow responds to musical changes');
        await evaluate('imageEffects.audio(null,44100,false)');
        await new Promise(resolve=>setTimeout(resolve,1200));
        assert.ok(await evaluate('window.imageProbe.reactive.contours<.005 && window.imageProbe.reactive.chromatic<.005'),'effects fade on pause');
        const parameterControls=await evaluate(`(() => {
            const input=document.getElementById('image-effects-chromaticDistance');
            input.value=30;input.dispatchEvent(new Event('input'));
            const persisted=JSON.parse(appStorage.getItem('setting_image_effects')).parameters.chromaticDistance;
            input.dispatchEvent(new MouseEvent('contextmenu',{cancelable:true,button:2}));
            return {persisted, reset:imageEffects.appearance().parameters.chromaticDistance, shown:!document.getElementById('image-effects-chromatic-details').hidden, hidden:document.getElementById('image-effects-waves-details').hidden};
        })()`);
        assert.deepEqual(parameterControls,{persisted:30,reset:14,shown:true,hidden:true});
        // Absolute loudness gates suppress quiet audio even when it has strong normalized transients.
        await evaluate('imageEffects.applyAppearance({enabled:true,contours:true,waves:true,highlights:true,sparks:true,ripple:true,chromatic:true,parameters:{contoursThreshold:.3,wavesThreshold:.3,highlightsThreshold:.3,sparksThreshold:.3,rippleThreshold:.3,chromaticThreshold:.3}});imageEffects.select(window.fixture)');
        await waitFor("document.getElementById('image-effects-status').textContent==='' || document.getElementById('image-effects-status').textContent.includes('Упрощённая')");
        await evaluate('imageEffects.audio(new Uint8Array(256).fill(40),44100,true)');
        await new Promise(resolve=>setTimeout(resolve,150));
        assert.ok(await evaluate('Object.values(imageProbe.reactive).every(value=>value===0) && imageProbe.waveRadii.length===0 && imageProbe.rippleRadii.length===0 && imageProbe.particleCount===0'),'all six effects ignore quiet transients');
        await evaluate("const threshold=document.getElementById('image-effects-wavesThreshold');threshold.value=0;threshold.dispatchEvent(new Event('input'));imageEffects.audio(new Uint8Array(256),44100,true)");
        await new Promise(resolve=>setTimeout(resolve,270));
        await evaluate('imageEffects.audio(new Uint8Array(256).fill(40),44100,true)');
        await new Promise(resolve=>setTimeout(resolve,120));
        assert.ok(await evaluate('imageProbe.waveRadii.length>0 && imageProbe.rippleRadii.length===0 && imageProbe.particleCount===0 && Object.values(imageProbe.reactive).every(value=>value===0)'),'thresholds operate independently');
        assert.equal(await evaluate("JSON.parse(appStorage.getItem('setting_image_effects')).parameters.wavesThreshold"),0,'threshold changes persist');
        await evaluate('imageEffects.audio(new Uint8Array(256),44100,true)');
        await new Promise(resolve=>setTimeout(resolve,270));
        await evaluate('imageEffects.audio(new Uint8Array(256).fill(230),44100,true)');
        await new Promise(resolve=>setTimeout(resolve,120));
        assert.ok(await evaluate('Object.values(imageProbe.reactive).every(value=>value>.1) && imageProbe.rippleRadii.length>0 && imageProbe.particleCount>0'),'loud audio still triggers all effects');
        await evaluate("threshold.value=.3;threshold.dispatchEvent(new Event('input'));threshold.dispatchEvent(new MouseEvent('contextmenu',{cancelable:true,button:2}))");
        assert.equal(await evaluate('imageEffects.appearance().parameters.wavesThreshold'),0,'right-click restores the ungated default');
        // Rapid triggers add bounded instances instead of resetting their progress.
        await evaluate('imageEffects.applyAppearance({enabled:true,waves:true,ripple:true,sparks:true,parameters:{wavesLimit:3,rippleLimit:2,sparksLimit:20,wavesSensitivity:3,rippleSensitivity:3,sparksSensitivity:3,wavesSpeed:.15,rippleSpeed:.15,sparksCount:40,sparksLifetime:2.5}});imageEffects.select(window.fixture)');
        await waitFor("document.getElementById('image-effects-status').textContent==='' || document.getElementById('image-effects-status').textContent.includes('Упрощённая')");
        let previousWave=0,previousRipple=0;
        for(let beat=0;beat<5;beat++) {
            await evaluate('imageEffects.audio(new Uint8Array(256),44100,true)');
            await new Promise(resolve=>setTimeout(resolve,270));
            await evaluate('imageEffects.audio(new Uint8Array(256).fill(255),44100,true)');
            await new Promise(resolve=>setTimeout(resolve,120));
            const instances=await evaluate('({waves:imageProbe.waveRadii,ripple:imageProbe.rippleRadii,sparks:imageProbe.particleCount})');
            assert.ok(instances.waves.length<=3 && instances.ripple.length<=2 && instances.sparks<=20,'all configured limits hold');
            assert.ok(instances.waves[0]>previousWave && instances.ripple[0]>previousRipple,'the oldest waves keep advancing through every new beat');
            previousWave=instances.waves[0];previousRipple=instances.ripple[0];
            if(beat>=2) { assert.equal(instances.waves.length,3); assert.equal(instances.ripple.length,2); }
        }
        // Color selectors match the existing dropdowns, including keyboard controls.
        for(const effect of ['contours','waves','highlights','sparks']) {
            await evaluate(`(() => {imageEffects.applyAppearance({...imageEffects.appearance(),[${JSON.stringify(effect)}]:true});const root=document.getElementById('image-effects-${effect}-color');const button=root.querySelector('button');button.click();button.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));document.activeElement.click()})()`);
            assert.equal(await evaluate(`imageEffects.appearance().colors.${effect}.mode`),'gradient');
            await evaluate(`(() => {document.querySelector('#image-effects-${effect}-color [data-mode="custom"]').click();const picker=document.getElementById('image-effects-${effect}-color-picker');picker.value='#ff4400';picker.dispatchEvent(new Event('input'))})()`);
            assert.equal(await evaluate(`document.getElementById('image-effects-${effect}-custom-color').checkVisibility()`),true);
            assert.deepEqual(await evaluate(`imageEffects.appearance().colors.${effect}`),{mode:'custom',custom:'#ff4400'});
            for(const theme of ['dark','light']) {
                const styles=await evaluate(`(() => {document.body.setAttribute('data-theme','${theme}');const css=e=>{const s=getComputedStyle(e);return [s.backgroundColor,s.padding,s.fontSize,s.borderRadius,s.boxShadow]};return {menu:css(document.querySelector('#image-effects-${effect}-color [role="listbox"]')),reference:css(document.querySelector('#image-effects-contours-color [role="listbox"]'))};})()`);
                assert.deepEqual(styles.menu,styles.reference);
            }
        }
        // Use identical audio and compare actual rendered tint after changing only color.
        await evaluate('imageEffects.applyAppearance({enabled:true,contours:true,colors:{contours:{mode:"custom",custom:"#ff0000"}}});imageEffects.select(window.fixture)');
        await waitFor("document.getElementById('image-effects-status').textContent==='' || document.getElementById('image-effects-status').textContent.includes('Упрощённая')");
        await evaluate('imageEffects.audio(new Uint8Array(256).fill(200),44100,true)');
        await new Promise(resolve=>setTimeout(resolve,100));
        const redTint=await evaluate('window.snapshotEffect()');
        await evaluate('imageEffects.applyAppearance({...imageEffects.appearance(),colors:{contours:{mode:"custom",custom:"#00ff00"}}})');
        await new Promise(resolve=>setTimeout(resolve,100));
        assert.notEqual(await evaluate('window.snapshotEffect()'),redTint,'custom colors change actual pixels');
        const saved=await evaluate('imageEffects.appearance()');
        await evaluate('imageEffects.applyAppearance({});imageEffects.applyAppearance('+JSON.stringify(saved)+')');
        assert.deepEqual(await evaluate('imageEffects.appearance()'),saved,'theme settings round trip');
        await evaluate('window.bgImageEnabled=false;imageEffects.refreshVisibility()');
        assert.equal(await evaluate("document.getElementById('image-effects-settings').hidden"),true);
        assert.ok(await evaluate("![...document.querySelectorAll('.settings-toc-item')].some(item=>item.textContent==='Визуальные эффекты')"),'section navigation removes unavailable effects immediately');
        await evaluate('window.bgImageEnabled=true;window.bgImageIsVideo=true;imageEffects.select(window.fixture)');
        assert.equal(await evaluate("document.getElementById('image-effects-settings').hidden"),true,'video does not expose static effects');
        await evaluate('window.bgImageIsVideo=false;imageEffects.select(window.fixture)');
        await waitFor("document.getElementById('image-effects-status').textContent==='' || document.getElementById('image-effects-status').textContent.includes('Упрощённая')");
        await evaluate('imageEffects.remove(window.fixture);imageEffects.select(null)');
        await new Promise(resolve=>setTimeout(resolve,100));
        assert.equal((await fs.readdir(cacheDir)).length,0,'removing active background removes its mask');
        assert.equal(await evaluate("JSON.parse(appStorage.getItem('setting_bg_mask_tuning'))[window.fixture]===undefined"),true);
        // FullHD and 4K one-pixel stripes expose any downsampled source or backing canvas.
        for(const [width,height,pixelRatio] of [[1920,1080,1],[3840,2160,2]]) {
            const highRes=path.join(root,`stripes-${width}.png`);
            const png=await evaluate(`(() => {const canvas=document.createElement('canvas');canvas.width=${width};canvas.height=${height};const c=canvas.getContext('2d');c.fillStyle='#000';c.fillRect(0,0,canvas.width,canvas.height);c.fillStyle='#fff';for(let x=1;x<canvas.width;x+=2)c.fillRect(x,0,1,canvas.height);return canvas.toDataURL('image/png').split(',')[1];})()`);
            await fs.writeFile(highRes,Buffer.from(png,'base64'));retained=[highRes];
            await evaluate(`Object.defineProperty(window,'devicePixelRatio',{configurable:true,value:${pixelRatio}});document.getElementById('custom-bg-image').style.width='1920px';document.getElementById('custom-bg-image').style.height='1080px';window.checkQuality=true;window.checkerRed=null;imageEffects.applyAppearance({enabled:true,contours:true});imageEffects.select(${JSON.stringify(highRes)})`);
            await waitFor(`window.imageProbe?.sourceWidth===${width} && window.imageProbe?.maskWidth<=960 && (window.checkerRed || document.getElementById('image-effects-status').textContent.includes('Упрощённая'))`);
            const dimensions=await evaluate('({source:[imageProbe.sourceWidth,imageProbe.sourceHeight],render:[imageProbe.width,imageProbe.height],mask:[imageProbe.maskWidth,imageProbe.maskHeight]})');
            assert.deepEqual(dimensions.source,[width,height],'rendering keeps the original image');
            assert.deepEqual(dimensions.render,[width,height],'backing canvas matches the window at the screen pixel ratio');
            assert.ok(dimensions.mask[0]*dimensions.mask[1]<=960*540,'analysis remains bounded');
            if(gpu) {
                const reds=await evaluate('window.checkerRed');
                assert.ok(reds.every((red,i)=>i%2 ? red>240 : red<15),'one-pixel stripes survive the actual shader at '+width+'px: '+reds);
            }
            await evaluate('imageEffects.select(null)');await cache.remove(highRes);
        }
        await evaluate("window.checkQuality=false;Object.defineProperty(window,'devicePixelRatio',{configurable:true,value:1});document.getElementById('custom-bg-image').style.width='640px';document.getElementById('custom-bg-image').style.height='360px';imageEffects.layout()");
        retained=[image];
        if(process.argv.includes('--preview')) {
            await evaluate('imageEffects.select(window.fixture)');
            await evaluate('imageEffects.audio(new Uint8Array(256).fill(200),44100,true)');
            await waitFor("document.getElementById('image-effects-status').textContent==='' || document.getElementById('image-effects-status').textContent.includes('Упрощённая')");
            await fs.writeFile('/tmp/noctune-image-effects-preview.png',(await win.webContents.capturePage()).toPNG());
        }
        console.log('PASS: real worker masks, '+(gpu?'WebGL effects':'Canvas fallback')+', preview sensitivity, cached reuse, theme persistence, background/video gating, deletion cleanup, concurrent pulse limits, color modes, independent quiet thresholds and FullHD/4K detail at 1×/2× display scaling.');
    } catch(error) { console.error(error);process.exitCode=1; }
    finally { win?.destroy(); await fs.rm(root,{recursive:true,force:true}); app.exit(process.exitCode||0); }
});
