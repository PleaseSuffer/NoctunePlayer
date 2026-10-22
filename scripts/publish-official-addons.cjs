const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const p = require('../src/main/addons/package');
const { validateCatalog, CATALOG_FIELDS } = require('../src/main/addons/catalog');
const publisher = require('../src/shared/addon-publishers');

async function publishOfficialAddons({ root = path.resolve(__dirname, '..'), privateKey, thumbnail, trustedPublisher = publisher }) {
    const fingerprint = p.signingIdentity(p.sign({},privateKey),true);
    if (trustedPublisher(fingerprint) !== 'Noctune') throw new Error('Нужен существующий ключ издателя Noctune');
    const catalogFile = path.join(root,'addons/catalog/official.json');
    const previous = validateCatalog(JSON.parse(await fs.readFile(catalogFile,'utf8')),trustedPublisher);
    const entries = [], packages = [], ids = new Set();
    const source = path.join(root,'addons/official');
    for (const directory of (await fs.readdir(source,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
        if (!directory.isDirectory() || directory.isSymbolicLink()) continue;
        try { await fs.access(path.join(source,directory.name,'manifest.json')); }
        catch (error) { if (error.code==='ENOENT') continue; throw error; }
        const pkg = p.sign(await p.packDirectory(path.join(source,directory.name)),privateKey), m=pkg.manifest;
        if (m.id!==directory.name || ids.has(m.id)) throw new Error('Каталог исходников должен совпадать с уникальным ID расширения');
        ids.add(m.id);
        if (Object.keys(pkg.files).some(file=>/(^|\/)AGENTS(?:\.override)?\.md$/i.test(file))) throw new Error('Локальные инструкции не должны входить в пакет');
        const bytes = p.canonical(pkg), sha256=crypto.createHash('sha256').update(bytes).digest('hex');
        const old = previous.entries.find(entry=>entry.id===m.id);
        if (old && (m.revision<old.revision || p.compareVersions(m.version,old.version)<0 || (sha256!==old.sha256 && (m.revision<=old.revision || p.compareVersions(m.version,old.version)<=0)))) throw new Error('Увеличьте версию и ревизию изменённого расширения: '+m.id);
        const relative = `addons/distribution/${m.id}/${m.version}/${m.id}-${m.version}.noctaddon`;
        const output = path.join(root,relative);
        try { if (await fs.readFile(output,'utf8')!==bytes) throw new Error('Опубликованный файл неизменяем: '+relative); }
        catch (error) { if (error.code!=='ENOENT') throw error; }
        const entry = Object.fromEntries(CATALOG_FIELDS.filter(field=>m[field]!==undefined).map(field=>[field,m[field]]));
        Object.assign(entry,{publisher:fingerprint,sha256,published:true,packageUrl:'https://raw.githubusercontent.com/PleaseSuffer/NoctunePlayer/main/'+relative,artwork:{}});
        for (const kind of ['icon','banner']) if (m[kind]) entry.artwork[kind]={mime:'image/png',data:await thumbnail(Buffer.from(pkg.files[m[kind]].data,'base64'),kind==='icon'?128:640)};
        entries.push(entry);packages.push({output,bytes});
    }
    if (!entries.length) throw new Error('Официальные расширения не найдены');
    if (previous.entries.some(entry=>!ids.has(entry.id))) throw new Error('Удаление расширения из каталога требует отдельного решения; исходники отсутствуют');
    const changed = p.canonical(entries)!==p.canonical(previous.entries);
    const next = changed ? p.sign({format:'noctune-addon-catalog',formatVersion:1,channel:'official',revision:previous.revision+1,generatedAt:new Date().toISOString(),entries},privateKey) : previous;
    validateCatalog(next,trustedPublisher);
    for (const {output,bytes} of packages) {
        await fs.mkdir(path.dirname(output),{recursive:true});
        try { await fs.writeFile(output,bytes,{flag:'wx'}); }
        catch (error) { if (error.code!=='EEXIST' || await fs.readFile(output,'utf8')!==bytes) throw error; }
    }
    if (changed) {
        const temporary=catalogFile+'.'+crypto.randomUUID()+'.tmp';
        try { await fs.writeFile(temporary,p.canonical(next)+'\n');await fs.rename(temporary,catalogFile); }
        finally { await fs.rm(temporary,{force:true}); }
    }
    return {revision:next.revision,packages:packages.length,changed};
}
module.exports = {publishOfficialAddons};
if (require.main === module || process.versions.electron && process.type === 'browser' && path.resolve(process.argv[1] || '') === __filename) {
    const {app,nativeImage} = require('electron');
    app.whenReady().then(async()=>{
        const [keyFile,...extra]=process.argv.slice(2);
        if (!keyFile || extra.length) throw new Error('Запуск: electron scripts/publish-official-addons.cjs /путь/вне/репозитория/private.pem');
        const root=path.resolve(__dirname,'..'), relative=path.relative(root,path.resolve(keyFile));
        if (!relative.startsWith('..'+path.sep) && !path.isAbsolute(relative)) throw new Error('Закрытый ключ должен находиться вне репозитория');
        const result=await publishOfficialAddons({root,privateKey:await fs.readFile(keyFile,'utf8'),thumbnail:async(bytes,width)=>{
            const image=nativeImage.createFromBuffer(bytes);if(image.isEmpty())throw new Error('Не удалось прочитать изображение расширения');
            return image.resize({width,quality:'best'}).toPNG().toString('base64');
        }});
        console.log(`Подготовлено пакетов: ${result.packages}. Ревизия каталога: ${result.revision}${result.changed?'':' (без изменений)'}.`);
    }).then(()=>app.exit(0)).catch(error=>{console.error(error.message);app.exit(1);});
}
