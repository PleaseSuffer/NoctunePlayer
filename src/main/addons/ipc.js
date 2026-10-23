const { createAddonStore } = require('./store');
const { createAddonInstaller } = require('./installer');
const { createAddonCatalog } = require('./catalog');

function registerAddonIpc({ ipcMain, BrowserWindow, dialog, getWindow, directory, appVersion, icon, safeStorage, shell, clipboard }) {
  const store = createAddonStore({ directory, appVersion });
  const credentialDialog = require('./credentials-dialog').createCredentialDialog({ BrowserWindow, ipcMain });
  const services = require('./services').createAddonServices({ store, directory, safeStorage, shell, clipboard, dialog, getWindow, credentialDialog });
  const installer = createAddonInstaller({ BrowserWindow, ipcMain, store, icon });
  const catalog = createAddonCatalog({ directory, appVersion, store });
  const shop = require('./store-window').createAddonStoreWindow({ BrowserWindow, ipcMain, installer, store, directory, appVersion, icon, shell, catalog, onInstalled: () => {
    const window = getWindow();
    if (window && !window.isDestroyed()) window.webContents.send('addons:changed');
  } });
  const downloads = new Map();
  const fileInstalls = new Map();
  store.openFile = file => {
    const existing = fileInstalls.get(file);
    if (existing) { if(existing.ticket)installer.open(existing.ticket).catch(()=>{});return existing.promise; }
    const entry = {};
    entry.promise = (async()=>{
      const preview = await store.prepareFile(file);entry.ticket=preview.ticket;
      const installed = await installer.open(preview.ticket);
      const win=getWindow();if(installed&&win&&!win.isDestroyed())win.webContents.send('addons:changed');
      return installed;
    })().finally(()=>fileInstalls.delete(file));
    fileInstalls.set(file,entry);return entry.promise;
  };
  function sender(event) {
    const win = getWindow();
    if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Недоступно для этого окна');
    return win;
  }
  const handle = (channel, callback) => ipcMain.handle('addons:' + channel, (event, ...args) => { sender(event); return callback(event, ...args); });
  handle('settings', (_event, id) => store.settings(id));
  handle('set-settings', (_event, id, value) => store.setSettings(id, value));
  handle('services', (_event, id, hash, method, args) => services.invoke(id, hash, method, args));
  handle('library-file', async (_event, id, hash, filename) => { await store.context(id, hash, 'files.library'); return services.grantFile(id, hash, filename); });
  handle('list', () => store.list());
  handle('open-store', (_event, appearance) => shop.open(appearance));
  handle('runtime', () => store.runtime());
  handle('prepare-file', async event => {
    const choice = await dialog.showOpenDialog(sender(event), { title: 'Установить расширение', properties: ['openFile'], filters: [{ name: 'Noctune Extension', extensions: ['noctaddon'] }] });
    return choice.canceled || !choice.filePaths[0] ? null : store.prepareFile(choice.filePaths[0]);
  });
  handle('prepare-url', (_event, url) => store.prepareUrl(url));
  handle('open-installer', (_event, ticket) => installer.open(ticket));
  handle('discard', (_event, ticket) => store.discard(ticket));
  function abort(id) {
    services.cancel(id);
    const pending = downloads.get(id);
    if (pending) { for (const controller of pending) controller.abort(); downloads.delete(id); }
  }
  handle('enable', async (_event, id, enabled) => { await store.setEnabled(id, enabled); if (!enabled) abort(id); });
  handle('remove', async (_event, id) => { await store.remove(id); await services.remove(id); abort(id); });
  handle('rollback', async (_event, id) => { const result = await store.rollback(id); abort(id); return result; });
  handle('check-update', async (_event, id) => {
    const current = (await store.list()).find(item=>item.id===id);
    return current?.verifiedPublisher === 'Noctune' ? catalog.checkUpdate(id) : store.checkUpdate(id);
  });
  handle('invoke', (_event, id, hash, method, args) => store.invoke(id, hash, method, args));
  handle('request', async (_event, id, hash, url) => {
    const pending = downloads.get(id) || new Set();
    if (pending.size >= 3) throw new Error('Разрешено не более трёх одновременных запросов');
    const controller = new AbortController(); pending.add(controller); downloads.set(id, pending);
    try { return await store.request(id, hash, url, controller.signal); }
    finally { pending.delete(controller); if (!pending.size) downloads.delete(id); }
  });
  handle('cancel-requests', (_event, id) => abort(id));
  store.stream = request => services.stream(request);
  return store;
}
module.exports = { registerAddonIpc };
