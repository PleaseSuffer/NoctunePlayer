const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
if (process.platform !== 'win32') { app.whenReady().then(() => { console.log('SKIP: Windows identity probe'); app.exit(0); }); }
else {
    const root = path.resolve(__dirname, '..');
    const archive = process.argv.find(value => value.startsWith('--app-asar='))?.slice('--app-asar='.length);
    const sdkRoot = archive ? path.resolve(archive) : root;
    const profiles = path.join(__dirname, '.artifacts', 'windows-identity'); fs.mkdirSync(profiles, { recursive: true });
    app.setPath('userData', fs.mkdtempSync(path.join(profiles, 'profile-')));
    if (archive) app.setAppPath(sdkRoot);
    // Reproduce the packaged probes that previously registered Electron as Noctune.
    Object.defineProperty(app, 'isPackaged', { value: true });
    require('electron-updater').autoUpdater.checkForUpdates = async () => null;
    const setId = app.setAppUserModelId.bind(app), setDetails = BrowserWindow.prototype.setAppDetails;
    let processId; const windows = new Map();
    app.setAppUserModelId = id => { processId = id; return setId(id); };
    BrowserWindow.prototype.setAppDetails = function (details) { setDetails.call(this, details); windows.set(this.id, details); };
    app.on('browser-window-created', (_, window) => {
        assert.equal(processId, 'com.noctune.player.dev', 'identity must be isolated before the first window');
        window.webContents.on('did-finish-load', () => {
            if (!window.webContents.getURL().endsWith('/renderer/index.html')) return;
            try {
                assert(windows.size >= 2, 'splash and main windows have explicit shell metadata');
                for (const details of windows.values()) {
                    assert.equal(details.appId, 'com.noctune.player.dev');
                    assert(!details.appIconPath.includes('.asar'), 'shell icon is a physical file');
                    assert.equal(details.relaunchDisplayName, 'Noctune (development)');
                    assert(details.relaunchCommand.includes(process.execPath));
                }
                console.log('PASS: real Electron accepts early process/window shell identities; forced packaged status cannot claim the installed Noctune identity.');
                app.exit(0);
            } catch (error) { console.error(error); app.exit(1); }
        });
    });
    require(path.join(sdkRoot, 'src/main/index.js'));
    setTimeout(() => { console.error('Windows identity probe timeout'); app.exit(1); }, 30000);
}
