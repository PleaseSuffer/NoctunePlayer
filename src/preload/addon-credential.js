const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('credentialDialog', { details: () => ipcRenderer.invoke('addon-credential:details'), save: value => ipcRenderer.invoke('addon-credential:save', value), cancel: () => ipcRenderer.send('addon-credential:cancel') });
