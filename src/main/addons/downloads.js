const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fetchText } = require('./network');

const LIMIT = 256 * 1024 * 1024;
function filename(value) {
  if (typeof value !== 'string' || value.length > 1000 || !/\.mp3$/i.test(value)) throw new Error((globalThis.noctuneI18n?.t("downloads.errors.filenameRequired") ?? "Требуется имя MP3-файла"));
  let base = value.slice(0, -4).normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').replace(/^[. ]+|[. ]+$/g, '');
  if (!base) base = 'track';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base)) base = '_' + base;
  while (Buffer.byteLength(base) > 180) base = Array.from(base).slice(0, -1).join('');
  return base + '.mp3';
}
function createAddonDownloads({ store, directory, downloadsPath, dialog, shell, getWindow, resource, fetch = fetchText }) {
  const jobs = new Map(), choosing = new Set();
  let folderTail = Promise.resolve();
  const root = () => typeof directory === 'function' ? directory() : directory;
  async function folders() {
    try { return JSON.parse(await fs.readFile(path.join(root(), 'download-folders.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  }
  async function destination(id, hash, setting, create = false) {
    const pkg = await store.context(id, hash, 'downloads.write');
    if (typeof setting !== 'string' || !Object.hasOwn(pkg.manifest.settings || {}, setting) || pkg.manifest.settings[setting].type !== 'directory') throw new Error((globalThis.noctuneI18n?.t("downloads.errors.unknownFolderSetting") ?? "Неизвестная настройка папки"));
    const location = (await store.settings(id))[setting];
    let target;
    if (location === 'app') target = path.join(path.dirname(root()), 'Downloads', id);
    else if (location === 'downloads') target = path.join(downloadsPath(), 'Noctune', id);
    else if (location === 'custom') target = (await folders())[id]?.[setting]?.path;
    else throw new Error((globalThis.noctuneI18n?.t("downloads.errors.unknownLocation") ?? "Неизвестное место сохранения"));
    if (!target) { if (create) throw new Error((globalThis.noctuneI18n?.t("downloads.errors.chooseFolder") ?? "Выберите папку сохранения в настройках интеграции")); return { location, path: null }; }
    if (create) {
      if (location !== 'custom') await fs.mkdir(target, { recursive: true });
      const real = await fs.realpath(target), stat = await fs.stat(real);
      if (!stat.isDirectory()) throw new Error((globalThis.noctuneI18n?.t("downloads.errors.folderUnavailable") ?? "Папка сохранения недоступна"));
      if (location === 'custom') {
        const selected = (await folders())[id]?.[setting];
        if (real !== selected.path || stat.dev !== selected.dev || stat.ino !== selected.ino) throw new Error((globalThis.noctuneI18n?.t("downloads.errors.folderChanged") ?? "Выбранная папка изменилась. Выберите её заново"));
      }
      return { location, path: real, dev: stat.dev, ino: stat.ino };
    }
    return { location, path: target };
  }
  async function saveFolder(id, setting, target) {
    const operation = folderTail.then(async () => {
      const values = await folders(); values[id] = { ...values[id], [setting]: target };
      await fs.mkdir(root(), { recursive: true });
      const temp = path.join(root(), 'download-folders.' + crypto.randomUUID() + '.tmp');
      try { await fs.writeFile(temp, JSON.stringify(values), { mode: 0o600 }); await fs.rename(temp, path.join(root(), 'download-folders.json')); }
      finally { await fs.rm(temp, { force: true }); }
    });
    folderTail = operation.catch(() => {}); return operation;
  }
  const publicJob = job => ({ id: job.key, state: job.state, name: job.name, bytes: job.bytes, total: job.total, error: job.error });
  async function run(job, options, folder) {
    const temp = path.join(folder.path, '.noctune-' + job.key + '.part');
    let file, response;
    const timer = setTimeout(() => job.controller.abort(), 300000);
    try {
      file = await fs.open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
      response = await fetch(options.url, { ...options, stream: true, detailed: true, signal: job.controller.signal });
      if (response.statusCode !== 200 || !/^(audio\/(mpeg|mp3)|application\/octet-stream)(?:;|$)/i.test(response.headers['content-type'] || '')) throw new Error((globalThis.noctuneI18n?.t("downloads.errors.incompleteResponse") ?? "Сервер не вернул полный MP3-файл"));
      const length = response.headers['content-length'];
      job.total = /^\d+$/.test(length || '') ? Number(length) : null;
      if (job.total > LIMIT) throw new Error((globalThis.noctuneI18n?.t("downloads.errors.sizeLimit") ?? "MP3 превышает 256 МБ"));
      let prefix = Buffer.alloc(0);
      for await (const chunk of response) {
        if (job.controller.signal.aborted) throw new Error((globalThis.noctuneI18n?.t("downloads.cancelled") ?? "Сохранение отменено"));
        job.bytes += chunk.length;
        if (job.bytes > LIMIT) throw new Error((globalThis.noctuneI18n?.t("downloads.errors.sizeLimit") ?? "MP3 превышает 256 МБ"));
        if (prefix.length < 3) prefix = Buffer.concat([prefix, chunk]).subarray(0, 3);
        await file.writeFile(chunk);
      }
      if (job.bytes < 3 || (job.total !== null && job.bytes !== job.total) || !(prefix.toString('ascii') === 'ID3' || (prefix[0] === 255 && (prefix[1] & 0xe0) === 0xe0 && (prefix[1] & 6) === 2))) throw new Error((globalThis.noctuneI18n?.t("downloads.errors.invalidMp3") ?? "Получен неполный или некорректный MP3-файл"));
      await file.sync(); await file.close(); file = null;
      await store.context(job.id, job.hash, 'downloads.write');
      const current = await fs.stat(folder.path);
      if (current.dev !== folder.dev || current.ino !== folder.ino || job.controller.signal.aborted) throw new Error((globalThis.noctuneI18n?.t("downloads.errors.folderChangedOrCancelled") ?? "Папка изменилась или сохранение отменено"));
      // Publish a complete file without ever replacing an existing file or symlink.
      const base = job.name.slice(0, -4);
      for (let index = 0; ; index++) {
        if (index > 999) throw new Error((globalThis.noctuneI18n?.t("downloads.errors.filenameCollisions") ?? "Слишком много файлов с одинаковым именем"));
        const name = base + (index ? ' (' + index + ')' : '') + '.mp3';
        try { await fs.link(temp, path.join(folder.path, name)); job.name = name; break; }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
      job.state = 'completed';
    } catch (error) {
      job.state = job.controller.signal.aborted ? 'canceled' : 'failed';
      job.error = job.controller.signal.aborted ? (globalThis.noctuneI18n?.t("downloads.errors.timeout") ?? "Сохранение отменено или истекло время ожидания") : String(error.message).replace(/https?:\/\/\S+/g, (globalThis.noctuneI18n?.t("errors.addressHidden") ?? "[адрес скрыт]")).slice(0, 300);
    } finally {
      clearTimeout(timer); response?.destroy(); await file?.close().catch(() => {}); await fs.rm(temp, { force: true }).catch(() => {});
      job.finished = Date.now();
    }
  }
  return {
    cancel(id) { for (const job of jobs.values()) if (job.id === id) job.controller.abort(); },
    async invoke(id, hash, method, args) {
      const pkg = await store.context(id, hash, 'downloads.write');
      if (method === 'downloads.folder') {
        const value = await destination(id, hash, args.setting);
        if (args.action === 'choose') {
          if (choosing.has(id)) throw new Error((globalThis.noctuneI18n?.t("downloads.errors.folderDialogOpen") ?? "Выбор папки уже открыт"));
          choosing.add(id);
          try {
            const result = await dialog.showOpenDialog(getWindow(), { title: pkg.manifest.name + (globalThis.noctuneI18n?.t("downloads.folderDialogSuffix") ?? ": папка для MP3"), properties: ['openDirectory', 'createDirectory'], ...(value.path ? { defaultPath: value.path } : {}) });
            await store.context(id, hash, 'downloads.write');
            if (result.canceled || !result.filePaths[0]) return { ...value, canceled: true };
            const real = await fs.realpath(result.filePaths[0]);
            const stat = await fs.stat(real);
            if (!stat.isDirectory()) throw new Error((globalThis.noctuneI18n?.t("downloads.chooseFolder") ?? "Выберите папку"));
            await saveFolder(id, args.setting, { path: real, dev: stat.dev, ino: stat.ino });
            return { location: 'custom', path: real, canceled: false };
          } finally { choosing.delete(id); }
        }
        if (args.action === 'open') {
          const folder = await destination(id, hash, args.setting, true);
          const error = await shell.openPath(folder.path); if (error) throw new Error(error);
          return folder;
        }
        if (args.action !== undefined && args.action !== 'status') throw new Error((globalThis.noctuneI18n?.t("downloads.errors.unknownFolderAction") ?? "Неизвестное действие папки"));
        return value;
      }
      if (method === 'downloads.start') {
        if (!pkg.grants.includes('network.request')) throw new Error((globalThis.noctuneI18n?.t("downloads.errors.networkPermission") ?? "Для сохранения нужен доступ к сети"));
        for (const [key, job] of jobs) if (job.finished && Date.now() - job.finished > 600000) jobs.delete(key);
        if (jobs.size >= 128 || [...jobs.values()].filter(job => job.id === id && job.state === 'running').length >= 2) throw new Error((globalThis.noctuneI18n?.t("downloads.errors.concurrency") ?? "Не более двух одновременных сохранений"));
        const name = filename(args.filename), folder = await destination(id, hash, args.folder, true);
        // Audio export is public: caller headers and credential values never reach a CDN.
        const options = await resource(id, hash, pkg, { url: args.url });
        await store.context(id, hash, 'downloads.write');
        if ([...jobs.values()].filter(job => job.id === id && job.state === 'running').length >= 2) throw new Error((globalThis.noctuneI18n?.t("downloads.errors.concurrency") ?? "Не более двух одновременных сохранений"));
        const key = crypto.randomUUID(), job = { key, id, hash, name, state: 'running', bytes: 0, total: null, controller: new AbortController() };
        jobs.set(key, job); run(job, options, folder).catch(() => {});
        return publicJob(job);
      }
      const job = jobs.get(args.id);
      if (!job || job.id !== id || job.hash !== hash) throw new Error((globalThis.noctuneI18n?.t("downloads.errors.notFound") ?? "Сохранение не найдено"));
      if (method === 'downloads.cancel') job.controller.abort();
      else if (method !== 'downloads.status') throw new Error((globalThis.noctuneI18n?.t("downloads.errors.unknownMethod") ?? "Неизвестный метод сохранения"));
      return publicJob(job);
    },
  };
}
module.exports = { createAddonDownloads, filename };
