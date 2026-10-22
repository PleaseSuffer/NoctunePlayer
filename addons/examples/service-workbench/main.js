NoctuneAddon.define(async api => {
    let settings=await api.settings.get(), serial=2, entrySerial=2;
    api.on('settings.changed',event=>{settings=event.values;});
    const songs=[{id:'song-1',title:'Первый учебный трек',artist:'Noctune'},{id:'song-2',title:'Второй учебный трек',artist:'Noctune'}];
    const playlists=new Map([['playlist-1',{id:'playlist-1',name:'Мой учебный плейлист',revision:'1',tracks:[{...songs[0],entryId:'entry-1'}]}]]), receipts=new Map();
    const copy=value=>JSON.parse(JSON.stringify(value));
    await api.providers.register({id:'demo-audio',name:'Учебный провайдер',resolve:()=>({error:{code:'UNSUPPORTED_TRANSPORT',message:'Учебный каталог не содержит аудиопотоков.'}})});
    const change=(action,args)=>{
        if(receipts.has(args.requestId))return copy(receipts.get(args.requestId));
        let playlist=playlists.get(args.id);
        if(action!=='create'&&(!playlist||playlist.revision!==args.revision))throw new Error('REVISION_CONFLICT');
        if(action==='create'){playlist={id:'playlist-'+serial++,name:args.name,revision:'1',tracks:[]};playlists.set(playlist.id,playlist);}
        else {
            if(action==='rename')playlist.name=args.name;
            if(action==='addTracks')playlist.tracks.push(...args.tracks.map(id=>{const song=songs.find(song=>song.id===id);if(!song)throw new Error('Трек не найден');return {...song,entryId:'entry-'+entrySerial++};}));
            if(action==='removeTracks')playlist.tracks=playlist.tracks.filter(track=>!args.entries.includes(track.entryId));
            if(action==='reorder'){if(args.entries.length!==playlist.tracks.length||new Set(args.entries).size!==playlist.tracks.length||args.entries.some(id=>!playlist.tracks.some(track=>track.entryId===id)))throw new Error('Нужен полный порядок');playlist.tracks=args.entries.map(id=>playlist.tracks.find(track=>track.entryId===id));}
            playlist.revision=String(Number(playlist.revision)+1);
            if(action==='delete')playlists.delete(playlist.id);
        }
        const result={id:playlist.id,revision:playlist.revision,deleted:action==='delete'};receipts.set(args.requestId,result);return copy(result);
    };
    await api.catalog.register({id:'demo-catalog',name:'Учебная медиатека',providerId:'demo-audio',accountId:'demo-account',
        browse:()=>({items:[...songs.map(song=>({...song,type:'track'})),...[...playlists.values()].map(playlist=>({id:playlist.id,type:'playlist',title:playlist.name}))],cursor:null}),
        read:args=>{if(args.id){const playlist=playlists.get(args.id);if(!playlist)throw new Error('Плейлист удалён');return copy(playlist);}return {items:[...playlists.values()].map(({tracks,...playlist})=>copy(playlist)),cursor:null};},
        ...Object.fromEntries(['create','rename','delete','addTracks','removeTracks','reorder'].map(action=>[action,args=>change(action,args)])),
    });
    await api.appearance.register({id:'graphite',name:'Графит · SDK 1',mode:'dark',palette:{background:'#202024',surface:'#2b2b30',text:'#eeeeef',muted:'#b3b3bc',border:'#44444b',hover:'#36363d',accent:'#9da8c7',secondary:'#b4b6cd'}});
    await api.lyrics.provide({id:'demo-lyrics',resolve:()=>settings.demoLyrics?{status:'found',lines:[{time:0,text:settings.note}],plain:settings.note,source:'Мастерская SDK'}:{status:'missing',lines:[],plain:''}});
    api.onCommand('show-state',async()=>{const state=await api.player.current(),appearance=await api.appearance.read(),lyrics=await api.lyrics.read(),artwork=await api.artwork.read();await api.notify(`${settings.label}: ${appearance.effectiveMode}; повтор ${state.repeat}; текст ${lyrics.status}; обложка ${artwork?'есть':'нет'}.`);});
    api.onCommand('apply-gray',()=>api.appearance.switch({id:'graphite'}));
    api.onCommand('release-gray',()=>api.appearance.switch({id:null}));
    await api.hotkeys.register({command:'show-state'});
});
