const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const shared=require('../../src/shared/addon-contributions');
const attributes=new Map([['data-theme','dark']]),css=new Map(),storage=new Map(),events=[];
const style={setProperty:(key,value)=>css.set(key,value),getPropertyValue:key=>css.get(key)||'',removeProperty:key=>css.delete(key)};
const controls=new Map([['setting-dark-theme',{}],['theme-toggle',{replaceChildren(){}}]]);
const systemMedia={matches:false,addEventListener(){}};
const context={URL,AddonContributions:shared,Event:class{constructor(type){this.type=type;}},matchMedia:()=>systemMedia,getComputedStyle:()=>({getPropertyValue:key=>css.get(key)||''}),
    document:{body:{style,getAttribute:key=>attributes.get(key),setAttribute:(key,value)=>attributes.set(key,value),removeAttribute:key=>attributes.delete(key)},documentElement:{style},head:{append(){}},createElement:()=>({remove(){}}),getElementById:key=>controls.get(key),addEventListener(){},dispatchEvent(){}},
    appStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    backgroundSettings:{refreshAccent(){}},addonEvents:{emit:(type,args)=>events.push({type,...args})},addonLyrics:{read:()=>({status:'missing',lines:[],plain:''})},
};
controls.get('setting-dark-theme').addEventListener=()=>{};controls.get('theme-toggle').addEventListener=()=>{};
context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync('src/renderer/addons/contributions.js','utf8'),context);
const api=context.addonContributions;
(async()=>{
    const call=(owner,method,args={})=>api.invoke(owner,'hash',method,args,{});
    await call('first','appearance.register',{id:'graphite',name:'Gray',mode:'dark',palette:{background:'#202020',surface:'#303030',text:'#eeeeee'}});
    await call('first','appearance.switch',{id:'graphite'});assert.equal((await call('first','appearance.read')).palette.background,'#202020');
    await call('second','appearance.palette',{palette:{background:'#880000',text:'#ffffff'}});
    await call('first','appearance.persist');api.cleanup('second');assert.equal((await call('first','appearance.read')).palette.background,'#202020','persist excludes another owner’s temporary colors');
    await assert.rejects(call('first','appearance.palette',{palette:{background:'#888888',text:'#888888'}}),/читаемость/);
    await assert.rejects(call('first','appearance.register',{id:'broken',name:'Bad',mode:'gray',palette:{}}));
    await assert.rejects(call('second','appearance.switch',{id:'graphite'}),/установлена/);
    await call('first','appearance.palette',{palette:{background:'#002244',text:'#ffffff'}});api.cleanup('first');assert.equal((await call('first','appearance.read')).palette.background,'#202020');
    let revision='1',writes=0,pending;
    const grants=new Set(['servicePlaylists.read','servicePlaylists.rename']);
    await api.invoke('service','hash','catalog.register',{id:'library',providerId:'audio-provider',accountId:'account-1',name:'Account',capabilities:['browse','read','rename','delete']},{grants,call:async(action,args)=>{
        assert.equal(args.accountId,'account-1','account scope cannot be overridden');
        if(action==='browse')return {items:[{id:'playlist',title:'Playlist',type:'playlist',addonId:'forged'}]};
        if(action==='read')return {id:'playlist',name:'Test',revision,tracks:[]};
        writes++;if(pending)await pending;revision=String(Number(revision)+1);return {revision};
    }});
    const scope=(action,args={})=>api.invoke('service','hash','servicePlaylists.'+action,{catalog:'library',...args},{});
    assert.equal((await api.invoke('service','','catalog.browse',{catalog:'library'},{})).items[0].addonId,'service');
    await assert.rejects(api.invoke('other','','catalog.browse',{catalog:'library'},{}),/выключен/);
    await scope('read',{id:'playlist'});
    const args={id:'playlist',revision:'1',name:'New',requestId:'operation-0001',accountId:'forged'};
    assert.equal((await scope('rename',args)).revision,'2');assert.equal((await scope('rename',args)).revision,'2');assert.equal(writes,1,'retry returns original receipt before checking old revision');
    await assert.rejects(scope('rename',{...args,name:'Different'}),/requestId/);
    await assert.rejects(scope('rename',{...args,requestId:'operation-0002'}),/REVISION_CONFLICT/);
    await assert.rejects(scope('delete',{id:'playlist',revision:'2',requestId:'operation-0003'}),/разрешена/);
    let finish;pending=new Promise(resolve=>{finish=resolve;});
    const mutation=scope('rename',{id:'playlist',revision:'2',name:'Pending',requestId:'operation-0004'});await Promise.resolve();
    await assert.rejects(scope('rename',{id:'playlist',revision:'2',name:'Concurrent',requestId:'operation-0005'}),/выполняется/);
    api.cleanup('service');finish();await assert.rejects(mutation,/остановлен/);
    await api.invoke('text','','lyrics.provide',{id:'lyrics-source'},{call:async()=>({status:'found',lines:[{time:0,text:'Safe text <b>'}],plain:''})});
    assert.equal((await api.lyrics({title:'Track'})).lines[0].text,'Safe text <b>');api.cleanup('text');assert.equal(await api.lyrics({}),null);
    await api.invoke('keys','','hotkeys.register',{command:'show-state'},{manifest:{name:'Demo',commands:[{id:'show-state',title:'Show state'}]}});assert.equal(api.hotkeys()[0].id,'addon:keys:show-state');api.cleanup('keys');assert.equal(api.hotkeys().length,0);
    let committed=false,remoteChanges=0;
    await api.invoke('retry','','catalog.register',{id:'retry-library',providerId:'audio-provider',accountId:'account-2',name:'Retry',capabilities:['read','rename']},{grants:new Set(['servicePlaylists.read','servicePlaylists.rename']),call:async(action)=>{
        if(action==='read')return {id:'playlist',name:'Test',revision:'1',tracks:[]};
        if(!committed){committed=true;remoteChanges++;throw new Error('NETWORK: reply lost after server commit');}
        return {revision:'2'}; // A real adapter looks up the same requestId on the server.
    }});
    await api.invoke('retry','','servicePlaylists.read',{catalog:'retry-library',id:'playlist'},{});
    const retryArgs={catalog:'retry-library',id:'playlist',revision:'1',name:'Retry',requestId:'retry-after-timeout'};
    await assert.rejects(api.invoke('retry','','servicePlaylists.rename',retryArgs,{}),/NETWORK/);
    assert.equal((await api.invoke('retry','','servicePlaylists.rename',retryArgs,{})).revision,'2');assert.equal(remoteChanges,1);api.cleanup('retry');
    let removedCatalog=null,lastRead;
    context.addonProviders={has:()=>true,removeCatalog:(owner,id)=>{removedCatalog=[owner,id];}};
    const track={id:'track',entryId:'batch-1-track',title:'Title',type:'track',duration:180,album:'Album',canonicalId:'stable-track',artwork:'https://images.example.com/cover.jpg'};
    await api.invoke('media','digest','catalog.register',{id:'media-library',providerId:'audio-provider',accountId:'account-3',name:'Library',capabilities:['browse','search','read']},{manifest:{ui:{integrations:{title:'Library'}}},grants:new Set(['providers.play','servicePlaylists.read']),call:async(action,args)=>{
        if(action==='read'){lastRead=args;return {id:'wave',name:'Wave',revision:'batch-1',tracks:[track],continuous:true,total:20,cursor:'next',artwork:track.artwork};}
        return {items:[{...track,title:action==='search'?args.query:track.title}],cursor:null};
    }});
    const metadata=api.catalogs().find(item=>item.owner==='media');assert.equal(metadata.integration,true);assert.equal(metadata.hash,'digest');assert.equal(metadata.playable,true);
    const found=await api.invoke('media','','catalog.search',{catalog:'media-library',query:'Search title'},{});
    assert.equal(found.items[0].title,'Search title');assert.equal(found.items[0].duration,180);assert.equal(found.items[0].artwork,track.artwork);assert.equal(found.items[0].canonicalId,'stable-track');
    await assert.rejects(api.invoke('media','','catalog.search',{catalog:'media-library',query:''},{}));
    const wave=await api.invoke('media','','servicePlaylists.read',{catalog:'media-library',id:'wave',after:'opaque-current',reason:'continue'},{});
    assert.equal(wave.continuous,true);assert.equal(wave.total,20);assert.equal(wave.tracks[0].album,'Album');assert.equal(lastRead.after,'opaque-current');
    await assert.rejects(api.invoke('media','','servicePlaylists.read',{catalog:'media-library',id:'wave',after:42},{}));
    track.artwork='file:///private.jpg';await assert.rejects(api.invoke('media','','catalog.browse',{catalog:'media-library'},{}),/HTTPS/);
    await api.invoke('media','','catalog.unregister',{id:'media-library'},{});assert.deepEqual(removedCatalog,['media','media-library']);assert(!api.catalogs().some(item=>item.owner==='media'));
    let currentSession='old-track',decode;
    context.addonEvents.snapshot=()=>({sessionId:currentSession});context.addonLyrics.artwork=()=> 'data:image/png;base64,AA==';
    context.Image=class{decode(){return new Promise(resolve=>{decode=resolve;});}};
    const oldArtwork=call('cover','artwork.read',{sessionId:'old-track'});await Promise.resolve();currentSession='new-track';decode();await assert.rejects(oldArtwork,/Сеанс/);
    await assert.rejects(call('cover','appearance.mode',{sessionId:'old-track',mode:'light'}),/Сеанс/);
    await call('provider','appearance.register',{id:'public-gray',name:'Public gray',mode:'dark',palette:{background:'#282828',text:'#eeeeee'}});
    const listed=await call('scheduler','appearance.list');assert(listed.some(item=>item.id==='scheme:provider:public-gray'));
    await call('scheduler','appearance.select',{id:'scheme:provider:public-gray'});assert.equal((await call('scheduler','appearance.read')).palette.background,'#282828');
    await assert.rejects(call('scheduler','appearance.switch',{id:'public-gray'}),/установлена/);
    api.cleanup('provider');assert.equal((await call('scheduler','appearance.read')).palette.background,'#202020','source removal also releases dependent layers');
    await call('scheduler','appearance.select',{id:'light'});assert.equal((await call('scheduler','appearance.read')).palette.background,'#f4f7f6');
    await call('scheduler','appearance.select',{id:null});assert.equal((await call('scheduler','appearance.read')).palette.background,'#202020');
    await call('scheduler','appearance.select',{id:'system'});assert.equal((await call('scheduler','appearance.read')).palette.background,'#f4f7f6');systemMedia.matches=true;assert.equal((await call('scheduler','appearance.read')).palette.background,'#121212','system selection updates its palette when the OS changes');api.cleanup('scheduler');
    console.log('PASS: owned appearance layers/persistence, readable palettes, scoped catalogs, permissions/revisions, idempotent requests, concurrent writes, disposal, lyric sources and hotkey cleanup.');
})().catch(error=>{console.error(error);process.exitCode=1;});
