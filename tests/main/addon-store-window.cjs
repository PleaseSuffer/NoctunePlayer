const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createAddonStoreWindow } = require('../../src/main/addons/store-window');
(async () => {
    const windows = [], handlers = new Map(), links = [], discarded = [], notifications = [];
    class Window extends EventEmitter {
        constructor(options) { super();this.options=options;this.webContents=new EventEmitter();this.webContents.mainFrame={};this.webContents.setWindowOpenHandler=callback=>{this.openHandler=callback;};windows.push(this); }
        isDestroyed(){return !!this.destroyed;} setMenu(){} show(){} focus(){this.focused=true;}
        async loadFile(file,options){this.file=file;this.query=options.query;}
        destroy(){this.destroyed=true;this.emit('closed');}
    }
    let complete, prepare = async id => {assert.equal(id,'test-addon');return {ticket:'ticket'};};
    const shop = createAddonStoreWindow({BrowserWindow:Window,ipcMain:{handle:(id,callback)=>handlers.set(id,callback)},store:{discard:ticket=>discarded.push(ticket)},installer:{open:()=>new Promise(resolve=>{complete=resolve;})},catalog:{list:async refresh=>({refresh}),prepare:id=>prepare(id)},shell:{openExternal:url=>links.push(url)},onInstalled:result=>notifications.push(result)});
    await shop.open({theme:'light',accent:'invalid'});
    let window=windows[0]; const event=()=>({sender:window.webContents,senderFrame:window.webContents.mainFrame});
    assert.equal(window.options.webPreferences.sandbox,true);assert.equal(window.options.webPreferences.nodeIntegration,false);assert.equal(window.options.webPreferences.contextIsolation,true);
    assert.deepEqual(window.query,{theme:'light',accent:'#ac91ee'});
    shop.open();assert.equal(windows.length,1);assert(window.focused);
    for(const handler of handlers.values()) {
        await assert.rejects(async()=>handler({sender:{},senderFrame:window.webContents.mainFrame}),/Недоступно/);
        await assert.rejects(async()=>handler({...event(),senderFrame:{}}),/Недоступно/);
    }
    assert.deepEqual(window.openHandler(),{action:'deny'});
    let prevented=false;window.webContents.emit('will-navigate',{preventDefault:()=>{prevented=true;}});assert(prevented);
    assert.deepEqual(await handlers.get('addon-store:list')(event(),true),{refresh:true});
    assert.throws(()=>handlers.get('addon-store:open-link')(event(),'https://evil.example'),/Неизвестная/);
    assert.throws(()=>handlers.get('addon-store:open-link')(event(),'constructor'),/Неизвестная/);
    handlers.get('addon-store:open-link')(event(),'documentation');assert(links[0].endsWith('/docs/extensions-publishing.md'));
    let task=handlers.get('addon-store:install')(event(),'test-addon');await new Promise(resolve=>setImmediate(resolve));
    await assert.rejects(handlers.get('addon-store:install')(event(),'test-addon'),/уже выполняется/);
    complete(null);assert.deepEqual(await task,{installed:false});assert.deepEqual(discarded,['ticket']);assert.equal(notifications.length,0);
    task=handlers.get('addon-store:install')(event(),'test-addon');await new Promise(resolve=>setImmediate(resolve));complete({id:'test-addon'});assert.deepEqual(await task,{installed:true});assert.equal(notifications.length,1);
    let prepared;
    prepare=()=>new Promise(resolve=>{prepared=resolve;});
    const oldEvent=event();task=handlers.get('addon-store:install')(oldEvent,'test-addon');window.destroy();await shop.open();window=windows[1];prepared({ticket:'closed-ticket'});
    await assert.rejects(task,/Недоступно/);assert(discarded.includes('closed-ticket'));
    assert.throws(()=>handlers.get('addon-store:list')(oldEvent),/Недоступно/);
    window.destroy();assert.throws(()=>handlers.get('addon-store:list')(event()),/Недоступно/);
    console.log('PASS: single sandboxed store window, sender/frame isolation, fixed external links, consent/cancel notification, concurrent install guard and closed-window ticket cleanup.');
})().catch(error=>{console.error(error);process.exitCode=1;});
