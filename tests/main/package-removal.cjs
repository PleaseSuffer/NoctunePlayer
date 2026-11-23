const assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createPackageRemoval}=require('../../src/main/package-removal');
(async()=>{
 const handlers=new Map(),windows=[];
 class Window extends EventEmitter {
  constructor(options){super();this.options=options;this.webContents=new EventEmitter();this.webContents.mainFrame={};this.webContents.setWindowOpenHandler=()=>{};windows.push(this);}
  setMenu(){}show(){}focus(){}isDestroyed(){return !!this.destroyed}async loadFile(file,options){this.query=options.query;}
  destroy(){this.destroyed=true;this.emit('closed')}close(){const e={preventDefault(){this.prevented=true}};this.emit('close',e);if(!e.prevented)this.destroy()}
 }
 const api=createPackageRemoval({BrowserWindow:Window,ipcMain:{handle:(key,fn)=>handlers.set(key,fn),on:(key,fn)=>handlers.set(key,fn)}});
 let calls=0,fail=true;
 const details={kind:'theme',name:'Example',version:'1.0.0'};
 let task=api.open(details,{theme:'light',accent:'#409f82'},async()=>{calls++;if(fail)throw Error('Cannot delete');return {removed:true}}),win=windows.at(-1);
 const event=()=>({sender:win.webContents,senderFrame:win.webContents.mainFrame});
 details.name='Changed';assert.equal(handlers.get('package-removal:details')(event()).name,'Example');assert.equal(calls,0);
 assert.equal(win.options.webPreferences.sandbox,true);assert.equal(win.options.webPreferences.contextIsolation,true);assert.equal(win.options.webPreferences.nodeIntegration,false);assert.deepEqual(win.query,{theme:'light',accent:'#409f82',action:'remove',kind:'theme'});
 assert.throws(()=>handlers.get('package-removal:details')({...event(),senderFrame:{}}),/Недоступно/);
 assert.equal((await handlers.get('package-removal:confirm')(event())).error,'Cannot delete');assert(!win.destroyed);fail=false;
 assert.equal((await handlers.get('package-removal:confirm')(event())).ok,true);assert.deepEqual(await task,{removed:true});assert.equal(calls,2);
 assert.throws(()=>handlers.get('package-removal:details')(event()),/Недоступно/);
 task=api.open({kind:'extension',name:'Sample'}, {},()=>{throw Error('must not run')});win=windows.at(-1);handlers.get('package-removal:cancel')(event());assert.deepEqual(await task,{removed:false});
 console.log('PASS: themed sandboxed removal, immutable details, main-frame isolation, no deletion before consent, cancellation, failure/retry and closed-session cleanup.');
})().catch(e=>{console.error(e);process.exitCode=1});
