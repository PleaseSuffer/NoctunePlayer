const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const p=require('../../src/main/addons/package');
const {publishPreviews}=require('../../scripts/publish-previews.cjs');
(async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'noctune-preview-publish-')),root=path.join(temp,'project');
 try{
  const key=crypto.generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'}),keyFile=path.join(temp,'publisher.pem');
  const seed=p.sign({format:'noctune-previews',formatVersion:1,revision:1,entries:[]},key);
  const identity=p.signingIdentity(seed,true),trustedPublisher=id=>id===identity?'Noctune':null;
  const dir=path.join(root,'addons/previews/test-theme/1.0.0'),file=path.join(root,'addons/catalog/previews.json');
  await fs.mkdir(dir,{recursive:true});await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(keyFile,key);
  await fs.writeFile(file,p.canonical(seed));
  await fs.writeFile(path.join(root,'addons/catalog/marketplace.json'),JSON.stringify({entries:[{id:'test-theme',version:'1.0.0',kind:'theme',channel:'community'}]}));
  await fs.writeFile(path.join(dir,'preview.webm'),Buffer.from('1a45dfa301020304','hex'));
  await fs.writeFile(path.join(dir,'metadata.json'),JSON.stringify({width:960,height:540,duration:4}));
  const options={root,keyFile,trustedPublisher};
  await publishPreviews(options);assert.equal(JSON.parse(await fs.readFile(file)).revision,2);
  await publishPreviews({...options,revision:10});const released=await fs.readFile(file,'utf8');
  const value=JSON.parse(released);assert.equal(value.revision,10);assert.equal(p.signingIdentity(value,true),identity);
  await publishPreviews(options);assert.equal(await fs.readFile(file,'utf8'),released,'unchanged preview publication is idempotent');
  for(const revision of [10,9,0,NaN,1.5])await assert.rejects(publishPreviews({...options,revision}),/revision/);
  assert.equal(await fs.readFile(file,'utf8'),released,'invalid revision cannot change published index');
  await fs.writeFile(path.join(dir,'preview.webm'),Buffer.from('1a45dfa309080706','hex'));
  await assert.rejects(publishPreviews({...options,revision:11}),/immutable/);
  assert.equal(await fs.readFile(file,'utf8'),released,'explicit revisions do not allow replacement of published videos');
  console.log('PASS: signed preview publication, explicit recovery revisions, idempotence, rollback rejection and immutable video content.');
 }finally{await fs.rm(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
