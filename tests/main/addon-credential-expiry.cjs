const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createCredentialDialog}=require('../../src/main/addons/credentials-dialog');
const handlers=new Map(),windows=[];
class Window extends EventEmitter {
    constructor(){super();this.webContents=new EventEmitter();this.webContents.mainFrame={};this.webContents.setWindowOpenHandler=()=>{};windows.push(this);}
    setMenu(){}show(){}focus(){}loadFile(){return Promise.resolve();}destroy(){this.emit('closed');}close(){this.destroy();}
}
const dialogs=createCredentialDialog({BrowserWindow:Window,ipcMain:{handle:(name,fn)=>handlers.set(name,fn),on:(name,fn)=>handlers.set(name,fn)}});
let now=1700000000000;const realNow=Date.now;Date.now=()=>now;
function open(save){const done=dialogs.open('expiry-test',{},save),window=windows.at(-1);return {done,event:{sender:window.webContents,senderFrame:window.webContents.mainFrame}};}
const preview=(item,value)=>handlers.get('addon-credential:expiry')(item.event,value);
const save=(item,value)=>handlers.get('addon-credential:save')(item.event,{value:'fixture-token',expiresIn:value});
(async()=>{
    let stored, item=open(value=>{stored=value;});
    for(const value of ['0','86400','-5','86400.9','1e8','NaN','Infinity','9999999999999',86401,{},[]])assert.equal(preview(item,value).ok,false,String(value));
    assert.throws(()=>handlers.get('addon-credential:expiry')({...item.event,senderFrame:{}},'28840403'));
    const expected=now+(28840403-86400)*1000;
    assert.equal(preview(item,'28840403').expiresAt,expected);
    now+=3600000;
    assert.equal(preview(item,'28840403').expiresAt,expected,'previews must not restart the lifetime');
    assert.equal((await save(item,'28840403')).ok,true);await item.done;
    assert.equal(stored.expiresAt,expected,'main process subtracts exactly one day');
    item=open(value=>{stored=value;});await save(item,null);await item.done;assert.equal(stored.expiresAt,null);
    item=open(value=>{stored=value;});const tiny=preview(item,'86401').expiresAt;assert.equal(tiny,now+1000);
    now+=1001;assert.equal((await save(item,'86401')).ok,false,'expired preview cannot be refreshed by saving');dialogs.cancel('expiry-test');await item.done;
    let attempts=0;item=open(value=>{if(++attempts===1)throw Error('Fixture storage failure');stored=value;});
    const deadline=preview(item,'200000').expiresAt;
    assert.equal((await save(item,'200000')).ok,false);now+=5000;
    assert.equal((await save(item,'200000')).ok,true);await item.done;assert.equal(stored.expiresAt,deadline,'save retry must not extend the deadline');
    item=open(()=>{});assert.equal((await handlers.get('addon-credential:save')(item.event,{value:'fixture',expiresAt:now+999999})).ok,false,'renderer cannot bypass the buffer using an absolute date');dialogs.cancel('expiry-test');await item.done;
    console.log('PASS: expires_in validation, one-day buffer, stable preview/retry deadlines, elapsed lifetime, optional expiry and IPC isolation.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{Date.now=realNow;});
