const path = require('node:path');
const { createAddonCatalog, REPOSITORY_URL, SUBMISSION_URL } = require('./catalog');

function createAddonStoreWindow({ BrowserWindow, ipcMain, installer, store, directory, appVersion, icon, shell, onInstalled, catalog = createAddonCatalog({ directory, appVersion, store }) }) {
  let window = null, contents = null, installing = false;
  function session(event) {
    if (!window || window.isDestroyed() || event.sender !== contents || event.senderFrame !== contents.mainFrame) throw new Error('Недоступно для этого окна');
    return window;
  }
  ipcMain.handle('addon-store:list', (event, refresh = false) => { session(event); return catalog.list(refresh); });
  ipcMain.handle('addon-store:install', async (event, id) => {
    session(event);
    if (installing) throw new Error('Установка уже выполняется');
    installing = true;
    let candidate;
    try {
      candidate = await catalog.prepare(id);
      session(event);
      const result = await installer.open(candidate.ticket);
      if (result) onInstalled?.(result);
      return { installed: !!result };
    } finally { if (candidate) store.discard(candidate.ticket); installing = false; }
  });
  ipcMain.handle('addon-store:open-link', (event, kind) => {
    session(event);
    const links = { repository: REPOSITORY_URL, submission: SUBMISSION_URL, documentation: REPOSITORY_URL + '/blob/main/docs/extensions-publishing.md' };
    if (!Object.hasOwn(links, kind)) throw new Error('Неизвестная ссылка');
    return shell.openExternal(links[kind]);
  });
  return {
    open(appearance = {}) {
      if (window && !window.isDestroyed()) { window.show(); window.focus(); contents.send('addon-store:refresh'); return; }
      const theme = appearance?.theme === 'light' ? 'light' : 'dark';
      const accent = /^#[a-f0-9]{6}$/i.test(appearance?.accent) ? appearance.accent : '#ac91ee';
      window = new BrowserWindow({ title: 'Магазин расширений — Noctune', width: 1040, height: 800, minWidth: 620, minHeight: 560, show: false, backgroundColor: theme === 'light' ? '#f4f7f6' : '#15151b', icon, autoHideMenuBar: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, '../../preload/addon-store.js') } });
      const current = window; contents = current.webContents;
      current.setMenu(null);
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
      contents.on('will-navigate', event => event.preventDefault());
      contents.on('will-frame-navigate', event => event.preventDefault());
      current.once('ready-to-show', () => { if (!current.isDestroyed()) { current.show(); current.focus(); } });
      current.once('closed', () => { if (window === current) { window = null; contents = null; } });
      return current.loadFile(path.join(__dirname, '../../renderer/addon-store/index.html'), { query: { theme, accent } }).catch(error => { current.destroy(); throw error; });
    },
  };
}
module.exports = { createAddonStoreWindow };
