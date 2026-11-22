const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const p = require('../src/main/addons/package');
const themes = require('../src/main/scene-themes');
const publisher = require('../src/shared/addon-publishers');
const { CATALOG_FIELDS } = require('../src/main/addons/catalog');
const { validateCatalog, packagePath } = require('../src/main/addons/marketplace');

async function publishMarketplace({root=path.resolve(__dirname,'..'),privateKey,thumbnail,trustedPublisher=publisher}) {
  const identity = privateKey ? p.signingIdentity(p.sign({},privateKey),true) : p.signingIdentity(require('../addons/catalog/official.json'),true);
  if (trustedPublisher(identity)!=='Noctune') throw new Error('Нужен существующий ключ издателя Noctune');
  const file = path.join(root,'addons/catalog/marketplace.json');
  let previous;
  try { previous=validateCatalog(JSON.parse(await fs.readFile(file,'utf8')),trustedPublisher,true); }
  catch(error) { if(error.code!=='ENOENT')throw error; }
  const entries=[],packages=[];
  // Sources are explicitly separated by provenance. Local experiments are never scanned.
  for (const [relative,kind,channel] of [['themes/official','theme','official'],['themes/community','theme','community'],['addons/community','extension','community']]) {
    let directories;try{directories=await fs.readdir(path.join(root,relative),{withFileTypes:true});}catch(error){if(error.code==='ENOENT')continue;throw error;}
    let order=[];
    if(relative==='themes/community'){
      try{order=JSON.parse(await fs.readFile(path.join(root,relative,'order.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
      if(!Array.isArray(order)||order.length>128||new Set(order).size!==order.length||order.some(id=>typeof id!=='string'||!directories.some(item=>item.isDirectory()&&item.name===id)))throw new Error('Некорректный порядок пользовательских тем');
    }
    const rank=name=>order.includes(name)?order.indexOf(name):order.length;
    for(const directory of directories.sort((a,b)=>rank(a.name)-rank(b.name)||a.name.localeCompare(b.name))){
      if(!directory.isDirectory() || directory.isSymbolicLink())continue;
      const source=path.join(root,relative,directory.name);
      let pkg=await (kind==='theme'?themes.packDirectory(source):p.packDirectory(source));
      const m=pkg.manifest;
      if(m.id!==directory.name)throw new Error('Имя каталога должно совпадать с ID: '+directory.name);
      if(kind==='extension' && Object.keys(pkg.files).some(name=>/(^|\/)AGENTS(?:\.override)?\.md$/i.test(name)))throw new Error('Локальные инструкции не должны входить в пакет');
      if(kind==='extension'){
        // A contributor may supply an author-signed release in distribution.
        // Preserve it only when its unsigned payload exactly reproduces the source.
        try{
          const released=p.validatePackage(JSON.parse(await fs.readFile(path.join(root,packagePath({kind,id:m.id,version:m.version})),'utf8')));
          const {signature,...payload}=released;
          if(signature && p.canonical(payload)===p.canonical(pkg)){p.signingIdentity(released,true);pkg=released;}
        }catch(error){if(error.code!=='ENOENT')throw error;}
      }
      const bytes=p.canonical(pkg),sha256=crypto.createHash('sha256').update(bytes).digest('hex');
      const metadata=kind==='theme'?{id:m.id,name:m.name,description:m.description,author:m.author,version:m.version,type:'theme',apiVersion:pkg.apiVersion,minNoctuneVersion:'1.4.1'}:Object.fromEntries(CATALOG_FIELDS.filter(field=>m[field]!==undefined).map(field=>[field,m[field]]));
      const entry={...metadata,kind,channel,publisher:channel==='official'?identity:kind==='extension'?p.signingIdentity(pkg):null,sha256,artwork:{}};
      const old=previous?.entries.find(item=>item.id===m.id&&item.kind===kind);
      if(old && (p.compareVersions(m.version,old.version)<0 || old.sha256!==sha256 && (p.compareVersions(m.version,old.version)<=0 || kind==='extension' && m.revision<=old.revision)))throw new Error('Увеличьте версию изменённого пакета: '+m.id);
      entry.packageUrl='https://raw.githubusercontent.com/PleaseSuffer/NoctunePlayer/main/'+packagePath(entry);
      if(kind==='theme')entry.artwork.banner={mime:'image/png',data:await thumbnail(Buffer.from(pkg.assets[m.preview].slice(22),'base64'),640)};
      else for(const type of ['icon','banner'])if(m[type])entry.artwork[type]={mime:'image/png',data:await thumbnail(Buffer.from(pkg.files[m[type]].data,'base64'),type==='icon'?128:640)};
      entries.push(entry);packages.push({output:path.join(root,packagePath(entry)),bytes});
    }
  }
  if(new Set(entries.map(entry=>entry.kind+':'+entry.id)).size!==entries.length)throw new Error('Повторный ID в каталоге');
  if(previous?.entries.some(old=>!entries.some(entry=>entry.kind===old.kind&&entry.id===old.id)))throw new Error('Удаление пакета из каталога требует отдельного решения; исходники отсутствуют');
  const changed=!previous||p.canonical(entries)!==p.canonical(previous.entries);
  if(changed&&previous?.signature&&!privateKey)throw new Error('Изменение подписанного каталога требует существующий ключ Noctune');
  const payload={format:'noctune-marketplace',formatVersion:1,revision:(previous?.revision||0)+1,generatedAt:new Date().toISOString(),entries};
  const next=changed ? privateKey ? p.sign(payload,privateKey) : payload : privateKey && !previous.signature ? p.sign({...previous,revision:previous.revision+1},privateKey) : previous;
  validateCatalog(next,trustedPublisher,!privateKey);
  // Check every destination before writing any package.
  for(const item of packages){try{if(await fs.readFile(item.output,'utf8')!==item.bytes)throw new Error('Опубликованный пакет неизменяем: '+item.output);}catch(error){if(error.code!=='ENOENT')throw error;}}
  for(const item of packages){await fs.mkdir(path.dirname(item.output),{recursive:true});try{await fs.writeFile(item.output,item.bytes,{flag:'wx'});}catch(error){if(error.code!=='EEXIST'||await fs.readFile(item.output,'utf8')!==item.bytes)throw error;}}
  if(changed || next!==previous){await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+crypto.randomUUID()+'.tmp';try{await fs.writeFile(temp,p.canonical(next)+'\n');await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true});}}
  return {revision:next.revision,packages:packages.length,changed};
}
module.exports={publishMarketplace};
if(require.main===module || process.versions.electron && process.type==='browser' && path.resolve(process.argv[1]||'')===__filename){
  const {app,nativeImage}=require('electron');
  app.whenReady().then(async()=>{
    const [keyFile,...extra]=process.argv.slice(2);
    if(!keyFile||extra.length)throw new Error('Запуск: electron scripts/publish-marketplace.cjs /путь/вне/репозитория/private.pem (или --prepare для встроенного снимка)');
    const root=path.resolve(__dirname,'..'),relative=path.relative(root,path.resolve(keyFile));
    if(keyFile!=='--prepare' && !relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative))throw new Error('Закрытый ключ должен находиться вне репозитория');
    const result=await publishMarketplace({root,...(keyFile==='--prepare'?{}:{privateKey:await fs.readFile(keyFile,'utf8')}),thumbnail:async(bytes,width)=>{const image=nativeImage.createFromBuffer(bytes);if(image.isEmpty())throw new Error('Не удалось прочитать превью');return image.resize({width,quality:'best'}).toPNG().toString('base64');}});
    console.log(`Пакетов: ${result.packages}. Ревизия: ${result.revision}${result.changed?'':' (без изменений)'}.`);
  }).then(()=>app.exit(0)).catch(error=>{console.error(error.message);app.exit(1);});
}
