const { contextBridge, ipcRenderer } = require('electron');
// Kept inline: sandboxed Electron preloads cannot require local helper modules.
contextBridge.exposeInMainWorld('noctuneLocale', {
    initial: ipcRenderer.sendSync('i18n:initial'),
    set: input => ipcRenderer.invoke('i18n:set', input),
    onChange(callback) {
        const listener = () => callback();
        ipcRenderer.on('i18n:changed', listener);
        return () => ipcRenderer.removeListener('i18n:changed', listener);
    },
});

contextBridge.exposeInMainWorld('addonStore', {
    list: refresh => ipcRenderer.invoke('addon-store:list', refresh),
    onRefresh: callback => {
        const listener = () => callback();
        ipcRenderer.on('addon-store:refresh', listener);
        return () => ipcRenderer.removeListener('addon-store:refresh', listener);
    },
    install: id => ipcRenderer.invoke('addon-store:install', id),
    openLink: kind => ipcRenderer.invoke('addon-store:open-link', kind),
});
