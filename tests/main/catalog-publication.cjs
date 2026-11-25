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
  const fetch=async(url,options)=>{assert(files.has(url),'unexpected publication URL');const remaining=options.deadline-Date.now();if(/\.noct(?:addon|heme)$/.test(url)){assert(remaining>110000&&remaining<=120000,'package downloads have a bounded two-minute deadline');}else{assert(remaining>50000&&remaining<=60000,'catalogs allow a bounded minute for embedded previews');}const bytes=await fs.readFile(files.get(url),'utf8');assert(Buffer.byteLength(bytes)<=options.limit);requested.add(url);return bytes;};
  const store=createAddonStore({directory:path.join(root,'addons'),appVersion:'1.4.1'});
  const themeStore=createSceneThemeStore({directory:()=>path.join(root,'themes'),builtinDirectory:path.join(root,'absent'),presetsDirectory:path.resolve('themes/backgrounds'),sdkFile:path.resolve('src/renderer/effects/scene-sdk.js')});
  const a=official.createAddonCatalog({directory:root,appVersion:'1.4.1',store,fetch});
  const b=marketplace.createMarketplaceCatalog({directory:root,appVersion:'1.4.1',store,themeStore,fetch});
  for(const catalog of [a,b]){
   const list=await catalog.list(true);assert.equal(list.source,'network');assert(!list.message);
   for(const entry of list.entries){assert(entry.compatible);assert(!entry.description.startsWith('extension.'));const candidate=await catalog.prepare(entry.id,entry.kind,entry.channel);if(candidate.ticket)store.discard(candidate.ticket);else assert(candidate.theme);}
  }
  assert.deepEqual(requested,new Set(files.keys()),'both signed catalogs and every referenced package are fetched and validated');
  const community=(await b.list()).entries.filter(entry=>entry.kind==='theme'&&entry.channel==='community');
  const sourceDirectory=path.resolve('themes/community');
  const sourceThemes=(await fs.readdir(sourceDirectory,{withFileTypes:true})).filter(item=>item.isDirectory()&&!item.isSymbolicLink()).map(item=>item.name).sort((a,b)=>a.localeCompare(b));
  const order=JSON.parse(await fs.readFile(path.join(sourceDirectory,'order.json'),'utf8'));
  assert.equal(new Set(order).size,order.length,'community order contains no duplicates');
  assert(order.every(id=>sourceThemes.includes(id)),'community order references existing source themes');
  const publishedIds=new Set(community.map(entry=>entry.id));
  assert(community.every(entry=>sourceThemes.includes(entry.id)),'every published community theme has sources');
  const expectedOrder=[...order,...sourceThemes.filter(id=>!order.includes(id))].filter(id=>publishedIds.has(id));
  assert.deepEqual(community.map(entry=>entry.id),expectedOrder,'published themes match source folders and configured community order');
  assert(community.every(entry=>entry.publisher===null),'community themes do not claim an official publisher');
  for(const entry of (await b.list()).entries.filter(entry=>entry.channel==='community')){
   const parent=entry.kind==='theme'?'themes/community':'addons/community';
   const manifest=JSON.parse(await fs.readFile(path.join(parent,entry.id,'manifest.json'),'utf8'));
   assert.equal(entry.id,manifest.id);assert.equal(entry.author,manifest.author,'published author matches source');
   assert.equal(entry.version,manifest.version,'published version matches source');
  }
  assert((await a.list()).entries.every(entry=>entry.author==='Noctune'&&entry.channel===undefined));
  console.log('PASS: publication URLs, signed network snapshots, localized cards, community theme order and all referenced package hashes/metadata/install previews.');
 }finally{await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
