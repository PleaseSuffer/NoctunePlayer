// Run with Electron. FFmpeg is an explicit development tool, never a runtime dependency.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname,'..');
const [id, ffmpeg, ...options] = process.argv.slice(2);
const audioFile = options.includes('--audio') ? options[options.indexOf('--audio')+1] : null;
const compare = options.includes('--compare');
const requestedStart = options.includes('--start') ? Number(options[options.indexOf('--start')+1]) : null;
const width = options.includes('--width') ? Number(options[options.indexOf('--width')+1]) : 960;
const height = width*9/16;
const draft = options.includes('--draft');
app.setPath('userData',path.join(root,'.development/preview-renderer'));
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
    if (!/^[a-z][a-z0-9-]{1,63}$/.test(id || '') || !ffmpeg) throw new Error('Usage: electron scripts/render-theme-preview.cjs theme-id /path/to/ffmpeg');
    if (![640,960,1280].includes(width)) throw new Error('Preview width must be 640, 960 or 1280');
    const catalog = require('../addons/catalog/marketplace.json');
    const entry = catalog.entries.find(item => item.kind === 'theme' && item.id === id);
    if (!entry) throw new Error('Unknown published theme');
    const pkg = JSON.parse(await fs.readFile(path.join(root,require('../src/main/addons/marketplace').packagePath(entry)),'utf8'));
    const dir = draft ? path.join(root,'.development/preview-candidates',id,entry.version,String(width)) : path.join(root,'addons/previews',id,entry.version);
    try { await fs.access(path.join(dir,'preview.webm')); throw new Error('Preview already exists; do not overwrite published assets'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.mkdir(path.join(root,'.development'),{recursive:true});
    const temp = await fs.mkdtemp(path.join(root,'.development/preview-frames-'));
    try {
        let audio, audioStart = 0, audioDuration = 240;
        if (audioFile) {
            const { parseFile } = await import('music-metadata');
            const metadata = await parseFile(audioFile,{duration:true,skipCovers:true});
            audioDuration = metadata.format.duration;
            if (!Number.isFinite(audioDuration) || audioDuration < 5) throw new Error('Audio must be at least five seconds');
            if (requestedStart !== null && (!Number.isFinite(requestedStart) || requestedStart < .2 || requestedStart+4.1 > audioDuration)) throw new Error('Requested audio segment is outside the track');
            audioStart = requestedStart ?? Math.max(.2, Math.min(audioDuration-4.1,audioDuration/2));
            // Decode only the analysis fragment into memory. Never copy, package or modify the song.
            const decoded = spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-ss',String(audioStart-.2),'-i',audioFile,'-t','4.3','-vn','-ac','1','-ar','48000','-f','f32le','pipe:1'],{windowsHide:true,maxBuffer:4*1024*1024});
            if (decoded.error) throw decoded.error;
            if (decoded.status !== 0) throw new Error(decoded.stderr.toString());
            audio = decoded.stdout.toString('base64');
            console.log(`Audio-driven spectrum: ${audioStart.toFixed(2)}s–${(audioStart+4).toFixed(2)}s; silent video only`);
        }
        const win = new BrowserWindow({ show:false, webPreferences:{ nodeIntegration:false, contextIsolation:true, sandbox:true, backgroundThrottling:false } });
        await win.loadURL('about:blank');
        await win.webContents.executeJavaScript(`(async()=>{
            ${await fs.readFile(path.join(root,'src/renderer/effects/scene-sdk.js'),'utf8')}
            ${pkg.script}
            const pkg=${JSON.stringify(pkg)},images={};
            for(const [key,src] of Object.entries(pkg.assets)){const image=new Image();image.src=src;await image.decode();images[key]=image;}
            const canvas=document.createElement('canvas');canvas.width=${width};canvas.height=${height};
            window.previewApi=NoctuneScene.create(canvas,pkg.manifest,images);window.previewScene=window.__noctuneScene;window.previewCanvas=canvas;
            window.previewParameters=Object.fromEntries(Object.entries(pkg.manifest.parameterSchema || {}).map(([key,value])=>[key,value.default]));
            previewScene.init(previewApi);
        })()`);
        if (audio) await win.webContents.executeJavaScript(`(async()=>{
            const bytes=Uint8Array.from(atob(${JSON.stringify(audio)}),c=>c.charCodeAt(0)),pcm=new Float32Array(bytes.buffer);
            const context=new OfflineAudioContext(1,pcm.length,48000),buffer=context.createBuffer(1,pcm.length,48000);buffer.copyToChannel(pcm,0);
            const source=context.createBufferSource(),analyser=context.createAnalyser();source.buffer=buffer;
            analyser.fftSize=8192;analyser.smoothingTimeConstant=.35;analyser.minDecibels=-90;analyser.maxDecibels=-10;
            source.connect(analyser);analyser.connect(context.destination);source.start();
            const checkpoints=Array.from({length:80},(_,i)=>context.suspend(.2+i/20));const rendering=context.startRendering();window.audioSpectra=[];
            for(const checkpoint of checkpoints){await checkpoint;const bins=new Uint8Array(analyser.frequencyBinCount);analyser.getByteFrequencyData(bins);audioSpectra.push(Array.from(bins));await context.resume();}
            await rendering;
            if(!audioSpectra.some(bins=>bins.some(value=>value>0)))throw Error('Audio spectrum is empty');
        })()`);
        // Audio supplies frequency data only; output files never contain a sound track.
        for (let i=0;i<80;i++) {
            const png = await win.webContents.executeJavaScript(`(()=>{
                const time=${i}/20,frame={width:${width},height:${height},dpr:1,dt:1/20,time:time+10,motion:true,reducedMotion:false,parameters:previewParameters,lighting:{intensity:1},safeArea:null,pointer:{x:0,y:0,active:false},playback:{position:${audioStart}+time,duration:${audioDuration},playing:true,live:false},audio:{spectrum:window.audioSpectra ? Uint8Array.from(audioSpectra[${i}]) : Uint8Array.from({length:2048},(_,j)=>Math.max(0,Math.min(255,95+60*Math.sin(j*.04+time*4)+40*Math.cos(j*.013-time*2)))),sampleRate:48000,enabled:true,playing:true,intensity:1}};
                previewApi.begin(frame);previewScene.render(previewApi,frame);return previewCanvas.toDataURL('image/png').split(',')[1];
            })()`);
            await fs.writeFile(path.join(temp,String(i).padStart(3,'0')+'.png'),Buffer.from(png,'base64'));
        }
        const output = path.join(temp,'preview.webm');
        const result = spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-framerate','20','-i',path.join(temp,'%03d.png'),'-an','-c:v','libvpx-vp9','-crf','24','-b:v','0','-pix_fmt','yuv420p',output],{stdio:'inherit',windowsHide:true});
        if (result.error) throw result.error;
        if (result.status !== 0) throw new Error('FFmpeg failed');
        if (compare) {
            const comparisonDir=path.join(root,'.development/preview-comparison',id,entry.version);await fs.mkdir(comparisonDir,{recursive:true});
            await fs.copyFile(output,path.join(comparisonDir,'preview.webm'));
            const profiles=[['preview.mp4',['-an','-c:v','libx264','-crf','26','-preset','medium','-pix_fmt','yuv420p','-movflags','+faststart']],['preview.gif',['-filter_complex','[0:v]split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a']]];
            for(const [name,args]of profiles){const encoded=spawnSync(ffmpeg,['-y','-hide_banner','-loglevel','error','-framerate','20','-i',path.join(temp,'%03d.png'),...args,path.join(comparisonDir,name)],{stdio:'inherit',windowsHide:true});if(encoded.error)throw encoded.error;if(encoded.status!==0)throw Error('Comparison encoding failed');}
            const sizes={};for(const name of ['preview.webm','preview.mp4','preview.gif'])sizes[name]=(await fs.stat(path.join(comparisonDir,name))).size;
            await fs.writeFile(path.join(comparisonDir,'sizes.json'),JSON.stringify(sizes,null,2)+'\n');console.log(`Same frames / ${width}x${height} / 4s / 20 FPS: `+JSON.stringify(sizes));
        }
        await fs.mkdir(dir,{recursive:true});
        await fs.copyFile(output,path.join(dir,'preview.webm'),require('node:fs').constants.COPYFILE_EXCL);
        await fs.writeFile(path.join(dir,'metadata.json'),JSON.stringify({width,height,duration:4},null,2)+'\n',{flag:'wx'});
        win.destroy();
        console.log(`Rendered ${id} ${entry.version}: ${width}x${height}, 4s, 20 FPS, silent WebM/VP9`);
    } finally { await fs.rm(temp,{recursive:true,force:true}); }
    app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
