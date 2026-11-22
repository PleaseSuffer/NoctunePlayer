const path = require('node:path');
function createCredentialDialog({ BrowserWindow, ipcMain, shell }) {
  const sessions = new Map();
  function entry(event) {
    const item = sessions.get(event.sender);
    if (!item || event.senderFrame !== item.window.webContents.mainFrame) throw new Error((globalThis.noctuneI18n?.t("index.unavailableForThisWindow", {}) ?? "Недоступно для этого окна"));
    return item;
  }
  ipcMain.handle('addon-credential:details', event => entry(event).details);
  function expiration(item, input) {
    if (input === null || input === undefined || input === '') { item.expiration = null; return { ok: true, expiresAt: null }; }
    const invalid = () => ({ ok: false, error: globalThis.noctuneI18n?.t('addonCredential.expirationInvalid') ?? 'Введите целое число секунд больше 86400 (одних суток).' });
    if (typeof input !== 'string' || !/^\d{1,12}$/.test(input.trim())) return invalid();
    const seconds = Number(input.trim());
    if (!Number.isSafeInteger(seconds) || seconds <= 86400) return invalid();
    // Keep the deadline stable across previews and save retries for this value.
    if (item.expiration?.seconds !== seconds) item.expiration = { seconds, expiresAt: Date.now() + (seconds - 86400) * 1000 };
    if (item.expiration.expiresAt <= Date.now()) return { ok: false, error: globalThis.noctuneI18n?.t('addonCredential.expirationElapsed') ?? 'Указанный срок уже истёк с учётом запаса. Получите новый токен.' };
    return { ok: true, expiresAt: item.expiration.expiresAt };
  }
  ipcMain.handle('addon-credential:expiry', (event, seconds) => expiration(entry(event), seconds));
  ipcMain.handle('addon-credential:open-link', async (event, index) => {
    const item = entry(event);
    if (!Number.isInteger(index) || index < 0 || !item.details.links?.[index]) throw new Error('Unknown credential help link');
    const link = item.details.links[index], url = new URL(link.url);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid credential help URL');
    await shell.openExternal(link.url);
    return { ok: true };
  });
  ipcMain.handle('addon-credential:save', async (event, payload) => {
    const item = entry(event);
    const { value, expiresIn } = payload || {};
    if (payload?.expiresAt !== undefined) return { ok: false, error: 'Absolute expiration dates are not accepted by this form' };
    const result = expiration(item, expiresIn);
    if (!result.ok) return result;
    const expiresAt = result.expiresAt;
    if (item.saving) return { ok: false };
    if (typeof value !== 'string' || !value.trim() || value.length > 16000 || /[\r\n\0]/.test(value)) return { ok: false, error: (globalThis.noctuneI18n?.t("extensions.credentialsDialog.aNonEmptyKeyWithoutLineBreaksIsRequired", {}) ?? "Нужен непустой ключ без переносов строк") };
    item.saving = true;
    try { await item.save({value,expiresAt:expiresAt||null}); item.resolve({ configured: true }); item.window.destroy(); return { ok: true }; }
    catch (_) { item.saving = false; return { ok: false, error: (globalThis.noctuneI18n?.t("extensions.credentialsDialog.couldNotSaveTheKeyCheckSecureStorageAndExtensionStatus", {}) ?? "Не удалось сохранить ключ. Проверьте защищённое хранилище и состояние расширения.") }; }
  });
  ipcMain.on('addon-credential:cancel', event => { const item = entry(event); if (!item.saving) item.window.close(); });
  return {
    cancel(id) { for (const item of sessions.values()) if (item.id === id) item.window.destroy(); },
    open(id, details, save) {
      for (const item of sessions.values()) if (item.id === id) { if (JSON.stringify(item.details)!==JSON.stringify(details)) throw new Error((globalThis.noctuneI18n?.t("extensions.credentialsDialog.finishConfiguringTheOpenProfile") ?? "Завершите настройку открытого профиля")); item.window.focus(); return item.promise; }
      const window = new BrowserWindow({ width: 560, height: 720, minWidth: 480, minHeight: 420, show: false, title: (globalThis.noctuneI18n?.t("addonCredential.accessKeyNoctune") ?? "Ключ доступа — Noctune"), autoHideMenuBar: true, backgroundColor: '#15151b', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, '../../preload/addon-credential.js') } });
      let resolve;
      const promise = new Promise(done => { resolve = done; });
      const item = { id, details, save, window, resolve, promise, saving: false };
      const contents=window.webContents; sessions.set(contents, item);
      window.setMenu(null); window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', event => event.preventDefault()); window.webContents.on('will-frame-navigate', event => event.preventDefault());
      window.on('close', event => { if (item.saving) event.preventDefault(); });
      window.once('closed', () => { sessions.delete(contents); resolve({ configured: false }); });
      window.once('ready-to-show', () => window.show());
      window.loadFile(path.join(__dirname, '../../renderer/addon-credential/index.html')).catch(() => window.destroy());
      return promise;
    },
  };
}
module.exports = { createCredentialDialog };
