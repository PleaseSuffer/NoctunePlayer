const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'tests/.artifacts/scene-performance');
fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'profile'));
const showInactive=BrowserWindow.prototype.showInactive;
BrowserWindow.prototype.show=function(){};BrowserWindow.prototype.showInactive=function(){};BrowserWindow.prototype.focus=function(){};
const baseline=process.argv.includes('--baseline');
app.on('browser-window-created',(_event,win)=>win.webContents.on('did-finish-load',async()=>{
 if(!win.webContents.getURL().endsWith('/renderer/index.html'))return;
 try{
  win.webContents.setBackgroundThrottling(false);
  win.setOpacity(process.argv.includes('--visible') ? 1 : 0);showInactive.call(win);
  await win.webContents.executeJavaScript(`Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});window._rafSuspended=false;effectsPerformance.setFps(60);sceneThemes.deactivate(false);`);
  let source=fs.readFileSync(baseline?path.join(out,'baseline-scene-host.js'):path.join(root,'src/renderer/effects/scene-host.js'),'utf8');
  if(process.argv.includes('--verify'))source=source.replace('const pkg = await noctune.sceneThemes.read(metadata.id);',`const pkg = await noctune.sceneThemes.read(metadata.id); if(window.__domTheme)pkg.script='document.title="DOM compatibility";\\n'+pkg.script;`);
  if(process.argv.includes('--stress'))source=source.replace('const pkg = await noctune.sceneThemes.read(metadata.id);',`const pkg = await noctune.sceneThemes.read(metadata.id); pkg.script += ${JSON.stringify('\nconst original=window.__noctuneScene.render;window.__noctuneScene.render=(api,frame)=>{const end=performance.now()+45;while(performance.now()<end){};return original(api,frame)};')};`);
  await win.webContents.executeJavaScript(source);
  if(process.argv.includes('--verify')){
   const result=await win.webContents.executeJavaScript(`(async()=>{
    const theme=(await noctune.sceneThemes.list()).themes.find(t=>t.id==='builtin-rain-window');
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    await sceneThemes.activate(theme);await wait(400);
    const worker=sceneThemes.performance;
    document.getElementById('settings-fab').click();await wait(500);const panel=sceneThemes.performance;
    document.getElementById('settings-close-btn').click();await wait(100);const restored=sceneThemes.performance;
    appStorage.setItem('setting_scene_motion','0');sceneThemes.preferencesChanged();sceneThemes.audio(null,44100,false);await wait(2200);
    const staticBefore=sceneThemes.performance.frames;await wait(250);const staticAfter=sceneThemes.performance.frames;
    appStorage.setItem('setting_scene_motion','1');sceneThemes.preferencesChanged();await wait(100);
    window._rafSuspended=true;await wait(100);const hiddenBefore=sceneThemes.performance.frames;await wait(250);const hiddenAfter=sceneThemes.performance.frames;
    window._rafSuspended=false;await wait(100);const resumed=sceneThemes.performance.frames;
    window.__domTheme=true;await sceneThemes.activate(theme);const fallback=sceneThemes.performance;
    sceneThemes.deactivate();return {worker,panel,restored,staticBefore,staticAfter,hiddenBefore,hiddenAfter,resumed,fallback,remaining:document.querySelectorAll('.scene-frame').length};
   })()`);
   assert.equal(result.worker.runtime,'worker');assert.equal(result.panel.frameLimit,30);assert.equal(result.restored.frameLimit,60);
   assert.equal(result.staticBefore,result.staticAfter);assert.equal(result.hiddenBefore,result.hiddenAfter);assert.ok(result.resumed>result.hiddenAfter);
   assert.equal(result.fallback.runtime,'iframe');assert.equal(result.remaining,0);
   console.log('PASS: Worker rendering, transparent-panel budget, full cadence restoration, static/tray suspension, resume, DOM-theme fallback and teardown.');app.exit(0);return;
  }
  const results=[];
  for(const id of ['builtin-rain-window','builtin-obsessed-over-camera']){
   await win.webContents.executeJavaScript(`noctune.sceneThemes.list().then(list=>sceneThemes.activate(list.themes.find(t=>t.id==='${id}')))`);
   for(const overlay of [false,true]){
    const result=await win.webContents.executeJavaScript(`(async()=>{
      document.getElementById('${overlay?'btn-lyrics':'lyrics-close'}').click();
      if(${overlay}){document.getElementById('settings-fab').click();document.querySelector('[data-panel="panel-appearance"]').click();}
      else document.getElementById('settings-close-btn').click();
      const data=new Uint8Array(4096).fill(180);const audioTimer=setInterval(()=>sceneThemes.audio(data,44100,true),16);
      await new Promise(r=>setTimeout(r,700));
      const gaps=[],delays=[];let last=performance.now(),expected=last+10,done=false;
      const timer=setInterval(()=>{const now=performance.now();delays.push(Math.max(0,now-expected));expected=now+10;},10);
      const tick=now=>{gaps.push(now-last);last=now;if(!done)requestAnimationFrame(tick);};requestAnimationFrame(tick);
      await new Promise(r=>setTimeout(r,2500));done=true;clearInterval(timer);clearInterval(audioTimer);
      const summary=values=>{values.sort((a,b)=>a-b);return {count:values.length,p50:values[Math.floor(values.length*.5)],p95:values[Math.floor(values.length*.95)],max:values.at(-1)};};
      return {frame:summary(gaps),inputDelay:summary(delays),runtime:sceneThemes.performance||null};
    })()`);
    results.push({id,overlay,...result});
   }
  }
  fs.writeFileSync(path.join(out,`${baseline?'baseline':'optimized'}${process.argv.includes('--stress')?'-stress':''}.json`),JSON.stringify(results,null,2));
  console.log(JSON.stringify(results));app.exit(0);
 }catch(error){console.error(error);app.exit(1);}
}));
require('../src/main/index.js');
