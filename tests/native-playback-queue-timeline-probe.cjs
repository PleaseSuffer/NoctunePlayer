const {app,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.resolve('tests/.artifacts/playback-queue-timeline');fs.mkdirSync(root,{recursive:true});
const profile=fs.mkdtempSync(path.join(root,'profile-'));app.setPath('userData',profile);
fs.writeFileSync(path.join(profile,'config.json'),JSON.stringify({language:process.argv.includes('--english')?'en':'ru',hardwareAcceleration:'0'}));
const files=['Alpha','Bravo','Charlie','Delta','Extra'].map(name=>path.join(root,name+'.wav'));
for(const file of files)fs.writeFileSync(file,require('./helpers/tag-audio.cjs').audioFixture(40).buffer);
const show=BrowserWindow.prototype.show;BrowserWindow.prototype.show=function(){};BrowserWindow.prototype.showInactive=function(){};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
setTimeout(()=>{console.error('TIMEOUT');app.exit(1)},90000);
app.on('browser-window-created',(_,win)=>win.webContents.on('did-finish-load',async()=>{
 if(!win.webContents.getURL().endsWith('/renderer/index.html'))return;
 const run=code=>win.webContents.executeJavaScript(code);
 const wait=async code=>{for(let i=0;i<120;i++){if(await run(code))return;await delay(100)}throw Error('wait '+code)};
 const upcoming=()=>run(`playbackQueue.view().map(e=>e.path.split('/').pop())`);
 try{
 win.webContents.setBackgroundThrottling(false);win.setSize(1100,850);show.call(win);await delay(800);
 await run(`appStorage.setItem('setting_read_tags','0');openExternalAudioFiles({files:${JSON.stringify(files.slice(0,4))},action:'play'})`);await wait('isPlaying && fileEntries.length===4');
 await run(`document.getElementById('btn-queue').click()`);
 assert.deepEqual(await upcoming(),['Bravo.wav','Charlie.wav','Delta.wav']);
 assert.equal(await run(`document.querySelectorAll('#queue-list .queue-row').length`),3,'playlist is shown without adding anything');
 const sdkQueue=await run(`addonPlayer.invoke('queue-test','hash','queue.read',{})`);assert.equal(sdkQueue.length,3);
 await run(`addonPlayer.invoke('queue-test','hash','queue.reorder',{id:${JSON.stringify(sdkQueue[2].id)},index:0})`);
 assert.equal(await run(`document.querySelector('#queue-list .queue-track-title').textContent`),'Delta');
 assert.deepEqual(await upcoming(),['Delta.wav','Bravo.wav','Charlie.wav']);
 await run(`playNext()`);await wait(`isPlaying && trackTitle.textContent==='Delta'`);assert.deepEqual(await upcoming(),['Bravo.wav','Charlie.wav']);
 await run(`document.querySelector('#queue-list [data-action="remove"]').click();handleTrackEnded()`);await wait(`isPlaying && trackTitle.textContent==='Charlie'`);assert.deepEqual(await upcoming(),[]);
 await run(`handleTrackEnded()`);await wait('!isPlaying && currentIndex===-1');assert.deepEqual(await upcoming(),[],'normal fallback does not replay removed tracks');
 await run(`playTrack(0)`);await wait(`isPlaying && trackTitle.textContent==='Alpha'`);
 await run(`setRepeatMode(1);handleTrackEnded()`);await wait(`isPlaying && trackTitle.textContent==='Alpha'`);assert.deepEqual(await upcoming(),['Bravo.wav','Charlie.wav','Delta.wav']);
 await run(`setRepeatMode(0);toggleShuffle()`);
 assert.deepEqual(await upcoming(),await run(`shuffleList.slice(currentShufflePos+1).map(i=>fileEntries[playlistOrder[i]].path.split('/').pop())`),'UI follows the real shuffle list');
 await run(`toggleShuffle()`);
 const origin=await run('activePlaylistId');
 await run(`userPlaylists.push({id:'other',name:'Other playlist',type:'folder',files:[${JSON.stringify(files[4])}],stations:[]});selectPlaylist('other')`);
 assert.deepEqual(await upcoming(),['Bravo.wav','Charlie.wav','Delta.wav']);
 await run(`enqueuePlaylistTrack(0)`);assert.deepEqual(await upcoming(),['Extra.wav','Bravo.wav','Charlie.wav','Delta.wav']);
 await run(`moveQueueEntry(externalAudioQueue[0].queueId,1)`);assert.deepEqual(await upcoming(),['Bravo.wav','Extra.wav','Charlie.wav','Delta.wav']);
 for(const title of ['Bravo','Extra','Charlie']){await run('playNext()');await wait(`isPlaying && trackTitle.textContent===${JSON.stringify(title)}`)}
 assert.equal(await run('activePlaylistId'),origin,'returns to the source playlist after an inserted track');
 assert.deepEqual(await upcoming(),['Delta.wav']);
 // Both native and custom palettes use the player's glass surface.
 await run(`window.glassOpacityEnabled=true;window.glassOpacityValue=.35;applyGlassOpacity();document.body.classList.remove('no-blur');`);await delay(850);
 const glass=await run(`(()=>{const p=getComputedStyle(document.getElementById('main-player')),q=getComputedStyle(document.getElementById('playback-queue'));return {main:p.backgroundColor,queue:q.backgroundColor,blur:q.backdropFilter}})()`);
 assert.equal(glass.main,glass.queue);assert.match(glass.queue,/0\.35/);assert.match(glass.blur,/blur/);
 await run(`document.body.classList.add('no-blur')`);assert.equal(await run(`getComputedStyle(document.getElementById('playback-queue')).backdropFilter`),'none');await run(`document.body.classList.remove('no-blur')`);
 await run(`document.documentElement.style.setProperty('--container-bg','rgba(24, 40, 62, .45)');document.body.style.setProperty('--container-bg','rgba(24, 40, 62, .45)');document.body.style.setProperty('--text-color','#dceaff');document.body.style.setProperty('--text-muted','#bed0e5');document.body.style.setProperty('--accent-color','#63c9ce');`);await delay(850);
 assert(await run(`(()=>{const p=getComputedStyle(document.getElementById('main-player')),q=getComputedStyle(document.getElementById('playback-queue'));return p.backgroundColor===q.backgroundColor&&p.color===q.color})()`));
 fs.writeFileSync(path.join(root,'queue-inherited-palette.png'),(await win.webContents.capturePage()).toPNG());
 await run(`document.body.style.removeProperty('--text-color');document.body.style.removeProperty('--text-muted');document.body.style.removeProperty('--accent-color');window.glassOpacityValue=.7;document.getElementById('setting-dark-theme').checked=false;document.getElementById('setting-dark-theme').dispatchEvent(new Event('change'));applyGlassOpacity();`);
 win.setMinimumSize(340,360);win.setSize(460,740);await delay(850);fs.writeFileSync(path.join(root,'queue-light-narrow.png'),(await win.webContents.capturePage()).toPNG());
 const bounds=await run(`(()=>{const p=document.getElementById('playback-queue'),r=p.getBoundingClientRect();return {w:p.scrollWidth,c:p.clientWidth,left:r.left,right:r.right,top:r.top,bottom:r.bottom,vw:innerWidth,vh:innerHeight}})()`);assert(bounds.w<=bounds.c+1&&bounds.left>=0&&bounds.right<=bounds.vw+1&&bounds.bottom<=bounds.vh+1,JSON.stringify(bounds));
 await run(`document.getElementById('queue-clear').click()`);assert.deepEqual(await upcoming(),[]);assert(await run('isPlaying'));
 // Large playlists retain the full timeline while drawing a bounded first page.
 win.setSize(1100,850);
 await run(`userPlaylists.push({id:'large',name:'Large playlist',type:'folder',files:Array.from({length:250},(_,i)=>${JSON.stringify(files.slice(0,4))}[i%4]),stations:[]});selectPlaylist('large')`);
 await run('playTrack(0)');await wait('isPlaying && playbackQueue.view().length===249');
 assert.equal(await run(`document.querySelectorAll('#queue-list .queue-row').length`),100);
 await run(`document.getElementById('queue-more').click()`);assert.equal(await run(`document.querySelectorAll('#queue-list .queue-row').length`),200);
 console.log('PASS real Electron: playlist fills queue, reordering controls playback, natural completion, removal, repeat, existing shuffle, browsing, mixed playlist continuation, glass alpha, palette, blur and narrow window');app.exit(0);
 }catch(error){console.error(error);console.error(await run(`({title:trackTitle.textContent,playing:isPlaying,currentIndex,currentPlaylistId,activePlaylistId,queue:playbackQueue.view().map(e=>({path:e.path,auto:e.automatic}))})`).catch(()=>''));app.exit(1)}
}));
const archive = process.argv.find(value => value.startsWith('--app-asar='))?.slice('--app-asar='.length);
if (archive) { app.setAppPath(path.resolve(archive)); Object.defineProperty(app, 'isPackaged', { value: true }); require('electron-updater').autoUpdater.checkForUpdates = async () => null; }
require(archive ? path.join(path.resolve(archive), 'src/main/index.js') : '../src/main/index');
