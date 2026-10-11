const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('themeInstaller', {
    details: () => ipcRenderer.invoke('theme-install:details'),
    install: () => ipcRenderer.invoke('theme-install:confirm'),
    cancel: () => ipcRenderer.send('theme-install:cancel'),
});
