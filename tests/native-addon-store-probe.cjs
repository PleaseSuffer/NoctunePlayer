// Real main/preload/renderer, with an ephemeral catalog key and no network requests.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname,'..');
const archive = process.argv.find(value=>value.startsWith('--app-asar='))?.slice('--app-asar='.length);
const source = archive ? path.resolve(root,archive) : root;
const p = require(path.join(source,'src/main/addons/package'));
const catalogModule = require(path.join(source,'src/main/addons/catalog'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(),'noctune-store-native-'));
const screenshots = path.join(__dirname,'.artifacts/addon-store');
fs.mkdirSync(screenshots,{recursive:true});
app.setPath('userData',profile);
const showWindow=BrowserWindow.prototype.show;
BrowserWindow.prototype.show=function(){};
BrowserWindow.prototype.showInactive=function(){};
const windows=[];
app.on('browser-window-created',(_event,window)=>windows.push(window));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(callback) {
    const deadline=Date.now()+15000;
    while(Date.now()<deadline){try{const result=await callback();if(result)return result;}catch(_){}await delay(50);}
    throw new Error('Timed out waiting for store state');
}
const run=(window,code)=>window.webContents.executeJavaScript(code);
let networkCalls=0, offline=false;
(async()=>{
    const key=crypto.generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'});
    const addonDirectory=path.join(root,'addons/official/noctune-chroma');
    const files={};
    for(const name of fs.readdirSync(addonDirectory,{recursive:true})){
        const filename=path.join(addonDirectory,name);
        if(!fs.statSync(filename).isFile()||name==='manifest.json')continue;
        files[name.split(path.sep).join('/')]=/\.(js|json|md|txt)$/.test(name)?fs.readFileSync(filename,'utf8'):{encoding:'base64',data:fs.readFileSync(filename).toString('base64')};
    }
    const pkg=p.sign(p.validatePackage({format:'noctune-addon',formatVersion:1,manifest:JSON.parse(fs.readFileSync(path.join(addonDirectory,'manifest.json'),'utf8')),files}),key);
    const bytes=p.canonical(pkg),identity=p.signingIdentity(pkg,true);
    const seed=JSON.parse(fs.readFileSync(path.join(source,'addons/catalog/official.json'),'utf8'));
    const entry={...seed.entries[0],publisher:identity,published:true,packageUrl:'https://github.com/PleaseSuffer/NoctunePlayer/releases/download/test/chroma.noctaddon',sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
    const fixture=p.sign({...seed,entries:[entry]},key);
    const original=catalogModule.createAddonCatalog;
    catalogModule.createAddonCatalog=options=>original({...options,builtin:fixture,trustedPublisher:value=>value===identity?'Noctune':null,fetch:async url=>{
        networkCalls++;if(offline)throw new Error('Offline');return url===catalogModule.CATALOG_URL?p.canonical(fixture):bytes;
    }});
    if(archive){
        app.setAppPath(source);
        Object.defineProperty(app,'isPackaged',{value:true});
        require(path.join(source,'node_modules/electron-updater')).autoUpdater.checkForUpdates=async()=>null;
    }
    require(path.join(source,'src/main/index.js'));
    const main=await waitFor(()=>windows.find(window=>!window.isDestroyed()&&window.webContents.getURL().endsWith('/renderer/index.html')&&!window.webContents.isLoading()));
    main.webContents.setBackgroundThrottling(false);
    await run(main,`document.getElementById('settings-fab').click();document.querySelector('.settings-nav-item[data-panel="panel-addons"]').click()`);
    await waitFor(()=>run(main,`document.getElementById('panel-addons').classList.contains('active')`));
    for(const id of ['addons-store','addons-import','addons-check-all','addons-link-toggle'])assert.equal(await run(main,`!!document.querySelector('#${id} svg')`),true,'settings action has an icon: '+id);
    assert.equal(await run(main,`!!document.getElementById('addons-check-all').closest('.addons-installed-heading')`),true);
    assert.equal(await run(main,`document.getElementById('addons-url-form').hidden`),true);
    await run(main,`document.getElementById('addons-link-toggle').click()`);
    assert.equal(await run(main,`document.getElementById('addons-url-form').hidden`),false);
    assert.equal(await run(main,`document.activeElement.id`),'addons-url');
    await run(main,`document.getElementById('addons-url').value='https://example.com/addon.noctaddon';document.getElementById('addons-link-toggle').click();document.getElementById('addons-link-toggle').click()`);
    assert.equal(await run(main,`document.getElementById('addons-url').value`),'https://example.com/addon.noctaddon');
    await run(main,`document.getElementById('addons-link-toggle').click()`);
    showWindow.call(main);
    for(const theme of ['dark','light'])for(const width of [1280,900]){
        main.setSize(width,850);
        await run(main,`document.getElementById('setting-dark-theme').checked=${theme==='dark'};document.getElementById('setting-dark-theme').dispatchEvent(new Event('change'))`);
        await delay(400);
        assert.equal(await run(main,`(()=>{const panel=document.getElementById('panel-addons').getBoundingClientRect();return ['addons-store','addons-import','addons-check-all','addons-link-toggle'].every(id=>{const r=document.getElementById(id).getBoundingClientRect();return r.width>0&&r.left>=panel.left&&r.right<=panel.right+1;});})()`),true,'settings actions fit the panel');
        await main.webContents.capturePage();
        fs.writeFileSync(path.join(screenshots,`settings-${theme}-${width}.png`),(await main.webContents.capturePage()).toPNG());
    }
    await run(main,`document.getElementById('addons-store').click()`);
    const shop=await waitFor(()=>windows.find(window=>!window.isDestroyed()&&window.webContents.getURL().includes('/addon-store/index.html')&&!window.webContents.isLoading()));
    shop.webContents.setBackgroundThrottling(false);
    showWindow.call(shop);
    await waitFor(()=>run(shop,`document.querySelector('.store-card .primary')?.textContent==='Установить'`));
    assert.equal(shop.webContents.getLastWebPreferences().sandbox,true);
    assert.equal(await run(shop,`typeof require`),'undefined');
    assert.equal(await run(shop,`typeof window.noctune`),'undefined');
    assert.equal(await run(shop,`!!document.querySelector('#repository svg')`),true,'repository button has a rendered icon');
    assert.equal(await run(shop,`document.querySelector('.card-title').textContent`),'Noctune Chroma');
    assert.equal(await run(shop,`document.getElementById('community').hidden`),true);
    for(const theme of ['dark','light']){
        await run(shop,`document.documentElement.dataset.theme='${theme}'`);
        assert.equal(await run(shop,`getComputedStyle(document.documentElement).backgroundColor`),theme==='dark'?'rgb(21, 21, 27)':'rgb(244, 247, 246)');
        for(const size of [[1040,800],[640,650]]){
            shop.setSize(...size);
            for(const tab of ['official','community']){
                await run(shop,`document.getElementById('tab-${tab}').click()`);await delay(350);
                assert.equal(await run(shop,`document.documentElement.scrollWidth>innerWidth`),false);
                await shop.webContents.capturePage();
                fs.writeFileSync(path.join(screenshots,`${theme}-${tab}-${size[0]}.png`),(await shop.webContents.capturePage()).toPNG());
            }
        }
    }
    await run(shop,`document.getElementById('tab-community').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}))`);
    assert.equal(await run(shop,`document.getElementById('tab-official').getAttribute('aria-selected')`),'true');
    await run(shop,`document.getElementById('search').value='missing';document.getElementById('search').dispatchEvent(new Event('input'))`);
    assert.equal(await run(shop,`document.getElementById('empty').hidden`),false);
    await run(shop,`document.getElementById('search').value='';document.getElementById('search').dispatchEvent(new Event('input'));document.querySelector('.store-card .primary').click()`);
    let installer=await waitFor(()=>windows.find(window=>!window.isDestroyed()&&window.webContents.getURL().includes('/addon-install/index.html')&&!window.webContents.isLoading()));
    await waitFor(()=>run(installer,`!document.getElementById('consent').disabled`));
    assert.equal(await run(installer,`document.getElementById('install').disabled`),true);
    await run(installer,`document.getElementById('cancel').click()`);
    await waitFor(()=>run(shop,`document.getElementById('status').textContent==='Установка отменена'`));
    assert.equal((await run(main,`window.noctune.addons.list()`)).length,0);
    await run(shop,`document.querySelector('.store-card .primary').click()`);
    installer=await waitFor(()=>windows.find(window=>!window.isDestroyed()&&window.webContents.getURL().includes('/addon-install/index.html')&&!window.webContents.isLoading()));
    await waitFor(()=>run(installer,`!document.getElementById('consent').disabled`));
    await run(installer,`document.getElementById('consent').click();document.getElementById('install').click()`);
    await waitFor(()=>run(shop,`document.querySelector('.store-card .primary')?.textContent==='Установлено'`));
    const installed=await run(main,`window.noctune.addons.list()`);assert.equal(installed.length,1);assert.equal(installed[0].enabled,false);
    await waitFor(()=>run(main,`!!document.querySelector('#addons-list [data-addon-id="noctune-chroma"]')`));
    assert.equal(await run(shop,`document.querySelector('.store-card .primary').disabled`),true);
    offline=true;await delay(5100);
    await run(shop,`document.getElementById('refresh').click()`);
    await waitFor(()=>run(shop,`document.getElementById('catalog-message').textContent.includes('сохранённая')`));
    assert.equal(await run(shop,`document.querySelectorAll('.store-card').length`),1);
    assert(networkCalls>=4);
    console.log('PASS: isolated store, real catalog/artwork and search, keyboard tabs, both themes and sizes, consent/cancel/install, disabled-by-default, main-window refresh and offline fallback.');
    for(const window of windows)if(!window.isDestroyed())window.destroy();
    fs.rmSync(profile,{recursive:true,force:true});app.exit(0);
})().catch(error=>{console.error(error);app.exit(1);});
setTimeout(()=>{console.error('Native store probe timed out');app.exit(1);},60000);
