const path = require('node:path');
function createCredentialDialog({ BrowserWindow, ipcMain }) {
  const sessions = new Map();
  function entry(event) {
    const item = sessions.get(event.sender);
    if (!item || event.senderFrame !== item.window.webContents.mainFrame) throw new Error('Недоступно для этого окна');
    return item;
  }
  ipcMain.handle('addon-credential:details', event => entry(event).details);
  ipcMain.handle('addon-credential:save', async (event, payload) => {
    const item = entry(event);
    const { value, expiresAt } = payload || {};
    if (expiresAt !== null && expiresAt !== undefined && (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now())) return { ok:false,error:'Укажите срок действия в будущем' };
    if (item.saving) return { ok: false };
    if (typeof value !== 'string' || !value.trim() || value.length > 16000 || /[\r\n\0]/.test(value)) return { ok: false, error: 'Нужен непустой ключ без переносов строк' };
    item.saving = true;
    try { await item.save({value,expiresAt:expiresAt||null}); item.resolve({ configured: true }); item.window.destroy(); return { ok: true }; }
    catch (_) { item.saving = false; return { ok: false, error: 'Не удалось сохранить ключ. Проверьте защищённое хранилище и состояние расширения.' }; }
  });
  ipcMain.on('addon-credential:cancel', event => { const item = entry(event); if (!item.saving) item.window.close(); });
  return {
    cancel(id) { for (const item of sessions.values()) if (item.id === id) item.window.destroy(); },
    open(id, details, save) {
      for (const item of sessions.values()) if (item.id === id) { if (JSON.stringify(item.details)!==JSON.stringify(details)) throw new Error('Завершите настройку открытого профиля'); item.window.focus(); return item.promise; }
      const window = new BrowserWindow({ width: 560, height: 500, minWidth: 480, minHeight: 420, show: false, title: 'Ключ доступа — Noctune', autoHideMenuBar: true, backgroundColor: '#15151b', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, '../../preload/addon-credential.js') } });
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
