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

contextBridge.exposeInMainWorld('miniPlayer', {
    getSettings: () => ipcRenderer.invoke('mini-player:get-settings'),
    command: (action, value) => ipcRenderer.send('mini-player:command', { action, value }),
    onState: callback => ipcRenderer.on('mini-player:state', (_event, state) => callback(state)),
    onSettings: callback => ipcRenderer.on('mini-player:settings', (_event, settings) => callback(settings)),
    onOpacity: callback => ipcRenderer.on('mini-player:opacity', (_event, opacity) => callback(opacity)),
});
