const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('addonInstaller', {
    details: () => ipcRenderer.invoke('addon-install:details'),
    install: () => ipcRenderer.invoke('addon-install:confirm'),
    cancel: () => ipcRenderer.send('addon-install:cancel'),
});
