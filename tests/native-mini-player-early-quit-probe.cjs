// A second process opening .noctheme quits before ready after handing off argv.
// Electron's lazy screen proxy must not be touched during that cleanup.
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { createMiniPlayer } = require('../src/main/mini-player');
process.on('uncaughtException', error => { console.error(error); app.exit(1); });
createMiniPlayer({ app, BrowserWindow, ipcMain, screen, getMainWindow: () => null,
    getStore: async () => ({ get: () => undefined }), quit: () => app.quit() });
app.on('will-quit', () => {
    if (app.isReady()) { console.error('Expected quit before ready'); app.exit(1); }
    console.log('PASS: mini-player shutdown before ready does not access screen.');
});
app.quit();
