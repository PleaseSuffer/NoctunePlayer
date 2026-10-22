const {app,BrowserWindow,safeStorage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events'),{Readable}=require('node:stream');
const root=path.resolve(__dirname,'..'),output=path.join(__dirname,'.artifacts/service-library');fs.mkdirSync(output,{recursive:true});
const archive=process.argv.find(value=>value.startsWith('--app-asar='))?.slice('--app-asar='.length),sdkRoot=archive?path.resolve(archive):root;
if(archive){app.setAppPath(sdkRoot);Object.defineProperty(app,'isPackaged',{value:true});}
const profile=fs.mkdtempSync(path.join(output,'profile-'));app.setPath('userData',profile);app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');

safeStorage.isEncryptionAvailable=()=>true;safeStorage.getSelectedStorageBackend=()=> 'test';safeStorage.encryptString=value=>Buffer.from(value);safeStorage.decryptString=value=>value.toString();
require('electron-updater').autoUpdater.checkForUpdates=async()=>null;
const artwork='https://images.service.example/covers/sample.png';
const song=id=>({id:String(id),entryId:'entry-'+id,title:'Трек '+id,artist:'Исполнитель',album:'Альбом',duration:0.9,artwork,canonicalId:'record-'+id});
const json=value=>({body:Buffer.from(JSON.stringify(value)),mime:'application/json'}),resolved=new Set();
const wav=Buffer.alloc(44+22050*2);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(22050,24);wav.writeUInt32LE(44100,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
const png=fs.readFileSync(path.join(root,'resources/app.png'));
require('node:dns').promises.lookup=async()=>[{address:'1.1.1.1',family:4}];
let batch=0;
function response(url,options){
    if(url.hostname==='images.service.example'){
        assert.equal(options.headers.Authorization,undefined,'artwork never receives the API credential');
        return {body:png,mime:'image/png'};
    }
    if(url.hostname==='media.service.example'){
        assert.equal(options.headers.Authorization,undefined,'audio never receives the API credential');
        resolved.add(url.pathname);return {body:wav,mime:'audio/wav'};
    }
    assert.equal(url.hostname,'api.service.example','no real service requests');
    assert.equal(options.headers.Authorization,'Bearer fixture-only-token');
    if(url.pathname==='/catalog'){
        const parent=url.searchParams.get('parent');
        return json({items:parent?(parent==='owned'?[{id:'playlist-1',type:'playlist',title:'Любимый плейлист',artwork}]:[]):[
            {id:'favorites',type:'playlist',title:'Избранное'},
            {id:'stream',type:'playlist',title:'Персональный поток'},
            {id:'owned',type:'album',title:'Мои плейлисты'},
            {id:'saved',type:'album',title:'Сохранённые'},
            {id:'recommendations',type:'album',title:'Рекомендации'}
        ]});
    }
    if(url.pathname==='/search'){
        const offset=Number(url.searchParams.get('cursor')||0);
        return json({items:[song(5001+offset),song(5002+offset)].map(track=>({...track,type:'track'})),cursor:offset===0?'2':null});
    }
    if(url.pathname==='/playlists/stream'){
        const start=Number(url.searchParams.get('after')||url.searchParams.get('cursor')||9001);
        const tracks=[song(start),song(start+1),song(start+2)].map(track=>({...track,entryId:'stream-'+batch+'-'+track.id}));batch++;
        return json({id:'stream',name:'Персональный поток',revision:'batch-'+batch,tracks,continuous:true,cursor:String(start+2),artwork});
    }
    if(url.pathname==='/playlists/favorites'||url.pathname==='/playlists/playlist-1'){
        const favorites=url.pathname.endsWith('/favorites'),offset=Number(url.searchParams.get('cursor')||0),total=favorites?720:5;
        const tracks=Array.from({length:Math.min(100,total-offset)},(_,index)=>song((favorites?1000:1)+offset+index));
        return json({id:favorites?'favorites':'playlist-1',name:favorites?'Избранное':'Любимый плейлист',revision:'1',tracks,total,cursor:offset+tracks.length<total?String(offset+tracks.length):null,artwork});
    }
    throw new Error('Unmocked endpoint '+url.pathname);
}
const https=require('node:https');
function request(url,options,callback){
    let body='',sent=false;const req=new EventEmitter();req.destroy=error=>{if(error)req.emit('error',error);req.emit('close');};
    const send=()=>{if(sent)return;sent=true;queueMicrotask(()=>{try{
        const value=response(url,options,body),range=options.headers.Range&&/^bytes=(\d+)-(\d*)$/.exec(options.headers.Range),start=range?Number(range[1]):0,end=range&&range[2]?Math.min(value.body.length-1,Number(range[2])):value.body.length-1;
        const data=range?value.body.subarray(start,end+1):value.body,res=Readable.from([data]);res.statusCode=range?206:200;res.headers={'content-type':value.mime,'content-length':String(data.length),'accept-ranges':'bytes',...(range?{'content-range':`bytes ${start}-${end}/${value.body.length}`}:{})};res.setTimeout=()=>res;callback(res);res.on('end',()=>req.emit('close'));
    }catch(error){req.destroy(error);}});};
    req.end=value=>{body=value||'';send();};if(options.method==='GET'||!options.method)send();return req;
}
https.get=request;https.request=request;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.on('browser-window-created',(_,win)=>{
    win.webContents.on('did-finish-load',async()=>{
        if(!win.webContents.getURL().endsWith('/renderer/index.html'))return;
        win.webContents.setAudioMuted(true);win.webContents.setBackgroundThrottling(false);
        const run=async code=>{try{return await win.webContents.executeJavaScript(code);}catch(error){console.error('Failed:',code);throw error;}};
        const wait=async(code,message)=>{for(let i=0;i<150;i++){if(await run(code))return;await delay(100);}throw new Error(message);};
        const clickText=(selector,text)=>run(`(()=>{const button=[...document.querySelectorAll(${JSON.stringify(selector)})].find(node=>node.textContent===${JSON.stringify(text)});if(!button)throw new Error('Button missing');button.click();})()`);
        try{
            await installed;await run('window.addonHost.refresh()');
            await wait(`window.addonHost.state('service-library-demo')?.status==='running'`,'addon startup');
            await run(`document.getElementById('settings-fab').click();document.querySelector('[data-panel="panel-integrations"]').click()`);
            await wait(`document.querySelectorAll('#integration-addon-service-library-demo .service-playlist-card').length===5`,'library inside integration');
            assert.equal(await run(`document.querySelectorAll('#addon-catalogs .addon-catalog').length`),0);
            assert.equal(await run(`document.querySelector('#integration-addon-service-library-demo .addon-configuration').open`),false);
            await run(`document.querySelectorAll('#integration-addon-service-library-demo .service-playlist-card')[2].click()`);
            await wait(`document.querySelector('#integration-addon-service-library-demo .service-playlist-name')?.textContent==='Любимый плейлист'`,'owned playlists');
            await run(`document.querySelector('#integration-addon-service-library-demo .service-playlist-card').scrollIntoView({block:'center'})`);
            await wait(`!!document.querySelector('#integration-addon-service-library-demo .service-playlist-cover img[src^="data:image/"]')`,'playlist artwork through broker');
            for(const mode of ['light','dark']){
                await run(`(()=>{const input=document.getElementById('setting-dark-theme');if(input.checked!==${mode==='dark'}){input.checked=${mode==='dark'};input.dispatchEvent(new Event('change'));}})()`);
                await run(`document.getElementById('integration-addon-service-library-demo').scrollIntoView({block:'start'})`);await delay(600);
                await fs.promises.writeFile(path.join(output,'library-'+mode+'.png'),(await win.webContents.capturePage()).toPNG());
            }
            await clickText('#integration-addon-service-library-demo button','Назад');
            await wait(`document.querySelectorAll('#integration-addon-service-library-demo .service-playlist-card').length===5`,'root');
            await run(`document.querySelector('#integration-addon-service-library-demo .service-playlist-card').click()`);
            await wait(`document.querySelectorAll('#integration-addon-service-library-demo .provider-track').length===300`,'initial 300 liked tracks');
            assert.match(await run(`document.querySelector('#integration-addon-service-library-demo .service-playlist-toolbar').textContent`),/300 из 720/);
            await clickText('#integration-addon-service-library-demo button','Ещё 300 треков');
            await wait(`document.querySelectorAll('#integration-addon-service-library-demo .provider-track').length===600`,'load next 300');
            await clickText('#integration-addon-service-library-demo button','Открыть в плеере');
            await wait(`fileEntries.length===600`,'opened full loaded playlist');
            assert.equal(await run(`getPlaylistIcon(userPlaylists.find(pl=>pl.id===currentPlaylistId))`),'cloud');
            assert.equal(await run(`document.querySelectorAll('#playlist .track-title-item').length`),600);
            await run(`document.querySelector('#playlist .actions-btn').click()`);
            await wait(`document.querySelectorAll('.provider-context-menu [role="menuitem"]').length===6&&!document.querySelector('.provider-context-menu button:disabled')`,'provider track actions loaded');
            await clickText('.provider-context-menu button','Нравится');
            await run(`document.querySelector('#playlist .actions-btn').click()`);
            await wait(`[...document.querySelectorAll('.provider-context-menu button')].some(button=>button.textContent==='Не нравится')`,'like changed label');
            await run(`document.body.click();document.querySelectorAll('#playlist .actions-btn')[1].click()`);
            await wait(`[...document.querySelectorAll('.provider-context-menu button')].some(button=>button.textContent==='Дизлайк — реже рекомендовать')`,'dislike menu');
            await clickText('.provider-context-menu button','Дизлайк — реже рекомендовать');
            await run(`document.querySelectorAll('#playlist .actions-btn')[1].click()`);
            await wait(`[...document.querySelectorAll('.provider-context-menu button')].some(button=>button.textContent==='Отменить дизлайк')`,'independent dislike');
            await run(`document.body.click();document.querySelector('#playlist .provider-track').click()`);
            await wait(`isPlaying`,'start track for hotkey');
            await run(`togglePlayback();window.hotkeyBindings['addon:service-library-demo:toggle-like']='ctrl+alt+KeyL';document.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyL',ctrlKey:true,altKey:true,bubbles:true,cancelable:true}))`);
            await wait(`!document.querySelector('.provider-context-menu')`,'menu closed');
            await delay(150);
            await run(`document.querySelector('#playlist .actions-btn').click()`);
            await wait(`[...document.querySelectorAll('.provider-context-menu button')].some(button=>button.textContent==='Нравится')`,'configured hotkey unlikes current track');
            assert.ok(await run(`[...document.querySelectorAll('#hotkeys-list .hotkey-label')].some(label=>label.textContent.includes('Текущий трек: нравится / не нравится'))`),'extension hotkey appears in settings');
            await run(`document.body.click();document.getElementById('settings-fab').click();document.querySelector('[data-panel="panel-integrations"]').click();document.querySelector('#integration-addon-service-library-demo input[type="search"]').value='Исполнитель';document.querySelector('#integration-addon-service-library-demo .service-search').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))`);
            await wait(`document.querySelector('#integration-addon-service-library-demo .service-library-heading').textContent==='Поиск: Исполнитель'`,'inline search');
            assert.equal(await run(`document.querySelectorAll('#integration-addon-service-library-demo .provider-track').length`),2);
            await clickText('#integration-addon-service-library-demo button','Ещё результаты');await wait(`document.querySelectorAll('#integration-addon-service-library-demo .provider-track').length===4`,'search pagination');
            await clickText('#integration-addon-service-library-demo button','Назад');await wait(`document.querySelectorAll('#integration-addon-service-library-demo .service-playlist-card').length===5`,'root for stream');
            await run(`document.querySelectorAll('#integration-addon-service-library-demo .service-playlist-card')[1].click()`);
            await wait(`document.querySelector('#integration-addon-service-library-demo .service-library-heading').textContent==='Персональный поток'`,'stream');
            await run(`document.querySelector('#integration-addon-service-library-demo .provider-track').click()`);
            await wait(`isPlaying&&fileEntries.some(track=>track.canonicalId?.includes('9004'))`,'stream continuation without replacement');
            await wait(`isPlaying&&fileEntries[playlistOrder[currentIndex]]?.canonicalId?.includes('9006')`,'automatic next track in stream');
            await run(`togglePlayback();document.getElementById('settings-close-btn').click()`);await delay(600);
            assert.ok(resolved.size>=6,'several natural completions resolved new tracks');
            assert.equal(await run(`new Set(fileEntries.map(track=>track.canonicalId)).size===fileEntries.length`),true);
            assert.equal(await run(`userPlaylists.filter(pl=>pl.type==='provider'&&pl.service?.id==='stream').length`),1);
            assert.ok(await run(`JSON.parse(appStorage.getItem('addon_service_playlists')).some(item=>item.id==='stream')`));
            await fs.promises.writeFile(path.join(output,'stream.png'),(await win.webContents.capturePage()).toPNG());
            await run(`noctune.addons.setEnabled('service-library-demo',false).then(()=>addonHost.refresh())`);
            await wait(`addonHost.state('service-library-demo')?.status==='stopped'&&!userPlaylists.some(pl=>pl.addonId==='service-library-demo')`,'disabled owner cleanup');
            assert.equal(await run(`addonContributions.catalogs().length`),0);
            await run(`noctune.addons.setEnabled('service-library-demo',true).then(()=>addonHost.refresh())`);
            await wait(`userPlaylists.some(pl=>pl.service?.id==='stream')&&userPlaylists.some(pl=>pl.service?.id==='favorites'&&pl.tracks.length>=300)`,'saved collection references restored');
            assert.equal(await run(`isPlaying`),false,'restoring a playlist does not start playback');
            console.log('PASS: integrated library, artwork broker, 300/600-track pages, service playlist icon/type/rows, dynamic track menus, separate like/dislike actions, configured current-track hotkey, inline paginated search and natural stream autoplay with deduplicated continuation. Profile: '+profile);
            app.exit(0);
        }catch(error){console.error(error);await fs.promises.writeFile(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());app.exit(1);}
    });
});
const installed=(async()=>{
    const {createAddonStore}=require(path.join(sdkRoot,'src/main/addons/store')),{packDirectory,canonical}=require(path.join(sdkRoot,'src/main/addons/package'));
    const store=createAddonStore({directory:path.join(profile,'addons'),appVersion:require(path.join(sdkRoot,'package.json')).version}),pkg=JSON.parse(canonical(await packDirectory(path.join(root,'tests/fixtures/service-library-demo'))));
    await store.confirm((await store.preparePackage(pkg)).ticket);await store.setEnabled('service-library-demo',true);
    const {createVault}=require(path.join(sdkRoot,'src/main/addons/vault'));const vault=createVault({directory:path.join(profile,'addons'),safeStorage});
    await vault.set('service-library-demo','credential:demo-token',{config:JSON.stringify(pkg.manifest.credentials['demo-token']),value:'fixture-only-token',expiresAt:null});
})();
installed.catch(error=>{console.error(error);app.exit(1);});require(path.join(sdkRoot,'src/main/index.js'));
setTimeout(()=>{console.error('UX probe timeout');app.exit(1);},90000);
