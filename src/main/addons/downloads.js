const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { fetchText } = require('./network');
const { runTagOperation, validatePatch } = require('../tag-editor');

const LIMIT = 256 * 1024 * 1024;
const FORMATS = {
  '.mp3': ['audio/mpeg', 'audio/mp3'],
  '.png': ['image/png'], '.jpg': ['image/jpeg'], '.jpeg': ['image/jpeg'], '.webp': ['image/webp'],
  '.txt': ['text/plain'], '.lrc': ['text/plain', 'application/x-subrip'],
  '.srt': ['text/plain', 'application/x-subrip'], '.vtt': ['text/plain', 'text/vtt'],
};
const TEXT_LIMIT = 48 * 1024;
const isText = ext => ['.txt', '.lrc', '.srt', '.vtt'].includes(ext);
function validContent(ext, bytes) {
  if (isText(ext)) {
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return !bytes.includes(0); } catch (_) { return false; }
  }
  if (ext === '.mp3') return bytes.length >= 3 && (bytes.toString('ascii', 0, 3) === 'ID3' || bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 6) === 2);
  if (ext === '.png') return bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  if (ext === '.webp') return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
}
function filename(value) {
  const ext = typeof value === 'string' ? path.extname(value).toLowerCase() : '';
  if (typeof value !== 'string' || value.length > 1000 || !Object.hasOwn(FORMATS, ext)) throw new Error((globalThis.noctuneI18n?.t("downloads.errors.filenameRequired") ?? "Укажите имя аудиофайла, изображения или текста поддерживаемого формата"));
  let base = value.slice(0, -ext.length).normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').replace(/^[. ]+|[. ]+$/g, '');
  if (!base) base = 'track';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base)) base = '_' + base;
  while (Buffer.byteLength(base) > 180) base = Array.from(base).slice(0, -1).join('');
  return base + ext;
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
  const publicJob = job => ({ id: job.key, state: job.state, name: job.name, bytes: job.bytes, total: job.total, error: job.error, ...(job.phase ? { phase: job.phase } : {}) });
  async function run(job, options, folder, metadata) {
    const temp = path.join(folder.path, '.noctune-' + job.key + (metadata ? '.part.mp3' : '.part'));
    let file, response;
    const timer = setTimeout(() => job.controller.abort(), 300000);
    try {
      file = await fs.open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
      const ext = path.extname(job.name);
      response = options.data !== undefined ? Object.assign(Readable.from([Buffer.from(options.data, 'utf8')]), { statusCode: 200, headers: { 'content-type': 'text/plain' } }) : await fetch(options.url, { ...options, stream: true, detailed: true, signal: job.controller.signal });
      const mime = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (response.statusCode !== 200 || ![...FORMATS[ext], 'application/octet-stream'].includes(mime)) throw new Error((globalThis.noctuneI18n?.t("downloads.errors.incompleteResponse") ?? "Сервер вернул файл другого типа или неполный ответ"));
      const length = response.headers['content-length'];
      job.total = /^\d+$/.test(length || '') ? Number(length) : null;
      if (job.total > LIMIT) throw new Error((globalThis.noctuneI18n?.t("downloads.errors.sizeLimit") ?? "Файл превышает 256 МБ"));
      let prefix = Buffer.alloc(0);
      const decoder = isText(ext) ? new TextDecoder('utf-8', { fatal: true }) : null;
      for await (const chunk of response) {
        if (job.controller.signal.aborted) throw new Error((globalThis.noctuneI18n?.t("downloads.cancelled") ?? "Сохранение отменено"));
        job.bytes += chunk.length;
        if (job.bytes > LIMIT) throw new Error((globalThis.noctuneI18n?.t("downloads.errors.sizeLimit") ?? "Файл превышает 256 МБ"));
        if (prefix.length < 12) prefix = Buffer.concat([prefix, chunk]).subarray(0, 12);
        if (decoder) {
          try { decoder.decode(chunk, { stream: true }); if (chunk.includes(0)) throw new Error(); }
          catch (_) { throw new Error(globalThis.noctuneI18n?.t('downloads.errors.invalidText') ?? 'Файл должен содержать корректный текст UTF-8 без нулевых байтов'); }
        }
        await file.writeFile(chunk);
      }
      if (decoder) { try { decoder.decode(); } catch (_) { throw new Error(globalThis.noctuneI18n?.t('downloads.errors.invalidText') ?? 'Файл должен содержать корректный текст UTF-8 без нулевых байтов'); } }
      if (!job.bytes || (job.total !== null && job.bytes !== job.total) || !decoder && !validContent(ext, prefix)) throw new Error((globalThis.noctuneI18n?.t("downloads.errors.invalidFile") ?? "Получен неполный файл или содержимое не соответствует расширению"));
      await file.sync();
      const downloadedIdentity = await file.stat({ bigint: true });
      await file.close(); file = null;
      if (metadata && Object.keys(metadata).length) {
        job.phase = 'tagging';
        if (job.controller.signal.aborted) throw new Error('Сохранение отменено');
        const before = await runTagOperation({ action: 'read', filePath: temp });
        if (!before.ok) throw new Error('Не удалось прочитать MP3 для записи метаданных');
        if (!before.revision.startsWith(`${downloadedIdentity.dev}:${downloadedIdentity.ino}:`)) throw new Error('Временный файл MP3 изменился');
        const tagged = await runTagOperation({ action: 'save', filePath: temp, expectedRevision: before.revision, patch: metadata });
        if (!tagged.ok) throw new Error('Не удалось записать метаданные MP3');
      }
      await store.context(job.id, job.hash, 'downloads.write');
      const current = await fs.stat(folder.path);
      if (current.dev !== folder.dev || current.ino !== folder.ino || job.controller.signal.aborted) throw new Error((globalThis.noctuneI18n?.t("downloads.errors.folderChangedOrCancelled") ?? "Папка изменилась или сохранение отменено"));
      // Publish a complete file without ever replacing an existing file or symlink.
      const base = job.name.slice(0, -ext.length);
      for (let index = 0; ; index++) {
        if (index > 999) throw new Error((globalThis.noctuneI18n?.t("downloads.errors.filenameCollisions") ?? "Слишком много файлов с одинаковым именем"));
        const name = base + (index ? ' (' + index + ')' : '') + ext;
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
            const result = await dialog.showOpenDialog(getWindow(), { title: pkg.manifest.name + (globalThis.noctuneI18n?.t("downloads.folderDialogSuffix") ?? ": папка для загрузок"), properties: ['openDirectory', 'createDirectory'], ...(value.path ? { defaultPath: value.path } : {}) });
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
        if ((args.url !== undefined) === (args.data !== undefined) || args.url !== undefined && typeof args.url !== 'string' || args.data !== undefined && typeof args.data !== 'string') throw new Error(globalThis.noctuneI18n?.t('downloads.errors.source') ?? 'Укажите ровно один источник: url или data');
        if (args.url !== undefined && !pkg.grants.includes('network.request')) throw new Error((globalThis.noctuneI18n?.t("downloads.errors.networkPermission") ?? "Для загрузки нужен доступ к сети"));
        for (const [key, job] of jobs) if (job.finished && Date.now() - job.finished > 600000) jobs.delete(key);
        if (jobs.size >= 128 || [...jobs.values()].filter(job => job.id === id && job.state === 'running').length >= 2) throw new Error((globalThis.noctuneI18n?.t("downloads.errors.concurrency") ?? "Не более двух одновременных сохранений"));
        const name = filename(args.filename), folder = await destination(id, hash, args.folder, true);
        let metadata;
        if (args.metadata !== undefined) {
          if (path.extname(name) !== '.mp3') throw new Error('Метаданные доступны только для MP3');
          validatePatch(args.metadata);
          metadata = { ...args.metadata };
        }
        // Export requests are public: caller headers and credentials never reach a CDN.
        if (args.data !== undefined && (!isText(path.extname(name)) || Buffer.byteLength(args.data, 'utf8') > TEXT_LIMIT)) throw new Error(globalThis.noctuneI18n?.t('downloads.errors.inlineText') ?? 'В data разрешён текст UTF-8 до 48 КиБ для TXT/LRC/SRT/VTT');
        const options = args.data !== undefined ? { data: args.data } : await resource(id, hash, pkg, { url: args.url });
        await store.context(id, hash, 'downloads.write');
        if ([...jobs.values()].filter(job => job.id === id && job.state === 'running').length >= 2) throw new Error((globalThis.noctuneI18n?.t("downloads.errors.concurrency") ?? "Не более двух одновременных сохранений"));
        const key = crypto.randomUUID(), job = { key, id, hash, name, state: 'running', bytes: 0, total: null, controller: new AbortController() };
        jobs.set(key, job); run(job, options, folder, metadata).catch(() => {});
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
