const { contextBridge, ipcRenderer } = require('electron');
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
