const {app,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.resolve('tests/.artifacts/queue-service-menu');fs.mkdirSync(root,{recursive:true});
const profile=fs.mkdtempSync(path.join(root,'profile-'));app.setPath('userData',profile);fs.writeFileSync(path.join(profile,'config.json'),JSON.stringify({language:process.argv.includes('--english')?'en':'ru',hardwareAcceleration:'0'}));
const files=['Alpha','Bravo','Charlie'].map(name=>path.join(root,name+'.wav'));
for(const file of files)fs.writeFileSync(file,require('./helpers/tag-audio.cjs').audioFixture(40).buffer);
const show=BrowserWindow.prototype.show;BrowserWindow.prototype.show=function(){};BrowserWindow.prototype.showInactive=function(){};
const delay=ms=>new Promise(r=>setTimeout(r,ms));setTimeout(()=>{console.error('TIMEOUT');app.exit(1)},80000);
app.on('browser-window-created',(_,win)=>win.webContents.on('did-finish-load',async()=>{
 if(!win.webContents.getURL().endsWith('/renderer/index.html'))return;
 const run=code=>win.webContents.executeJavaScript(code);
 const wait=async code=>{for(let i=0;i<150;i++){if(await run(code))return;await delay(50)}throw Error(code)};
 const menuMetrics=selector=>run(`(()=>{const menu=document.querySelector(${JSON.stringify(selector)});return {width:menu.offsetWidth,items:[...menu.querySelectorAll('button')].filter(b=>getComputedStyle(b).display!=='none').slice(0,3).map(b=>({text:b.textContent.trim(),height:b.offsetHeight,font:getComputedStyle(b).fontSize,icon:b.querySelector('svg').getBoundingClientRect().width}))}})()`);
 try{
 win.webContents.setBackgroundThrottling(false);win.webContents.setAudioMuted(true);win.setSize(1100,850);show.call(win);await delay(700);
 await run(`appStorage.setItem('setting_read_tags','0');openExternalAudioFiles({files:${JSON.stringify(files)},action:'play'})`);await wait(`isPlaying && trackTitle.textContent==='Alpha'`);
 const localId=await run('currentPlaylistId');
 await run(`playlistElem.querySelector('li[data-id="0"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:450,clientY:300}))`);
 assert.equal(await run(`getComputedStyle(document.getElementById('menu-play-next')).display`),'flex');
 const localMenu=await menuMetrics('#context-menu');assert.equal(localMenu.items.length,3);assert(localMenu.items.every(i=>i.icon===16));
 await delay(250);fs.writeFileSync(path.join(root,'local-menu.png'),(await win.webContents.capturePage()).toPNG());
 await run(`addonProviders.register('queue-demo','hash',{id:'queue-provider',name:'Queue service',trackActions:false},async()=>[]);addonProviders.resolve=async(entry,token,reason)=>{if(entry.trackId==='bad'||(entry.trackId==='late'&&reason==='refresh')){const error=new Error('Unavailable');error.code='UNAVAILABLE';throw error;}return ${JSON.stringify('file://'+files[0])}};addonProviders.collection('queue-demo',{provider:'queue-provider',id:'source',name:'Service playlist',persist:false,tracks:[{id:'good',entryId:'one',title:'Service track',artist:'Demo'},{id:'bad',entryId:'two',title:'Unavailable track'},{id:'removed',entryId:'three',title:'Removed track'},{id:'late',entryId:'four',title:'Expired stream'}]})`);
 const serviceId=await run('currentPlaylistId');const playlistCount=await run('userPlaylists.length');
 await run(`playlistElem.querySelector('li[data-id="0"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:450,clientY:300}))`);await wait(`!!document.querySelector('.provider-context-menu') && !document.querySelector('.provider-context-menu button:disabled')`);
 const serviceMenu=await menuMetrics('.provider-context-menu');assert.deepEqual(serviceMenu,localMenu,'common menus have identical labels, row dimensions and icon sizes');
 await delay(250);fs.writeFileSync(path.join(root,'service-menu.png'),(await win.webContents.capturePage()).toPNG());
 await run(`document.querySelector('.provider-context-menu button:nth-child(3)').click()`);await wait('externalAudioQueue.length===1');assert.equal(await run('externalAudioQueue[0].playlistId'),serviceId);
 await run(`selectPlaylist(${JSON.stringify(localId)})`);await run('playNext()');await wait(`isPlaying && trackTitle.textContent==='Service track'`);
 assert.equal(await run('userPlaylists.length'),playlistCount);assert.equal(await run('activePlaylistId'),serviceId);
 await run('playNext()');await wait(`isPlaying && trackTitle.textContent==='Bravo'`);assert.equal(await run('activePlaylistId'),localId);
 await run(`selectPlaylist(${JSON.stringify(serviceId)})`);await run('enqueuePlaylistTrack(1)');await run(`selectPlaylist(${JSON.stringify(localId)})`);await run('playNext()');await wait(`isPlaying && trackTitle.textContent==='Charlie'`);
 assert(await run(`[...document.querySelectorAll('.notification-toast-msg')].some(n=>n.textContent.includes('Unavailable track'))`),'unavailable resolver track has a toast and is skipped');
 assert.equal(await run('userPlaylists.length'),playlistCount);
 await run(`selectPlaylist(${JSON.stringify(serviceId)})`);await run(`enqueuePlaylistTrack(2);enqueuePlaylistTrack(0);userPlaylists.find(p=>p.id===${JSON.stringify(serviceId)}).tracks.splice(2,1)`);await run('playNext()');await wait(`isPlaying && trackTitle.textContent==='Service track'`);
 assert(await run(`[...document.querySelectorAll('.notification-toast-msg')].some(n=>n.textContent.includes('Removed track'))`),'removed source entries are skipped');
 await run(`selectPlaylist(${JSON.stringify(serviceId)})`);await run('enqueuePlaylistTrack(2)');await run(`selectPlaylist(${JSON.stringify(localId)})`);await run('enqueuePlaylistTrack(0)');await run('playNext()');await wait(`isPlaying && trackTitle.textContent==='Expired stream'`);
 await run(`localAudioElement.dispatchEvent(new Event('error'))`);await wait(`isPlaying && trackTitle.textContent==='Alpha'`);assert(await run(`[...document.querySelectorAll('.notification-toast-msg')].some(n=>n.textContent.includes('Expired stream'))`),'unrecoverable stream refresh continues the queue');
 assert.equal(await run('userPlaylists.length'),playlistCount);
 await run(`document.getElementById('btn-queue').click()`);assert.equal(await run(`document.getElementById('queue-source')`),null);
 win.setMinimumSize(340,360);win.setSize(460,740);await delay(300);await run(`document.getElementById('queue-close').click()`);await delay(220);
 await run(`selectPlaylist(${JSON.stringify(localId)})`);await run(`playlistElem.querySelector('li[data-id="0"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:innerWidth-1,clientY:innerHeight-1}))`);
 assert(await run(`(()=>{const r=document.getElementById('context-menu').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()`),'local menu stays within a narrow viewport');
 console.log('PASS: unified compact menus, both queue actions, preserved provider source, resolver/removal/stream skips with toast, continuation, no duplicate playlists, neutral header and narrow placement');app.exit(0);
 }catch(error){console.error(error);console.error(await run(`({title:trackTitle.textContent,playing:isPlaying,currentIndex,currentPlaylistId,activePlaylistId,queue:playbackQueue.view().map(e=>({path:e.path,id:e.provider?.track.id})),status:statusText.textContent})`).catch(()=>''));app.exit(1)}
}));
const archive=process.argv.find(value=>value.startsWith('--app-asar='))?.slice('--app-asar='.length);
if(archive){app.setAppPath(path.resolve(archive));Object.defineProperty(app,'isPackaged',{value:true});require('electron-updater').autoUpdater.checkForUpdates=async()=>null;}
require(archive?path.join(path.resolve(archive),'src/main/index.js'):'../src/main/index');
