const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('addonStore', {
    list: refresh => ipcRenderer.invoke('addon-store:list', refresh),
    install: id => ipcRenderer.invoke('addon-store:install', id),
    openLink: kind => ipcRenderer.invoke('addon-store:open-link', kind),
});
