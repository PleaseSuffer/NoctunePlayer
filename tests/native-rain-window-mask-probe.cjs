const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'themes/builtin/03-rain-window');
const out = path.join(root, 'tests/.artifacts/rain-window-mask');
fs.mkdirSync(out, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(out, 'profile-')));
app.whenReady().then(async () => {
    fs.mkdirSync(out, { recursive: true });
    const foreground = nativeImage.createFromPath(path.join(directory, 'assets/inside.png'));
    const pixels = foreground.toBitmap(), { width, height } = foreground.getSize();
    const edge = x => {
        for (let y = height - 1; y >= 0; y--) if (pixels[(y * width + x) * 4 + 3] < 5) return y;
        throw new Error('No glass at x=' + x);
    };
    console.log('Glass boundary:', [0, 400, 700, 1000, 1080].map(x => [x, edge(x)]));
    const win = new BrowserWindow({ show: false, width, height, webPreferences: { sandbox: true, contextIsolation: true, offscreen: true } });
    try {
        await win.loadURL('data:text/html,<canvas></canvas>');
        await win.webContents.executeJavaScript(fs.readFileSync(path.join(root, 'src/renderer/effects/scene-sdk.js'), 'utf8'));
        await win.webContents.executeJavaScript(fs.readFileSync(path.join(directory, 'scene.js'), 'utf8'));
        const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json')));
        const assets = Object.fromEntries(Object.entries(manifest.assets).map(([id, file]) => [id, 'data:image/png;base64,' + fs.readFileSync(path.join(directory, file)).toString('base64')]));
        await win.webContents.executeJavaScript(`window.testManifest=${JSON.stringify(manifest)};window.testAssets=${JSON.stringify(assets)};`);
        const coverage = await win.webContents.executeJavaScript(`(async()=>{
            const images={};await Promise.all(Object.entries(testAssets).map(async([id,src])=>{const img=new Image();img.src=src;await img.decode();images[id]=img;}));
            const canvas=document.querySelector('canvas'),api=NoctuneScene.create(canvas,testManifest,images);
            window.maskApi=api;
            const project=api.plane.bind(api);api.plane=(plane,draw)=>{window.spectrumPlane=plane;return project(plane,draw);};
            api.flicker=()=>{};api.rain=()=>{};api.character=()=>{};
            api.line=()=>{api.ctx.fillStyle='#ff0000';api.ctx.fillRect(-2000,-2000,6000,6000);};
            api.begin({width:1920,height:1080,dpr:1,dt:0,time:0,motion:false,audio:{spectrum:[],sampleRate:44100,playing:false,enabled:false,intensity:1}});
            __noctuneScene.render(api);
            return canvas.toDataURL('image/png').slice(22);
        })()`);
        const rendered = nativeImage.createFromBuffer(Buffer.from(coverage, 'base64')).toBitmap();
        for (const x of [400, 600, 700, 850, 1000, 1080]) {
            const y = edge(x) - 2, offset = (y * width + x) * 4;
            assert.ok(rendered[offset + 2] > 245 && rendered[offset + 1] < 10, `glass coverage reaches the exact foreground edge at ${x},${y}`);
        }
        for (let y = 780; y < 1020; y += 3) for (let x = 350; x < 1180; x += 3) {
            const offset = (y * width + x) * 4;
            if (pixels[offset + 3] !== 255) continue;
            assert.deepEqual(rendered.subarray(offset, offset + 3), pixels.subarray(offset, offset + 3), `opaque foreground is preserved at ${x},${y}`);
        }
        const plane = await win.webContents.executeJavaScript('window.spectrumPlane');
        for (const x of [0, 400, 700, 1000, 1080]) {
            const baseline = plane.origin[1] * height + plane.xAxis[1] * height * x / width;
            assert.ok(baseline >= edge(x) && baseline <= edge(x) + 4, `idle baseline sits behind the glass rim at x=${x}`);
        }
        const silence = await win.webContents.executeJavaScript(`(()=>{
            const api=NoctuneScene.create(document.querySelector('canvas'),testManifest,maskApi.images);
            api.flicker=()=>{};api.rain=()=>{};api.character=()=>{};
            const draw=(playing,value)=>{api.begin({width:1920,height:1080,dpr:1,dt:1/60,time:0,motion:false,audio:{spectrum:new Uint8Array(4096).fill(value),sampleRate:44100,playing,enabled:true,intensity:1}});__noctuneScene.render(api);};
            draw(false,0);const idle=api.canvas.toDataURL('image/png');
            for(let i=0;i<60;i++)draw(true,180);const active=api.canvas.toDataURL('image/png');
            for(let i=0;i<300;i++)draw(false,0);
            return {idle,active,paused:api.canvas.toDataURL('image/png')};
        })()`);
        assert.notEqual(silence.active, silence.idle, 'music paints a visible spectrum');
        assert.equal(silence.paused, silence.idle, 'silence leaves no floating spectrum or glow above the sill');
        const preview = await win.webContents.executeJavaScript(`(async()=>{
            const canvas=document.querySelector('canvas'),api=maskApi;
            const images=api.images,fresh=NoctuneScene.create(canvas,testManifest,images);
            for(let i=0;i<60;i++){
                fresh.begin({width:1920,height:1080,dpr:1,dt:1/60,time:2,motion:true,audio:{spectrum:new Uint8Array(4096).fill(130),sampleRate:44100,playing:true,enabled:true,intensity:1,frequencyMix:.6}});
                __noctuneScene.render(fresh);
            }
            return canvas.toDataURL('image/png').slice(22);
        })()`);
        fs.writeFileSync(path.join(out, 'corrected.png'), Buffer.from(preview, 'base64'));
        console.log('PASS: precise glass alpha coverage, preserved foreground, baseline behind the rim and complete spectrum fade on silence.');
    } finally { win.destroy(); }
}).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1); });
