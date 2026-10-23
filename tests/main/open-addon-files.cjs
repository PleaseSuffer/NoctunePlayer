const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{pathToFileURL}=require('node:url');
const {addonFilesFromArgv,createAddonOpenQueue}=require('../../src/main/open-addon-files');
(async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'noctune-addon-open-'));
  try{
    const file=path.join(directory,'Расширение #1.NOCTADDON'),bad=path.join(directory,'broken.noctaddon');
    await fs.writeFile(file,'{}');await fs.writeFile(bad,'{}');await fs.mkdir(path.join(directory,'folder.noctaddon'));
    assert.deepEqual(addonFilesFromArgv(['Noctune',file,pathToFileURL(file).href,bad,'https://example.com/a.noctaddon','missing.noctaddon','folder.noctaddon','song.mp3'],{cwd:directory}),[file,bad]);
    assert.deepEqual(addonFilesFromArgv(['electron','project.noctaddon',file],{defaultApp:true}),[file]);
    const opened=[],errors=[],focused=[];let finish;
    const queue=createAddonOpenQueue(async file=>{opened.push(file);if(file===bad)throw Error('Broken package');await new Promise(resolve=>{finish=resolve;});},error=>errors.push(error.message),file=>focused.push(file));
    queue.enqueue([file,file,bad]);await queue.whenIdle();assert.equal(opened.length,0);
    queue.setReady(true);await Promise.resolve();assert.deepEqual(opened,[file]);queue.enqueue([file]);assert.deepEqual(focused,[file]);
    finish();await queue.whenIdle();assert.deepEqual(opened,[file,bad]);assert.deepEqual(errors,['Broken package']);
    queue.setReady(false);queue.enqueue([file]);assert.equal(opened.length,2);queue.setReady(true);await Promise.resolve();finish();await queue.whenIdle();assert.equal(opened.length,3,'warm reopening is allowed after closing a preview');
  }finally{await fs.rm(directory,{recursive:true,force:true});}
  console.log('PASS: addon file paths/URIs, cold readiness, duplicate focus, serialized previews, errors and warm reopening.');
})().catch(error=>{console.error(error);process.exitCode=1;});
