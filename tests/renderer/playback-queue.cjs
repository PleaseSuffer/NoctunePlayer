const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let serial=0;
function setup() {
 const listeners=[];
 const c={crypto:{randomUUID:()=>`id-${++serial}`},fileEntries:[],playlistOrder:[],parsedMetadataCache:{},currentIndex:-1,currentPlaylistId:'a',activePlaylistId:'a',isShuffle:false,shuffleList:[],repeatMode:0,_loadToken:1,externalAudioQueue:[],played:[],userPlaylists:[{id:'a',name:'Original',type:'folder',files:['a.wav','b.wav','c.wav','d.wav']},{id:'b',name:'Other',type:'folder',files:['x.wav','y.wav']}],
 addonEvents:{on:fn=>listeners.push(fn),emit:type=>listeners.forEach(fn=>fn({type}))},validatedAudioPaths:async paths=>paths,createShuffleOrder:(length,current)=>[current,...Array.from({length},(_,i)=>i).filter(i=>i!==current).reverse()]};
 c.window=c;c.selectPlaylist=async id=>{c.currentPlaylistId=id;const p=c.userPlaylists.find(p=>p.id===id);c.fileEntries=p.files.map(path=>({kind:'file',path,name:path}));c.playlistOrder=c.fileEntries.map((_,i)=>i);c.parsedMetadataCache={};c.currentIndex=-1;};
 c.playTrack=async index=>{c.currentIndex=index;c.activePlaylistId=c.currentPlaylistId;c._loadToken++;const entry=c.fileEntries[c.playlistOrder[index]];c.playbackQueue.trackSelected(entry,index);c.played.push(entry.path)};
 c.playQueuedAudioFile=async(token,options={})=>{if(!options.bypassTimeline)return c.playbackQueue.advance(token,options);const next=c.externalAudioQueue.shift();c.addonEvents.emit('queue.changed');if(!next)return false;if(c.currentPlaylistId!==next.playlistId)await c.selectPlaylist(next.playlistId);await c.playTrack(c.playlistOrder.findIndex(i=>c.fileEntries[i].path===next.path));return true;};
 vm.createContext(c);vm.runInContext(fs.readFileSync('src/renderer/playback/queue-model.js','utf8'),c);return c;
}
const paths=c=>Array.from(c.playbackQueue.view(),e=>e.path);
(async()=>{
 let c=setup();await c.selectPlaylist('a');await c.playTrack(0);
 assert.deepEqual(paths(c),['b.wav','c.wav','d.wav'],'playing a playlist populates the timeline without manual additions');
 c.playbackQueue.move(c.playbackQueue.view()[2].queueId,0);await c.playQueuedAudioFile(c._loadToken);
 assert.equal(c.played.at(-1),'d.wav');assert.deepEqual(paths(c),['b.wav','c.wav']);
 c.repeatMode=1;c.addonEvents.emit('playback.repeat');assert.deepEqual(paths(c),['b.wav','c.wav'],'repeat does not discard queue edits');c.repeatMode=0;c.addonEvents.emit('playback.repeat');
 c.playbackQueue.remove(c.playbackQueue.view()[0].queueId);await c.playQueuedAudioFile(c._loadToken);assert.equal(c.played.at(-1),'c.wav');assert.equal(c.playbackQueue.nextIndex(),-1,'removed/skipped tracks do not return as fallback');
 c=setup();await c.selectPlaylist('a');await c.playTrack(0);await c.selectPlaylist('b');
 assert.deepEqual(paths(c),['b.wav','c.wav','d.wav'],'browsing keeps the playing playlist');
 c.externalAudioQueue.push({queueId:'manual',playlistId:'b',kind:'file',path:'x.wav'});
 assert.deepEqual(paths(c),['x.wav','b.wav','c.wav','d.wav']);
 c.playbackQueue.move('manual',2);assert.deepEqual(paths(c),['b.wav','c.wav','x.wav','d.wav']);
 await c.playQueuedAudioFile(c._loadToken);await c.playQueuedAudioFile(c._loadToken);await c.playQueuedAudioFile(c._loadToken);await c.playQueuedAudioFile(c._loadToken);
 assert.deepEqual(c.played,['a.wav','b.wav','c.wav','x.wav','d.wav'],'manual additions resume the edited source playlist across playlists');
 c=setup();await c.selectPlaylist('a');await c.playTrack(0);assert.equal(await c.playQueuedAudioFile(c._loadToken,{automatic:false}),false);
 c.externalAudioQueue.push({queueId:'manual',playlistId:'a',kind:'file',path:'d.wav'});assert.equal(await c.playQueuedAudioFile(c._loadToken,{automatic:false}),true,'explicit additions still work with autonext off');
 assert.deepEqual(paths(c),['b.wav','c.wav','d.wav']);
 c.playbackQueue.clear();assert.deepEqual(paths(c),[]);assert.equal(c.playbackQueue.nextIndex(),-1);
 c=setup();await c.selectPlaylist('a');c.isShuffle=true;c.shuffleList=[0,3,1,2];await c.playTrack(0);assert.deepEqual(paths(c),['d.wav','b.wav','c.wav'],'the existing shuffle order is used');
 c.isShuffle=false;c.addonEvents.emit('playback.shuffle');assert.deepEqual(paths(c),['b.wav','c.wav','d.wav']);
 c.repeatMode=2;c.addonEvents.emit('playback.repeat');assert.deepEqual(paths(c),['b.wav','c.wav','d.wav','a.wav']);
 for(let i=0;i<4;i++)await c.playQueuedAudioFile(c._loadToken);assert.deepEqual(paths(c),['b.wav','c.wav','d.wav','a.wav'],'playlist repeat starts another bounded cycle');
 c.playbackQueue.clear();assert.deepEqual(paths(c),[],'clear does not regenerate a repeated playlist');
 c=setup();await c.selectPlaylist('a');await c.playTrack(0);let release;c.validatedAudioPaths=()=>new Promise(r=>release=r);
 const pending=c.playQueuedAudioFile(c._loadToken);c.playbackQueue.clear();release(['b.wav']);assert.equal(await pending,false);assert.deepEqual(c.played,['a.wav'],'clearing during validation cannot start a removed track');
 c=setup();await c.selectPlaylist('a');await c.playTrack(0);c.userPlaylists[0].files.push('e.wav');c.fileEntries.push({kind:'file',path:'e.wav',name:'e.wav'});c.playlistOrder.push(4);assert.deepEqual(paths(c),['b.wav','c.wav','d.wav','e.wav'],'new provider/library pages extend the timeline');
 for(const service of [{continuous:true},{cursor:'next-page'}]) {
  c=setup();c.userPlaylists[0].service=service;c.repeatMode=2;await c.selectPlaylist('a');await c.playTrack(0);
  assert.deepEqual(paths(c),['b.wav','c.wav','d.wav'],'expandable services must not enqueue a wrap to the first track');
  for(let i=0;i<3;i++)await c.playQueuedAudioFile(c._loadToken);
  assert.deepEqual(paths(c),[],'last loaded service track waits for continuation instead of repeating');
  c.userPlaylists[0].files.push('e.wav');c.fileEntries.push({kind:'file',path:'e.wav',name:'e.wav'});c.playlistOrder.push(4);
  assert.deepEqual(paths(c),['e.wav'],'late continuation is the immediate next track');
  c.addonEvents.emit('playback.repeat');assert.deepEqual(paths(c),['e.wav'],'repeat changes cannot insert old service tracks before continuation');
  await c.playQueuedAudioFile(c._loadToken);assert.equal(c.played.at(-1),'e.wav');
  assert.deepEqual(paths(c),[]);
 }
 c=setup();c.userPlaylists[0].service={continuous:true};c.repeatMode=2;c.isShuffle=true;
 await c.selectPlaylist('a');c.shuffleList=[0,3,1,2];await c.playTrack(0);
 assert.deepEqual(paths(c),['d.wav','b.wav','c.wav'],'shuffle on a continuous service has no wrapped tracks');
 c.addonEvents.emit('playback.shuffle');assert.deepEqual(paths(c),['d.wav','b.wav','c.wav']);
 c.userPlaylists[0].service={cursor:null,continuous:false};await c.playTrack(3);
 assert(paths(c).length>0,'fully loaded finite service playlists retain playlist repeat');
 console.log('PASS playlist timeline: populate, edits, playback, cross-playlist continuation, browsing, autonext, shuffle, repeat, clear, validation cancellation and appended service pages');
})().catch(e=>{console.error(e);process.exitCode=1});
