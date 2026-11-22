const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const p = require('./package');
const themes = require('../scene-themes');
const { compareThemeVersions } = require('../theme-versions');
const { artwork, CATALOG_FIELDS } = require('./catalog');
const { fetchText, httpsUrl } = require('./network');
const publisher = require('../../shared/addon-publishers');
const URL = 'https://raw.githubusercontent.com/PleaseSuffer/NoctunePlayer/main/addons/catalog/marketplace.json';
const LIMIT = 4 * 1024 * 1024;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const key = entry => entry.kind + ':' + entry.id;
function packagePath(entry) {
  const extension = entry.kind === 'theme' ? 'noctheme' : 'noctaddon';
  return `addons/distribution/${entry.id}/${entry.version}/${entry.id}-${entry.version}.${extension}`;
}
function validateCatalog(value, trustedPublisher = publisher, bundled = false) {
  p.keys(value, ['format','formatVersion','revision','generatedAt','entries','signature']);
  if (Buffer.byteLength(JSON.stringify(value)) > LIMIT || value.format !== 'noctune-marketplace' || value.formatVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 1 || !Number.isFinite(Date.parse(value.generatedAt)) || !Array.isArray(value.entries) || value.entries.length > 128) throw new Error('Некорректный каталог магазина');
  // An unsigned seed is trusted only as part of the shipped application. Remote
  // changes still require the pinned publisher signature; there is no trust-on-first-use.
  const signer = p.signingIdentity(value, !bundled) || p.signingIdentity(require('../../../addons/catalog/official.json'),true);
  if (trustedPublisher(signer) !== 'Noctune') throw new Error('Каталог не подписан доверенным издателем Noctune');
  const ids = new Set();
  for (const entry of value.entries) {
    p.keys(entry, ['kind','channel',...CATALOG_FIELDS,'publisher','sha256','packageUrl','artwork','apiVersion']);
    const validId = entry.kind === 'theme' ? typeof entry.id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(entry.id) : p.id(entry.id);
    if (!['theme','extension'].includes(entry.kind) || !['official','community'].includes(entry.channel) || !validId || !p.version(entry.version) || ids.has(key(entry)) || !p.version(entry.minNoctuneVersion) || entry.maxNoctuneVersion !== undefined && (!p.version(entry.maxNoctuneVersion) || p.compareVersions(entry.maxNoctuneVersion,entry.minNoctuneVersion)<0)) throw new Error('Некорректная карточка магазина');
    ids.add(key(entry));
    for (const field of ['name','description','author']) if (typeof entry[field] !== 'string' || !entry[field].trim() || entry[field].length > (field === 'description' ? 1200 : 120)) throw new Error('Некорректное описание');
    if (!/^[a-f0-9]{64}$/.test(entry.sha256) || entry.publisher !== null && !/^[a-f0-9]{64}$/.test(entry.publisher) || entry.channel === 'official' && (value.signature ? entry.publisher !== signer : trustedPublisher(entry.publisher) !== 'Noctune')) throw new Error('Некорректный издатель');
    if (entry.kind === 'theme') {
      if (![1,2].includes(entry.apiVersion) || entry.type !== 'theme' || entry.revision !== undefined || entry.permissions !== undefined) throw new Error('Некорректная тема');
    } else if (!['extension','integration'].includes(entry.type) || !Number.isSafeInteger(entry.revision) || entry.revision < 1 || !Array.isArray(entry.permissions) || entry.permissions.some(permission=>!p.PERMISSIONS.includes(permission)) || new Set(entry.permissions).size !== entry.permissions.length) throw new Error('Некорректное расширение');
    const url = httpsUrl(entry.packageUrl);
    if (url.href !== entry.packageUrl || url.search || url.hash || !['https://raw.githubusercontent.com/PleaseSuffer/NoctunePlayer/main/'+packagePath(entry)].includes(url.href)) throw new Error('Некорректный адрес пакета');
    if (entry.homepage !== undefined) httpsUrl(entry.homepage);
    artwork(entry.artwork);
  }
  return value;
}
function createMarketplaceCatalog({ directory, appVersion, store, themeStore, fetch = fetchText, builtin = require('../../../addons/catalog/marketplace.json'), trustedPublisher = publisher }) {
  let snapshot = validateCatalog(builtin,trustedPublisher,true), source = 'builtin', initialized, pending, lastAttempt = 0, message = '';
  const file = () => path.join(typeof directory === 'function' ? directory() : directory,'catalog-marketplace.json');
  const validate = value => validateCatalog(value,trustedPublisher,p.canonical(value)===p.canonical(builtin));
  function accept(next) {
    if (next.revision < snapshot.revision || next.revision === snapshot.revision && p.canonical(next) !== p.canonical(snapshot)) throw new Error('Устаревший каталог');
    for (const entry of next.entries) {
      const old = snapshot.entries.find(item=>key(item)===key(entry));
      if (!old) continue;
      const comparison = p.compareVersions(entry.version,old.version);
      if (comparison < 0 || entry.revision < old.revision || comparison === 0 && (entry.sha256 !== old.sha256 || entry.publisher !== old.publisher || entry.channel !== old.channel)) throw new Error('Опубликованный пакет изменён');
    }
    return next;
  }
  async function initialize() {
    if (!initialized) initialized = (async()=>{try { if ((await fs.stat(file())).size > LIMIT) return; snapshot = accept(validate(JSON.parse(await fs.readFile(file(),'utf8')))); source = 'cache'; } catch (_) { /* Keep the trusted bundled snapshot. */ }})();
    await initialized;
  }
  async function update(force = false) {
    if (pending) return pending;
    if (!force && Date.now()-lastAttempt < 5000) return;
    lastAttempt = Date.now();
    pending = (async()=>{
      try {
        const next = accept(validate(JSON.parse(await fetch(URL,{limit:LIMIT,deadline:Date.now()+60000,headers:{'Cache-Control':'no-cache'}}))));
        await fs.mkdir(path.dirname(file()),{recursive:true});
        const temp = file()+'.'+crypto.randomUUID()+'.tmp';
        try { await fs.writeFile(temp,p.canonical(next),{mode:0o600}); await fs.rename(temp,file()); } finally { await fs.rm(temp,{force:true}); }
        snapshot = next; source = 'network'; message = '';
      } catch (error) { message = globalThis.noctuneI18n?.t('extensions.catalog.couldNotVerifyTheGithubCatalogShowingASavedCopy') ?? 'Не удалось проверить каталог GitHub. Показана сохранённая копия.'; message += ' '+String(error.message).replace(/https?:\/\/\S+/g,'GitHub').slice(0,240); }
    })().finally(()=>{pending=null;});
    return pending;
  }
  return {
    async checkUpdate(id) {
      await initialize(); await update();
      const entry = snapshot.entries.find(item=>item.kind==='extension' && item.id===id);
      if (!entry) return null;
      const current = (await store.list()).find(item=>item.id===id);
      if (!current) throw new Error('Расширение не установлено');
      if (message) return {state:'unavailable',message};
      if (current.publisher!==entry.publisher) throw new Error('Другой издатель расширения');
      if (!p.compatible(entry,appVersion)) return {state:'incompatible',message:globalThis.noctuneI18n?.t('extensions.catalog.updateRequiresAnotherNoctuneVersion') ?? 'Обновление требует другой версии Noctune'};
      if (entry.revision<=(current.maxRevision||current.revision)) return {state:'current',message:globalThis.noctuneI18n?.t('extensions.catalog.noNewerRevisions') ?? 'Новых ревизий нет'};
      return this.prepare(id,'extension',entry.channel);
    },
    async list(refresh = false) {
      if (typeof refresh !== 'boolean') throw new Error('Некорректный запрос');
      await initialize(); if (refresh) await update(true);
      const [addons, installedThemes] = await Promise.all([store.list(),themeStore.list()]);
      return { source, message, generatedAt:snapshot.generatedAt, entries:snapshot.entries.map(entry=>{
        const current = entry.kind === 'theme' ? installedThemes.themes.find(theme=>theme.packageId===entry.id) : addons.find(addon=>addon.id===entry.id);
        const state = current ? entry.kind === 'theme' ? compareThemeVersions(entry.version,current.version)>0 ? 'update':'installed' : current.publisher !== entry.publisher ? 'conflict' : entry.revision > (current.maxRevision||current.revision) ? 'update':'installed' : 'install';
        const {packageUrl,sha256,...metadata} = entry;
        return {...metadata,artwork:artwork(entry.artwork),compatible:p.compatible(entry,appVersion),published:true,state,enabled:current?.enabled===true};
      }) };
    },
    async prepare(id, kind, channel) {
      await initialize(); await update();
      const entry = snapshot.entries.find(item=>item.id===id && item.kind===kind && (channel===undefined || item.channel===channel));
      if (!entry || !p.compatible(entry,appVersion)) throw new Error('Пакет недоступен для этой версии Noctune');
      const bytes = await fetch(entry.packageUrl,{limit:kind==='theme'?themes.MAX_BYTES:p.MAX_BYTES,deadline:Date.now()+120000});
      if (digest(bytes)!==entry.sha256) throw new Error('Контрольная сумма пакета не совпадает с каталогом');
      if (kind === 'theme') {
        const theme = themes.validatePackage(JSON.parse(bytes));
        if (theme.apiVersion!==entry.apiVersion || ['id','version','name','description','author'].some(field=>theme.manifest[field]!==entry[field])) throw new Error('Тема не соответствует карточке');
        return { theme };
      }
      const pkg = p.validatePackage(JSON.parse(bytes));
      if (p.signingIdentity(pkg)!==entry.publisher || CATALOG_FIELDS.some(field=>p.canonical(pkg.manifest[field])!==p.canonical(entry[field]))) throw new Error('Расширение не соответствует карточке');
      return store.preparePackage(pkg, entry.publisher === null && entry.channel === 'community' ? 'community-catalog' : 'catalog');
    },
  };
}
module.exports = { createMarketplaceCatalog, validateCatalog, packagePath, CATALOG_URL:URL };
