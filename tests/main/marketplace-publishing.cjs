const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const p=require('../../src/main/addons/package');
const {publishMarketplace}=require('../../scripts/publish-marketplace.cjs');
const {validateCatalog,packagePath}=require('../../src/main/addons/marketplace');
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'noctune-marketplace-publish-'));
 try{
  const key=crypto.generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'}),identity=p.signingIdentity(p.sign({},key),true),trustedPublisher=id=>id===identity?'Noctune':null;
  const authorKey=crypto.generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'});
  const addon=p.sign(await p.packDirectory('addons/examples/track-info'),authorKey),author=p.signingIdentity(addon,true);
  const themeManifest=JSON.parse(await fs.readFile('themes/examples/api-v2/manifest.json','utf8'));
  const themeSource=path.join(root,'themes/official',themeManifest.id),addonSource=path.join(root,'addons/community',addon.manifest.id);
  await fs.cp('themes/examples/api-v2',themeSource,{recursive:true});await fs.cp('addons/examples/track-info',addonSource,{recursive:true});
  const releaseFile=path.join(root,packagePath({kind:'extension',id:addon.manifest.id,version:addon.manifest.version}));
  await fs.mkdir(path.dirname(releaseFile),{recursive:true});await fs.writeFile(releaseFile,p.canonical(addon));
  const png=(await require('../../src/main/scene-themes').packDirectory('themes/examples/api-v2')).assets[themeManifest.preview].slice(22);
  const options={root,privateKey:key,trustedPublisher,thumbnail:async()=>png};
  let result=await publishMarketplace(options);assert.equal(result.packages,2);assert.equal(result.revision,1);
  const file=path.join(root,'addons/catalog/marketplace.json'),first=await fs.readFile(file,'utf8'),catalog=validateCatalog(JSON.parse(first),trustedPublisher);
  const community=catalog.entries.find(e=>e.kind==='extension');assert.equal(community.channel,'community');assert.equal(community.publisher,author,'preserves the author identity of a reproducible signed release');assert.equal(await fs.readFile(releaseFile,'utf8'),p.canonical(addon));
  result=await publishMarketplace(options);assert.equal(result.changed,false);assert.equal(await fs.readFile(file,'utf8'),first,'unchanged publication is idempotent');
  const manifestFile=path.join(themeSource,'manifest.json');themeManifest.description+=' updated';await fs.writeFile(manifestFile,JSON.stringify(themeManifest));
  await assert.rejects(publishMarketplace(options),/версию/);assert.equal(await fs.readFile(file,'utf8'),first,'failed publication never replaces the catalog');
  themeManifest.version='2.0.0';await fs.writeFile(manifestFile,JSON.stringify(themeManifest));
  result=await publishMarketplace(options);assert.equal(result.revision,2);
  await fs.rename(addonSource,path.join(root,'removed-source'));
  await assert.rejects(publishMarketplace(options),/исходники отсутствуют/,'missing source cannot silently remove a published entry');
  console.log('PASS: marketplace source discovery, author signature preservation, trusted catalog signing, idempotence, immutable versions, versioned updates and missing-source rejection.');
 }finally{await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
