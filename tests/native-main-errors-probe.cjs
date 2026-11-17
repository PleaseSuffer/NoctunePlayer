const {app,BrowserWindow,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),output=path.join(__dirname,'.artifacts/main-errors');
fs.mkdirSync(output,{recursive:true});const profile=fs.mkdtempSync(path.join(output,'profile-'));app.setPath('userData',profile);
const disabledAtStartup=process.argv.includes('--notifications-disabled');if(disabledAtStartup)fs.writeFileSync(path.join(profile,'config.json'),JSON.stringify({setting_notifications:'0'}));
const archive=process.argv.find(value=>value.startsWith('--app-asar='))?.slice(11),source=archive?path.resolve(archive):root;
if(archive){app.setAppPath(source);Object.defineProperty(app,'isPackaged',{value:true});}
require('electron-updater').autoUpdater.checkForUpdates=async()=>null;
const nativeErrors=[];dialog.showErrorBox=(...args)=>nativeErrors.push(args);dialog.showMessageBox=async(_win,options)=>{if(options?.type==='error')nativeErrors.push(options);return {response:0};};
BrowserWindow.prototype.show=function(){};BrowserWindow.prototype.showInactive=function(){};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.on('browser-window-created',(_,win)=>win.webContents.on('did-finish-load',async()=>{
 if(!win.webContents.getURL().endsWith('/renderer/index.html'))return;
 const run=code=>win.webContents.executeJavaScript(code),wait=async(code,label)=>{for(let i=0;i<100;i++){if(await run(code))return;await delay(50);}throw Error(label);};
 try{
  if(disabledAtStartup){await wait(`window._appLogBuffer.some(item=>item.msg.includes('startup-main-fixture'))`,'startup error delivered');assert.equal(await run(`document.querySelectorAll('.notification-toast').length`),0);}else await wait(`Array.from(document.querySelectorAll('.notification-toast')).some(t=>t.textContent.includes('startup-main-fixture'))`,'buffered startup error toast');
  await run(`document.querySelectorAll('.notification-toast').forEach(node=>node.remove());Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__copied=value;}}});document.getElementById('setting-notifications').checked=true`);
  setImmediate(()=>{throw Object.assign(new Error('connect ENETUNREACH main-fixture'),{code:'ENETUNREACH',syscall:'connect'});});
  await wait(`document.querySelector('.notification-toast-copy-stack')`,'copyable main-error toast');
  assert(await run(`document.querySelector('.notification-toast').textContent.includes('ENETUNREACH')`));
  await run(`document.querySelector('.notification-toast-copy-stack').click()`);
  await wait(`window.__copied?.includes('STACK TRACE')&&window.__copied.includes('ENETUNREACH')&&window.__copied.includes(${JSON.stringify(path.basename(__filename))})`,'full main stack copied');
  await fs.promises.writeFile(path.join(output,'main-error-toast.png'),(await win.webContents.capturePage()).toPNG());
  await run(`document.querySelectorAll('.notification-toast').forEach(node=>node.remove());document.getElementById('setting-notifications').checked=false`);
  Promise.reject(new Error('disabled-main-fixture'));
  await wait(`window._appLogBuffer.some(item=>item.msg.includes('disabled-main-fixture'))`,'rejection logged while notifications disabled');
  assert.equal(await run(`document.querySelectorAll('.notification-toast').length`),0);
  await run(`document.getElementById('setting-notifications').checked=true`);
  const bad=path.join(output,'broken.noctaddon');fs.writeFileSync(bad,'invalid package');app.emit('open-file',{preventDefault(){}},bad);
  await wait(`document.querySelector('.notification-toast-copy-stack')`,'addon-open failure uses copyable toast');
  assert.equal(nativeErrors.length,0,'Electron/default/error-message dialogs must never open');
  console.log('PASS: real startup queue, uncaught exception and unhandled rejection use existing toasts, full stack copy, disabled notification toggle, addon-open errors, and no native error dialogs.');app.exit(0);
 }catch(error){console.log('Renderer state:',await run(`({ready:document.readyState,errors:!!noctune.errors,enabled:document.getElementById('setting-notifications').checked,logs:window._appLogBuffer,toasts:document.querySelectorAll('.notification-toast').length})`));console.error(error);app.exit(1);}
}));
require(path.join(source,'src/main/index.js'));
setImmediate(()=>{throw new Error('startup-main-fixture');});
setTimeout(()=>{console.error('Main errors probe timeout');app.exit(1);},25000);
