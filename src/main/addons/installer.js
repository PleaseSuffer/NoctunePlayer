const path = require('node:path');
const { normalizeAppearance } = require('../window-appearance');

function createAddonInstaller({ BrowserWindow, ipcMain, store, icon, getAppearance = () => ({}) }) {
  const sessions = new Map();
  const tickets = new Map();
  function session(event) {
    const entry = sessions.get(event.sender);
    if (!entry || event.senderFrame !== entry.window.webContents.mainFrame) throw new Error((globalThis.noctuneI18n?.t("index.unavailableForThisWindow", {}) ?? "Недоступно для этого окна"));
    return entry;
  }
  ipcMain.handle('addon-install:details', event => session(event).preview);
  ipcMain.handle('addon-install:confirm', async (event, acceptRotation) => {
    const entry = session(event);
    if (entry.installing) return { ok: false, error: (globalThis.noctuneI18n?.t("themeInstaller.installationAlreadyInProgress", {}) ?? "Установка уже выполняется") };
    if (entry.preview.state === 'installed') return { ok: true, installed: true };
    entry.installing = true;
    try {
      const result = await store.confirm(entry.ticket, acceptRotation === true);
      entry.resolve(result);
      entry.window.destroy();
      return { ok: true };
    } catch (error) {
      entry.installing = false;
      return { ok: false, error: error.message || (globalThis.noctuneI18n?.t("extensions.installer.couldNotInstallExtension", {}) ?? "Не удалось установить расширение") };
    }
  });
  ipcMain.on('addon-install:cancel', event => {
    const entry = session(event);
    if (!entry.installing) entry.window.close();
  });
  return {
    open(ticket, appearance) {
      const existing = tickets.get(ticket);
      if (existing) { existing.window.show(); existing.window.focus(); return existing.promise; }
      if (!appearance) {
        const value = getAppearance();
        if (value?.then) return value.then(colors => this.open(ticket, colors));
        appearance = value;
      }
      const colors = normalizeAppearance(appearance);
      // Metadata and the immutable package snapshot belong to main, not the caller.
      const preview = store.preview(ticket);
      const window = new BrowserWindow({
        title: preview.state === 'update' ? (globalThis.noctuneI18n?.t("extensions.installer.updateExtensionNoctune", {}) ?? "Обновление расширения — Noctune") : (globalThis.noctuneI18n?.t("addonInstall.installExtensionNoctune", {}) ?? "Установка расширения — Noctune"),
        width: 640, height: 780, minWidth: 520, minHeight: 600,
        show: false, backgroundColor: colors.theme === 'light' ? '#f4f7f6' : '#15151b', icon, autoHideMenuBar: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, '../../preload/addon-installer.js') },
      });
      let resolve, reject;
      const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
      const entry = { window, ticket, preview, promise, resolve, installing: false };
      const contents = window.webContents;
      sessions.set(contents, entry); tickets.set(ticket, entry);
      window.setMenu(null);
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', event => event.preventDefault());
      window.webContents.on('will-frame-navigate', event => event.preventDefault());
      window.once('ready-to-show', () => { window.show(); window.focus(); });
      window.on('close', event => { if (entry.installing) event.preventDefault(); });
      window.once('closed', () => {
        sessions.delete(contents); tickets.delete(ticket);
        store.discard(ticket); resolve(null);
      });
      window.loadFile(path.join(__dirname, '../../renderer/addon-install/index.html'), { query: colors }).catch(error => { reject(error); window.destroy(); });
      return promise;
    },
  };
}
module.exports = { createAddonInstaller };
