// ══════════════════════════════════════════════════════════════════════════
// PRELOAD SCRIPT
// ══════════════════════════════════════════════════════════════════════════
// С contextIsolation: true рендерер (renderer/index.html + renderer/**/*.js) больше не
// имеет прямого доступа к Node.js / Electron API — только к тому, что явно
// опубликовано здесь через contextBridge как window.noctune.
//
// Сам preload выполняется в привилегированном контексте (у него есть require,
// т.к. webPreferences.sandbox = false в main/index.js) — поэтому вся файловая
// работа (fs, path, чтение метаданных) сделана прямо тут, без лишнего IPC
// round-trip до main-процесса. Всё, что требует ресурсов главного процесса
// (диалоги, трей, Discord RPC, автообновления, electron-store) — проксируется
// через ipcRenderer.
// ══════════════════════════════════════════════════════════════════════════

const { contextBridge, ipcRenderer, nativeImage, webUtils } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { pathToFileURL } = require('url');

const { resizeArtwork, encodeArtwork, createSerialQueue } = require('./artwork');
const metadataQueue = createSerialQueue();
let activeCoverRequest = 0;

const { AUDIO_EXTENSIONS } = require('../main/open-audio-files');

// music-metadata — ESM-only пакет, поэтому подключаем через динамический
// import (как electron-store в main/index.js). Кэшируем промис, чтобы не грузить
// модуль повторно на каждый вызов.
let _mmPromise = null;
function loadMusicMetadata() {
  if (!_mmPromise) _mmPromise = import('music-metadata');
  return _mmPromise;
}

// ── Метаданные аудиофайла ───────────────────────────────────────────────
// Полностью заменяет прежний самописный ID3v2-парсер: music-metadata умеет
// MP3/FLAC/OGG/WAV/M4A и десятки других форматов, отдаёт длительность и
// битрейт без отдельного "прогона" через временный <audio>.
async function parseAudioMetadata(filePath, fallbackName) {
  let targetName = fallbackName || path.basename(filePath);

  const result = {
    title: '',
    artist: '',
    album: '',
    coverDataUrl: null,
    coverThumbnailDataUrl: null,
    hasEmbeddedCover: false,
    duration: 0,
    kbps: 0,
    fileSize: 0,
    replayGainTrackDb: null,   // дБ, из тега (если есть) — null означает "тега нет"
    replayGainAlbumDb: null,
  };

  try {
    const stats = await fsp.stat(filePath);
    result.fileSize = stats.size;
  } catch (e) { /* размер недоступен — не критично */ }

  try {
    const mm = await loadMusicMetadata();
    const metadata = await mm.parseFile(filePath, { duration: true, skipCovers: false });

    if (metadata.common) {
      if (metadata.common.title) result.title = String(metadata.common.title).trim();
      if (metadata.common.artist) result.artist = String(metadata.common.artist).trim();
      if (metadata.common.album) result.album = String(metadata.common.album).trim();
      if (Array.isArray(metadata.common.picture) && metadata.common.picture.length > 0) {
        const pic = metadata.common.picture[0];
        result.hasEmbeddedCover = true;
        result.coverThumbnailDataUrl = resizeArtwork(pic, nativeImage, 96, 75);
      }
      // ReplayGain: music-metadata отдаёт его в разных формах в зависимости
      // от версии/формата тега — число, строка "-6.5 dB" или объект
      // {dB, ratio}. Разбираем защитно, вместо того чтобы полагаться на одну
      // конкретную форму.
      const parseGainDb = (v) => {
        if (v === null || v === undefined) return null;
        if (typeof v === 'number' && isFinite(v)) return v;
        if (typeof v === 'object' && typeof v.dB === 'number' && isFinite(v.dB)) return v.dB;
        if (typeof v === 'string') {
          const n = parseFloat(v);
          return isFinite(n) ? n : null;
        }
        return null;
      };
      result.replayGainTrackDb = parseGainDb(metadata.common.replaygain_track_gain);
      result.replayGainAlbumDb = parseGainDb(metadata.common.replaygain_album_gain);
    }
    if (metadata.format) {
      if (typeof metadata.format.duration === 'number' && isFinite(metadata.format.duration)) {
        result.duration = metadata.format.duration;
      }
      if (typeof metadata.format.bitrate === 'number' && isFinite(metadata.format.bitrate)) {
        result.kbps = Math.round(metadata.format.bitrate / 1000);
      }
    }
  } catch (e) {
    // Файл без тегов / повреждённый / неподдерживаемый — не фатально,
    // ниже сработает резервный разбор по имени файла.
  }

  // Битрейт не всегда есть в format (например, некоторые WAV) — считаем
  // от размера файла и длительности, как раньше.
  if (!result.kbps && result.duration > 0 && result.fileSize > 0) {
    result.kbps = Math.round((result.fileSize * 8) / result.duration / 1000);
  }

  // Резервный разбор имени файла "Artist - Title.ext", если тегов не было —
  // логика 1:1 перенесена из прежнего parseAudioTags().
  if ((!result.title || !result.artist) && targetName) {
    let cleanName = targetName.replace(/\.[^/.]+$/, '');
    let separator = null;
    if (cleanName.includes(' - ')) separator = ' - ';
    else if (cleanName.includes(' — ')) separator = ' — ';
    else if (cleanName.includes(' – ')) separator = ' – ';

    if (separator) {
      const parts = cleanName.split(separator);
      const fallbackArtist = parts[0].trim();
      const fallbackTitle = parts.slice(1).join(separator).trim();
      if (!result.artist && fallbackArtist) result.artist = fallbackArtist;
      if (!result.title && fallbackTitle) result.title = fallbackTitle;
    } else if (!result.title) {
      result.title = cleanName.trim();
    }
  }

  if (!result.title) result.title = 'Без названия';
  if (!result.artist) result.artist = 'Неизвестный исполнитель';

  return result;
}

// ── Радиостанции: проверка доступности без CORS ────────────────────────
// Раньше это делалось через fetch() прямо в рендерере — у большинства
// радио-серверов нет CORS-заголовков, поэтому проверка либо не работала
// вовсе, либо давала ложный "Offline". Здесь запрос идёт из Node
// (в preload), CORS на него не распространяется.
function checkRadioStreamReachable(streamUrl, timeoutMs = 6000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (online) => {
      if (settled) return;
      settled = true;
      resolve({ online });
    };

    let mod;
    try {
      const u = new URL(streamUrl);
      mod = u.protocol === 'https:' ? require('https') : require('http');
    } catch (e) {
      return finish(false);
    }

    try {
      const req = mod.request(streamUrl, {
        method: 'GET',
        headers: { Range: 'bytes=0-4095', 'User-Agent': 'NoctunePlayer' },
        timeout: timeoutMs,
      }, (res) => {
        const ct = (res.headers['content-type'] || '').toLowerCase();
        const looksAudio = ct.includes('audio') || ct.includes('ogg') || ct.includes('mpeg') || ct.includes('stream');
        const okStatus = res.statusCode && res.statusCode < 400;
        res.destroy();
        finish(!!(okStatus && (looksAudio || res.statusCode === 200 || res.statusCode === 206)));
      });
      req.on('timeout', () => { req.destroy(); finish(false); });
      req.on('error', () => finish(false));
      req.end();
    } catch (e) {
      finish(false);
    }
  });
}

// ── .m3u плейлисты: чтение/запись ───────────────────────────────────────
function buildM3U(playlistName, items) {
  // items: [{ isRadio, name, path/url, duration, artist }]
  const lines = ['#EXTM3U', `#PLAYLIST:${playlistName}`];
  for (const it of items) {
    const durationTag = it.isRadio ? -1 : Math.round(it.duration || 0);
    const titleTag = it.artist ? `${it.artist} - ${it.name}` : it.name;
    lines.push(`#EXTINF:${durationTag},${titleTag}`);
    lines.push(it.target);
  }
  return lines.join('\n') + '\n';
}

function parseM3U(text) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  let pendingTitle = null;
  let playlistName = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#PLAYLIST:')) {
      playlistName = line.slice('#PLAYLIST:'.length).trim();
      continue;
    }
    if (line.startsWith('#EXTINF:')) {
      const commaIdx = line.indexOf(',');
      pendingTitle = commaIdx !== -1 ? line.slice(commaIdx + 1).trim() : null;
      continue;
    }
    if (line.startsWith('#')) continue; // прочие метаданные-комментарии игнорируем
    entries.push({ target: line, title: pendingTitle });
    pendingTitle = null;
  }
  return { playlistName, entries };
}

// ══════════════════════════════════════════════════════════════════════════
// Публичный API, доступный в рендерере как window.noctune
// ══════════════════════════════════════════════════════════════════════════
contextBridge.exposeInMainWorld('noctune', {
  lyrics: { get: payload => ipcRenderer.invoke('lyrics:get', payload), cancel: () => ipcRenderer.invoke('lyrics:cancel') },
  // Статичные значения окружения (нужны, например, для отчётов об ошибках,
  // где раньше использовался глобальный process.*, недоступный без
  // nodeIntegration)
  platform: process.platform,
  versions: { electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome },

  // ── Версия приложения ──
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getTechVersions: () => ipcRenderer.invoke('get-tech-versions'),
  systemIntegration: { apply: action => ipcRenderer.invoke('system-integration:apply', action) },
  audioFilesReady: () => ipcRenderer.send('audio-files:ready'),
  getDroppedFilePath: file => {
    try { return webUtils.getPathForFile(file); } catch (_) { return ''; }
  },
  onOpenAudioFiles: cb => ipcRenderer.on('open-audio-files', (_event, files) => cb(files)),

  // ── Диалоги ──
  dialogOpenFiles: () => ipcRenderer.invoke('dialog:openFiles'),
  dialogOpenDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  dialogOpenImage: () => ipcRenderer.invoke('dialog:openImage'),
  dialogOpenM3U: () => ipcRenderer.invoke('dialog:openM3U'),
  dialogSaveM3U: (defaultName) => ipcRenderer.invoke('dialog:saveM3U', defaultName),
  getSavedDirectory: () => ipcRenderer.invoke('get-saved-directory'),

  // ── Ссылки ──
  openExternalUrl: (url) => ipcRenderer.send('open-external-url', url),
  showItemInFolder: (filePath) => ipcRenderer.send('show-item-in-folder', filePath),
  openInternalUrl: (url) => ipcRenderer.send('open-internal-url', url),

  // ── Трей / окно ──
  setMinimizeToTray: (value) => ipcRenderer.send('setting-minimize-to-tray-changed', value),
  sendPlayingStateResponse: (isPlaying, minimizeToTray) => ipcRenderer.send('playing-state-response', isPlaying, minimizeToTray),
  sendTrayState: (state) => ipcRenderer.send('tray-state-update', state),
  onTrayCmd: (cb) => ipcRenderer.on('tray-cmd', (_e, cmd) => cb(cmd)),
  onQueryPlayingState: (cb) => ipcRenderer.on('query-playing-state', () => cb()),
  onLoadSavedDirectory: (cb) => ipcRenderer.on('load-saved-directory', (_e, dirPath) => cb(dirPath)),
  onDeepLinkRadio: (cb) => ipcRenderer.on('deep-link-radio', (_e, payload) => cb(payload)),
  // Сигнал сворачивания/разворачивания окна из трея — используется, чтобы
  // ставить requestAnimationFrame-циклы визуализатора/фона/конфетти на паузу
  // и не тратить CPU/GPU, пока плеер не виден.
  onWindowTrayVisibility: (cb) => ipcRenderer.on('window-tray-visibility', (_e, visible) => cb(visible)),

  // ── Discord Rich Presence ──
  discordRpcConnect: (clientId) => ipcRenderer.invoke('discord-rpc-connect', clientId),
  discordRpcDisconnect: () => ipcRenderer.invoke('discord-rpc-disconnect'),
  discordRpcStatus: () => ipcRenderer.invoke('discord-rpc-status'),
  discordRpcSetActivity: (activity) => ipcRenderer.send('discord-rpc-set-activity', activity),
  discordRpcClearActivity: () => ipcRenderer.send('discord-rpc-clear-activity'),
  onDiscordRpcStatus: (cb) => ipcRenderer.on('discord-rpc-status', (_e, status) => cb(status)),

  // ── Last.fm (скробблинг) ──
  lastfm: {
    beginAuth: () => ipcRenderer.invoke('lastfm-begin-auth'),
    completeAuth: (token) => ipcRenderer.invoke('lastfm-complete-auth', token),
    disconnect: () => ipcRenderer.invoke('lastfm-disconnect'),
    status: () => ipcRenderer.invoke('lastfm-status'),
    cover: payload => ipcRenderer.invoke('lastfm-cover', payload),
    cancelRadioCover: () => ipcRenderer.invoke('lastfm-cover-radio-cancel'),
    clearCoverCache: payload => ipcRenderer.invoke('lastfm-cover-cache-clear', payload),
    trackCoverCacheStatus: payload => ipcRenderer.invoke('lastfm-cover-cache-track-status', payload),
    removeTrackCoverCache: payload => ipcRenderer.invoke('lastfm-cover-cache-track-remove', payload),
    coverCacheStats: payload => ipcRenderer.invoke('lastfm-cover-cache-stats', payload),
    configureCoverCache: payload => ipcRenderer.invoke('lastfm-cover-cache-configure', payload),
    chooseCoverCacheFolder: () => ipcRenderer.invoke('lastfm-cover-cache-choose-folder'),
    openCoverCacheFolder: payload => ipcRenderer.invoke('lastfm-cover-cache-open-folder', payload),
    onCoverProgress: callback => {
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on('lastfm-cover-progress', listener);
      return () => ipcRenderer.removeListener('lastfm-cover-progress', listener);
    },
    nowPlaying: (payload) => ipcRenderer.invoke('lastfm-now-playing', payload),
    scrobble: (payload) => ipcRenderer.invoke('lastfm-scrobble', payload),
  },

  // ── Радио ──
  checkRadioStation: (url) => checkRadioStreamReachable(url),

  // ── Электрон-хранилище настроек (замена localStorage) ──
  storage: {
    getAll: () => ipcRenderer.sendSync('store:get-all-sync') || {},
    set: (key, value) => ipcRenderer.send('store:set', key, value),
    remove: (key) => ipcRenderer.send('store:delete', key),
  },

  // ── Файловая система (используется вместо прямого require('fs')) ──
  fs: {
    exists: (p) => fsp.access(p).then(() => true).catch(() => false),
    readDir: (dirPath) => fsp.readdir(dirPath),
    stat: async (p) => {
      const s = await fsp.stat(p);
      return { size: s.size, mtimeMs: s.mtimeMs, isDirectory: s.isDirectory(), isFile: s.isFile() };
    },
    joinPath: (...parts) => path.join(...parts),
    basename: (p) => path.basename(p),
    toFileUrl: (p) => pathToFileURL(p).href,
    isAudioExt: (name) => AUDIO_EXTENSIONS.has(String(name).split('.').pop().toLowerCase()),
    readTextFile: (p) => fsp.readFile(p, 'utf8'),
    writeTextFile: (p, content) => fsp.writeFile(p, content, 'utf8'),
  },

  // ── Метаданные аудио (music-metadata) ──
  metadata: {
    parseFile: (filePath, fallbackName) => metadataQueue(() => parseAudioMetadata(filePath, fallbackName)),
    cancelCover: () => { activeCoverRequest++; },
    cover: filePath => {
      const request = ++activeCoverRequest;
      return metadataQueue(async () => {
        if (request !== activeCoverRequest) return null;
        try {
          const mm = await loadMusicMetadata();
          const metadata = await mm.parseFile(filePath, { duration: false, skipCovers: false });
          if (request !== activeCoverRequest) return null;
          return resizeArtwork(metadata.common?.picture?.[0], nativeImage, 1024, 85);
        } catch (_) { return null; }
      }, true);
    },
    thumbnail: dataUrl => metadataQueue(() => {
      if (typeof dataUrl !== 'string' || dataUrl.length > 3 * 1024 * 1024 || !new RegExp('^data:image/(png|jpeg|webp);base64,').test(dataUrl)) return null;
      const image = nativeImage.createFromDataURL(dataUrl);
      if (image.isEmpty()) return null;
      return encodeArtwork(image, 96, 75);
    }, true),
  },

  performance: {
    getHardwareAcceleration: () => ipcRenderer.invoke('performance:hardware-get'),
    setHardwareAcceleration: enabled => ipcRenderer.invoke('performance:hardware-set', enabled),
    restart: () => ipcRenderer.invoke('performance:restart'),
  },

  waveform: {
    get: filePath => ipcRenderer.invoke('waveform:get', filePath),
    set: payload => ipcRenderer.invoke('waveform:set', payload),
  },

  // ── .m3u плейлисты ──
  m3u: {
    build: (playlistName, items) => buildM3U(playlistName, items),
    parse: (text) => parseM3U(text),
  },

  // ── Автообновления (electron-updater) ──
  updater: {
    check: (silent) => ipcRenderer.invoke('updater:check', !!silent),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    onChecking: (cb) => ipcRenderer.on('updater:checking', () => cb()),
    onAvailable: (cb) => ipcRenderer.on('updater:available', (_e, info) => cb(info)),
    onNotAvailable: (cb) => ipcRenderer.on('updater:not-available', (_e, info) => cb(info)),
    onProgress: (cb) => ipcRenderer.on('updater:progress', (_e, progress) => cb(progress)),
    onDownloaded: (cb) => ipcRenderer.on('updater:downloaded', (_e, info) => cb(info)),
    onError: (cb) => ipcRenderer.on('updater:error', (_e, message) => cb(message)),
  },
});
