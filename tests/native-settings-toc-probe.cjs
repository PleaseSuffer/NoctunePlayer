const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const output=path.resolve('tests/.artifacts/settings-toc');fs.mkdirSync(output,{recursive:true});app.setPath('userData',fs.mkdtempSync(path.join(output,'profile-')));
const show=BrowserWindow.prototype.showInactive;BrowserWindow.prototype.show=function(){};BrowserWindow.prototype.showInactive=function(){};
const delay=ms=>new Promise(r=>setTimeout(r,ms));setTimeout(()=>{console.error('TIMEOUT');app.exit(1)},60000);
app.on('browser-window-created',(_,win)=>win.webContents.on('did-finish-load',async()=>{
 if(!win.webContents.getURL().endsWith('/renderer/index.html'))return;
 try{
  win.setSize(1400,900);show.call(win);win.webContents.setBackgroundThrottling(false);await delay(700);
  const run=code=>win.webContents.executeJavaScript(code);
  const pkg={apiVersion:2,manifest:{id:'toc-test',name:'TOC test',width:640,height:360,palette:{background:'#101820',accent:'#46c8ed',gradient:['#46c8ed','#81a9c4','#e4aa64']},capabilities:{motion:true,visualizer:'bars'},parameterSchema:{response:{type:'slider',label:'Test response',min:0,max:2,step:.1,default:1}}},sdk:fs.readFileSync('src/renderer/effects/scene-sdk.js','utf8'),assets:{},script:"NoctuneScene.define({render(api){api.ctx.fillStyle='#101820';api.ctx.fillRect(0,0,api.width,api.height)}});"};
  ipcMain.removeHandler('scene-themes:read');ipcMain.handle('scene-themes:read',()=>pkg);
  await win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  const result=await run(`(async()=>{
   const wait=ms=>new Promise(r=>setTimeout(r,ms)),toc=document.getElementById('settings-toc'),content=document.querySelector('.settings-content');
   document.getElementById('settings-fab').click();await sceneThemes.activate({id:'toc-test',name:'TOC test'});document.querySelector('[data-panel="panel-appearance"]').click();
   const themeTitle=document.querySelector('#appearance-themes-section .settings-section-title');const themeItem=[...toc.children].find(n=>n.textContent===themeTitle.textContent);themeItem.click();await wait(80);
   document.getElementById('scene-frequencyMix').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
   const nodes=[...toc.children],active=()=>toc.querySelector('.active')?.textContent,expected=active(),top=content.scrollTop;
   for(const id of ['scene-intensity','scene-frequencyMix','scene-glowIntensity','scene-custom-response']){const slider=document.getElementById(id);for(let i=0;i<6;i++){slider.value=String(Number(slider.min)+(Number(slider.max)-Number(slider.min))*(i+1)/7);slider.dispatchEvent(new Event('input',{bubbles:true}));await wait(10)}}
   return {same:nodes.every((n,i)=>n===toc.children[i]),expected,active:active(),top,after:content.scrollTop};
  })()`);
  assert(result.same,'slider input must preserve TOC nodes');assert.equal(result.active,result.expected);assert.equal(result.after,result.top);
  const panels=await run(`(async()=>{
   const toc=document.getElementById('settings-toc'),results=[],wait=ms=>new Promise(r=>setTimeout(r,ms));
   for(const nav of document.querySelectorAll('.settings-nav-item')){
    nav.click();await wait(30);if(toc.children.length<2)continue;
    const chosen=toc.children[1];chosen.click();await wait(50);const before=[...toc.children],top=document.querySelector('.settings-content').scrollTop;
    for(let i=0;i<8;i++)document.dispatchEvent(new Event('settings-sections-changed'));
    results.push({panel:nav.dataset.panel,same:before.every((n,i)=>n===toc.children[i]),active:toc.querySelector('.active')===chosen,scroll:document.querySelector('.settings-content').scrollTop===top});
   }return results;
  })()`);
  assert(panels.length>=3,'exercise multiple settings panels');
  for(const result of panels){assert(result.same,JSON.stringify(result));assert(result.active,JSON.stringify(result));assert(result.scroll,JSON.stringify(result));}
  const dynamic=await run(`(async()=>{
   const toc=document.getElementById('settings-toc');document.querySelector('[data-panel="panel-appearance"]').click();
   const panel=document.getElementById('panel-appearance'),titles=[...panel.querySelectorAll('.settings-section-title')].filter(t=>t.getClientRects().length),title=titles[2],item=[...toc.children].find(n=>n.textContent===title.textContent);
   const added=document.createElement('div');added.className='settings-section-title';added.textContent='Inserted test section';panel.prepend(added);document.dispatchEvent(new Event('settings-sections-changed'));
   const reused=[...toc.children].includes(item);item.click();const rightTarget=toc.querySelector('.active')===item;
   const label=title.textContent;title.textContent='Updated test section';document.dispatchEvent(new Event('settings-sections-changed'));const renamed=toc.querySelector('.active')===item&&item.textContent===title.textContent;
   title.textContent=label;added.remove();document.dispatchEvent(new Event('settings-sections-changed'));
   sceneThemes.deactivate();document.dispatchEvent(new Event('settings-sections-changed'));
   return {reused,rightTarget,renamed,reappeared:toc.children.length>titles.length};
  })()`);
  for(const [key,value]of Object.entries(dynamic))assert(value,key);
  const mini=await run(`(async()=>{
   const toc=document.getElementById('settings-toc'),section=document.getElementById('mini-player-appearance-section'),title=section.querySelector('.settings-section-title'),settings=await noctune.miniPlayer.getSettings();
   const themes=document.querySelector('#appearance-themes-section .settings-section-title'),item=[...toc.children].find(n=>n.textContent===themes.textContent);let correct=true;
   for(const enabled of [true,false]){window.dispatchEvent(new CustomEvent('mini-player-settings',{detail:{...settings,enabled}}));correct&&=[...toc.children].some(n=>n.textContent===title.textContent)===enabled;item.click();correct&&=toc.querySelector('.active')===item;}
   window.dispatchEvent(new CustomEvent('mini-player-settings',{detail:settings}));return correct;
  })()`);assert(mini,'mini-player visibility updates preserve theme navigation');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  const smooth=await run(`(async()=>{
   const wait=ms=>new Promise(r=>setTimeout(r,ms)),toc=document.getElementById('settings-toc'),content=document.querySelector('.settings-content');content.scrollTo({top:0,behavior:'instant'});await wait(200);
   const target=toc.lastElementChild;target.click();const expected=target.textContent;let retained=true;
   for(let i=0;i<8;i++){document.dispatchEvent(new Event('settings-sections-changed'));retained&&=toc.querySelector('.active')===target;await wait(20)}
   const title=[...document.querySelectorAll('.settings-panel.active .settings-section-title')].find(n=>n.textContent===expected),top=Math.min(content.scrollHeight-content.clientHeight,Math.max(0,title.getBoundingClientRect().top-content.getBoundingClientRect().top+content.scrollTop-12));
   for(let i=0;i<80&&Math.abs(content.scrollTop-top)>2;i++)await wait(50);
   return {retained,completed:Math.abs(content.scrollTop-top)<=2,active:toc.querySelector('.active')===target,expected,top,actual:content.scrollTop};
  })()`);
  for(const key of ['retained','completed','active'])assert(smooth[key],key);
  console.log('PASS settings TOC: theme sliders, all multi-section panels, live heading insertion/rename/visibility and uninterrupted smooth navigation.');app.exit(0);
 }catch(error){console.error(error);app.exit(1)}
}));
const archive=process.argv.find(arg=>arg.startsWith('--app-asar='))?.slice('--app-asar='.length);
if(archive){app.setAppPath(path.resolve(archive));Object.defineProperty(app,'isPackaged',{value:true});require('electron-updater').autoUpdater.checkForUpdates=async()=>null;}
require(archive?path.join(path.resolve(archive),'src/main/index.js'):'../src/main/index');
