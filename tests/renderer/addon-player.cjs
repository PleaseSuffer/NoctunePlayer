const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const events = [], handlers = {}, storage = new Map();
let timer;
const audio = { currentTime: 2, duration: 100, playbackRate: 1, paused: false, addEventListener: (name, fn) => { handlers[name] = fn; } };
const context = {
    crypto, performance: { now: () => 1000 }, setInterval: fn => { timer = fn; },
    isPlaying: true, isRadioMode: false, localAudioElement: audio, radioAudioElement: null,
    volumeSlider: { value: '.5' }, userPlaylists: [{ id: 'library', type: 'folder', name: 'Library', files: ['/music/a.mp3','/music/b.mp3'] }],
    fileEntries: [{ path: '/music/a.mp3', kind: 'file' }], currentPlaylistId: 'library', activePlaylistId: 'library',
    backgroundSettings: { accent: (id, color) => storage.set(id, color) },
    externalAudioQueue: [], sceneThemes: { onChange() {} },
    savePlaylistsToStorage() {context.addonEvents.playlistsChanged();}, renderPlaylistsDropdown() {},
};
context.window = context; vm.createContext(context);
vm.runInContext(fs.readFileSync('src/renderer/addons/player-api.js', 'utf8'), context);
(async () => {
    context.addonEvents.on(event => events.push(event));
    const entry = { kind: 'file', path: '/music/a.mp3', name: 'A' };
    context.addonEvents.begin(entry); const first = context.addonEvents.snapshot();
    assert(first.sessionId); assert(first.trackId); assert(!JSON.stringify(first).includes('/music/'));
    context.addonEvents.media(audio); handlers.playing(); timer();
    assert.equal(events.at(-1).type, 'progress.updated'); assert.equal(events.at(-1).position, 2);
    audio.currentTime = 60; handlers.seeking(); assert.equal(events.at(-1).type, 'progress.seek');
    const oldHandler = handlers.playing;
    context.addonEvents.begin({ kind: 'file', path: '/music/b.mp3', name: 'B' }); const count = events.length;
    oldHandler(); assert.equal(events.length, count, 'stale media events ignored');
    await assert.rejects(context.addonPlayer.invoke('addon', 'hash', 'playback.seek', { sessionId: first.sessionId, position: 50 }), /Сеанс/);
    context.addonEvents.begin(entry); assert.equal(context.addonEvents.snapshot().trackId, first.trackId); assert.notEqual(context.addonEvents.snapshot().sessionId, first.sessionId, 'repeat has a fresh session');
    context.addonEvents.emit('queue.changed'); assert.equal(events.at(-1).title, undefined, 'unrelated events do not leak playback data');
    const invoke = (method, args = {}) => context.addonPlayer.invoke('addon', 'hash', method, args);
    const playlists = await invoke('playlists.read'); const tracks = playlists[0].tracks;
    const firstId = await invoke('queue.add', { trackId: tracks[0].trackId });
    const secondId = await invoke('queue.add', { trackId: tracks[1].trackId });
    await assert.rejects(invoke('queue.reorder', { id: firstId, index: 99 })); assert.equal(context.externalAudioQueue.length, 2, 'invalid reorder leaves queue intact');
    await invoke('queue.reorder', { id: secondId, index: 0 }); assert.equal((await invoke('queue.read'))[0].id, secondId);
    await invoke('queue.remove', { id: firstId }); assert.equal(context.externalAudioQueue.length, 1);
    const created=await invoke('playlists.create',{name:'Managed'});
    let local=(await invoke('playlists.read')).find(item=>item.id===created);
    local=await invoke('playlists.addTracks',{id:created,revision:local.revision,tracks:[tracks[0].trackId,tracks[0].trackId,tracks[1].trackId]});
    assert.equal(local.tracks.length,3);assert.notEqual(local.tracks[0].entryId,local.tracks[1].entryId);
    const retained=local.tracks[1].entryId;
    await assert.rejects(invoke('playlists.removeTracks',{id:created,revision:local.revision-1,entries:[local.tracks[0].entryId]}),/REVISION_CONFLICT/);
    local=await invoke('playlists.removeTracks',{id:created,revision:local.revision,entries:[local.tracks[0].entryId]});
    assert.equal(local.tracks[0].entryId,retained,'removal targets one occurrence, preserving the other');
    const order=local.tracks.map(entry=>entry.entryId).reverse();
    local=await invoke('playlists.reorder',{id:created,revision:local.revision,entries:order});assert.equal(local.tracks[1].entryId,retained);
    await assert.rejects(invoke('playlists.rename',{id:created,revision:local.revision-1,name:'Stale'}),/REVISION_CONFLICT/);
    context.userPlaylists.find(item=>item.id===created).files.push('/music/b.mp3');
    await assert.rejects(invoke('playlists.removeTracks',{id:created,revision:local.revision,entries:[retained]}),/REVISION_CONFLICT/,'manual changes invalidate a stale revision');
    assert(events.some(event=>event.type==='playlists.changed'&&event.initiator==='addon'));
    await invoke('themes.accent', { color: '#ff6688' }); assert.equal(storage.get('addon'), '#ff6688');
    await assert.rejects(invoke('themes.accent', { color: 'red; color: red' }));
    await assert.rejects(invoke('themes.accent', {}));
    assert.equal(storage.get('addon'), '#ff6688', 'invalid accent leaves prior layer intact');
    context.addonPlayer.cleanup('addon'); assert.equal(storage.get('addon'), null, 'disposal releases the accent');
    context.addonEvents.stop(); assert.equal(context.addonEvents.snapshot().sessionId, null);
    assert(events.every((event, index) => !index || event.sequence > events[index - 1].sequence));
    const nodes=[],ramps=[],wallpaperCalls=[];
    context.TextEncoder=TextEncoder;
    context.noctune={sceneThemes:{list:async()=>({presets:[{path:'/wallpapers/day.png'}]})},fs:{stat:async()=>({isFile:true})}};
    context.backgroundSettings.list=()=>[{path:'/wallpapers/night.png'}];context.backgroundSettings.override=(id,path)=>wallpaperCalls.push({id,path});
    const backgrounds=await invoke('backgrounds.list');assert.match(backgrounds[0].id,/^background:[a-f0-9]{64}$/);assert(!JSON.stringify(backgrounds).includes('/wallpapers/'));
    assert.equal((await invoke('backgrounds.list'))[0].id,backgrounds[0].id,'wallpaper IDs are deterministic');
    await invoke('backgrounds.override',{id:backgrounds[0].id});assert.equal(wallpaperCalls.at(-1).path,'/wallpapers/night.png');
    context.noctune.fs.stat=async()=>({isFile:false});await assert.rejects(invoke('backgrounds.override',{id:backgrounds[0].id}),/обои/);
    context.noctune.fs.stat=async()=>({isFile:true});context.addonHost={active:()=>false};await assert.rejects(invoke('backgrounds.override',{id:backgrounds[0].id}),/остановлено/);delete context.addonHost;
    context.pannerNode={disconnect(){},connect(){}};context.initAudioEngine=()=>{};
    context.audioCtx={currentTime:10,destination:{},createGain:()=>{const index=nodes.length,node={connect(){},disconnect(){},gain:{value:1,cancelAndHoldAtTime(){},setValueAtTime(value,time){ramps.push({index,value,time});},linearRampToValueAtTime(value,time){ramps.push({index,value,time});}}};nodes.push(node);return node;}};
    await invoke('audio.gain',{gain:0,ramp:20});assert.equal(nodes.length,1);assert.equal(ramps.at(-1).time,30);
    await invoke('audio.gain',{gain:1,ramp:.5});assert.equal(nodes.length,1,'automation reuses the owner’s gain node');
    await assert.rejects(invoke('audio.gain',{gain:2}));await assert.rejects(invoke('audio.gain',{gain:0,ramp:301}));
    await context.addonPlayer.invoke('other','hash','audio.gain',{gain:.5});assert.equal(nodes.length,2);
    await invoke('audio.gain',{gain:null});await context.addonPlayer.invoke('other','hash','audio.gain',{gain:.7});assert.equal(nodes.length,2,'releasing one owner preserves another');
    context.addonPlayer.cleanup('other');
    console.log('PASS: stable opaque track IDs, repeat sessions, stale media/async rejection, seek/progress, event privacy and atomic queue edits.');
})().catch(error => { console.error(error); process.exitCode = 1; });
