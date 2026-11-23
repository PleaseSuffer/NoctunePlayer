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

contextBridge.exposeInMainWorld('packageRemoval', {
    details: () => ipcRenderer.invoke('package-removal:details'),
    confirm: () => ipcRenderer.invoke('package-removal:confirm'),
    cancel: () => ipcRenderer.send('package-removal:cancel'),
});
