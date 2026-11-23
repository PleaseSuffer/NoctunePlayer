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
    preview: (request, id, kind, channel) => ipcRenderer.invoke('addon-store:preview', request, id, kind, channel),
    cancelPreview: request => ipcRenderer.invoke('addon-store:cancel-preview', request),
    clearPreviews: () => ipcRenderer.invoke('addon-store:clear-previews'),
    previewCache: () => ipcRenderer.invoke('addon-store:preview-cache'),
    onProgress: callback => {
        const listener = (_event, progress) => callback(progress);
        ipcRenderer.on('addon-store:progress', listener);
        return () => ipcRenderer.removeListener('addon-store:progress', listener);
    },
    list: refresh => ipcRenderer.invoke('addon-store:list', refresh),
    onRefresh: callback => {
        const listener = (_event, state) => callback(state);
        ipcRenderer.on('addon-store:refresh', listener);
        return () => ipcRenderer.removeListener('addon-store:refresh', listener);
    },
    install: async (id, kind, channel) => {
        try { return await ipcRenderer.invoke('addon-store:install', id, kind, channel); }
        catch (error) { throw new Error(String(error.message).replace(/^Error invoking remote method 'addon-store:install': (?:Error: )?/, '')); }
    },
    remove: async (id, kind, channel) => {
        try { return await ipcRenderer.invoke('addon-store:remove', id, kind, channel); }
        catch (error) { throw new Error(String(error.message).replace(/^Error invoking remote method 'addon-store:remove': (?:Error: )?/, '')); }
    },
    openLink: kind => ipcRenderer.invoke('addon-store:open-link', kind),
});
