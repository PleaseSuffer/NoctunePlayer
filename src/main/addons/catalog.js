const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const p = require('./package');
const { fetchText, httpsUrl } = require('./network');
const publisher = require('../../shared/addon-publishers');

const CATALOG_URL = 'https://raw.githubusercontent.com/PleaseSuffer/NoctunePlayer/main/addons/catalog/official.json';
const REPOSITORY_URL = 'https://github.com/PleaseSuffer/NoctunePlayer';
const SUBMISSION_URL = REPOSITORY_URL + '/issues/new?template=extension-submission.yml';
const LIMIT = 4 * 1024 * 1024;
const fields = ['id','name','description','author','type','version','revision','minNoctuneVersion','maxNoctuneVersion','permissions','homepage'];
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = () => { throw new Error('Некорректный каталог расширений'); };

function artwork(value) {
  if (value === undefined) return {};
  p.keys(value, ['icon','banner']);
  const result = {};
  for (const [kind, image] of Object.entries(value)) {
    p.keys(image, ['mime','data']);
    if (!['image/png','image/jpeg','image/webp'].includes(image.mime) || typeof image.data !== 'string' || image.data.length > 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) fail();
    const bytes = Buffer.from(image.data, 'base64');
    if (!bytes.length || bytes.toString('base64') !== image.data) fail();
    const valid = image.mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) : image.mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!valid) fail();
    result[kind] = 'data:' + image.mime + ';base64,' + image.data;
  }
  return result;
}

function validateCatalog(value, trustedPublisher = publisher) {
  p.keys(value, ['format','formatVersion','revision','generatedAt','channel','entries','signature']);
  if (Buffer.byteLength(JSON.stringify(value)) > LIMIT || value.format !== 'noctune-addon-catalog' || value.formatVersion !== 1 || value.channel !== 'official' || !Number.isSafeInteger(value.revision) || value.revision < 1 || typeof value.generatedAt !== 'string' || !Number.isFinite(Date.parse(value.generatedAt)) || !Array.isArray(value.entries) || value.entries.length > 64) fail();
  const identity = p.signingIdentity(value, true);
  if (trustedPublisher(identity) !== 'Noctune') throw new Error('Каталог не подписан доверенным ключом Noctune');
  const ids = new Set();
  for (const entry of value.entries) {
    p.keys(entry, [...fields, 'publisher','sha256','packageUrl','published','artwork']);
    if (!p.id(entry.id) || ids.has(entry.id) || !p.version(entry.version) || !Number.isSafeInteger(entry.revision) || entry.revision < 1 || !p.version(entry.minNoctuneVersion) || (entry.maxNoctuneVersion !== undefined && (!p.version(entry.maxNoctuneVersion) || p.compareVersions(entry.maxNoctuneVersion, entry.minNoctuneVersion) < 0))) fail();
    ids.add(entry.id);
    for (const [field, max] of [['name',120],['description',1000],['author',120]]) if (typeof entry[field] !== 'string' || !entry[field].trim() || entry[field].length > max) fail();
    if (!['extension','integration'].includes(entry.type) || !Array.isArray(entry.permissions) || entry.permissions.some(permission => !p.PERMISSIONS.includes(permission)) || new Set(entry.permissions).size !== entry.permissions.length || typeof entry.published !== 'boolean' || !/^[a-f0-9]{64}$/.test(entry.sha256) || entry.publisher !== identity) fail();
    if (entry.homepage !== undefined) httpsUrl(entry.homepage);
    if (entry.published && !entry.packageUrl) fail();
    if (entry.packageUrl !== undefined) {
      const url = httpsUrl(entry.packageUrl);
      const release = url.origin === 'https://github.com' && /^\/PleaseSuffer\/NoctunePlayer\/releases\/download\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\.noctaddon$/.test(url.pathname);
      const raw = url.origin === 'https://raw.githubusercontent.com' && /^\/PleaseSuffer\/NoctunePlayer\/(main|[a-f0-9]{40})\/addons\/distribution\//.test(url.pathname) && url.pathname.split('/').slice(4).join('/') === 'addons/distribution/'+entry.id+'/'+entry.version+'/'+entry.id+'-'+entry.version+'.noctaddon';
      if ((!release && !raw) || url.href !== entry.packageUrl || url.search || url.hash || /%|\\/.test(url.pathname)) fail();
    }
    artwork(entry.artwork);
  }
  return value;
}

function createAddonCatalog({ directory, appVersion, store, fetch = fetchText, builtin = require('../../../addons/catalog/official.json'), trustedPublisher = publisher }) {
  validateCatalog(builtin, trustedPublisher);
  let snapshot = builtin, source = 'builtin', initialized, pending, lastAttempt = 0, lastResult = { message: '' };
  const root = () => typeof directory === 'function' ? directory() : directory;
  const file = () => path.join(root(), 'catalog-official.json');
  const validate = value => validateCatalog(value, trustedPublisher);
  function initialize() {
    if (!initialized) initialized = (async () => {
      try {
        const info = await fs.stat(file()); if (info.size > LIMIT) return;
        const cached = validate(JSON.parse(await fs.readFile(file(), 'utf8')));
        if (cached.revision > snapshot.revision || cached.revision === snapshot.revision && p.canonical(cached) === p.canonical(snapshot)) { snapshot = cached; source = 'cache'; }
      } catch (_) { /* Invalid cache never replaces the signed bundled catalog. */ }
    })();
    return initialized;
  }
  async function update(force = false) {
    if (pending) return pending;
    if (!force && Date.now() - lastAttempt < 5000) return lastResult;
    lastAttempt = Date.now();
    pending = (async () => {
      try {
        const next = validate(JSON.parse(await fetch(CATALOG_URL, { limit: LIMIT, headers: { 'Cache-Control': 'no-cache' } })));
        for (const entry of next.entries) {
          const old = snapshot.entries.find(item=>item.id===entry.id);
          if (old && (entry.revision < old.revision || p.compareVersions(entry.version,old.version)<0 || entry.revision===old.revision && (entry.sha256!==old.sha256 || p.canonical(fields.map(field=>entry[field]))!==p.canonical(fields.map(field=>old[field]))))) throw new Error('Каталог изменяет опубликованную версию расширения');
        }
        if (next.revision < snapshot.revision || (next.revision === snapshot.revision && p.canonical(next) !== p.canonical(snapshot))) throw new Error('Сервер вернул устаревший каталог');
        await fs.mkdir(root(), { recursive: true });
        const temp = file() + '.' + crypto.randomUUID() + '.tmp';
        try { await fs.writeFile(temp, p.canonical(next), { mode: 0o600 }); await fs.rename(temp, file()); }
        finally { await fs.rm(temp, { force: true }); }
        snapshot = next; source = 'network';
        lastResult = { message: '' };
      } catch (_) { lastResult = { message: 'Не удалось проверить каталог GitHub. Показана сохранённая копия.' }; }
      return lastResult;
    })().finally(() => { pending = null; });
    return pending;
  }
  return {
    async list(refresh = false) {
      if (typeof refresh !== 'boolean') fail();
      await initialize();
      const result = refresh ? await update(true) : { message: '' };
      const installed = await store.list();
      return { ...result, source, generatedAt: snapshot.generatedAt, catalogRevision: snapshot.revision, repositoryUrl: REPOSITORY_URL, submissionUrl: SUBMISSION_URL, entries: snapshot.entries.map(entry => {
        const current = installed.find(addon => addon.id === entry.id);
        const samePublisher = current?.publisher === entry.publisher;
        const state = current ? !samePublisher ? 'conflict' : (current.maxRevision || current.revision) >= entry.revision ? 'installed' : 'update' : 'install';
        const { packageUrl, sha256, ...metadata } = entry;
        return { ...metadata, artwork: artwork(entry.artwork), compatible: p.compatible(entry, appVersion), state, enabled: current?.enabled === true };
      }) };
    },
    async checkUpdate(id) {
      if (typeof id !== 'string' || !p.id(id)) fail();
      await initialize();
      const result = await update();
      if (result.message) return {state:'unavailable',message:result.message};
      const current = (await store.list()).find(item=>item.id===id);
      if (!current) throw new Error('Расширение не установлено');
      const entry = snapshot.entries.find(item=>item.id===id);
      if (!entry || !entry.published) return {state:'unavailable',message:'Расширение пока недоступно в официальном каталоге'};
      if (current.publisher!==entry.publisher) throw new Error('Другой издатель расширения');
      if (!p.compatible(entry,appVersion)) return {state:'incompatible',message:'Обновление требует другой версии Noctune'};
      if (entry.revision <= (current.maxRevision || current.revision)) return {state:'current',message:'Новых ревизий нет'};
      return this.prepare(id);
    },
    async prepare(id) {
      if (typeof id !== 'string' || !p.id(id)) fail();
      await initialize();
      await update();
      const entry = snapshot.entries.find(candidate => candidate.id === id);
      if (!entry || !entry.published) throw new Error('Пакет ещё не опубликован в официальном каталоге');
      if (!p.compatible(entry, appVersion)) throw new Error('Расширение несовместимо с этой версией Noctune');
      const bytes = await fetch(entry.packageUrl, { limit: p.MAX_BYTES });
      if (hash(bytes) !== entry.sha256) throw new Error('Контрольная сумма пакета не совпадает с каталогом');
      const pkg = p.validatePackage(JSON.parse(bytes));
      if (p.signingIdentity(pkg, true) !== entry.publisher || fields.some(field => p.canonical(pkg.manifest[field]) !== p.canonical(entry[field]))) throw new Error('Пакет не соответствует карточке магазина');
      return store.preparePackage(pkg, 'catalog');
    },
  };
}
module.exports = { CATALOG_URL, REPOSITORY_URL, SUBMISSION_URL, CATALOG_FIELDS: fields, validateCatalog, createAddonCatalog };
