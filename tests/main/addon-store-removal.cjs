const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createAddonStoreWindow}=require('../../src/main/addons/store-window');
(async()=>{
 const handlers=new Map(),removed=[],notified=[],windows=[];
 class Window extends EventEmitter{
  constructor(){super();windows.push(this);this.webContents=new EventEmitter();this.webContents.mainFrame={};this.webContents.setWindowOpenHandler=()=>{};this.webContents.send=()=>{};}
  isDestroyed(){return false;}setMenu(){}show(){}focus(){}async loadFile(){}
 }
 let entry={id:'sample',name:'Sample',state:'installed',removable:true},response=0,afterDialog=()=>{};
 const shop=createAddonStoreWindow({BrowserWindow:Window,ipcMain:{handle:(id,fn)=>handlers.set(id,fn)},catalog:{list:async()=>({entries:[entry]})},marketplace:{list:async()=>({entries:[{...entry,kind:'theme'}]})},store:{list:async()=>[{id:'sample',name:'Sample',version:'1.0.0'}]},installer:{},themeStore:{list:async()=>({themes:[{packageId:'sample',id:'import-123',removable:true}]}),remove:async id=>removed.push(id)},removeExtension:async id=>removed.push(id),onThemeRemoved:theme=>notified.push(theme),removalWindow:{open:async(details,colors,confirm)=>{afterDialog();return response===1?confirm():{removed:false}}}});
 await shop.open();const win=windows[0],event={sender:win.webContents,senderFrame:win.webContents.mainFrame},remove=handlers.get('addon-store:remove');
 await assert.rejects(remove({...event,senderFrame:{}},'sample'),/Недоступно/);
 await assert.rejects(remove(event,'other'),/нельзя удалить/);
 await assert.rejects(remove(event,'sample','bogus'),/Некорректный/);
 for(const state of ['install','conflict']){entry.state=state;await assert.rejects(remove(event,'sample'),/нельзя удалить/);}
 entry.state='installed';entry.removable=false;await assert.rejects(remove(event,'sample'),/нельзя удалить/);entry.removable=true;
 assert.deepEqual(await remove(event,'sample'),{removed:false});assert.equal(removed.length,0);
 response=1;afterDialog=()=>{entry.removable=false};await assert.rejects(remove(event,'sample'),/нельзя удалить/);assert.equal(removed.length,0);
 afterDialog=()=>{};entry.removable=true;assert.deepEqual(await remove(event,'sample'),{removed:true});assert.deepEqual(removed,['sample']);
 assert.deepEqual(await remove(event,'sample','theme'),{removed:true});assert.deepEqual(removed,['sample','import-123']);assert.equal(notified[0].packageId,'sample');
 console.log('PASS: removal sender/frame, catalog identity, installed state, removable flag, cancellation, revalidation, extension/theme routing and notification.');
})().catch(e=>{console.error(e);process.exitCode=1});
