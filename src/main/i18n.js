const fs = require('node:fs');
const path = require('node:path');
const i18n = require('../shared/i18n');

function installI18n({ app, ipcMain, BrowserWindow, getStore, getMainWindow }) {
    let languagePack = null;
    try {
        const config = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'config.json'), 'utf8'));
        if (config.languagePack) { i18n.register(config.languagePack.owner || 'user-selection', config.languagePack); languagePack = config.languagePack; }
        i18n.setLocale(config.language || 'ru');
    } catch { /* Missing or obsolete preference uses the bundled Russian locale. */ }
    function sender(event) {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win || event.senderFrame !== event.sender.mainFrame) throw new Error((globalThis.noctuneI18n?.t("language.errors.unavailableForThisWindow") ?? "Unavailable for this window"));
        return win;
    }
    ipcMain.on('i18n:initial', event => { try { sender(event); event.returnValue = { locale: i18n.locale, pack: languagePack, catalogs: require('../shared/locales') }; } catch { event.returnValue = null; } });
    ipcMain.handle('i18n:set', async (event, input) => {
        if (sender(event) !== getMainWindow()) throw new Error((globalThis.noctuneI18n?.t("language.errors.onlyPlayerSettingsCanChangeLanguage") ?? "Only player settings can change language"));
        if (!input || typeof input.locale !== 'string') throw new Error((globalThis.noctuneI18n?.t("language.errors.invalidLanguage") ?? "Invalid language"));
        // Validate in isolation before modifying the active registry or preference.
        if (input.pack) {
            if (input.pack.locale !== input.locale) throw new Error((globalThis.noctuneI18n?.t("language.errors.languagePackMismatch") ?? "Language pack mismatch"));
            i18n.validateMessages(input.pack.messages);
            i18n.register(input.pack.owner || 'user-selection', input.pack);
        }
        const previous = i18n.locale;
        i18n.setLocale(input.locale);
        try {
            const store = await getStore();
            store.set({ language: input.locale, languagePack: input.pack || null });
            languagePack = input.pack || null;
        } catch (error) { i18n.setLocale(previous); throw error; }
        for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('i18n:changed');
        return input.locale;
    });
    return i18n;
}
module.exports = { installI18n };
