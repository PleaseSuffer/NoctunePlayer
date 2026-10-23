// Isolated profile and mocked image service; never contacts a real provider.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{Readable}=require('node:stream');
const root=path.resolve(__dirname,'..'),output=path.join(__dirname,'.artifacts/metadata-sources');fs.mkdirSync(output,{recursive:true});
const archive=process.argv.find(value=>value.startsWith('--app-asar='))?.slice('--app-asar='.length),source=archive?path.resolve(archive):root;
if(archive){app.setAppPath(source);Object.defineProperty(app,'isPackaged',{value:true});require('electron-updater').autoUpdater.checkForUpdates=async()=>null;}
const profile=fs.mkdtempSync(path.join(output,'profile-'));app.setPath('userData',profile);
BrowserWindow.prototype.show=function(){};BrowserWindow.prototype.showInactive=function(){};
const network=require(path.join(source,'src/main/addons/network'));let downloads=0;
network.fetchText=async(url,options)=>{
    assert.equal(String(url),'https://images.example.com/cover.png');assert.deepEqual(options.headers,{});downloads++;
    const response=Readable.from([fs.readFileSync(path.join(root,'resources/app.png'))]);response.statusCode=200;response.headers={'content-type':'image/png'};return response;
};
const {createAddonStore}=require(path.join(source,'src/main/addons/store'));
const store=createAddonStore({directory:path.join(profile,'addons'),appVersion:'1.4.0'});
const installed=(async()=>{
    const pkg={format:'noctune-addon',formatVersion:1,manifest:{id:'metadata-source-demo',name:'Metadata source',description:'Local track metadata fixture',author:'Noctune tests',version:'1.0.0',revision:1,apiVersion:1,minNoctuneVersion:'1.4.0',type:'extension',entry:'main.js',permissions:['artwork.provide','lyrics.provide','network.request'],commands:[],network:{origins:['https://images.example.com'],routes:[{origin:'https://images.example.com',path:'/cover.png',methods:['GET']}]}},files:{'main.js':`NoctuneAddon.define(async api=>{
        const check=track=>{if('filePath' in track||'path' in track)throw Error('Private path leaked');};
        await api.artwork.provide({id:'covers',resolve:track=>{check(track);return {status:'found',url:'https://images.example.com/cover.png'};}});
        await api.lyrics.provide({id:'words',resolve:track=>{check(track);return {status:'found',lines:[{time:0,text:'Extension lyrics for '+track.title}],plain:'Extension lyrics for '+track.title};}});
    });`}};
    await store.confirm((await store.preparePackage(pkg)).ticket);await store.setEnabled(pkg.manifest.id,true);
})();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.on('browser-window-created',(_,win)=>win.webContents.on('did-finish-load',async()=>{
    if(!win.webContents.getURL().endsWith('/renderer/index.html'))return;
    const run=code=>win.webContents.executeJavaScript(code);
    const wait=async(code,label)=>{for(let i=0;i<150;i++){if(await run(code))return;await delay(100);}throw Error(label);};
    try{
        await installed;await run('addonHost.refresh()');await wait(`addonHost.state('metadata-source-demo')?.status==='running'`,'Worker activation');
        await run(`window.lastfmEnabled=false;setLyricsTrack({title:'Local song',artist:'Artist',album:'Album',duration:180,filePath:'C:/private/local.mp3'},1);document.getElementById('btn-lyrics').click()`);
        await wait(`document.getElementById('player-cover-img').src.startsWith('data:image/png;base64,')`,'extension cover with Last.fm disabled');
        await wait(`addonLyrics.read().plain==='Extension lyrics for Local song'`,'extension lyrics before LRCLIB');assert.equal(downloads,1);
        assert.equal(await run(`document.getElementById('lyrics-source').textContent`),'Тексты: Metadata source');
        await fs.promises.writeFile(path.join(output,'local-metadata.png'),(await win.webContents.capturePage()).toPNG());
        await run(`noctune.addons.setEnabled('metadata-source-demo',false).then(()=>addonHost.refresh())`);
        await wait(`!addonContributions.hasArtwork('metadata-source-demo')&&addonLyrics.artwork()===''`,'source disposal clears cover');
        console.log('PASS: Worker artwork/lyrics sources for local tracks, public image broker without catalog permission, metadata privacy, Last.fm independence and disable cleanup.');app.exit(0);
    }catch(error){console.error(error);app.exit(1);}
}));
installed.catch(error=>{console.error(error);app.exit(1);});require(path.join(source,'src/main/index.js'));
setTimeout(()=>{console.error('Metadata source probe timeout');app.exit(1);},45000);
