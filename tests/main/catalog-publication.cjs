const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createAddonStore}=require('../../src/main/addons/store');
const official=require('../../src/main/addons/catalog'),marketplace=require('../../src/main/addons/marketplace');
const {createSceneThemeStore}=require('../../src/main/scene-themes');
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'noctune-publication-'));
 try{
  const files=new Map([[official.CATALOG_URL,'addons/catalog/official.json'],[marketplace.CATALOG_URL,'addons/catalog/marketplace.json']]);
  for(const catalog of [...files.values()])for(const entry of JSON.parse(await fs.readFile(catalog,'utf8')).entries){
   const prefix='https://raw.githubusercontent.com/PleaseSuffer/NoctunePlayer/main/';assert(entry.packageUrl.startsWith(prefix));
   const file=entry.packageUrl.slice(prefix.length);assert(!file.includes('..'));files.set(entry.packageUrl,file);
  }
  const requested=new Set();
  const fetch=async(url,options)=>{assert(files.has(url),'unexpected publication URL');const bytes=await fs.readFile(files.get(url),'utf8');assert(Buffer.byteLength(bytes)<=options.limit);requested.add(url);return bytes;};
  const store=createAddonStore({directory:path.join(root,'addons'),appVersion:'1.4.1'});
  const themeStore=createSceneThemeStore({directory:()=>path.join(root,'themes'),builtinDirectory:path.join(root,'absent'),presetsDirectory:path.resolve('themes/backgrounds'),sdkFile:path.resolve('src/renderer/effects/scene-sdk.js')});
  const a=official.createAddonCatalog({directory:root,appVersion:'1.4.1',store,fetch});
  const b=marketplace.createMarketplaceCatalog({directory:root,appVersion:'1.4.1',store,themeStore,fetch});
  for(const catalog of [a,b]){
   const list=await catalog.list(true);assert.equal(list.source,'network');assert(!list.message);
   for(const entry of list.entries){assert(entry.compatible);assert(!entry.description.startsWith('extension.'));const candidate=await catalog.prepare(entry.id,entry.kind,entry.channel);if(candidate.ticket)store.discard(candidate.ticket);else assert(candidate.theme);}
  }
  assert.equal(requested.size,10,'both signed catalogs and all eight packages are accessible and valid');
  console.log('PASS: publication URLs, current signed network snapshots, localized cards, compatibility and all eight package hashes/metadata/install previews.');
 }finally{await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
