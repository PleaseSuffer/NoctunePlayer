// Real installer windows in an isolated profile; no user registry or packages.
const {app,BrowserWindow,dialog}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const fsSync=require('node:fs');
const root=path.resolve(__dirname,'..'),output=path.join(root,'tests/.artifacts/open-addon'),windows=[];
const archive=process.argv.find(value=>value.startsWith('--app-asar='))?.slice('--app-asar='.length),source=archive?path.resolve(archive):root;
if(archive){app.setAppPath(source);Object.defineProperty(app,'isPackaged',{value:true});require('electron-updater').autoUpdater.checkForUpdates=async()=>null;}
BrowserWindow.prototype.show=function(){};BrowserWindow.prototype.showInactive=function(){};
app.on('browser-window-created',(_,win)=>windows.push(win));
let errors=0;dialog.showMessageBox=async()=>{errors++;return {response:0};};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const wait=async(fn,label)=>{for(let i=0;i<150;i++){const value=await fn();if(value)return value;await delay(100);}throw Error(label);};
const run=(win,code)=>win.webContents.executeJavaScript(code);
const installer=()=>windows.find(win=>!win.isDestroyed()&&win.webContents.getURL().endsWith('/addon-install/index.html')&&!win.webContents.isLoading());
(async()=>{
    fsSync.mkdirSync(output,{recursive:true});const profile=fsSync.mkdtempSync(path.join(output,'profile-'));app.setPath('userData',profile);
    const p=require(path.join(source,'src/main/addons/package')),{createAddonStore}=require(path.join(source,'src/main/addons/store'));
    const pkg={format:'noctune-addon',formatVersion:1,manifest:JSON.parse(fsSync.readFileSync(path.join(root,'addons/examples/track-info/manifest.json'),'utf8')),files:{'main.js':fsSync.readFileSync(path.join(root,'addons/examples/track-info/main.js'),'utf8')}};pkg.manifest.id='file-open-demo';
    const file=path.join(output,'Новое расширение #1.noctaddon'),bad=path.join(output,'broken.noctaddon');fsSync.writeFileSync(file,p.canonical(pkg));fsSync.writeFileSync(bad,'{}');
    process.argv.push(file);require(path.join(source,'src/main/index.js'));
    const store=createAddonStore({directory:path.join(profile,'addons'),appVersion:'1.4.0'});
    const reopen=file=>app.emit('second-instance',{},process.defaultApp?[process.execPath,root,file]:[process.execPath,file],root);
    let win=await wait(installer,'cold installer');
    await wait(()=>run(win,`document.getElementById('badge').textContent==='Новое расширение'`),'cold details');
    assert.equal((await store.list()).length,0,'opening a file does not install it');
    reopen(file);await delay(300);assert.equal(windows.filter(w=>!w.isDestroyed()&&w.webContents.getURL().includes('/addon-install/')).length,1,'duplicate file focuses existing preview');
    await run(win,`document.getElementById('cancel').click()`);await wait(()=>win.isDestroyed(),'cancel');assert.equal((await store.list()).length,0);
    reopen(file);win=await wait(installer,'warm installer');await wait(()=>run(win,`document.getElementById('badge').textContent==='Новое расширение'`),'warm details');
    const originalVersion=pkg.manifest.version;pkg.manifest.version='9.0.0';pkg.manifest.revision++;
    await fs.writeFile(file,p.canonical(pkg));
    await run(win,`document.getElementById('consent').checked=true;document.getElementById('consent').dispatchEvent(new Event('change'));document.getElementById('install').click()`);
    await wait(()=>win.isDestroyed(),'install confirm');assert.equal((await store.list())[0].version,originalVersion,'confirm installs previewed immutable snapshot');
    app.emit('open-file',{preventDefault(){}},file);win=await wait(installer,'open-file update');
    await wait(()=>run(win,`document.getElementById('badge').textContent==='Обновление'`),'update details');await fs.writeFile(path.join(output,'update.png'),(await win.webContents.capturePage()).toPNG());
    await run(win,`document.getElementById('cancel').click()`);await wait(()=>win.isDestroyed(),'update cancel');assert.equal((await store.list())[0].version,originalVersion);
    reopen(bad);await wait(()=>errors===1,'corrupt package error');reopen(file);win=await wait(installer,'error recovery');await run(win,`document.getElementById('cancel').click()`);
    console.log('PASS: cold/warm addon files, duplicate focus, cancel, immutable confirmation, update preview, open-file event and corrupt package recovery.');app.exit(0);
})().catch(error=>{console.error(error);app.exit(1);});
setTimeout(()=>{console.error('Addon open probe timeout');app.exit(1);},45000);
