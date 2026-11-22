const {trySymlink}=require('../helpers/symlink.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{Readable}=require('node:stream');
const {createAddonDownloads,filename}=require('../../src/main/addons/downloads');
const {validate,normalize}=require('../../src/shared/addon-settings');
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'noctune-export-')),directory=path.join(root,'addons'),custom=path.join(root,'custom');await fs.mkdir(custom);
 let active=true,network=true,location='app',mode='ok',release,content=null,mime=null;const bytes=Buffer.concat([Buffer.from('ID3'),Buffer.alloc(5*1024*1024,17)]);
 const store={context:async(id,hash,permission)=>{if(!active||id!=='test-addon'||hash!=='hash'||permission!=='downloads.write')throw Error('Denied');return {manifest:{name:'Test',settings:{folder:{type:'directory'}}},grants:['downloads.write',...(network?['network.request']:[])]};},settings:async()=>({folder:location})};
 const broker=createAddonDownloads({store,directory,downloadsPath:()=>path.join(root,'Downloads'),getWindow:()=>null,shell:{openPath:async()=>''},dialog:{showOpenDialog:async()=>({canceled:false,filePaths:[custom]})},resource:async(id,hash,pkg,input)=>{assert.deepEqual(Object.keys(input),['url']);if(input.url!=='https://cdn.example/test.mp3')throw Error('Denied domain');return {url:input.url,headers:{}};},fetch:async()=>{
   if(mode==='blocked')await new Promise(resolve=>release=resolve);
   const data=content||(mode==='invalid'?Buffer.from('<html>no</html>'):bytes);
   const response=Readable.from([data.subarray(0,1),data.subarray(1,2),data.subarray(2)]);response.statusCode=200;response.headers={'content-type':mime||(mode==='html'?'text/html':'audio/mpeg'),'content-length':String(data.length+(mode==='short'?1:0))};return response;
 }});
 const invoke=(method,args)=>broker.invoke('test-addon','hash','downloads.'+method,args),start=(name='Artist — Song.mp3')=>invoke('start',{url:'https://cdn.example/test.mp3',filename:name,folder:'folder'});
 async function done(job){for(let i=0;i<500;i++){const current=await invoke('status',{id:job.id});if(current.state!=='running')return current;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('Job timeout');}
 try{
   validate({folder:{type:'directory',label:'Folder',default:'app'}});assert.throws(()=>normalize({folder:{type:'directory',default:'app'}},{folder:'/tmp'}));
   assert.equal(filename('../../CON.mp3'),'_.._CON.mp3');assert.equal(filename('CON.mp3'),'_CON.mp3');assert.throws(()=>filename('file.exe'));
   const folder=(await invoke('folder',{setting:'folder'})).path;
   assert.equal((await done(await start())).state,'completed');assert.deepEqual(await fs.readFile(path.join(folder,'Artist — Song.mp3')),bytes);
   assert.equal((await done(await start())).name,'Artist — Song (1).mp3');
   network=false;
   const text='[00:01.00]Текст песни 🎵\n';
   const lyrics=await done(await invoke('start',{data:text,filename:'Song.lrc',folder:'folder'}));assert.equal(lyrics.state,'completed');assert.equal(await fs.readFile(path.join(folder,'Song.lrc'),'utf8'),text);
   await assert.rejects(start(),/сети/);
   await assert.rejects(invoke('start',{data:'x'.repeat(48*1024+1),filename:'large.txt',folder:'folder'}));
   await assert.rejects(invoke('start',{data:'text',filename:'cover.png',folder:'folder'}));
   await assert.rejects(invoke('start',{url:'https://cdn.example/test.mp3',data:'text',filename:'song.txt',folder:'folder'}));
   assert.equal((await done(await invoke('start',{data:'bad\0text',filename:'invalid.txt',folder:'folder'}))).state,'failed');
   network=true;
   content=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7K0AAAAASUVORK5CYII=','base64');mime='image/png';
   const cover=await done(await start('cover.PNG'));assert.equal(cover.state,'completed');assert.deepEqual(await fs.readFile(path.join(folder,'cover.png')),content);
   assert.equal((await done(await start('wrong.mp3'))).state,'failed','MIME must match filename');
   content=Buffer.from(text);mime='text/plain; charset=utf-8';assert.equal((await done(await start('remote.lrc'))).state,'completed');
   content=Buffer.from([0xff,0xfe]);assert.equal((await done(await start('bad-encoding.txt'))).state,'failed');content=null;mime=null;
   const linked=await trySymlink(path.join(folder,'Artist — Song.mp3'),path.join(folder,'linked.mp3'));
   if(!linked)await fs.writeFile(path.join(folder,'linked.mp3'),'existing');
   assert.equal((await done(await start('linked.mp3'))).name,'linked (1).mp3');
   assert.deepEqual(await fs.readFile(path.join(folder,'linked.mp3')),linked?bytes:Buffer.from('existing'));
   for(const failure of ['html','invalid','short']){mode=failure;assert.equal((await done(await start('bad.mp3'))).state,'failed');await assert.rejects(fs.access(path.join(folder,'bad.mp3')));}
   mode='ok';location='custom';await assert.rejects(start(),/Выберите папку/);await invoke('folder',{setting:'folder',action:'choose'});
   assert.equal((await done(await start())).state,'completed');assert.deepEqual(await fs.readFile(path.join(custom,'Artist — Song.mp3')),bytes);
   await fs.rename(custom,custom+'-old');await fs.mkdir(custom);await assert.rejects(start(),/изменилась/);
   await invoke('folder',{setting:'folder',action:'choose'});mode='blocked';const one=await start('cancel.mp3');while(!release)await new Promise(resolve=>setTimeout(resolve,1));await invoke('cancel',{id:one.id});release();assert.equal((await done(one)).state,'canceled');
   release=null;const two=await start('revoke.mp3');while(!release)await new Promise(resolve=>setTimeout(resolve,1));active=false;release();await new Promise(resolve=>setTimeout(resolve,50));await assert.rejects(fs.access(path.join(custom,'revoke.mp3')));
   for(let i=0;i<200&&(await fs.readdir(custom)).some(name=>name.endsWith('.part'));i++)await new Promise(resolve=>setTimeout(resolve,10));
   assert(!(await fs.readdir(custom)).some(name=>name.endsWith('.part')));
   await assert.rejects(invoke('status',{id:two.id}),/Denied/);
   console.log('PASS: >4 MiB MP3, cover and UTF-8 exports, inline text without network access, split headers, filenames, no overwrite/symlinks, MIME/body/truncation rejection, directory consent/identity, cancellation, revocation and cleanup.');
 }finally{broker.cancel('test-addon');await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
