const path = require('node:path');
const { normalizeAppearance } = require('./window-appearance');
function createPackageRemoval({ BrowserWindow, ipcMain, icon }) {
  const sessions = new Map();
  function session(event) {
    const entry = sessions.get(event.sender);
    if (!entry || event.senderFrame !== entry.window.webContents.mainFrame) throw new Error(globalThis.noctuneI18n?.t('index.unavailableForThisWindow') ?? 'Недоступно для этого окна');
    return entry;
  }
  ipcMain.handle('package-removal:details', event => session(event).details);
  ipcMain.handle('package-removal:confirm', async event => {
    const entry = session(event);
    if (entry.busy) return { ok: false, error: globalThis.noctuneI18n?.t('packageRemoval.removing') ?? 'Удаление…' };
    entry.busy = true;
    try {
      const result = await entry.remove();
      entry.resolve(result); entry.window.destroy();
      return { ok: true };
    } catch (error) {
      entry.busy = false;
      return { ok: false, error: error.message || (globalThis.noctuneI18n?.t('addonStore.removeFailed') ?? 'Не удалось удалить пакет') };
    }
  });
  ipcMain.on('package-removal:cancel', event => { const entry = session(event); if (!entry.busy) entry.window.close(); });
  return {
    open(details, appearance, remove) {
      const colors = normalizeAppearance(appearance);
      const key = details.kind === 'theme' ? 'packageRemoval.themeTitle' : 'packageRemoval.extensionTitle';
      const window = new BrowserWindow({ title: globalThis.noctuneI18n?.t(key) ?? 'Удаление — Noctune', width: 640, height: 740, minWidth: 520, minHeight: 600, show: false, backgroundColor: colors.theme === 'light' ? '#f4f7f6' : '#15151b', icon, autoHideMenuBar: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, '../preload/package-removal.js') } });
      return new Promise((resolve, reject) => {
        const contents = window.webContents;
        sessions.set(contents, { window, details: structuredClone(details), remove, resolve, busy: false });
        window.setMenu(null);
        contents.setWindowOpenHandler(() => ({ action: 'deny' }));
        contents.on('will-navigate', event => event.preventDefault());
        contents.on('will-frame-navigate', event => event.preventDefault());
        window.once('ready-to-show', () => { if (!window.isDestroyed()) { window.show(); window.focus(); } });
        window.on('close', event => { if (sessions.get(contents)?.busy) event.preventDefault(); });
        window.once('closed', () => { sessions.delete(contents); resolve({ removed: false }); });
        window.loadFile(path.join(__dirname, '../renderer/theme-install/index.html'), { query: { ...colors, action: 'remove', kind: details.kind } }).catch(error => { reject(error); window.destroy(); });
      });
    },
  };
}
module.exports = { createPackageRemoval };
