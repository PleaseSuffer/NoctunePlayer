const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {Readable}=require('node:stream');
const {createAddonDownloads}=require('../../src/main/addons/downloads');
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'noctune-download-tags-'));assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));
 const frame=Buffer.alloc(417);Buffer.from('fffb9000','hex').copy(frame);const audio=Buffer.concat(Array(50).fill(frame));
 let active=true,bytes=audio,requests=0;
 const store={context:async()=>{if(!active)throw Error('Revoked');return {manifest:{name:'Test',settings:{folder:{type:'directory'}}},grants:['downloads.write','network.request']};},settings:async()=>({folder:'app'})};
 const broker=createAddonDownloads({store,directory:path.join(root,'addons'),downloadsPath:()=>root,resource:async()=>({url:'https://example.com/audio'}),fetch:async()=>{requests++;const response=Readable.from([bytes]);response.statusCode=200;response.headers={'content-type':'audio/mpeg','content-length':String(bytes.length)};return response;}});
 const invoke=(method,args)=>broker.invoke('test','hash','downloads.'+method,args);
 const start=(filename,metadata)=>invoke('start',{url:'https://example.com/audio',filename,folder:'folder',metadata});
 const done=async job=>{for(let i=0;i<1000;i++){const s=await invoke('status',{id:job.id});if(s.state!=='running')return s;await new Promise(r=>setTimeout(r,5));}throw Error('Timeout');};
 try{
  const folder=(await invoke('folder',{setting:'folder'})).path;
  const metadata={title:'Ночь 🎵',artist:'Первый; Second',album:'Альбом',albumArtist:'Various Artists',genre:'Electronic',year:2026,track:3,trackCount:10,disc:1,discCount:2,comment:'Сохранено локально'};
  const result=await done(await start('tagged.mp3',metadata));assert.equal(result.state,'completed',result.error);
  const tagged=await fs.readFile(path.join(folder,result.name));assert(tagged.includes(audio),'MPEG frames remain unchanged');
  const {parseBuffer}=await import('music-metadata');const parsed=await parseBuffer(tagged,{mimeType:'audio/mpeg'});
  assert.equal(parsed.common.title,metadata.title);assert.deepEqual(parsed.common.artists,['Первый','Second']);assert.equal(parsed.common.album,metadata.album);assert.equal(parsed.common.albumartist,metadata.albumArtist);assert.equal(parsed.common.year,2026);assert.equal(parsed.common.track.no,3);assert.equal(parsed.common.track.of,10);assert.equal(parsed.common.disk.of,2);assert.deepEqual(parsed.common.genre,['Electronic']);
  bytes=tagged;assert.equal((await done(await start('preserved.mp3',{title:'New title'}))).state,'completed');
  const preserved=await parseBuffer(await fs.readFile(path.join(folder,'preserved.mp3')),{mimeType:'audio/mpeg'});
  assert.equal(preserved.common.album,metadata.album);assert.equal(preserved.common.comment[0].text,metadata.comment,'unspecified tags preserved');
  const before=requests;
  for(const bad of [{unknown:'x'},{title:7},{title:'bad\0text'},{year:-1},{track:65536},[],null])await assert.rejects(start('invalid.mp3',bad));
  await assert.rejects(start('image.png',{title:'No'}));assert.equal(requests,before,'metadata validation precedes network access');
  bytes=Buffer.from('ID3not-an-mp3');assert.equal((await done(await start('broken.mp3',{title:'Bad'}))).state,'failed');await assert.rejects(fs.access(path.join(folder,'broken.mp3')));
  bytes=audio;const canceled=await start('canceled.mp3',{title:'Cancel'});
  for(let i=0;i<1000;i++){const s=await invoke('status',{id:canceled.id});if(s.phase==='tagging')break;assert.equal(s.state,'running');await new Promise(r=>setTimeout(r,1));}
  await invoke('cancel',{id:canceled.id});assert.equal((await done(canceled)).state,'canceled');await assert.rejects(fs.access(path.join(folder,'canceled.mp3')));
  for(let i=0;i<200&&(await fs.readdir(folder)).some(n=>n.startsWith('.noctune-'));i++)await new Promise(r=>setTimeout(r,5));
  assert(!(await fs.readdir(folder)).some(n=>n.startsWith('.noctune-')),'temporary tag/download files removed');
  console.log('PASS MP3 download tags: Unicode, multiple artists, album/year/genre/disc/track, preserved tags and audio frames, invalid input, failure and tagging cancellation.');
 }finally{broker.cancel('test');await fs.rm(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
