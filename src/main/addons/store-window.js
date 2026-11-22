const path = require('node:path');
const { createAddonCatalog, REPOSITORY_URL, SUBMISSION_URL } = require('./catalog');

function createAddonStoreWindow({ BrowserWindow, ipcMain, installer, store, directory, appVersion, icon, shell, onInstalled, marketplace, themeInstaller, onThemeInstalled, catalog = createAddonCatalog({ directory, appVersion, store }) }) {
  let window = null, contents = null, installing = false;
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
    session(event);
    if (installing) throw new Error((globalThis.noctuneI18n?.t("themeInstaller.installationAlreadyInProgress", {}) ?? "Установка уже выполняется"));
    installing = true;
    let candidate;
    try {
      if (!['extension','theme'].includes(kind) || !['official','community'].includes(channel)) throw new Error('Некорректный раздел магазина');
      candidate = kind === 'extension' && channel === 'official' ? await catalog.prepare(id) : await marketplace.prepare(id,kind,channel);
      session(event);
      const result = candidate.theme ? await themeInstaller.openPackage(candidate.theme) : await installer.open(candidate.ticket);
      if (result) { if (candidate.theme) onThemeInstalled?.(result); else onInstalled?.(result); }
      return { installed: !!result };
    } finally { if (candidate?.ticket) store.discard(candidate.ticket); installing = false; }
  });
  ipcMain.handle('addon-store:open-link', (event, kind) => {
    session(event);
    const links = { repository: REPOSITORY_URL, submission: SUBMISSION_URL, documentation: REPOSITORY_URL + '/blob/main/docs/extensions-publishing.md' };
    if (!Object.hasOwn(links, kind)) throw new Error((globalThis.noctuneI18n?.t("extensions.storeWindow.unknownLink", {}) ?? "Неизвестная ссылка"));
    return shell.openExternal(links[kind]);
  });
  return {
    open(appearance = {}) {
      if (window && !window.isDestroyed()) { window.show(); window.focus(); if(appearance?.section==='themes') contents.send('addon-store:refresh',{section:'themes'}); else contents.send('addon-store:refresh'); return; }
      const theme = appearance?.theme === 'light' ? 'light' : 'dark';
      const accent = /^#[a-f0-9]{6}$/i.test(appearance?.accent) ? appearance.accent : '#ac91ee';
      window = new BrowserWindow({ title: (globalThis.noctuneI18n?.t('marketplace.windowTitle') ?? 'Магазин — Noctune'), width: 1040, height: 800, minWidth: 620, minHeight: 560, show: false, backgroundColor: theme === 'light' ? '#f4f7f6' : '#15151b', icon, autoHideMenuBar: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, '../../preload/addon-store.js') } });
      const current = window; contents = current.webContents;
      current.setMenu(null);
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
      contents.on('will-navigate', event => event.preventDefault());
      contents.on('will-frame-navigate', event => event.preventDefault());
      current.once('ready-to-show', () => { if (!current.isDestroyed()) { current.show(); current.focus(); } });
      current.once('closed', () => { if (window === current) { window = null; contents = null; } });
      return current.loadFile(path.join(__dirname, '../../renderer/addon-store/index.html'), { query: { theme, accent, section: appearance?.section === 'themes' ? 'themes' : 'extensions' } }).catch(error => { current.destroy(); throw error; });
    },
  };
}
module.exports = { createAddonStoreWindow };
