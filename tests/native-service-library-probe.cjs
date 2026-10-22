const {app,BrowserWindow,safeStorage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events'),{Readable}=require('node:stream');
const root=path.resolve(__dirname,'..'),output=path.join(__dirname,'.artifacts/service-library');fs.mkdirSync(output,{recursive:true});
const archive=process.argv.find(value=>value.startsWith('--app-asar='))?.slice('--app-asar='.length),sdkRoot=archive?path.resolve(archive):root;
if(archive){app.setAppPath(sdkRoot);Object.defineProperty(app,'isPackaged',{value:true});}
const profile=fs.mkdtempSync(path.join(output,'profile-'));app.setPath('userData',profile);app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');

safeStorage.isEncryptionAvailable=()=>true;safeStorage.getSelectedStorageBackend=()=> 'test';safeStorage.encryptString=value=>Buffer.from(value);safeStorage.decryptString=value=>value.toString();
require('electron-updater').autoUpdater.checkForUpdates=async()=>null;
const song=id=>({id:String(id),title:'Трек '+id,artists:[{name:'Исполнитель'}],albums:[{id:7,title:'Альбом'}],durationMs:900,coverUri:'avatars.yandex.net/get-music-content/album/%%'});
const json=result=>({body:Buffer.from(JSON.stringify({result})),mime:'application/json'}),requests=[],resolved=[];
const wav=Buffer.alloc(44+22050*2);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(22050,24);wav.writeUInt32LE(44100,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
const png=fs.readFileSync(path.join(root,'resources/app.png'));
require('node:dns').promises.lookup=async()=>[{address:'1.1.1.1',family:4}];
function response(url,options,body){
    requests.push({path:url.pathname,method:options.method||'GET'});
    if(url.hostname.startsWith('avatars.'))return {body:png,mime:'image/png'};
    if(url.pathname.startsWith('/get-mp3/'))return {body:wav,mime:'audio/wav',audio:true};
    if(url.hostname==='storage.mds.yandex.net')return {body:Buffer.from('<download-info><host>s1.storage.yandex.net</host><path>/fixture/audio.mp3</path><ts>000af</ts><s>abcdef</s></download-info>'),mime:'text/xml'};
    if(url.pathname==='/account/status')return json({account:{uid:42,displayName:'Тестовый аккаунт'}});
    if(url.pathname==='/users/42/likes/tracks')return json({library:{revision:4,tracks:Array.from({length:720},(_,i)=>({id:String(1000+i),albumId:7}))}});
    if(url.pathname==='/tracks')return json(new URLSearchParams(body).get('track-ids').split(',').map(id=>song(id.split(':')[0])));
    if(url.pathname==='/users/42/playlists/list')return json([{owner:{uid:42},kind:1,title:'Любимый плейлист',revision:4,trackCount:5,cover:{uri:'avatars.yandex.net/get-music-content/playlist/%%'}}]);
    if(url.pathname==='/users/42/playlists/1')return json({title:'Любимый плейлист',revision:4,trackCount:5,tracks:[1,2,3,4,5].map(id=>({id:String(id),track:song(id)})),cover:{uri:'avatars.yandex.net/get-music-content/playlist/%%'}});
    if(url.pathname==='/users/42/likes/playlists')return json([]);
    if(url.pathname==='/feed')return json({generatedPlaylists:[]});
    if(url.pathname==='/search'){const page=Number(url.searchParams.get('page')||0);return json({tracks:{perPage:2,total:4,results:[song(5001+page*2),song(5002+page*2)]}});}
    if(url.pathname.endsWith('/download-info')){resolved.push(url.pathname);return json([{codec:'mp3',preview:false,bitrateInKbps:192,downloadInfoUrl:'https://storage.mds.yandex.net/info'}]);}
    if(url.pathname.endsWith('/feedback'))return json('ok');
    if(url.pathname.startsWith('/rotor/')){const start=Number(url.searchParams.get('queue')||9001);return json({batchId:'batch-'+start,sequence:[song(start),song(start+1),song(start+2)].map(track=>({track}))});}
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
            await wait(`window.addonHost.state('yandex-music')?.status==='running'`,'addon startup');
            await run(`document.getElementById('settings-fab').click();document.querySelector('[data-panel="panel-integrations"]').click()`);
            await wait(`document.querySelectorAll('#integration-addon-yandex-music .service-playlist-card').length===5`,'library inside integration');
            assert.equal(await run(`document.querySelectorAll('#addon-catalogs .addon-catalog').length`),0);
            assert.equal(await run(`document.querySelector('#integration-addon-yandex-music .addon-configuration').open`),false);
            await run(`document.querySelectorAll('#integration-addon-yandex-music .service-playlist-card')[2].click()`);
            await wait(`document.querySelector('#integration-addon-yandex-music .service-playlist-name')?.textContent==='Любимый плейлист'`,'owned playlists');
            await run(`document.querySelector('#integration-addon-yandex-music .service-playlist-card').scrollIntoView({block:'center'})`);
            await wait(`!!document.querySelector('#integration-addon-yandex-music .service-playlist-cover img[src^="data:image/"]')`,'playlist artwork through broker');
            for(const mode of ['light','dark']){
                await run(`(()=>{const input=document.getElementById('setting-dark-theme');if(input.checked!==${mode==='dark'}){input.checked=${mode==='dark'};input.dispatchEvent(new Event('change'));}})()`);
                await run(`document.getElementById('integration-addon-yandex-music').scrollIntoView({block:'start'})`);await delay(600);
                await fs.promises.writeFile(path.join(output,'library-'+mode+'.png'),(await win.webContents.capturePage()).toPNG());
            }
            await clickText('#integration-addon-yandex-music button','Назад');
            await wait(`document.querySelectorAll('#integration-addon-yandex-music .service-playlist-card').length===5`,'root');
            await run(`document.querySelector('#integration-addon-yandex-music .service-playlist-card').click()`);
            await wait(`document.querySelectorAll('#integration-addon-yandex-music .provider-track').length===300`,'initial 300 liked tracks');
            assert.match(await run(`document.querySelector('#integration-addon-yandex-music .service-playlist-toolbar').textContent`),/300 из 720/);
            await clickText('#integration-addon-yandex-music button','Ещё 300 треков');
            await wait(`document.querySelectorAll('#integration-addon-yandex-music .provider-track').length===600`,'load next 300');
            await clickText('#integration-addon-yandex-music button','Открыть в плеере');
            await wait(`fileEntries.length===600`,'opened full loaded playlist');
            assert.equal(await run(`getPlaylistIcon(userPlaylists.find(pl=>pl.id===currentPlaylistId))`),'cloud');
            assert.equal(await run(`document.querySelectorAll('#playlist .track-title-item').length`),600);
            await run(`document.querySelector('#playlist .actions-btn').click()`);
            assert.equal(await run(`document.querySelectorAll('.provider-context-menu [role="menuitem"]').length`),4);
            await run(`document.body.click();document.getElementById('settings-fab').click();document.querySelector('[data-panel="panel-integrations"]').click();document.querySelector('#integration-addon-yandex-music input[type="search"]').value='Исполнитель';document.querySelector('#integration-addon-yandex-music .service-search').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))`);
            await wait(`document.querySelector('#integration-addon-yandex-music .service-library-heading').textContent==='Поиск: Исполнитель'`,'inline search');
            assert.equal(await run(`document.querySelectorAll('#integration-addon-yandex-music .provider-track').length`),2);
            await clickText('#integration-addon-yandex-music button','Ещё результаты');await wait(`document.querySelectorAll('#integration-addon-yandex-music .provider-track').length===4`,'search pagination');
            await clickText('#integration-addon-yandex-music button','Назад');await wait(`document.querySelectorAll('#integration-addon-yandex-music .service-playlist-card').length===5`,'root for wave');
            await run(`document.querySelectorAll('#integration-addon-yandex-music .service-playlist-card')[1].click()`);
            await wait(`document.querySelector('#integration-addon-yandex-music .service-library-heading').textContent==='Моя волна'`,'wave');
            await run(`document.querySelector('#integration-addon-yandex-music .provider-track').click()`);
            await wait(`isPlaying&&fileEntries.some(track=>track.canonicalId?.includes('9004'))`,'wave continuation without replacement');
            await wait(`isPlaying&&fileEntries[playlistOrder[currentIndex]]?.canonicalId?.includes('9006')`,'automatic next track in wave');
            await run(`togglePlayback();document.getElementById('settings-close-btn').click()`);await delay(600);
            assert.ok(resolved.length>=6,'several natural completions resolved new tracks');
            assert.equal(await run(`new Set(fileEntries.map(track=>track.canonicalId)).size===fileEntries.length`),true);
            assert.equal(await run(`userPlaylists.filter(pl=>pl.type==='provider'&&pl.service?.id==='wave').length`),1);
            assert.ok(await run(`JSON.parse(appStorage.getItem('addon_service_playlists')).some(item=>item.id==='wave')`));
            await fs.promises.writeFile(path.join(output,'wave.png'),(await win.webContents.capturePage()).toPNG());
            await run(`noctune.addons.setEnabled('yandex-music',false).then(()=>addonHost.refresh())`);
            await wait(`addonHost.state('yandex-music')?.status==='stopped'&&!userPlaylists.some(pl=>pl.addonId==='yandex-music')`,'disabled owner cleanup');
            assert.equal(await run(`addonContributions.catalogs().length`),0);
            await run(`noctune.addons.setEnabled('yandex-music',true).then(()=>addonHost.refresh())`);
            await wait(`userPlaylists.some(pl=>pl.service?.id==='wave')&&userPlaylists.some(pl=>pl.service?.id==='likes'&&pl.tracks.length>=300)`,'saved collection references restored');
            assert.equal(await run(`isPlaying`),false,'restoring a playlist does not start playback');
            console.log('PASS: integrated library, artwork broker, 300/600-track pages, service playlist icon/type/rows, context menus, inline paginated search and natural Wave autoplay with deduplicated continuation. Profile: '+profile);
            app.exit(0);
        }catch(error){console.error(error);await fs.promises.writeFile(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());app.exit(1);}
    });
});
const installed=(async()=>{
    const {createAddonStore}=require(path.join(sdkRoot,'src/main/addons/store')),{packDirectory,canonical}=require(path.join(sdkRoot,'src/main/addons/package'));
    const store=createAddonStore({directory:path.join(profile,'addons'),appVersion:require(path.join(sdkRoot,'package.json')).version}),pkg=JSON.parse(canonical(await packDirectory(path.join(root,'addons/integrations/yandex-music'))));
    await store.confirm((await store.preparePackage(pkg)).ticket);await store.setEnabled('yandex-music',true);
    const runtime=(await store.runtime())[0];await store.invoke('yandex-music',runtime.digest,'storage.set',{key:'account',value:{uid:'42'}});
    const {createVault}=require(path.join(sdkRoot,'src/main/addons/vault'));const vault=createVault({directory:path.join(profile,'addons'),safeStorage});
    await vault.set('yandex-music','credential:yandex-token',{config:JSON.stringify(pkg.manifest.credentials['yandex-token']),value:'fixture-only-token',expiresAt:null});
})();
installed.catch(error=>{console.error(error);app.exit(1);});require(path.join(sdkRoot,'src/main/index.js'));
setTimeout(()=>{console.error('UX probe timeout');app.exit(1);},90000);
