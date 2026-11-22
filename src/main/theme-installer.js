const path = require('node:path');
const { readPackage, validatePackage } = require('./scene-themes');

function createThemeInstaller({ BrowserWindow, ipcMain, store, icon }) {
    const sessions = new Map();
    function session(event) {
        const entry = sessions.get(event.sender);
        if (!entry || event.senderFrame !== entry.window.webContents.mainFrame) throw new Error((globalThis.noctuneI18n?.t("index.unavailableForThisWindow", {}) ?? "Недоступно для этого окна"));
        return entry;
    }
    ipcMain.handle('theme-install:details', async event => {
        const { theme } = session(event);
        const status = await store.installationStatus(theme);
        return { ...theme.manifest, preview: theme.assets[theme.manifest.preview], installation: { state: status.state, installedVersion: status.installedVersion } };
    });
    ipcMain.handle('theme-install:confirm', async event => {
        const entry = session(event);
        if (entry.installing) return { ok: false, error: (globalThis.noctuneI18n?.t("themeInstaller.installationAlreadyInProgress", {}) ?? "Установка уже выполняется") };
        entry.installing = true;
        try {
            const imported = await store.installPackage(entry.theme);
            if (imported.unchanged) {
                entry.installing = false;
                return { ok: true, installed: true };
            }
            entry.resolve(imported);
            entry.window.destroy();
            return { ok: true };
        } catch (error) {
            entry.installing = false;
            return { ok: false, error: (globalThis.noctuneI18n?.t("themeInstaller.couldNotInstallTheme", {}) ?? "Не удалось установить тему: ") + error.message };
        }
    });
    ipcMain.on('theme-install:cancel', event => {
        const entry = session(event);
        if (!entry.installing) entry.window.close();
    });
    return {
        async open(file) { return this.openPackage(await readPackage(file)); },
        async openPackage(value) {
            // Preview the validated snapshot only; scene code runs only after the user selects an installed theme.
            const theme = validatePackage(JSON.parse(JSON.stringify(value)));
            return new Promise((resolve, reject) => {
                const window = new BrowserWindow({
                    title: (globalThis.noctuneI18n?.t("themeInstall.installThemeNoctune", {}) ?? "Установка темы — Noctune"), width: 640, height: 740,
                    minWidth: 520, minHeight: 640, show: false, backgroundColor: '#15151b', icon,
                    autoHideMenuBar: true,
                    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true,
                        preload: path.join(__dirname, '../preload/theme-installer.js') },
                });
                const entry = { window, theme, resolve, installing: false };
                const contents = window.webContents;
                sessions.set(contents, entry);
                window.setMenu(null);
                window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
                window.webContents.on('will-navigate', event => event.preventDefault());
                window.webContents.on('will-frame-navigate', event => event.preventDefault());
                window.once('ready-to-show', () => { window.show(); window.focus(); });
                window.on('close', event => { if (entry.installing) event.preventDefault(); });
                window.once('closed', () => { sessions.delete(contents); resolve(null); });
                window.loadFile(path.join(__dirname, '../renderer/theme-install/index.html')).catch(error => { reject(error); window.destroy(); });
            });
        },
    };
}
module.exports = { createThemeInstaller };
