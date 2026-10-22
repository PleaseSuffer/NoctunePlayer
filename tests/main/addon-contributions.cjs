const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {EventEmitter}=require('node:events');
const schema=require('../../src/shared/addon-contributions'),settings=require('../../src/shared/addon-settings');
const {packDirectory,validatePackage}=require('../../src/main/addons/package');
const {createCredentialDialog}=require('../../src/main/addons/credentials-dialog');
const {createAddonServices}=require('../../src/main/addons/services');
(async()=>{
    const pkg=await packDirectory('addons/examples/service-workbench');
    validatePackage(pkg);const clone=()=>JSON.parse(JSON.stringify(pkg));
    let bad=clone();bad.manifest.ui.integrations.html='<script>';assert.throws(()=>validatePackage(bad));
    bad=clone();bad.manifest.permissions=bad.manifest.permissions.filter(key=>key!=='ui.integrations');assert.throws(()=>validatePackage(bad));
    bad=clone();delete bad.manifest.network.routes;assert.throws(()=>validatePackage(bad),/маршруты/);
    bad=clone();bad.manifest.credentials['demo-key'].header='Cookie';assert.throws(()=>validatePackage(bad));
    bad=clone();bad.manifest.credentials['demo-key'].origins=['https://other.example'];assert.throws(()=>validatePackage(bad));
    bad=clone();bad.manifest.ui.integrations.sections[0].fields.push('unknown');assert.throws(()=>validatePackage(bad));
    assert.throws(()=>settings.validate({field:{type:'text',label:'Field',default:'',visibleWhen:{field:'missing',equals:true}}}));
    const dynamic={theme:{type:'select',label:'Theme',default:'light',options:[{value:'light',label:'Light'}],source:'appearance.schemes'}};
    settings.validate(dynamic);assert.equal(settings.normalize(dynamic,{theme:'scheme:other-addon:graphite'}).theme,'scheme:other-addon:graphite');
    assert.throws(()=>settings.normalize(dynamic,{theme:'scheme:../escape:x'}));
    assert.throws(()=>schema.validate({settings:dynamic},[]),/appearance.list/);
    schema.validate({settings:dynamic},['appearance.list']);
    assert.throws(()=>settings.validate({theme:{...dynamic.theme,source:'files'}}));
    const manifest={network:{routes:[{origin:'https://api.example.com',path:'/read',methods:['POST'],permission:'servicePlaylists.read'},{origin:'https://api.example.com',path:'/delete',methods:['DELETE'],permission:'servicePlaylists.delete'}]}};
    schema.route(manifest,['servicePlaylists.read'],'https://api.example.com/read','POST');
    assert.throws(()=>schema.route(manifest,['servicePlaylists.read'],'https://api.example.com/delete','DELETE'));
    assert.throws(()=>schema.route(manifest,['servicePlaylists.read'],'https://api.example.com/read','GET'));
    assert.throws(()=>schema.route(manifest,['servicePlaylists.read'],'https://api.example.com/read/../delete','DELETE'));
    const handlers=new Map(),windows=[];
    class Window extends EventEmitter {
        constructor(options){super();this.options=options;this.webContents=new EventEmitter();this.webContents.mainFrame={};this.webContents.setWindowOpenHandler=fn=>{this.navigation=fn;};windows.push(this);}
        setMenu(){}show(){}focus(){}loadFile(){return Promise.resolve();}destroy(){this.emit('closed');}close(){this.destroy();}
    }
    const dialogs=createCredentialDialog({BrowserWindow:Window,ipcMain:{handle:(name,fn)=>handlers.set(name,fn),on:(name,fn)=>handlers.set(name,fn)}});
    let saved;
    let task=dialogs.open('demo',{name:'Profile',profile:'demo-key',origins:['https://api.example.com']},async value=>{saved=value;});
    let win=windows.at(-1),event={sender:win.webContents,senderFrame:win.webContents.mainFrame};
    assert.equal(win.options.webPreferences.sandbox,true);assert.equal(win.options.webPreferences.contextIsolation,true);
    assert.throws(()=>handlers.get('addon-credential:details')({...event,senderFrame:{}}));
    await assert.rejects(handlers.get('addon-credential:save')({sender:{},senderFrame:{}},{value:'secret'}));
    assert.equal((await handlers.get('addon-credential:save')(event,{value:'key\r\nInjected: true'})).ok,false);
    assert.equal((await handlers.get('addon-credential:save')(event,{value:'secret',expiresAt:Date.now()-1000})).ok,false);
    assert.equal((await handlers.get('addon-credential:save')(event,{value:'secret'})).ok,true);assert.equal(saved.value,'secret');assert.equal((await task).configured,true);
    assert.throws(()=>handlers.get('addon-credential:details')(event),'closed dialog cannot access IPC');
    task=dialogs.open('demo',{name:'Another'},async()=>{throw new Error('Must not save');});dialogs.cancel('demo');assert.equal((await task).configured,false);
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'noctune-credentials-'));
    try{
        const aes=crypto.randomBytes(32),safeStorage={isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=> 'test',encryptString(value){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',aes,iv);return Buffer.concat([iv,cipher.update(value),cipher.final(),cipher.getAuthTag()]);},decryptString(value){const cipher=crypto.createDecipheriv('aes-256-gcm',aes,value.subarray(0,12));cipher.setAuthTag(value.subarray(value.length-16));return Buffer.concat([cipher.update(value.subarray(12,value.length-16)),cipher.final()]).toString();}};
        const grants=['credentials.configure','credentials.status','credentials.disconnect','credentials.use','network.request'];
        const credential={'demo-key':{name:'Key',origins:['https://api.example.com'],header:'Authorization',scheme:'Bearer'}};
        const store={async context(id,hash,permission){if(permission&&!grants.includes(permission))throw new Error('Denied');return {manifest:{name:'Demo',network:{origins:['https://api.example.com']},credentials:credential},grants};}};
        const service=createAddonServices({store,directory,safeStorage,dialog:{},shell:{},getWindow:()=>null,credentialDialog:{cancel(){},async open(id,details,save){await save({value:'private-api-token',expiresAt:null});return {configured:true};}}});
        const invoke=(method,args={profile:'demo-key'})=>service.invoke('demo-addon','hash',method,args);
        assert.equal((await invoke('credentials.status')).configured,false);await invoke('credentials.configure');assert.equal((await invoke('credentials.status')).configured,true);
        assert.equal(JSON.stringify(await invoke('credentials.status')).includes('private-api-token'),false);
        const credentialValue=await service.vault.get('demo-addon','credential:demo-key');
        await service.vault.set('demo-addon','credential:demo-key',{...credentialValue,expiresAt:Date.now()-1000});
        assert.equal((await invoke('credentials.status')).configured,false);
        await assert.rejects(invoke('network.request',{url:'https://api.example.com/profile',credential:'demo-key'}),/Настройте/,'expired keys are rejected before opening a connection');
        await service.vault.set('demo-addon','credential:demo-key',credentialValue);
        const encrypted=await fs.readFile(path.join(directory,'secrets/demo-addon.enc'));assert.equal(encrypted.includes('private-api-token'),false);
        await assert.rejects(invoke('secrets.get',{key:'credential:demo-key'}));
        await assert.rejects(invoke('credentials.configure',{profile:'constructor'}));
        await assert.rejects(invoke('network.request',{url:'https://other.example/read',credential:'demo-key'}));
        credential['demo-key'].scheme='OAuth';assert.equal((await invoke('credentials.status')).configured,false,'changed auth profiles invalidate saved keys');
        await invoke('credentials.disconnect');assert.equal((await invoke('credentials.status')).configured,false);
    }finally{await fs.rm(directory,{recursive:true,force:true});}
    console.log('PASS: typed integration/credential schemas, conditional fields, operation routes, isolated secret dialog, validation, cancel/close, encrypted manual keys, profile invalidation and token-free status.');
})().catch(error=>{console.error(error);process.exitCode=1;});
