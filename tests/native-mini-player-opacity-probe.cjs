const {app,BrowserWindow,ipcMain,screen}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
if(process.platform!=='linux'){console.log('SKIP: rendered opacity fallback is Linux-specific.');app.exit(0);}
const root=path.resolve(__dirname,'..'),output=path.join(__dirname,'.artifacts/mini-player-opacity');fs.mkdirSync(output,{recursive:true});
app.setPath('userData',fs.mkdtempSync(path.join(output,'profile-')));
const archive=process.argv.find(arg=>arg.startsWith('--app-asar='))?.slice(11),source=archive?path.resolve(archive):root;
const {createMiniPlayer,DEFAULTS}=require(path.join(source,'src/main/mini-player'));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 let point={x:-1000,y:-1000},queries=0,saved={...DEFAULTS,opacity:65,x:120,y:180};
 const handlers=new Map(),ipc={handle:(key,callback)=>{handlers.set(key,callback);ipcMain.handle(key,callback);},on:(...args)=>ipcMain.on(...args)};
 const display={getPrimaryDisplay:()=>screen.getPrimaryDisplay(),getDisplayMatching:bounds=>screen.getDisplayMatching(bounds),getCursorScreenPoint:()=>{queries++;return point;},on:(...args)=>screen.on(...args),removeListener:(...args)=>screen.removeListener(...args)};
 const main=new BrowserWindow({show:false});
 const controller=createMiniPlayer({app,BrowserWindow,ipcMain:ipc,screen:display,getMainWindow:()=>main,getStore:async()=>({get:()=>saved,set:(_key,value)=>{saved=structuredClone(value);}})});
 try{
  await controller.ready;controller.open(false);const mini=controller.getWindow();mini.setIgnoreMouseEvents(true);
  await new Promise(resolve=>mini.webContents.once('did-finish-load',resolve));
  const run=code=>mini.webContents.executeJavaScript(code);
  async function sample(expected,label){
   for(let i=0;i<60&&Math.abs(Number(await run(`getComputedStyle(document.getElementById('floating-player')).opacity`))-expected)>.001;i++)await delay(50);
   await delay(80);const image=await mini.webContents.capturePage(),bitmap=image.toBitmap();let max=0;
   for(let i=3;i<bitmap.length;i+=4)max=Math.max(max,bitmap[i]);
   assert(Math.abs(max-Math.round(expected*255))<=2,label+': real rendered alpha '+max+' vs '+Math.round(expected*255));
   fs.writeFileSync(path.join(output,label+'.png'),image.toPNG());console.log(label+': alpha '+max);
  }
  const set=value=>handlers.get('mini-player:set-settings')({sender:main.webContents,senderFrame:main.webContents.mainFrame},value);
  await sample(.65,'initial-65');assert.equal(mini.getOpacity(),1,'native Linux opacity is unsupported');
  await set({locked:true});
  // Native renderer events, with the global point deliberately frozen inside.
  const nativeBounds=mini.getBounds();point={x:nativeBounds.x+nativeBounds.width-15,y:nativeBounds.y+12};
  mini.webContents.sendInputEvent({type:'mouseMove',x:nativeBounds.width-15,y:12});await sample(1,'native-enter');
  mini.webContents.sendInputEvent({type:'mouseLeave',x:-1,y:-1});await sample(.65,'native-leave-stale-global');
  await set({opacity:40});await sample(.4,'live-40');
  const bounds=mini.getBounds();point={x:bounds.x+10,y:bounds.y+10};mini.webContents.sendInputEvent({type:'mouseMove',x:bounds.width-15,y:12});await sample(1,'hover-100');
  await set({opacity:55});await sample(1,'hover-setting-55');assert.equal(saved.opacity,55);
  mini.webContents.sendInputEvent({type:'mouseLeave',x:-1,y:-1});await sample(.55,'leave-55');
  mini.hide();controller.open(false);await sample(.55,'reopen-55');assert.equal(saved.opacity,55);
  await new Promise(resolve=>{mini.webContents.once('did-finish-load',resolve);mini.webContents.reload();});await sample(.55,'reload-55');
  assert.equal(queries,0,'Linux opacity never polls global cursor coordinates');
  console.log('PASS: actual Linux rendered alpha at startup, live changes, native enter/leave with stale global coordinates, live settings, reopen and reload; no global cursor polling.');
  controller.destroy();main.destroy();app.exit(0);
 }catch(error){console.error(error);controller.destroy();app.exit(1);}
}).catch(error=>{console.error(error);app.exit(1);});
setTimeout(()=>{console.error('Mini opacity probe timeout');app.exit(1);},20000);
