const {app,BrowserWindow,ipcMain}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const out=path.resolve('tests/.artifacts/settings-behavior');fs.mkdirSync(out,{recursive:true});
app.setPath('userData',fs.mkdtempSync(path.join(out,'profile-')));
const show=BrowserWindow.prototype.showInactive;BrowserWindow.prototype.show=function(){};BrowserWindow.prototype.showInactive=function(){};
const wait=ms=>new Promise(r=>setTimeout(r,ms));setTimeout(()=>{console.error('TIMEOUT');app.exit(1)},60000);
const fixture=path.join(out,'playing.wav');fs.writeFileSync(fixture,require('./helpers/tag-audio.cjs').audioFixture(40).buffer);
app.on('browser-window-created',(_,win)=>win.webContents.on('did-finish-load',async()=>{
if(!win.webContents.getURL().endsWith('/renderer/index.html'))return;
try{
show.call(win);win.webContents.setBackgroundThrottling(false);await wait(600);
const run=s=>win.webContents.executeJavaScript(s);
const until=async(s,label)=>{for(let i=0;i<150;i++){if(await run(s))return;await wait(50)}throw Error(label)};
await run(`loadMusicFromFiles([${JSON.stringify(fixture)}])`);await until('!!parsedMetadataCache[0]','metadata');await run('playTrack(0)');await until('isPlaying','playing');
const hidden=await run(`(async()=>{const wait=ms=>new Promise(r=>setTimeout(r,ms));window.starDraws=0;window.vizDraws=0;const arc=starCtx.arc;starCtx.arc=function(...a){window.starDraws++;return arc.apply(this,a)};const fill=ctx.fill;ctx.fill=function(...a){window.vizDraws++;return fill.apply(this,a)};for(const id of ['setting-show-stars','setting-show-visualizer']){const el=document.getElementById(id);el.checked=false;el.dispatchEvent(new Event('change'))}await wait(150);const off=[starDraws,vizDraws];for(const id of ['setting-show-stars','setting-show-visualizer']){const el=document.getElementById(id);el.checked=true;el.dispatchEvent(new Event('change'))}await wait(150);const on=[starDraws,vizDraws];starCtx.arc=arc;ctx.fill=fill;return {off,on}})()`);
assert.deepEqual(hidden.off,[0,0]);assert(hidden.on.every(n=>n>0),JSON.stringify(hidden));
const mutation=await run(`(async()=>{let languages=0;const o=new MutationObserver(r=>languages+=r.filter(m=>m.attributeName==='lang').length);o.observe(document.documentElement,{attributes:true});const host=document.createElement('div');document.body.append(host);host.innerHTML='<span data-i18n="player.interface.playNext"></span><span id="raw-track-name">Личный трек 日本語</span><button data-i18n-title="player.interface.close"><i data-lucide="x"></i></button>';lucide.createIcons({root:host});await new Promise(r=>setTimeout(r,0));noctuneTranslateDocument(host);await new Promise(r=>setTimeout(r,0));const result={languages,label:host.firstElementChild.textContent,expected:noctuneI18n.t('player.interface.playNext'),user:host.querySelector('#raw-track-name').textContent};o.disconnect();host.remove();return result})()`);
assert.equal(mutation.languages,0);assert.equal(mutation.label,mutation.expected);assert.equal(mutation.user,'Личный трек 日本語');
await run(`playlistElem.insertAdjacentHTML('beforeend',Array.from({length:500},(_,i)=>'<li><span>Test track '+i+'</span><i data-lucide="music"></i></li>').join(''));lucide.createIcons({root:playlistElem});window.trackIcons=[...playlistElem.querySelectorAll('svg')];`);
await wait(100);
const pkg={apiVersion:2,manifest:{id:'settings-test',name:'Settings test',width:640,height:360,palette:{background:'#101820',accent:'#46c8ed',gradient:['#46c8ed','#81a9c4','#e4aa64']},capabilities:{motion:true,visualizer:'none'}},sdk:fs.readFileSync('src/renderer/effects/scene-sdk.js','utf8'),assets:{},script:"NoctuneScene.define({render(api){api.ctx.fillStyle='#101820';api.ctx.fillRect(0,0,api.width,api.height)}});"};
ipcMain.removeHandler('scene-themes:read');ipcMain.handle('scene-themes:read',()=>pkg);
for(const theme of [false,true]){
 if(theme)await run(`sceneThemes.activate({id:'settings-test',name:'Settings test'})`);
 await run(`effectsPerformance.setFps(60)`);await wait(100);
 const state=await run(`(async()=>{const before=localAudioElement.currentTime;const accent=document.body.style.getPropertyValue('--accent-color');let writes=0;const set=appStorage.setItem;appStorage.setItem=(...a)=>{writes++;return set(...a)};document.getElementById('settings-fab').click();await new Promise(r=>setTimeout(r,100));const result={sameIcons:trackIcons.every((node,i)=>node===playlistElem.querySelectorAll('svg')[i]),writes,accentBefore:accent,accentAfter:document.body.style.getPropertyValue('--accent-color'),effective:effectsPerformance.effectiveFps,configured:effectsPerformance.fps,playing:isPlaying&&localAudioElement.currentTime>=before,active:sceneThemes.active,sceneLimit:sceneThemes.performance?.frameLimit};document.getElementById('settings-close-btn').click();result.restored=effectsPerformance.effectiveFps;appStorage.setItem=set;return result})()`);
 assert(state.sameIcons);assert.equal(state.writes,0);assert.equal(state.accentAfter,state.accentBefore);assert(state.playing);assert.equal(state.effective,30);assert.equal(state.configured,60);assert.equal(state.restored,60);assert.equal(state.active,theme);if(theme)assert.equal(state.sceneLimit,30);
}
await run(`window.eqWidthReads=0;const viewport=document.getElementById('presets-viewport');const width=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'offsetWidth').get;Object.defineProperty(viewport,'offsetWidth',{configurable:true,get(){eqWidthReads++;return width.call(this)}})`);
await wait(150);assert.equal(await run('eqWidthReads'),0,'hidden EQ does not poll layout');
await run(`sceneThemes.deactivate();document.getElementById('open-eq-btn').click()`);await until(`!!document.querySelector('#presets-container .eq-preset-page')`,'equalizer carousel visible on open');
console.log('PASS: settings preserve track icons, config, playback and theme palette; translation avoids lang invalidation; hidden effects stop drawing; settings frame budget restores; EQ carousel opens.');app.exit(0);
}catch(e){console.error(e);app.exit(1)}
}));
const archive=process.argv.find(a=>a.startsWith('--app-asar='))?.slice('--app-asar='.length);
if(archive){app.setAppPath(path.resolve(archive));Object.defineProperty(app,'isPackaged',{value:true});require('electron-updater').autoUpdater.checkForUpdates=async()=>null;}
require(archive?path.join(path.resolve(archive),'src/main/index.js'):'../src/main/index');
