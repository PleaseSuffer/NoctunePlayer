const path = require('node:path');
const { normalizeAppearance } = require('../window-appearance');
const { createAddonCatalog, REPOSITORY_URL, SUBMISSION_URL } = require('./catalog');

function createAddonStoreWindow({ BrowserWindow, ipcMain, installer, store, directory, appVersion, icon, shell, onInstalled, marketplace, themeInstaller, onThemeInstalled, themeStore, removalWindow, removeExtension, onThemeRemoved, catalog = createAddonCatalog({ directory, appVersion, store }) }) {
  let window = null, contents = null, installing = false, controller = null;
  let colors = normalizeAppearance();
  function session(event) {
    if (!window || window.isDestroyed() || event.sender !== contents || event.senderFrame !== contents.mainFrame) throw new Error((globalThis.noctuneI18n?.t("index.unavailableForThisWindow", {}) ?? "Недоступно для этого окна"));
    return window;
  }
  ipcMain.handle('addon-store:list', (event, refresh = false) => {
    session(event);
    if (!marketplace) return catalog.list(refresh);
    return Promise.all([catalog.list(refresh),marketplace.list(refresh)]).then(([official,extra])=>({...official,catalogs:Object.fromEntries([['official',official],['marketplace',extra]].map(([key,value])=>[key,{source:value.source,generatedAt:value.generatedAt,message:value.message}])),message:[...new Set([official.message,extra.message].filter(Boolean))].join(' '),entries:[...official.entries.map(entry=>({...entry,kind:'extension',channel:'official'})),...extra.entries]}));
  });
  ipcMain.handle('addon-store:install', async (event, id, kind = 'extension', channel = 'official') => {
    const owner = session(event);
    if (installing) throw new Error((globalThis.noctuneI18n?.t("themeInstaller.installationAlreadyInProgress", {}) ?? "Установка уже выполняется"));
    installing = true;
    const download = new AbortController(); controller = download;
    let lastSent = 0, sampleAt = Date.now(), sampleBytes = 0, speed = 0;
    let progress = { received: 0, total: null };
    function report(value) {
      if (owner !== window || owner.isDestroyed() || event.sender !== contents || contents.isDestroyed?.()) return;
      const now = Date.now(), phase = value.phase || 'downloading';
      if (phase === 'downloading' && value.received === 0) { sampleAt = now; sampleBytes = 0; speed = 0; }
      if (phase === 'downloading' && lastSent && now - lastSent < 120 && value.received !== value.total) return;
      const received = Math.max(0, Number(value.received) || 0);
      if (now > sampleAt && received > sampleBytes) {
        const rate = (received - sampleBytes) * 1000 / (now - sampleAt);
        speed = speed ? speed * .5 + rate * .5 : rate;
        sampleAt = now; sampleBytes = received;
      }
      progress = { received, total: Number.isSafeInteger(value.total) && value.total >= received ? value.total : null };
      lastSent = now;
      contents.send('addon-store:progress', { id, kind, channel, phase, ...progress, bytesPerSecond: speed });
    }
    let candidate;
    try {
      if (!['extension','theme'].includes(kind) || !['official','community'].includes(channel)) throw new Error('Некорректный раздел магазина');
      report({ phase: 'connecting', received: 0, total: null });
      const options = { onProgress: report, signal: download.signal };
      candidate = kind === 'extension' && channel === 'official' ? await catalog.prepare(id,options) : await marketplace.prepare(id,kind,channel,options);
      session(event);
      report({ phase: 'confirming', ...progress });
      const result = candidate.theme ? await themeInstaller.openPackage(candidate.theme, colors) : await installer.open(candidate.ticket, colors);
      if (result) { if (candidate.theme) onThemeInstalled?.(result); else onInstalled?.(result); }
      return { installed: !!result };
    } finally { if (candidate?.ticket) store.discard(candidate.ticket); if (controller === download) controller = null; installing = false; }
  });
  ipcMain.handle('addon-store:remove', async (event, id, kind = 'extension', channel = 'official') => {
    session(event);
    if (installing) throw new Error(globalThis.noctuneI18n?.t('themeInstaller.installationAlreadyInProgress') ?? 'Установка уже выполняется');
    if (!['extension','theme'].includes(kind) || !['official','community'].includes(channel)) throw new Error('Некорректный раздел магазина');
    installing = true;
    try {
      async function installedEntry() {
        const entries = (await (kind === 'extension' && channel === 'official' ? catalog : marketplace).list()).entries;
        const entry = entries.find(entry => entry.id === id && (entry.channel || 'official') === channel && (entry.kind || 'extension') === kind);
        if (!entry?.removable || !['installed','update'].includes(entry.state)) throw new Error(globalThis.noctuneI18n?.t('addonStore.removeUnavailable') ?? 'Этот пакет нельзя удалить из магазина');
        return entry;
      }
      await installedEntry();
      const current = kind === 'theme' ? (await themeStore.list()).themes.find(theme => theme.packageId === id && theme.removable) : (await store.list()).find(addon => addon.id === id);
      if (!current) throw new Error(globalThis.noctuneI18n?.t('addonStore.removeUnavailable') ?? 'Этот пакет нельзя удалить из магазина');
      return await removalWindow.open({ kind, name: current.name, author: current.author, description: current.description, version: current.version, preview: kind === 'theme' ? current.preview : current.artwork?.banner || current.artwork?.icon, width: current.width, height: current.height }, colors, async () => {
        session(event);
        await installedEntry();
        if (kind === 'theme') {
          const theme = (await themeStore.list()).themes.find(theme => theme.packageId === id && theme.removable);
          if (!theme) throw new Error(globalThis.noctuneI18n?.t('addonStore.removeUnavailable') ?? 'Этот пакет нельзя удалить из магазина');
          await themeStore.remove(theme.id); onThemeRemoved?.(theme);
        } else await removeExtension(id);
        return { removed: true };
      });
    } finally { installing = false; }
  });
  ipcMain.handle('addon-store:open-link', (event, kind) => {
    session(event);
    const links = { repository: REPOSITORY_URL, submission: SUBMISSION_URL, documentation: REPOSITORY_URL + '/blob/main/docs/extensions-publishing.md' };
    if (!Object.hasOwn(links, kind)) throw new Error((globalThis.noctuneI18n?.t("extensions.storeWindow.unknownLink", {}) ?? "Неизвестная ссылка"));
    return shell.openExternal(links[kind]);
  });
  return {
    open(appearance = {}) {
      colors = normalizeAppearance(appearance);
      if (window && !window.isDestroyed()) { window.show(); window.focus(); if(appearance?.section==='themes') contents.send('addon-store:refresh',{section:'themes'}); else contents.send('addon-store:refresh'); return; }
      const { theme, accent } = colors;
      window = new BrowserWindow({ title: (globalThis.noctuneI18n?.t('marketplace.windowTitle') ?? 'NocStore'), width: 1040, height: 800, minWidth: 620, minHeight: 560, show: false, backgroundColor: theme === 'light' ? '#f4f7f6' : '#15151b', icon, autoHideMenuBar: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, '../../preload/addon-store.js') } });
      const current = window; contents = current.webContents;
      current.setMenu(null);
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
      contents.on('will-navigate', event => event.preventDefault());
      contents.on('will-frame-navigate', event => event.preventDefault());
      current.once('ready-to-show', () => { if (!current.isDestroyed()) { current.show(); current.focus(); } });
      current.once('closed', () => { if (window === current) { controller?.abort(); window = null; contents = null; } });
      return current.loadFile(path.join(__dirname, '../../renderer/addon-store/index.html'), { query: { theme, accent, section: appearance?.section === 'themes' ? 'themes' : 'extensions' } }).catch(error => { current.destroy(); throw error; });
    },
  };
}
module.exports = { createAddonStoreWindow };
