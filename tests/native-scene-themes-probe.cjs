const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { packDirectory } = require('../src/main/scene-themes');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'tests/.artifacts/scene-themes/previews');
let fullAppWindow;
if (process.argv.includes('--full-app')) {
    const userData = path.join(root, 'tests/.artifacts/scene-themes/probe-user-data');
    require('node:fs').mkdirSync(userData, { recursive: true }); app.setPath('userData', userData);
    // Keep the real main/preload/renderer startup invisible and isolate its settings from the user's profile.
    BrowserWindow.prototype.show = function () {};
    BrowserWindow.prototype.showInactive = function () {};
    fullAppWindow = new Promise(resolve => app.on('browser-window-created', (_event, win) => win.webContents.on('did-finish-load', () => {
        if (win.webContents.getURL().endsWith('/src/renderer/index.html')) resolve(win);
    })));
    require('../src/main/index.js');
}
app.whenReady().then(async () => {
    if (fullAppWindow) {
        const win = await Promise.race([fullAppWindow, new Promise((_, reject) => setTimeout(() => reject(new Error('App startup timeout')), 20000))]);
        const startup = await win.webContents.executeJavaScript(`({bridge:!!backgroundSettings,gallery:document.querySelectorAll('#bg-presets-list .scene-tile').length,tabs:document.querySelectorAll('.appearance-tabs [role=tab]').length})`);
        assert.ok(startup.bridge); assert.equal(startup.tabs, 0);
        await win.webContents.executeJavaScript(`(async()=>{for(const theme of (await noctune.sceneThemes.list()).themes.filter(t=>t.builtin))await sceneThemes.activate(theme);})()`);
        const state = await win.webContents.executeJavaScript(`(async()=>{ const list=await noctune.sceneThemes.list();await sceneThemes.activate(list.themes[0]); const result={active:sceneThemes.active,name:sceneThemes.metadata.name,enabled:document.getElementById('setting-scene-enabled').checked,background:document.getElementById('setting-bg-image-enabled').checked}; document.getElementById('setting-scene-enabled').checked=false;document.getElementById('setting-scene-enabled').dispatchEvent(new Event('change'));result.off=!sceneThemes.active;return result;})()`);
        assert.ok(state.active && state.enabled && state.off);
        assert.equal(state.background,false,'theme activation disables the ordinary background');
        const off = await win.webContents.executeJavaScript(`({checked:document.getElementById('setting-bg-image-enabled').checked,saved:appStorage.getItem('setting_bg_image_enabled')})`);
        assert.equal(off.checked, false); assert.equal(off.saved, '0');
        const resumed = await win.webContents.executeJavaScript(`(async()=>{
            const retained=appStorage.getItem('setting_scene_theme')==='builtin-rain-window';
            const toggle=document.getElementById('setting-scene-enabled');toggle.checked=true;toggle.dispatchEvent(new Event('change'));
            const start=Date.now();while(!sceneThemes.active&&Date.now()-start<16000)await new Promise(r=>setTimeout(r,50));
            return retained&&sceneThemes.active&&sceneThemes.metadata.id==='builtin-rain-window';
        })()`);
        assert.ok(resumed, 'theme off/on retains the selected scene');
        const layout = await win.webContents.executeJavaScript(`(() => {
            document.getElementById('settings-fab').click();
            document.querySelector('[data-panel="panel-appearance"]').click();
            const anchors=[...document.querySelectorAll('#settings-toc .settings-toc-item')].map(el=>el.textContent);
            const tiles=[...document.querySelectorAll('#scene-builtins-list .scene-tile')];
            return {anchors, widths:tiles.map(el=>el.getBoundingClientRect().width), gallery:document.getElementById('scene-builtins-list').getBoundingClientRect().width};
        })()`);
        assert.ok(layout.anchors.includes('Фон') && layout.anchors.includes('Темы') && layout.anchors.includes('Интерфейс'), 'right-hand section shortcuts remain available');
        assert.equal(layout.anchors.indexOf('Темы'),layout.anchors.indexOf('Фон')+1,'themes have their own category immediately after backgrounds');
        assert.ok(!layout.anchors.includes('Визуализатор'), 'scene hides ordinary visualizer shortcut');
        assert.ok(layout.widths.every(width=>width>=95), 'scene previews stay large');
        assert.ok(Math.abs(layout.widths.reduce((a,b)=>a+b,0)+16-layout.gallery)<2, 'three builtin scenes fill the row without an import tile');
        const edited=await win.webContents.executeJavaScript(`(()=>{
            const id=sceneThemes.metadata.id,frequency=document.getElementById('scene-frequencyMix'),lighting=document.getElementById('scene-glowIntensity');
            frequency.value=82;frequency.dispatchEvent(new Event('input'));lighting.value=1.7;lighting.dispatchEvent(new Event('input'));
            const saved=sceneThemes.appearance();sceneThemes.applyAppearance(saved);
            const add=document.querySelector('#scene-imported-list .scene-add-tile'),icon=add.querySelector('svg'),b=add.getBoundingClientRect(),i=icon.getBoundingClientRect();
            return {saved:saved[id],mix:frequency.value,glow:lighting.value,builtinPlus:document.querySelectorAll('#scene-builtins-list .scene-add-tile').length,dx:Math.abs(b.x+b.width/2-i.x-i.width/2),dy:Math.abs(b.y+b.height/2-i.y-i.height/2)};
        })()`);
        assert.equal(edited.saved.frequencyMix,.82);assert.equal(edited.saved.glowIntensity,1.7);assert.equal(edited.mix,'82');assert.equal(edited.glow,'1.7');assert.equal(edited.builtinPlus,0);assert.ok(edited.dx<1&&edited.dy<1,'import plus is centered along both axes');
        const themeControls=await win.webContents.executeJavaScript(`(()=>{
            const add=document.querySelector('#scene-imported-list .scene-add-tile').getBoundingClientRect(),builtin=document.querySelector('#scene-builtins-list .scene-tile').getBoundingClientRect();
            const theme=document.getElementById('scene-option-scene_visualizer_enabled'),global=document.getElementById('setting-show-visualizer'),details=document.getElementById('scene-visualizer-details');
            global.checked=false;global.dispatchEvent(new Event('change'));theme.checked=true;theme.dispatchEvent(new Event('change'));
            const independentOn=!global.checked&&theme.checked&&appStorage.getItem('setting_show_viz')==='0'&&!details.hidden;
            theme.checked=false;theme.dispatchEvent(new Event('change'));
            const hidden=details.hidden&&appStorage.getItem('setting_scene_visualizer_enabled')==='0';
            global.checked=true;global.dispatchEvent(new Event('change'));
            const independentOff=!theme.checked&&details.hidden&&appStorage.getItem('setting_scene_visualizer_enabled')==='0';
            theme.checked=true;theme.dispatchEvent(new Event('change'));
            return {independentOn,independentOff,hidden,sizeMatch:Math.abs(add.width-builtin.width)<.5&&Math.abs(add.height-builtin.height)<.5};
        })()`);
        assert.ok(Object.values(themeControls).every(Boolean),'theme visualizer is independent, its sliders hide when off, and import matches builtin tile size');
        const audio=await win.webContents.executeJavaScript(`(async()=>{
            initAudioEngine();await audioCtx.resume();const osc=audioCtx.createOscillator(),gain=audioCtx.createGain();osc.frequency.value=900;gain.gain.value=.1;osc.connect(gain);gain.connect(window.sceneAnalyzer);osc.start();
            try{await new Promise(r=>setTimeout(r,450));const data=new Uint8Array(sceneAnalyzer.frequencyBinCount);sceneAnalyzer.getByteFrequencyData(data);let peak=0;for(let i=1;i<data.length;i++)if(data[i]>data[peak])peak=i;return {fft:sceneAnalyzer.fftSize,legacy:analyzer.fftSize,bins:data.length,frequency:peak*audioCtx.sampleRate/sceneAnalyzer.fftSize,level:data[peak]};}
            finally{osc.stop();osc.disconnect();gain.disconnect();}
        })()`,true);
        assert.equal(audio.fft,8192);assert.equal(audio.legacy,512);assert.equal(audio.bins,4096);assert.ok(Math.abs(audio.frequency-900)<10&&audio.level>100,'real scene analyser resolves an independent 900 Hz signal');
        const copy = await win.webContents.executeJavaScript(`(async()=>{
            const original=Object.getOwnPropertyDescriptor(navigator,'clipboard');
            let copied;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{copied=text;}}});
            try{const details='PNG layer <broken>\\nScene: test';const toast=showNotification('Ошибка слоя <broken>','warning',null,null,{copyText:details});toast.querySelector('.notification-toast-copy-stack').click();await new Promise(r=>setTimeout(r,0));return {copied,details,text:toast.querySelector('.notification-toast-msg').textContent,markup:!!toast.querySelector('broken')};}
            finally{if(original)Object.defineProperty(navigator,'clipboard',original);else delete navigator.clipboard;}
        })()`);
        assert.equal(copy.copied,copy.details); assert.equal(copy.markup,false); assert.equal(copy.text,'Ошибка слоя <broken>');
        const modes = await win.webContents.executeJavaScript(`(async()=>{
            const gallery=await noctune.sceneThemes.list();backgroundSettings.select(gallery.presets[0].path);
            const deadline=Date.now()+5000;while(!document.querySelector('#bg-recent-list .bg-recent-item')&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
            await sceneThemes.activate(gallery.themes[0]);
            const recent=document.querySelector('#bg-recent-list .bg-recent-item');
            const visible=recent?.getClientRects().length>0;
            recent.click();const end=Date.now()+5000;while(sceneThemes.active&&Date.now()<end)await new Promise(r=>setTimeout(r,50));
            const imageWorks=!sceneThemes.active&&window.bgImageEnabled&&!document.getElementById('setting-scene-enabled').checked;
            const toggle=document.getElementById('setting-scene-enabled');toggle.checked=true;toggle.dispatchEvent(new Event('change'));
            const again=Date.now()+16000;while(!sceneThemes.active&&Date.now()<again)await new Promise(r=>setTimeout(r,50));
            const restored=sceneThemes.active&&!window.bgImageEnabled;
            const bg=document.getElementById('setting-bg-image-enabled');bg.checked=true;bg.dispatchEvent(new Event('change'));
            const exclusive=!sceneThemes.active&&window.bgImageEnabled&&appStorage.getItem('setting_scene_enabled')==='0';
            await sceneThemes.activate(gallery.themes[0]);return {visible,imageWorks,restored,exclusive};
        })()`);
        assert.ok(Object.values(modes).every(Boolean),'recent images remain visible and switch modes, scene resumes, background toggle disables scene');
        const recentLimit=await win.webContents.executeJavaScript(`(async()=>{
            const gallery=await noctune.sceneThemes.list(),paths=[...gallery.presets.map(p=>p.path),...${JSON.stringify(['02-night-hill','03-rain-window','05-obsessed-over-camera'].map(id=>path.join(root,'themes/builtin',id,'assets/preview.png')))}];
            for(const path of paths){backgroundSettings.select(path);const end=Date.now()+8000;while(JSON.parse(appStorage.getItem('setting_bg_recent_list')||'[]')[0]?.path!==path&&Date.now()<end)await new Promise(r=>setTimeout(r,30));}
            const list=JSON.parse(appStorage.getItem('setting_bg_recent_list')||'[]');
            await sceneThemes.activate(gallery.themes[0]);return {length:list.length,newest:list[0].path,last:paths.at(-1)};
        })()`);
        assert.equal(recentLimit.length,10,'eleven selected backgrounds evict only the oldest, keeping ten');assert.equal(recentLimit.newest,recentLimit.last);
        await fs.mkdir(out,{recursive:true});
        await win.webContents.executeJavaScript(`document.querySelector('#settings-toc .settings-toc-item.active')?.classList.remove('active');[...document.querySelectorAll('#settings-toc .settings-toc-item')].find(el=>el.textContent==='Фон').click();new Promise(r=>setTimeout(r,400))`);
        await fs.writeFile(path.join(out,'settings-full-app.png'),(await win.webContents.capturePage()).toPNG());
        const recent = await win.webContents.executeJavaScript(`(() => {
            sceneThemes.deactivate();
            document.getElementById('bg-image-advanced-settings').style.display='block';
            document.getElementById('bg-recent-row').style.display='flex';
            const list=document.getElementById('bg-recent-list');list.replaceChildren();
            for(let i=0;i<6;i++){const el=document.createElement('div');el.className='bg-recent-item';el.style.cssText='width:52px;height:52px';list.append(el);}
            const rect=list.firstChild.getBoundingClientRect();const bounds=list.getBoundingClientRect();
            for(let i=6;i<10;i++){const el=document.createElement('div');el.className='bg-recent-item';list.append(el);}
            const ten=list.firstChild.getBoundingClientRect();
            return {width:rect.width,height:rect.height,tenWidth:ten.width,tenHeight:ten.height,right:Math.max(...[...list.children].map(el=>el.getBoundingClientRect().right)),edge:bounds.right};
        })()`);
        assert.ok(recent.width>=80 && recent.height>=45,'recent wallpaper previews remain legible');
        assert.ok(Math.abs(recent.right-recent.edge)<2,'recent backgrounds fill the available row width');
        assert.equal(recent.tenWidth,recent.width);assert.equal(recent.tenHeight,recent.height,'ten backgrounds retain the six-background thumbnail size');
        await win.webContents.executeJavaScript(`(async()=>sceneThemes.activate((await noctune.sceneThemes.list()).themes[0]))()`);
        const sceneFrame = win.webContents.mainFrame.frames.find(f => f.url === 'about:srcdoc');
        assert.ok(sceneFrame);
        const isolation = await sceneFrame.executeJavaScript(`({node:typeof require,bridge:typeof noctune})`);
        assert.equal(isolation.node, 'undefined'); assert.equal(isolation.bridge, 'undefined');
        await sceneFrame.executeJavaScript(`location.href='https://noctune-scene-probe.invalid/';void 0;`);
        await new Promise(resolve => setTimeout(resolve, 100));
        assert.equal(sceneFrame.url, 'about:srcdoc', 'theme scripts cannot navigate to network URLs');
        console.log('PASS: three scenes, separate theme category, exclusive switches, recent-image round trip, right-hand shortcuts, full-width previews, copyable warnings and sandbox.');
        return;
    }
    const win = new BrowserWindow({ show: false, frame: false, enableLargerThanScreen: true, width: 1920, height: 1080, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: true } });
    win.webContents.setFrameRate(30);
    const errors = [];
    win.webContents.on('console-message', event => { if (event.level === 'error' && !event.message.includes('Content Security Policy')) errors.push(event.message); });
    try {
        const source = await fs.readFile(path.join(root, 'src/renderer/index.html'), 'utf8');
        const css = await fs.readFile(path.join(root, 'src/renderer/styles/app.css'), 'utf8');
        const start = source.indexOf('<div class="settings-panel" id="panel-appearance"');
        const panelStart = start < 0 ? source.lastIndexOf('<div', source.indexOf('id="panel-appearance"')) : start;
        const next = source.lastIndexOf('<div', source.indexOf('id="panel-integrations"'));
        const appearance = source.slice(panelStart, next);
        await fs.mkdir(out, { recursive: true });
        const harnessFile = path.join(out, 'probe.html');
        await fs.writeFile(harnessFile, `<html><head><style>${css}body{display:block}#panel-appearance{display:block;position:relative;z-index:10;width:830px;margin:20px;background:var(--container-bg);padding:20px;border-radius:12px}#custom-bg-layer{opacity:1}</style></head><body data-theme="dark"><div id="custom-bg-layer"><video id="custom-bg-video"></video></div><canvas id="star-canvas"></canvas><canvas id="confetti-canvas"></canvas><canvas id="visualizer"></canvas>${appearance}</body></html>`);
        await win.loadFile(harnessFile);
        const sdk = await fs.readFile(path.join(root, 'src/renderer/effects/scene-sdk.js'), 'utf8');
        const definitions = [];
        for (const [id, directory] of [['builtin-rain-window', 'themes/builtin/03-rain-window'], ['builtin-night-hill', 'themes/builtin/02-night-hill'], ['builtin-obsessed-over-camera', 'themes/builtin/05-obsessed-over-camera']]) {
            const pkg = await packDirectory(path.join(root, directory));
            definitions.push({ id, pkg: { ...pkg, sdk }, metadata: { ...pkg.manifest, id, builtin: id.startsWith('builtin'), preview: pkg.assets.preview } });
        }
        const presets = JSON.parse(await fs.readFile(path.join(root, 'themes/backgrounds/presets.json'), 'utf8')).map(p => ({ ...p, path: path.join(root, 'themes/backgrounds', p.file) }));
        await win.webContents.executeJavaScript(`window.__packages = ${JSON.stringify(definitions)};
            window.appStorage = { data: {setting_accent_color:'#123456'}, getItem(k){return this.data[k]??null},setItem(k,v){this.data[k]=String(v)},removeItem(k){delete this.data[k]} };
            window.requestEffectsFrame = callback => requestAnimationFrame(callback);
            window.showNotification = message => { (window.__notifications ||= []).push(message); };
            window.lucide = {createIcons(){}};
            window.backgroundSettings = {enable(v){window.bgImageEnabled=v;document.getElementById('setting-bg-image-enabled').checked=v},select(p){sceneThemes.deactivate();window.bgImagePath=p;this.enable(true)},palette(p){document.body.style.setProperty('--accent-color',p.accent);document.documentElement.style.setProperty('--accent-color',p.accent);window.vizGradColor1=p.gradient[0]}};
            window.noctune = {fs:{toFileUrl:p=>'file:///'+p.replaceAll('\\\\','/')},sceneThemes:{read:async id=>__packages.find(p=>p.id===id).pkg,list:async()=>({themes:__packages.map(p=>p.metadata),presets:${JSON.stringify(presets)}}),import:async()=>null,remove:async()=>true}};
            void 0;
        `);
        await win.webContents.executeJavaScript(await fs.readFile(path.join(root, 'src/renderer/effects/scene-host.js'), 'utf8'));
        await win.webContents.executeJavaScript(await fs.readFile(path.join(root, 'src/renderer/ui/scene-settings.js'), 'utf8'));
        await win.webContents.executeJavaScript(`new Promise(r=>setTimeout(r,100))`);
        let result = await win.webContents.executeJavaScript(`({backgrounds:document.querySelectorAll('#bg-presets-list .scene-tile').length,sections:document.querySelectorAll('.appearance-section').length,imports:document.querySelectorAll('.scene-add-tile').length,oldImport:!!document.getElementById('btn-import-scene-theme'),switches:document.querySelectorAll('#scene-theme-options .toggle-switch').length})`);
        assert.equal(result.backgrounds, 8); assert.equal(result.sections, 9); assert.equal(result.imports,1); assert.equal(result.oldImport,false); assert.equal(result.switches,3);
        await fs.mkdir(out, { recursive: true });
        for (const def of definitions) {
            await win.webContents.executeJavaScript(`sceneThemes.activate(__packages.find(p=>p.id===${JSON.stringify(def.id)}).metadata)`);
            await win.webContents.executeJavaScript(`sceneThemes.audio(new Uint8Array(1024).fill(210),44100,true); document.getElementById('panel-appearance').style.display='none'; new Promise(r=>setTimeout(r,450))`);
            result = await win.webContents.executeJavaScript(`({active:sceneThemes.active,id:sceneThemes.metadata.id,sandbox:document.querySelector('.scene-frame').getAttribute('sandbox'),effectTabHidden:[...document.querySelectorAll('.appearance-section')].find(b=>b.querySelector('.settings-section-title')?.textContent==='Визуальные эффекты').hidden,accent:getComputedStyle(document.body).getPropertyValue('--accent-color').trim(),spectrum:window.vizGradColor1})`);
            assert.equal(result.id, def.id); assert.equal(result.sandbox, 'allow-scripts'); assert.ok(result.effectTabHidden); assert.equal(result.accent, def.metadata.palette.accent);
            const frame = win.webContents.mainFrame.frames.find(f => f.url === 'about:srcdoc');
            assert.ok(frame);
            const isolation = await frame.executeJavaScript(`({node:typeof require,preload:typeof noctune,parentBlocked:(()=>{try{void parent.document.body;return false}catch(e){return true}})(),canvas:document.querySelector('canvas').width})`);
            const viewport = await win.webContents.executeJavaScript(`Math.round(innerWidth*Math.min(devicePixelRatio,1.5))`);
            assert.equal(isolation.node, 'undefined'); assert.equal(isolation.preload, 'undefined'); assert.ok(isolation.parentBlocked); assert.equal(isolation.canvas, viewport);
            if(process.argv.includes('--update-previews') || process.argv.includes('--update-backgrounds')) {
                const preview = await frame.executeJavaScript(`(async()=>{
                    const payload=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(document.getElementById('scene-data').textContent),c=>c.charCodeAt(0))));
                    const images={};await Promise.all(Object.entries(payload.assets).map(async([id,src])=>{const img=new Image();img.src=src;await img.decode();images[id]=img;}));
                    const canvas=document.createElement('canvas'),api=NoctuneScene.create(canvas,payload.manifest,images);
                    api.begin({width:1920,height:1080,dpr:1,dt:0,time:0,motion:false,lighting:{intensity:1},audio:{spectrum:[],sampleRate:44100,playing:false,enabled:false,intensity:1}});__noctuneScene.render(api,{});
                    const thumb=document.createElement('canvas');thumb.width=320;thumb.height=180;thumb.getContext('2d').drawImage(canvas,0,0,320,180);return {thumb:thumb.toDataURL('image/png').slice(22),full:canvas.toDataURL('image/png').slice(22)};
                })()`);
                if(process.argv.includes('--update-previews'))await fs.writeFile(path.join(root,'themes/builtin',def.pkg.manifest.id,'assets/preview.png'),Buffer.from(preview.thumb,'base64'));
                if(process.argv.includes('--update-backgrounds')&&['02-night-hill','03-rain-window'].includes(def.pkg.manifest.id))await fs.writeFile(path.join(root,'themes/backgrounds',def.pkg.manifest.id+'.png'),Buffer.from(preview.full,'base64'));
            }
            const rendered = await frame.executeJavaScript(`(async()=>{
                const payload=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(document.getElementById('scene-data').textContent),c=>c.charCodeAt(0))));
                const images={};await Promise.all(Object.entries(payload.assets).map(async([id,src])=>{const image=new Image();image.src=src;await image.decode();images[id]=image}));
                const canvas=document.createElement('canvas'),api=NoctuneScene.create(canvas,payload.manifest,images);
                for(let i=0;i<60;i++){api.begin({width:1920,height:1080,dpr:1,dt:1/60,time:5.8,motion:true,audio:{spectrum:Uint8Array.from({length:4096},(_,b)=>Math.max(0,185-Math.log2(b+1)*11+Math.sin(b*.24)*40)),sampleRate:44100,playing:true,enabled:true,intensity:1,frequencyMix:.75}});__noctuneScene.render(api,{})}
                return canvas.toDataURL('image/png').slice(22);
            })()`);
            await fs.writeFile(path.join(out, def.pkg.manifest.id + '.png'), Buffer.from(rendered, 'base64'));
        }
        result = await win.webContents.executeJavaScript(`sceneThemes.audio(null,44100,false);sceneThemes.deactivate();({active:sceneThemes.active,frames:document.querySelectorAll('.scene-frame').length,accent:document.body.style.getPropertyValue('--accent-color'),effects:[...document.querySelectorAll('.appearance-section')].find(b=>b.querySelector('.settings-section-title')?.textContent==='Визуальные эффекты').hidden})`);
        assert.ok(!result.active); assert.equal(result.frames, 0); assert.equal(result.accent, '#123456'); assert.equal(result.effects, false);
        // An invalid replacement must leave the current working scene intact.
        await win.webContents.executeJavaScript(`sceneThemes.activate(__packages[0].metadata)`);
        const invalid = { ...definitions[1].pkg, script: 'throw new Error("probe rejected script")' };
        await win.webContents.executeJavaScript(`__packages.push({id:'broken',pkg:${JSON.stringify(invalid)},metadata:{...__packages[1].metadata,id:'broken'}});`);
        result = await win.webContents.executeJavaScript(`sceneThemes.activate(__packages.at(-1).metadata).then(()=>false,()=>sceneThemes.metadata.id==='builtin-rain-window')`);
        assert.equal(result, true);
        await win.webContents.executeJavaScript(`document.getElementById('panel-appearance').style.display='block';document.getElementById('scene-theme-options').scrollIntoView({block:'center'});`);
        await win.webContents.executeJavaScript(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(r,100))))`);
        await fs.writeFile(path.join(out, 'settings.png'), (await win.webContents.capturePage()).toPNG());
        assert.ok(!errors.some(e => !e.includes('probe rejected script')), errors.join('\n'));
        console.log('PASS: three rendered scenes, eight backgrounds, nine sections, one centered import tile, styled switches, isolated iframe, palette/lifecycle and failure rollback. Previews: ' + out);
    } finally { win.destroy(); }
}).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1); });
