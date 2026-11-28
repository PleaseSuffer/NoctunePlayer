const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const output=path.resolve('tests/.artifacts/theme-view');fs.mkdirSync(output,{recursive:true});
app.setPath('userData',fs.mkdtempSync(path.join(output,'profile-')));
const audio=path.join(output,'playing.wav');fs.writeFileSync(audio,require('./helpers/tag-audio.cjs').audioFixture(40).buffer);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));let started=false;
setTimeout(()=>app.exit(2),35000);
app.on('browser-window-created',(_,win)=>win.webContents.on('did-finish-load',async()=>{
 if(started||!win.webContents.getURL().endsWith('/renderer/index.html'))return;started=true;
 try{
  await wait(700);win.show();
  const run=code=>win.webContents.executeJavaScript(code);
  await run(`loadMusicFromFiles([${JSON.stringify(audio)}])`);
  for(let i=0;i<100&&!await run('!!parsedMetadataCache[0]');i++)await wait(50);
  await run('updateVolume(0);playTrack(0)');await wait(400);
  const result=await run(`(async()=>{
   const assert=(v,m)=>{if(!v)throw Error(m)};
   const press=(code,options={})=>document.body.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true,cancelable:true,...options}));
   const hidden=()=>document.body.classList.contains('theme-view-only');
   const visible=node=>getComputedStyle(node).visibility!=='hidden'&&getComputedStyle(node).display!=='none';
   const hint=()=>document.querySelector('#notification-stack > .theme-view-hint');
   const marker=document.createElement('iframe');marker.className='scene-frame';document.body.prepend(marker);
   const control=document.getElementById('btn-queue');control.focus();
   press('KeyH',{ctrlKey:true,shiftKey:true});assert(hidden(),'default shortcut enters theme view');
   assert(hint()&&visible(hint())&&hint().textContent.includes('Ctrl+Shift+H')&&hint().textContent.includes('Esc'),'visible hint names active default shortcut and Escape');
   assert(hint().querySelector('.notification-toast-countdown'),'hint has auto-dismiss countdown');
   assert(visible(marker)&&!visible(document.getElementById('main-player')),'theme remains visible and player hides');
   assert(document.activeElement!==control,'hidden controls lose focus');
   press('KeyH',{ctrlKey:true,shiftKey:true,repeat:true});assert(hidden(),'holding shortcut cannot flicker');
   document.getElementById('setting-notifications').checked=true;
   const ordinary=showNotification('Hidden toast','info',null,null,{replaceKey:'view-test',pinned:true});
   assert(!visible(ordinary)&&visible(hint()),'ordinary notifications stay hidden while hint remains visible');
   press('Escape',{key:'Escape'});assert(!hidden()&&visible(document.getElementById('main-player')),'Escape restores UI');
   assert(!hint(),'restoring UI dismisses hint');
   assert(document.activeElement===control,'previous focus restored');
   window.hotkeyBindings.toggleInterface='alt+KeyU';
   press('KeyH',{ctrlKey:true,shiftKey:true});assert(!hidden(),'previous binding inactive');
   press('KeyU',{altKey:true});assert(hidden(),'custom binding enters');
   assert(hint().textContent.includes('Alt+U')&&!hint().textContent.includes('Ctrl+Shift+H'),'hint uses current custom binding');
   press('KeyU',{altKey:true});assert(!hidden(),'custom binding exits');
   window.hotkeyBindings.toggleInterface='';
   document.getElementById('setting-notifications').checked=false;
   window.setThemeViewOnly(true);
   assert(visible(hint())&&hint().textContent.includes('Esc')&&!hint().textContent.includes('Alt+U')&&!hint().textContent.includes('Ctrl+Shift+H'),'unassigned binding shows only Escape even with notifications disabled');
   window.setThemeViewOnly(false);
   document.getElementById('setting-notifications').checked=true;
   window.hotkeyBindings.toggleInterface='alt+KeyU';
   const input=document.getElementById('search-input');input.focus();
   input.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyU',altKey:true,bubbles:true,cancelable:true}));
   assert(!hidden(),'typing does not hide UI');input.blur();
   document.getElementById('settings-fab').click();assert(document.getElementById('settings-overlay').classList.contains('open'),'settings open');
   window.setThemeViewOnly(true);assert(!visible(document.getElementById('settings-overlay')),'open settings hidden');
   const before=localAudioElement.currentTime;await new Promise(r=>setTimeout(r,450));
   assert(!localAudioElement.paused&&localAudioElement.currentTime>before,'audio continues in theme view');
   window.notificationCenter.dismiss(window.notificationCenter.find('theme-view-hint'));
   const outgoing=document.querySelector('#notification-exit-layer > .theme-view-hint');
   assert(outgoing&&visible(outgoing),'hint exit remains visible while interface is hidden');
   if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
    await new Promise(r=>setTimeout(r,100));const opacity=Number(getComputedStyle(outgoing).opacity);
    assert(opacity>0&&opacity<1,'hint visibly fades out in theme view');
   }
   await new Promise(r=>setTimeout(r,350));assert(!outgoing.isConnected,'hint removed after exit');
   window.setThemeViewOnly(false);assert(visible(document.getElementById('settings-overlay')),'settings return intact');
   marker.remove();return true;
  })()`);
  assert(result);console.log('PASS theme view: default/custom shortcut, repeat, Escape, focus, theme visibility, overlays, notifications and uninterrupted audio.');app.exit(0);
 }catch(error){console.error(error);app.exit(1);}
}));
require('../src/main/index');
