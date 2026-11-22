const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const p=require('../../src/main/addons/package');
const {createMarketplaceCatalog,validateCatalog,packagePath,CATALOG_URL}=require('../../src/main/addons/marketplace');
const {createAddonStore}=require('../../src/main/addons/store');
const {createSceneThemeStore,packDirectory}=require('../../src/main/scene-themes');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'noctune-marketplace-'));
 try{
  const key=crypto.generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'}),sign=value=>p.sign(value,key),identity=p.signingIdentity(sign({}),true),trustedPublisher=id=>id===identity?'Noctune':null;
  const theme=await packDirectory('themes/examples/api-v2');theme.manifest.id='02-night-hill';theme.manifest.version='1.0.0';
  const addon=await p.packDirectory('addons/examples/track-info');
  const bodies=new Map();
  const entry=(pkg,kind,channel)=>{
   const m=pkg.manifest,bytes=p.canonical(pkg);
   const metadata=kind==='theme'?{id:m.id,name:m.name,description:m.description,author:m.author,version:m.version,minNoctuneVersion:'1.4.1',type:'theme',apiVersion:2}:Object.fromEntries(require('../../src/main/addons/catalog').CATALOG_FIELDS.filter(field=>m[field]!==undefined).map(field=>[field,m[field]]));
   const item={...metadata,kind,channel,publisher:channel==='official'?identity:null,sha256:digest(bytes),artwork:{}};
   item.packageUrl='https://raw.githubusercontent.com/PleaseSuffer/NoctunePlayer/main/'+packagePath(item);bodies.set(item.packageUrl,bytes);return item;
  };
  const builtin=sign({format:'noctune-marketplace',formatVersion:1,revision:1,generatedAt:new Date().toISOString(),entries:[entry(theme,'theme','official'),entry(addon,'extension','community')]});
  assert.equal(validateCatalog(builtin,trustedPublisher).entries.length,2);
  for(const mutate of [v=>v.entries.push(v.entries[0]),v=>v.entries[0].apiVersion=99,v=>v.entries[0].packageUrl='https://evil.example/a.noctheme',v=>v.entries[0].publisher=null,v=>v.entries[1].permissions=['unknown.*'],v=>v.entries[1].id='../escape']){
   const invalid=structuredClone(builtin);mutate(invalid);assert.throws(()=>validateCatalog(sign(invalid),trustedPublisher));
  }
  const tampered=structuredClone(builtin);tampered.entries[0].name+='!';assert.throws(()=>validateCatalog(tampered,trustedPublisher));
  assert.throws(()=>validateCatalog({...builtin,signature:undefined},trustedPublisher));
  // The shipped seed is trusted by application integrity. Modified unsigned network
  // catalogs are never accepted, even when they claim a newer revision.
  const seed=require('../../addons/catalog/marketplace.json');
  validateCatalog(seed,undefined,true);
  const store=createAddonStore({directory:path.join(root,'addons'),appVersion:'1.4.1'});
  const themeStore=createSceneThemeStore({directory:()=>path.join(root,'themes'),builtinDirectory:path.join(root,'absent'),sdkFile:path.resolve('src/renderer/effects/scene-sdk.js'),presetsDirectory:path.resolve('themes/backgrounds')});
  assert.equal((await themeStore.list()).themes.length,0,'no scene assets are required in the app');
  let remote=builtin,offline=false,corrupt=false;
  const fetch=async url=>{if(offline)throw Error('Offline');if(url===CATALOG_URL)return p.canonical(remote);return bodies.get(url)+(corrupt?'!':'');};
  const catalog=createMarketplaceCatalog({directory:path.join(root,'cache'),appVersion:'1.4.1',store,themeStore,builtin,trustedPublisher,fetch});
  let listed=await catalog.list(true);assert.deepEqual(listed.entries.map(e=>[e.kind,e.channel,e.state]),[['theme','official','install'],['extension','community','install']]);
  assert(!Object.hasOwn(listed.entries[0],'packageUrl'));assert(!Object.hasOwn(listed.entries[0],'sha256'));
  await assert.rejects(catalog.prepare(theme.manifest.id,'theme','community'),/недоступен/);
  const candidate=await catalog.prepare(theme.manifest.id,'theme','official');
  const installed=await themeStore.installPackage(candidate.theme);assert.equal(installed.action,'install');
  assert.equal((await themeStore.read('builtin-night-hill')).manifest.id,theme.manifest.id,'old selection aliases resolve to downloaded packages');
  assert.equal((await catalog.list()).entries[0].state,'installed');
  // Unsigned community packages keep their existing unsigned identity.
  const first=await store.preparePackage(addon);await store.confirm(first.ticket);
  const preview=await catalog.prepare(addon.manifest.id,'extension','community');assert.equal(preview.signed,false);assert.equal(preview.state,'installed');store.discard(preview.ticket);
  await assert.rejects(store.preparePackage(addon,'url'),/подписан/,'URL installs still require a package signature');
  corrupt=true;await assert.rejects(catalog.prepare(theme.manifest.id,'theme'),/сумма/);corrupt=false;
  remote={...builtin,revision:2,signature:undefined};listed=await catalog.list(true);assert(listed.message);assert.equal(listed.source,'network');
  remote=sign({...builtin,revision:2,entries:builtin.entries.map((e,i)=>i?e:{...e,sha256:'a'.repeat(64)})});listed=await catalog.list(true);assert(listed.message,'immutable versions cannot change even with a valid catalog signature');
  remote=sign({...builtin,revision:2});await catalog.list(true);
  remote=builtin;assert((await catalog.list(true)).message,'catalog revision rollback is rejected');
  const newer=structuredClone(addon);newer.manifest.version='1.0.1';newer.manifest.revision=addon.manifest.revision+1;
  newer.manifest.permissions.push('clipboard.write');
  remote=sign({...builtin,revision:3,entries:[builtin.entries[0],entry(newer,'extension','community')]});await catalog.list(true);
  const update=await catalog.checkUpdate(addon.manifest.id);assert(update.ticket);assert(update.addedPermissions.includes('clipboard.write'));
  assert.equal((await store.list())[0].version,addon.manifest.version,'update checks do not install without consent');
  await store.confirm(update.ticket);assert.equal((await catalog.checkUpdate(addon.manifest.id)).state,'current');
  offline=true;
  const cached=createMarketplaceCatalog({directory:path.join(root,'cache'),appVersion:'1.4.1',store,themeStore,builtin,trustedPublisher,fetch});assert.equal((await cached.list(true)).source,'cache');
  const boot=createMarketplaceCatalog({directory:path.join(root,'bootstrap'),appVersion:'1.4.1',store,themeStore,builtin:seed,fetch:async()=>p.canonical({...seed,revision:seed.revision+1})});assert((await boot.list(true)).message,'an unsigned seed does not authorize unsigned remote updates');
  console.log('PASS: theme/community catalogs, provenance, signatures, pinned bootstrap, immutable versions, rollback/cache, package hashes, unsigned identity compatibility and legacy scene selection aliases.');
 }finally{await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
