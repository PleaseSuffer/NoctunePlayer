const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const output=path.join(__dirname,'.artifacts/theme-switch');fs.mkdirSync(output,{recursive:true});
const profile=fs.mkdtempSync(path.join(output,'profile-'));app.setPath('userData',profile);
const fixture=path.join(output,'playing.wav');fs.writeFileSync(fixture,require('./helpers/tag-audio.cjs').audioFixture(40).buffer);
const delay=ms=>new Promise(r=>setTimeout(r,ms));let started=false;
setTimeout(()=>app.exit(2),60000);
app.on('browser-window-created',(_,win)=>win.webContents.on('did-finish-load',async()=>{
 if(!win.webContents.getURL().endsWith('/renderer/index.html')||started)return;started=true;win.show();win.webContents.setBackgroundThrottling(false);
 const run=code=>win.webContents.executeJavaScript(code).catch(e=>{console.error('CODE:',code);throw e});
 async function until(code,label){for(let i=0;i<150;i++){if(await run(code))return;await delay(50)}throw Error(label)}
 try{
 await delay(700);await run(`loadMusicFromFiles([${JSON.stringify(fixture)}])`);await until(`!!parsedMetadataCache[0]`,'metadata');await run(`updateVolume(0);playTrack(0)`);await until(`isPlaying`,'playback');
 await run(`playlistElem.insertAdjacentHTML('beforeend',Array.from({length:500},(_,i)=>'<li><span class="track-name">Track '+i+'</span><button class="actions-btn"><i data-lucide="more-vertical"></i></button></li>').join(''));lucide.createIcons({root:playlistElem});window.__trackIcons=[...playlistElem.querySelectorAll('svg')];window.__initialPlayTime=localAudioElement.currentTime;`);
 for(let i=0;i<4;i++){
 await run(`document.getElementById('theme-toggle').click()`);
 assert(await run(`__trackIcons.every((node,i)=>node===playlistElem.querySelectorAll('svg')[i])`),'theme button preserves track icon nodes');
 assert(await run(`[...playlistElem.querySelectorAll('svg')].every(node=>!node.getAnimations().some(a=>a instanceof CSSTransition&&a.transitionProperty==='color'))`),'no per-icon inherited color transitions');
 await until(`!document.documentElement.classList.contains('appearance-updating')`,'hover transitions restored');
 }
 await run(`document.getElementById('settings-fab').click();document.querySelector('[data-panel="panel-appearance"]').click()`);
 for(const dark of [false,true,false,true]){
 await run(`{const toggle=document.getElementById('setting-dark-theme');toggle.checked=${dark};toggle.dispatchEvent(new Event('change'));}`);
 assert.equal(await run(`document.body.getAttribute('data-theme')==='dark'`),dark);
 assert.equal(await run(`appStorage.getItem('player_theme')`),dark?'dark':'light');
 assert.equal(await run(`getComputedStyle(document.body).getPropertyValue('--bg-color').trim()`),dark?'#121212':'#f4f7f6');
 assert(await run(`__trackIcons.every((node,i)=>node===playlistElem.querySelectorAll('svg')[i])`));
 await until(`!document.documentElement.classList.contains('appearance-updating')`,'palette cleanup');
 }
 await run(`document.getElementById('accent-color-picker').value='#f4d03f';document.getElementById('accent-color-picker').dispatchEvent(new Event('input'))`);
 assert.equal(await run(`appStorage.getItem('setting_accent_color')`),'#f4d03f');
 assert.equal(await run(`getComputedStyle(document.body).getPropertyValue('--accent-color').trim()`),'#f4d03f');
 assert.equal(await run(`getComputedStyle(document.body).getPropertyValue('--accent-contrast').trim()`),'#000000');
 await until(`!document.documentElement.classList.contains('appearance-updating')`,'accent cleanup');
 assert(await run(`getComputedStyle(document.getElementById('theme-toggle')).transitionProperty.includes('background-color')`),'hover color feedback remains');
 await run(`beginAppearanceUpdate();document.getElementById('theme-toggle').style.opacity='.5'`);
 assert(await run(`document.getElementById('theme-toggle').getAnimations().some(a=>a instanceof CSSTransition&&a.transitionProperty==='opacity')`),'opacity transitions survive palette batch');
 await run(`document.getElementById('theme-toggle').style.opacity='';void 0`);
 await run(`(async()=>{await addonContributions.invoke('theme-probe','','appearance.mode',{mode:'dark'},{});await addonContributions.invoke('theme-probe','','appearance.palette',{palette:{background:'#18212c',surface:'#202c3b',text:'#eef3f8',accent:'#ed9c56'}},{})})()`);
 assert.equal(await run(`getComputedStyle(document.body).getPropertyValue('--bg-color').trim()`),'#18212c');
 await run(`{const toggle=document.getElementById('setting-dark-theme');toggle.checked=false;toggle.dispatchEvent(new Event('change'));}`);
 assert.equal(await run(`getComputedStyle(document.body).getPropertyValue('--bg-color').trim()`),'#18212c','owned palette remains effective');
 await run(`addonContributions.cleanup('theme-probe')`);
 assert.equal(await run(`getComputedStyle(document.body).getPropertyValue('--bg-color').trim()`),'#f4f7f6','manual base restored after extension stops');
 assert(await run(`isPlaying&&!localAudioElement.paused&&localAudioElement.currentTime>__initialPlayTime`),'playback stays continuous');
 assert(await run(`__trackIcons.every((node,i)=>node===playlistElem.querySelectorAll('svg')[i])`),'all appearance paths preserve library icons');
 for(const dark of [false,true]){await run(`{const toggle=document.getElementById('setting-dark-theme');toggle.checked=${dark};toggle.dispatchEvent(new Event('change'));}`);await delay(350);fs.writeFileSync(path.join(output,dark?'dark.png':'light.png'),(await win.webContents.capturePage()).toPNG())}
 console.log('PASS: theme/accent changes preserve 500 library icons and playback, avoid inherited per-icon transitions, retain hover/opacity feedback, persist values, and preserve extension palette ownership/cleanup.');app.exit(0);
 }catch(e){console.error(e);app.exit(1)}
}));require('../src/main/index');
