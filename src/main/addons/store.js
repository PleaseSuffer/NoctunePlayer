const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const p = require('./package');
const { fetchText: defaultFetch, httpsUrl } = require('./network');
const permissions = require('../../shared/addon-permissions');
const settings = require('../../shared/addon-settings');
const assets = require('../../shared/addon-assets');
const verifiedPublisher = require('../../shared/addon-publishers');
const digest = value => crypto.createHash('sha256').update(p.canonical(value)).digest('hex');

function createAddonStore({ directory, appVersion, fetchText = defaultFetch }) {
  let queue = Promise.resolve();
  const pending = new Map();
  const root = () => typeof directory === 'function' ? directory() : directory;
  const serial = action => {
    const result = queue.then(action);
    queue = result.catch(() => {});
    return result;
  };
  async function json(file, fallback) {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return fallback; throw new Error('Повреждено хранилище расширений'); }
  }
  async function atomic(file, value) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = file + '.' + crypto.randomUUID() + '.tmp';
    try { await fs.writeFile(temp, p.canonical(value), { mode: 0o600 }); await fs.rename(temp, file); }
    finally { await fs.rm(temp, { force: true }); }
  }
  async function registry() {
    const value = await json(path.join(root(), 'registry.json'), { formatVersion: 1, installed: {} });
    if (value?.formatVersion !== 1 || !value.installed || Array.isArray(value.installed) || typeof value.installed !== 'object' || Object.keys(value.installed).some(id => !p.id(id))) throw new Error('Повреждён реестр расширений');
    return value;
  }
  const save = value => atomic(path.join(root(), 'registry.json'), value);
  function packagePath(id, hash) {
    if (!p.id(id) || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('Некорректный ID расширения');
    return path.join(root(), 'packages', id, hash + '.noctaddon');
  }
  async function read(id, entry, hash = entry.current) {
    const pkg = await p.readPackage(packagePath(id, hash));
    if (pkg.manifest.id !== id || digest(pkg) !== hash || p.signingIdentity(pkg) !== entry.publisher) throw new Error('Содержимое установленного расширения изменено');
    return pkg;
  }
  function details(pkg, extra = {}) {
    const publisher = p.signingIdentity(pkg);
    return { ...pkg.manifest, artwork: { icon: pkg.manifest.icon ? assets.url(pkg.files, pkg.manifest.icon) : null, banner: pkg.manifest.banner ? assets.url(pkg.files, pkg.manifest.banner) : null }, publisher, verifiedPublisher: verifiedPublisher(publisher), signed: !!publisher, compatible: p.compatible(pkg.manifest, appVersion), ...extra };
  }
  function validateInstall(pkg, current, existing) {
    if (!p.compatible(pkg.manifest, appVersion)) throw new Error(`Расширение несовместимо с Noctune ${appVersion}`);
    if (!existing) return;
    if (existing.publisher !== p.signingIdentity(pkg)) throw new Error('Издатель не совпадает с установленным расширением');
    if (digest(pkg) === existing.current) return;
    if (pkg.manifest.revision <= existing.maxRevision || p.compareVersions(pkg.manifest.version, current.manifest.version) < 0) throw new Error('Установлена такая же или более новая ревизия; для возврата используйте откат');
  }
  async function prepare(pkg, source = 'file') {
    pkg = p.validatePackage(JSON.parse(JSON.stringify(pkg)));
    if (source !== 'file') p.signingIdentity(pkg, true);
    const state = await registry(), existing = state.installed[pkg.manifest.id];
    if (!existing && Object.keys(state.installed).length >= 32) throw new Error('Можно установить не более 32 расширений');
    const current = existing ? await read(pkg.manifest.id, existing) : null;
    validateInstall(pkg, current, existing);
    for (const [key, item] of pending) if (item.expires < Date.now()) pending.delete(key);
    if (pending.size >= 64) throw new Error('Закройте предыдущие предложения установки');
    const ticket = crypto.randomUUID();
    const preview = { ticket, ...details(pkg), grants: permissions.expand(pkg.manifest.permissions), source, state: existing ? digest(pkg) === existing.current ? 'installed' : 'update' : 'install', installedVersion: current?.manifest.version,
      addedPermissions: permissions.expand(pkg.manifest.permissions).filter(value => !(existing?.grants || permissions.expand(current?.manifest.permissions || [])).includes(value)),
      addedOrigins: (pkg.manifest.network?.origins || []).filter(value => !current?.manifest.network?.origins.includes(value)),
    };
    pending.set(ticket, { pkg, preview: JSON.parse(JSON.stringify(preview)), expires: Date.now() + 5 * 60000, base: existing?.current ?? null });
    return preview;
  }
  const api = {
    preparePackage: prepare,
    async context(id, hash, permission) {
      const state = await registry(), entry = state.installed[id];
      if (!entry?.enabled || entry.current !== hash) throw new Error('Расширение выключено или обновлено');
      const pkg = await read(id, entry), grants = entry.grants || permissions.expand(pkg.manifest.permissions);
      if (!p.compatible(pkg.manifest, appVersion) || (permission && !grants.includes(permission))) throw new Error('Операция не разрешена: ' + permission);
      return { ...pkg, grants };
    },
    async settings(id) {
      const state = await registry(), entry = state.installed[id];
      if (!entry) throw new Error('Расширение не установлено');
      const pkg = await read(id, entry), saved = await json(path.join(root(), 'settings', id + '.json'), {}), result = {};
      for (const [key, field] of Object.entries(pkg.manifest.settings || {})) {
        try { result[key] = settings.normalize({ [key]: field }, saved)[key]; }
        catch (_) { result[key] = field.default; }
      }
      return result;
    },
    setSettings(id, value) {
      return serial(async () => {
        const state = await registry(), entry = state.installed[id];
        if (!entry) throw new Error('Расширение не установлено');
        const pkg = await read(id, entry), result = settings.normalize(pkg.manifest.settings || {}, value);
        await atomic(path.join(root(), 'settings', id + '.json'), result); return result;
      });
    },
    async prepareFile(file) { return prepare(await p.readPackage(file)); },
    async prepareUrl(url) { httpsUrl(url); return prepare(JSON.parse(await fetchText(url, { limit: p.MAX_BYTES })), 'url'); },
    discard(ticket) { pending.delete(ticket); },
    preview(ticket) {
      const item = pending.get(ticket);
      if (!item || item.expires < Date.now()) throw new Error('Предложение установки истекло. Выберите пакет снова');
      return JSON.parse(JSON.stringify(item.preview));
    },
    confirm(ticket) {
      return serial(async () => {
        const item = pending.get(ticket);
        if (!item || item.expires < Date.now()) throw new Error('Предложение установки истекло. Выберите пакет снова');
        const { pkg } = item, state = await registry(), id = pkg.manifest.id, existing = state.installed[id];
        if (!existing && Object.keys(state.installed).length >= 32) throw new Error('Можно установить не более 32 расширений');
        if ((existing?.current ?? null) !== item.base) throw new Error('Расширение уже изменилось. Повторите установку');
        const current = existing ? await read(id, existing) : null;
        validateInstall(pkg, current, existing);
        const hash = digest(pkg);
        if (hash !== existing?.current) {
          await atomic(packagePath(id, hash), pkg);
          state.installed[id] = { current: hash, previous: existing?.current ?? null, grants: permissions.expand(pkg.manifest.permissions), previousGrants: existing?.grants || permissions.expand(current?.manifest.permissions || []), publisher: p.signingIdentity(pkg), maxRevision: pkg.manifest.revision, enabled: existing?.enabled === true };
          await save(state);
        }
        pending.delete(ticket);
        return details(pkg, { enabled: state.installed[id].enabled });
      });
    },
    async list() {
      const state = await registry(), addons = [];
      for (const [id, entry] of Object.entries(state.installed)) {
        try { const pkg = await read(id, entry); addons.push(details(pkg, { enabled: entry.enabled === true, maxRevision: entry.maxRevision, rollbackAvailable: !!entry.previous, grants: entry.grants || permissions.expand(pkg.manifest.permissions) })); }
        catch (_) { addons.push({ id, name: id, broken: true, enabled: false, description: 'Пакет повреждён. Удалите его и установите снова.' }); }
      }
      return addons.sort((a, b) => a.name.localeCompare(b.name));
    },
    setEnabled(id, enabled) {
      return serial(async () => {
        const state = await registry(), entry = state.installed[id];
        if (!entry) throw new Error('Расширение не установлено');
        if (typeof enabled !== 'boolean') throw new Error('Некорректное состояние расширения');
        const pkg = await read(id, entry);
        if (enabled && !p.compatible(pkg.manifest, appVersion)) throw new Error('Расширение несовместимо с этой версией Noctune');
        entry.enabled = enabled; await save(state);
      });
    },
    rollback(id) {
      return serial(async () => {
        const state = await registry(), entry = state.installed[id];
        if (!entry?.previous) throw new Error('Предыдущая версия отсутствует');
        const pkg = await read(id, entry, entry.previous);
        if (!p.compatible(pkg.manifest, appVersion)) throw new Error('Предыдущая версия несовместима с Noctune');
        entry.current = entry.previous; entry.previous = null; entry.grants = entry.previousGrants || []; delete entry.previousGrants;
        await save(state);
        return details(pkg);
      });
    },
    remove(id) {
      return serial(async () => {
        if (!p.id(id)) throw new Error('Некорректный ID');
        const state = await registry(); delete state.installed[id]; await save(state);
        await fs.rm(path.join(root(), 'packages', id), { recursive: true, force: true });
        await fs.rm(path.join(root(), 'storage', id + '.json'), { force: true });
        await fs.rm(path.join(root(), 'settings', id + '.json'), { force: true });
      });
    },
    async runtime() {
      const state = await registry(), packages = [];
      for (const [id, entry] of Object.entries(state.installed)) {
        if (!entry.enabled) continue;
        try { const pkg = await read(id, entry); if (p.compatible(pkg.manifest, appVersion)) packages.push({ manifest: pkg.manifest, files: pkg.files, digest: entry.current, grants: entry.grants || permissions.expand(pkg.manifest.permissions) }); }
        catch (_) { /* Broken extensions do not prevent the player from starting. */ }
      }
      return packages;
    },
    async checkUpdate(id) {
      const state = await registry(), entry = state.installed[id];
      if (!entry) throw new Error('Расширение не установлено');
      const current = await read(id, entry);
      if (!current.manifest.update) return { state: 'manual', message: 'Обновляется установкой нового пакета' };
      if (!entry.publisher) return { state: 'manual', message: 'Для обновления по сети нужен подписанный пакет' };
      const release = JSON.parse(await fetchText(current.manifest.update.url, { limit: 64 * 1024 }));
      p.keys(release, ['format','formatVersion','id','version','revision','channel','packageUrl','sha256','signature']);
      if (release.format !== 'noctune-addon-release' || release.formatVersion !== 1 || release.id !== id || release.channel !== current.manifest.update.channel || !p.version(release.version) || !Number.isSafeInteger(release.revision) || release.revision < 1 || !/^[a-f0-9]{64}$/.test(release.sha256)) throw new Error('Некорректные сведения об обновлении');
      if (p.signingIdentity(release, true) !== entry.publisher) throw new Error('Подпись обновления принадлежит другому издателю');
      if (release.revision <= entry.maxRevision) return { state: 'current', message: 'Новых ревизий нет' };
      httpsUrl(release.packageUrl);
      const source = await fetchText(release.packageUrl, { limit: p.MAX_BYTES });
      if (crypto.createHash('sha256').update(source).digest('hex') !== release.sha256) throw new Error('Контрольная сумма пакета не совпадает');
      const pkg = p.validatePackage(JSON.parse(source));
      if (pkg.manifest.id !== id || pkg.manifest.version !== release.version || pkg.manifest.revision !== release.revision || p.signingIdentity(pkg, true) !== entry.publisher) throw new Error('Пакет не соответствует сведениям об обновлении');
      if ((await registry()).installed[id]?.current !== entry.current) throw new Error('Расширение изменилось во время проверки обновления');
      return prepare(pkg, 'update');
    },
    invoke(id, hash, method, args = {}) {
      return serial(async () => {
        const state = await registry(), entry = state.installed[id];
        if (!entry?.enabled || entry.current !== hash) throw new Error('Расширение выключено или обновлено');
        const pkg = await read(id, entry);
        if (!p.compatible(pkg.manifest, appVersion)) throw new Error('Несовместимый API расширения');
        if (!(entry.grants || permissions.expand(pkg.manifest.permissions)).includes(method === 'storage.get' ? 'storage.read' : 'storage.write') || !['storage.get','storage.set'].includes(method)) throw new Error('Операция не разрешена');
        if (typeof args.key !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(args.key) || ['__proto__','constructor','prototype'].includes(args.key)) throw new Error('Некорректный ключ');
        const file = path.join(root(), 'storage', id + '.json'), data = await json(file, {});
        if (method === 'storage.get') return Object.hasOwn(data, args.key) ? data[args.key] : null;
        if (args.value === undefined) throw new Error('Нужно JSON-значение');
        const next = JSON.parse(JSON.stringify({ ...data, [args.key]: args.value }));
        if (Buffer.byteLength(JSON.stringify(next)) > 128 * 1024) throw new Error('Хранилище расширения превышает 128 КБ');
        await atomic(file, next); return null;
      });
    },
    async request(id, hash, url, signal) {
      const state = await registry(), entry = state.installed[id];
      if (!entry?.enabled || entry.current !== hash) throw new Error('Расширение выключено или обновлено');
      const pkg = await read(id, entry);
      if (!p.compatible(pkg.manifest, appVersion) || !(entry.grants || permissions.expand(pkg.manifest.permissions)).includes('network.request')) throw new Error('Нет разрешения на сеть');
      require('../../shared/addon-contributions').route(pkg.manifest, entry.grants || permissions.expand(pkg.manifest.permissions), url);
      return fetchText(url, { validateUrl: (value, method) => require('../../shared/addon-contributions').route(pkg.manifest, entry.grants || permissions.expand(pkg.manifest.permissions), value, method), limit: 1024 * 1024, signal, origins: pkg.manifest.network.origins });
    },
  };
  return api;
}
module.exports = { createAddonStore };
