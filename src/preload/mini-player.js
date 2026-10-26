const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('miniPlayer', {
    getSettings: () => ipcRenderer.invoke('mini-player:get-settings'),
    command: (action, value) => ipcRenderer.send('mini-player:command', { action, value }),
    onState: callback => ipcRenderer.on('mini-player:state', (_event, state) => callback(state)),
    onSettings: callback => ipcRenderer.on('mini-player:settings', (_event, settings) => callback(settings)),
});
