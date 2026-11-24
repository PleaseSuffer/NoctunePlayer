const {app,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.resolve('tests/.artifacts/playback-queue');fs.mkdirSync(root,{recursive:true});
const profile=fs.mkdtempSync(path.join(root,'profile-'));app.setPath('userData',profile);
fs.writeFileSync(path.join(profile,'config.json'),JSON.stringify({language:process.argv.includes('--english')?'en':'ru',hardwareAcceleration:'0'}));
const fixture=path.join(root,'queue.wav');fs.writeFileSync(fixture,require('./helpers/tag-audio.cjs').audioFixture(40).buffer);
const show=BrowserWindow.prototype.show;BrowserWindow.prototype.show=function(){};BrowserWindow.prototype.showInactive=function(){};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
setTimeout(()=>{console.error('TIMEOUT');app.exit(1)},60000);
app.on('browser-window-created',(_,win)=>win.webContents.on('did-finish-load',async()=>{
 if(!win.webContents.getURL().endsWith('/renderer/index.html'))return;
 const run=code=>win.webContents.executeJavaScript(code);
 const wait=async code=>{for(let i=0;i<100;i++){if(await run(code))return;await delay(100)}throw Error('wait '+code)};
 try{
 win.webContents.setBackgroundThrottling(false);win.setSize(1100,850);show.call(win);await delay(800);
 await run(`openExternalAudioFiles({files:[${JSON.stringify(fixture)}],action:'play'})`);await wait(`fileEntries.length===1 && parsedMetadataCache[0]`);
 await run(`playTrack(0)`);await wait('isPlaying');
 await run(`document.getElementById('btn-queue').click(); selectedTrackIndexInMenu=0;document.getElementById('menu-add-queue').click();document.getElementById('menu-play-next').click();enqueuePlaylistTrack(0);`);
 assert.equal(await run('externalAudioQueue.length'),3);
 const order=await run(`externalAudioQueue.map(e=>e.queueId)`);
 await run(`document.querySelectorAll('#queue-list [data-action="up"]')[1].click()`);
 assert.deepEqual(await run('externalAudioQueue.map(e=>e.queueId)'),[order[1],order[0],order[2]]);
 // Drag the last item before the first, using browser DataTransfer.
 await run(`(()=>{const rows=document.querySelectorAll('.queue-row'),dt=new DataTransfer();rows[2].querySelector('.queue-grip').dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));const r=rows[0].getBoundingClientRect();rows[0].dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt,clientY:r.top+1}));rows[0].dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt,clientY:r.top+1}));document.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));})()`);
 assert.deepEqual(await run('externalAudioQueue.map(e=>e.queueId)'),[order[2],order[1],order[0]]);
 assert.equal(await run('fileEntries.length'),1,'playlist is unchanged');
 await run(`playNext()`);await wait('isPlaying && externalAudioQueue.length===2');
 await run(`document.querySelector('#queue-list [data-action="remove"]').click()`);assert.equal(await run('externalAudioQueue.length'),1);
 await run(`document.querySelector('#queue-list .queue-track').click()`);await wait('isPlaying && externalAudioQueue.length===0');
 await run(`enqueuePlaylistTrack(0)`);
 // Add a playlist row through the drop target.
 await run(`(()=>{const row=playlistElem.querySelector('li[data-id]'),dt=new DataTransfer();row.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));document.getElementById('playback-queue').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));})()`);
 assert.equal(await run('externalAudioQueue.length'),2);
 await run(`document.querySelector('.queue-grip').focus();document.querySelector('.queue-grip').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',altKey:true,bubbles:true,cancelable:true}));`);
 assert.equal(await run(`document.activeElement.classList.contains('queue-grip')`),true);
 // Providers share the same queue, metadata uses text nodes.
 await run(`externalAudioQueue.push({queueId:'provider-test',provider:{addonId:'demo',providerId:'demo',track:{id:'1',title:'<b>Long title</b> '.repeat(20),artist:'Provider artist'}}});addonEvents.emit('queue.changed');`);
 assert.equal(await run(`document.querySelectorAll('#queue-list b').length`),0);
 await run(`document.getElementById('setting-dark-theme').checked=true;document.getElementById('setting-dark-theme').dispatchEvent(new Event('change'));`);await delay(900);
 fs.writeFileSync(path.join(root,'queue-dark.png'),(await win.webContents.capturePage()).toPNG());
 for(const [w,h] of [[460,740],[850,460],[360,400]]){
 win.setMinimumSize(340,360);win.setSize(w,h);
 await run(`document.getElementById('setting-dark-theme').checked=false;document.getElementById('setting-dark-theme').dispatchEvent(new Event('change'));`);await delay(900);
 assert(await run(`(()=>{const r=document.getElementById('btn-queue').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()`),'queue trigger stays reachable');
 const bounds=await run(`(()=>{const p=document.getElementById('playback-queue'),r=p.getBoundingClientRect();return {w:p.scrollWidth,c:p.clientWidth,left:r.left,right:r.right,top:r.top,bottom:r.bottom,vw:innerWidth,vh:innerHeight}})()`);
 assert(bounds.w<=bounds.c+1,JSON.stringify(bounds));assert(bounds.left>=0&&bounds.right<=bounds.vw+1&&bounds.top>=0&&bounds.bottom<=bounds.vh+1,JSON.stringify(bounds));
 fs.writeFileSync(path.join(root,`queue-${w}x${h}.png`),(await win.webContents.capturePage()).toPNG());
 }
 await run(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);await wait(`document.getElementById('playback-queue').hidden`);
 await run(`document.getElementById('btn-queue').click();document.getElementById('queue-clear').click()`);assert.equal(await run('externalAudioQueue.length'),0);assert(await run('isPlaying'),'clearing does not stop playback');
 console.log('PASS queue: reorder buttons, drag/drop, removal, next playback, provider metadata, escaping, clear, focus, dark/light and 360/460/850/1100 layouts');app.exit(0);
 }catch(error){console.error(error);app.exit(1)}
}));require('../src/main/index');
