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

contextBridge.exposeInMainWorld('credentialDialog', { details: () => ipcRenderer.invoke('addon-credential:details'), expiry: seconds => ipcRenderer.invoke('addon-credential:expiry', seconds), openLink: index => ipcRenderer.invoke('addon-credential:open-link', index), save: value => ipcRenderer.invoke('addon-credential:save', value), cancel: () => ipcRenderer.send('addon-credential:cancel') });
