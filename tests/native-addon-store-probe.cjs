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
let networkCalls=0, offline=false, marketplaceOffline=false;

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
    const metadata=Object.fromEntries(catalogModule.CATALOG_FIELDS.filter(field=>pkg.manifest[field]!==undefined).map(field=>[field,pkg.manifest[field]]));
    const entry={...seed.entries[0],...metadata,publisher:identity,published:true,packageUrl:'https://raw.githubusercontent.com/PleaseSuffer/NoctunePlayer/main/addons/distribution/'+pkg.manifest.id+'/'+pkg.manifest.version+'/'+pkg.manifest.id+'-'+pkg.manifest.version+'.noctaddon',sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
    const fixture=p.sign({...seed,entries:[entry]},key);
    const held = new Set(); let releaseDownload, packageFailure=false;
    async function transfer(text, options, category, known = true) {
        if(packageFailure)throw Error('Package download failed');
        const total = Buffer.byteLength(text); options.onProgress?.({received:0,total:known?total:null});
        await delay(150);
        options.onProgress?.({received:Math.ceil(total/2),total:known?total:null});
        if(!held.has(category)){held.add(category);await new Promise(resolve=>{releaseDownload=resolve;});}
        options.onProgress?.({received:total,total:known?total:null});return text;
    }
    const original=catalogModule.createAddonCatalog;
    catalogModule.createAddonCatalog=options=>original({...options,builtin:fixture,trustedPublisher:value=>value===identity?'Noctune':null,fetch:async (url,options)=>{
        networkCalls++;if(offline)throw new Error('Offline');return url===catalogModule.CATALOG_URL?(await delay(180),p.canonical(fixture)):transfer(bytes,options,'official');
    }});
    const marketplaceModule=require(path.join(source,'src/main/addons/marketplace'));
    const marketplaceSeed=require(path.join(source,'addons/catalog/marketplace.json'));
    const originalMarketplace=marketplaceModule.createMarketplaceCatalog;
    marketplaceModule.createMarketplaceCatalog=options=>originalMarketplace({...options,fetch:async (url,options)=>{
        networkCalls++;if(offline||marketplaceOffline)throw Error('Offline');
        if(url===marketplaceModule.CATALOG_URL)return p.canonical(marketplaceSeed);
        const entry=marketplaceSeed.entries.find(item=>item.packageUrl===url);assert(entry,'only a pinned catalog package is downloaded');
        const bytes=fs.readFileSync(path.join(root,marketplaceModule.packagePath(entry)),'utf8');return transfer(bytes,options,entry.kind,entry.kind==='theme');
    }});
    const sceneModule=require(path.join(source,'src/main/scene-themes')),originalSceneStore=sceneModule.createSceneThemeStore;
    sceneModule.createSceneThemeStore=options=>originalSceneStore({...options,directory:()=>path.join(profile,'themes/user'),builtinDirectory:path.join(profile,'no-bundled-scenes'),userThemesDirectory:path.join(profile,'no-source-scenes')});
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
    assert.equal(shop.getTitle(),'NocStore');
    assert.equal(shop.webContents.getLastWebPreferences().sandbox,true);
    assert.equal(await run(shop,`typeof require`),'undefined');
    assert.equal(await run(shop,`typeof window.noctune`),'undefined');
    assert.equal(await run(shop,`!!document.querySelector('#repository svg')`),true,'repository button has a rendered icon');
    assert.equal(await run(shop,`document.querySelector('.card-title').textContent`),'Noctune Chroma');
    assert.equal(await run(shop,`document.getElementById('community-note').hidden`),true);
    for(const theme of ['dark','light']){
        await run(shop,`document.documentElement.dataset.theme='${theme}'`);
        assert.equal(await run(shop,`getComputedStyle(document.documentElement).backgroundColor`),theme==='dark'?'rgb(21, 21, 27)':'rgb(244, 247, 246)');
        for(const size of [[1040,800],[640,650]]){
            shop.setSize(...size);
            for(const section of ['extensions','themes'])for(const tab of ['official','community']){
                await run(shop,`document.getElementById('tab-${section}').click();document.getElementById('tab-${tab}').click()`);await delay(180);
                assert.equal(await run(shop,`document.getElementById('community-actions').hidden`),tab!=='community');
                assert.equal(await run(shop,`(()=>{const cards=[...document.querySelectorAll('.store-card')];return cards.every(a=>cards.every(b=>Math.abs(a.offsetTop-b.offsetTop)>1||Math.abs(a.getBoundingClientRect().height-b.getBoundingClientRect().height)<1));})()`),true,'cards in a row have equal height');
                if(section==='themes'&&tab==='community'){
                    assert.deepEqual(await run(shop,`[...document.querySelectorAll('.store-card')].map(card=>card.dataset.addonId)`),['rhodes-island-dark','rhodes-island-light','endfield-dark','endfield-light']);
                    assert.equal(await run(shop,`!!document.querySelector('.card-author .lucide-badge-check')`),false);
                    assert.equal(await run(shop,`[...document.querySelectorAll('.card-author')].every(author=>author.textContent==='Noctune Community')`),true);
                }
                assert.equal(await run(shop,`document.documentElement.scrollWidth>innerWidth`),false);
                await shop.webContents.capturePage();
                fs.writeFileSync(path.join(screenshots,`${theme}-${section}-${tab}-${size[0]}.png`),(await shop.webContents.capturePage()).toPNG());
            }
        }
    }
    await run(shop,`document.getElementById('tab-extensions').click();document.getElementById('tab-community').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}))`);
    assert.equal(await run(shop,`document.getElementById('tab-official').getAttribute('aria-selected')`),'true');
    await run(shop,`document.getElementById('search').value='missing';document.getElementById('search').dispatchEvent(new Event('input'))`);
    assert.equal(await run(shop,`document.getElementById('empty').hidden`),false);
    assert.equal(await run(shop,`document.getElementById('empty').textContent`),'Ничего не найдено. Попробуйте другое название.');
    await run(shop,`document.getElementById('search').value='';document.getElementById('search').dispatchEvent(new Event('input'))`);
    const initialButton=await run(shop,`(()=>{const r=document.querySelector('.store-card .primary').getBoundingClientRect();return {width:r.width,height:r.height}})()`);
    await run(shop,`document.getElementById('search').value='';document.getElementById('search').dispatchEvent(new Event('input'));document.querySelector('.store-card .primary').click()`);
    await waitFor(()=>run(shop,`document.getElementById('transfer-progress').value===50`));
    assert.equal(await run(shop,`document.querySelector('.primary').textContent`),'Загрузка…');
    assert.deepEqual(await run(shop,`(()=>{const r=document.querySelector('.store-card .primary').getBoundingClientRect();return {width:r.width,height:r.height}})()`),initialButton);
    assert.equal(await run(shop,`document.querySelector('.primary').style.getPropertyValue('--download-progress')`),'0.5');
    assert.equal(await run(shop,`document.getElementById('transfer').hidden`),false);
    assert(await run(shop,`document.getElementById('transfer-speed').textContent.includes('/с')`));
    for(const theme of ['dark','light'])for(const width of [1040,640]){
        shop.setSize(width,740);await run(shop,`document.documentElement.dataset.theme='${theme}';document.querySelector('.primary').scrollIntoView({block:'nearest'})`);await delay(220);
        assert(await run(shop,`document.getElementById('transfer').getBoundingClientRect().bottom<=innerHeight&&document.documentElement.scrollWidth<=innerWidth`));
        fs.writeFileSync(path.join(screenshots,`progress-${theme}-${width}.png`),(await shop.webContents.capturePage()).toPNG());
    }
    releaseDownload();
    let installer=await waitFor(()=>windows.find(window=>!window.isDestroyed()&&window.webContents.getURL().includes('/addon-install/index.html')&&!window.webContents.isLoading()));
    await waitFor(()=>run(installer,`!document.getElementById('consent').disabled`));
    assert.equal(new URL(installer.webContents.getURL()).searchParams.get('accent'),new URL(shop.webContents.getURL()).searchParams.get('accent'));
    assert.equal(await run(installer,`document.documentElement.dataset.theme`),new URL(shop.webContents.getURL()).searchParams.get('theme'));
    assert.equal(await run(installer,`document.getElementById('install').disabled`),true);
    await run(installer,`document.getElementById('cancel').click()`);
    await waitFor(()=>run(shop,`document.getElementById('status').textContent==='Установка отменена'`));
    assert.equal((await run(main,`window.noctune.addons.list()`)).length,0);
    await waitFor(()=>run(shop,`!document.querySelector('.primary').disabled`));
    packageFailure=true;await run(shop,`document.querySelector('.store-card .primary').click()`);
    await waitFor(()=>run(shop,`document.getElementById('status').textContent.includes('Package download failed')`));
    assert(await run(shop,`document.getElementById('transfer').hidden&&!document.querySelector('.primary').disabled`));packageFailure=false;

    await waitFor(()=>run(shop,`!document.querySelector('.store-card .primary').disabled`));
    await run(shop,`document.querySelector('.store-card .primary').click()`);
    installer=await waitFor(()=>windows.find(window=>!window.isDestroyed()&&window.webContents.getURL().includes('/addon-install/index.html')&&!window.webContents.isLoading()));
    await waitFor(()=>run(installer,`!document.getElementById('consent').disabled`));
    assert.equal(new URL(installer.webContents.getURL()).searchParams.get('accent'),new URL(shop.webContents.getURL()).searchParams.get('accent'));
    assert.equal(await run(installer,`document.documentElement.dataset.theme`),new URL(shop.webContents.getURL()).searchParams.get('theme'));
    await run(installer,`document.getElementById('consent').click();document.getElementById('install').click()`);
    await waitFor(()=>run(shop,`document.querySelector('.store-card .primary')?.textContent==='Установлено'`));
    const installed=await run(main,`window.noctune.addons.list()`);assert.equal(installed.length,1);assert.equal(installed[0].enabled,false);
    await waitFor(()=>run(main,`!!document.querySelector('#addons-list [data-addon-id="noctune-chroma"]')`));
    assert.equal(await run(shop,`document.querySelector('.store-card .primary').disabled`),true);
    const beforeReopen=networkCalls;
    await run(main,`document.getElementById('addons-store').click()`);
    await waitFor(()=>networkCalls>beforeReopen);
    assert.equal(windows.filter(window=>!window.isDestroyed()&&window.webContents.getURL().includes('/addon-store/index.html')).length,1);
    await run(shop,`document.getElementById('tab-themes').click();document.getElementById('tab-official').click()`);
    assert.equal(await run(shop,`document.querySelectorAll('.store-card').length`),3);
    assert.equal((await run(main,`noctune.sceneThemes.list()`)).themes.length,0,'themes are not preinstalled');
    await run(shop,`document.querySelector('.store-card .primary').click()`);
    await waitFor(()=>run(shop,`document.getElementById('transfer-progress').value>=49&&document.getElementById('transfer-progress').value<=50`));
    assert(await run(shop,`document.getElementById('transfer-name').textContent===document.querySelector('.card-title').textContent`));
    releaseDownload();
    let themeInstaller=await waitFor(()=>windows.find(window=>!window.isDestroyed()&&window.webContents.getURL().includes('/theme-install/index.html')&&!window.webContents.isLoading()));
    await waitFor(()=>run(themeInstaller,`!document.getElementById('install').disabled`));
    assert.equal(await run(themeInstaller,`document.documentElement.dataset.theme`),new URL(shop.webContents.getURL()).searchParams.get('theme'));
    assert.equal(new URL(themeInstaller.webContents.getURL()).searchParams.get('accent'),new URL(shop.webContents.getURL()).searchParams.get('accent'));
    await run(themeInstaller,`document.getElementById('cancel').click()`);
    await waitFor(()=>run(shop,`document.getElementById('status').textContent==='Установка отменена'`));
    assert.equal((await run(main,`noctune.sceneThemes.list()`)).themes.length,0);
    await waitFor(()=>run(shop,`!document.querySelector('.store-card .primary').disabled`));
    await run(shop,`document.querySelector('.store-card .primary').click()`);
    themeInstaller=await waitFor(()=>windows.find(window=>!window.isDestroyed()&&window.webContents.getURL().includes('/theme-install/index.html')&&!window.webContents.isLoading()));
    await waitFor(()=>run(themeInstaller,`!document.getElementById('install').disabled`));
    assert.equal(await run(themeInstaller,`document.documentElement.dataset.theme`),new URL(shop.webContents.getURL()).searchParams.get('theme'));
    assert.equal(new URL(themeInstaller.webContents.getURL()).searchParams.get('accent'),new URL(shop.webContents.getURL()).searchParams.get('accent'));
    await run(themeInstaller,`document.getElementById('install').click()`);
    await waitFor(()=>run(shop,`document.querySelector('.store-card .primary')?.textContent==='Установлено'`));
    assert.equal((await run(main,`noctune.sceneThemes.list()`)).themes.length,1);
    await waitFor(()=>run(main,`document.querySelectorAll('#scene-imported-list [data-scene-id]').length===1`));
    await run(shop,`document.getElementById('tab-extensions').click();document.getElementById('tab-community').click()`);
    assert.equal(await run(shop,`document.querySelector('.store-card').dataset.addonId`),'yandex-music');
    assert.equal(await run(shop,`document.querySelector('.card-author').textContent`),'Noctune Community');
    assert.equal(await run(shop,`!!document.querySelector('.card-author .lucide-badge-check')`),false,'community cards never claim an official publisher');
    await run(shop,`document.querySelector('.store-card .primary').click()`);
    await waitFor(()=>run(shop,`!document.getElementById('transfer').hidden&&document.getElementById('transfer-phase').textContent==='Загрузка…'&&!document.getElementById('transfer-size').textContent.startsWith('0')`));
    assert(await run(shop,`!document.getElementById('transfer-progress').hasAttribute('value')&&document.getElementById('transfer-percent').textContent==='—'`));
    releaseDownload();
    installer=await waitFor(()=>windows.find(window=>!window.isDestroyed()&&window.webContents.getURL().includes('/addon-install/index.html')&&!window.webContents.isLoading()));
    await waitFor(()=>run(installer,`!document.getElementById('consent').disabled`));
    assert.equal(new URL(installer.webContents.getURL()).searchParams.get('accent'),new URL(shop.webContents.getURL()).searchParams.get('accent'));
    assert.equal(await run(installer,`document.documentElement.dataset.theme`),new URL(shop.webContents.getURL()).searchParams.get('theme'));
    assert.equal(await run(installer,`!!document.querySelector('[data-namespace="downloads"] svg')`),true,'downloads permission has an icon');
    assert.equal(await run(installer,`document.getElementById('signature-note').textContent.includes('без подписи')`),true);
    await run(installer,`document.getElementById('consent').click();document.getElementById('install').click()`);
    await waitFor(()=>run(shop,`document.querySelector('.store-card .primary')?.textContent==='Установлено'`));
    const yandex=(await run(main,`noctune.addons.list()`)).find(item=>item.id==='yandex-music');assert(yandex&&!yandex.enabled&&!yandex.verifiedPublisher);
    assert.equal(await run(main,`!!document.querySelector('#scene-theme-store svg')`),true,'appearance settings has a themed store button with an icon');
    assert(await run(main,`document.getElementById('scene-theme-store').parentElement.nextElementSibling.querySelector('.scene-add-tile').textContent==='Добавить тему из файла'`));
    await run(main,`document.querySelector('.settings-nav-item[data-panel="panel-appearance"]').click();document.getElementById('scene-theme-store').scrollIntoView({block:'center'});document.getElementById('scene-theme-store').click()`);
    await waitFor(()=>run(shop,`document.getElementById('tab-themes').getAttribute('aria-selected')==='true'`));
    fs.writeFileSync(path.join(screenshots,'theme-settings-entry.png'),(await main.webContents.capturePage()).toPNG());
    await run(shop,`document.getElementById('tab-extensions').click()`);
    await waitFor(()=>run(shop,`!document.getElementById('refresh').disabled`));
    marketplaceOffline=true;
    await run(shop,`document.getElementById('refresh').click()`);
    await waitFor(()=>run(shop,`!document.getElementById('refresh').disabled`));
    await run(shop,`document.getElementById('tab-official').click()`);
    assert.equal(await run(shop,`document.getElementById('catalog-message').textContent`),'','a failed theme catalog does not label the official extension catalog as failed');
    await run(shop,`document.getElementById('tab-themes').click()`);
    assert.equal(await run(shop,`document.getElementById('catalog-message').textContent.includes('Offline')`),true,'catalog failures include the actual reason');
    await run(shop,`document.getElementById('tab-extensions').click();document.getElementById('tab-community').click()`);
    offline=true;
    await run(shop,`document.getElementById('refresh').click()`);
    await waitFor(()=>run(shop,`document.getElementById('catalog-message').textContent.includes('сохранённая')`));
    assert.equal(await run(shop,`document.querySelectorAll('.store-card').length`),1);
    assert(networkCalls>=4);
    await waitFor(()=>run(shop,`!document.getElementById('refresh').disabled`));
    offline=false;marketplaceOffline=false;
    await run(shop,`document.getElementById('refresh').click()`);
    assert(await run(shop,`document.getElementById('refresh').getAttribute('aria-busy')==='true'&&document.getElementById('status').textContent==='Обновляем каталог…'`));
    await waitFor(()=>run(shop,`!document.getElementById('refresh').disabled`));
    assert.equal(await run(shop,`document.getElementById('status').textContent`),'Каталог обновлён');
    async function removal(action, kind) {
        await run(shop,`document.querySelector('.remove-package').click()`);
        const window=await waitFor(()=>windows.find(window=>!window.isDestroyed()&&window.webContents.getURL().includes('action=remove')&&!window.webContents.isLoading()));
        await waitFor(()=>run(window,`!document.getElementById('install').disabled`));
        assert.equal(await run(window,`document.getElementById('install').textContent`),'Удалить');
        assert.equal(await run(window,`typeof window.themeInstaller`),'undefined');
        assert.equal(await run(window,`document.querySelector('.eyebrow').textContent`),kind==='theme'?'Удаление темы':'Удаление расширения');
        await run(window,`document.getElementById('${action==='cancel'?'cancel':'install'}').click()`);
        await waitFor(()=>window.isDestroyed());
    }
    await removal('cancel','extension');
    await waitFor(()=>run(shop,`!document.querySelector('.remove-package').disabled`));
    assert((await run(main,`noctune.addons.list()`)).some(item=>item.id==='yandex-music'),'cancel preserves extension');
    await removal('confirm','extension');
    await waitFor(async()=>!(await run(main,`noctune.addons.list()`)).some(item=>item.id==='yandex-music'));
    await waitFor(()=>run(shop,`document.querySelector('.primary').textContent==='Установить'`));
    await run(shop,`document.getElementById('tab-themes').click();document.getElementById('tab-official').click()`);
    const installedTheme=(await run(main,`noctune.sceneThemes.list()`)).themes.find(theme=>theme.removable);
    assert(installedTheme);await run(main,`window.sceneThemes.activate(${JSON.stringify(installedTheme)})`);
    await removal('confirm','theme');
    await waitFor(async()=>!(await run(main,`noctune.sceneThemes.list()`)).themes.some(theme=>theme.packageId===installedTheme.packageId));
    await waitFor(()=>run(main,`!window.sceneThemes.active`));
    console.log('PASS: fixed button size, refresh feedback, deletion cancellation/removal and active theme deactivation.');
    console.log('PASS: NocStore, known/unknown byte progress and button fill, download error recovery, footer in both themes/sizes, theme action tiles, consent/cancel/install and offline fallback.');
    for(const window of windows)if(!window.isDestroyed())window.destroy();
    if(process.env.NOCTUNE_TEST_CLEANUP)fs.writeFileSync(process.env.NOCTUNE_TEST_CLEANUP,JSON.stringify([profile]));
    app.exit(0);
})().catch(error=>{console.error(error);if(process.env.NOCTUNE_TEST_CLEANUP)fs.writeFileSync(process.env.NOCTUNE_TEST_CLEANUP,JSON.stringify([profile]));app.exit(1);});
setTimeout(()=>{console.error('Native store probe timed out');app.exit(1);},100000);
