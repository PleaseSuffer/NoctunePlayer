const path = require('node:path');

function windowsAppDetails({ isPackaged, defaultApp, execPath, appPath, iconPath }) {
    // Packaged-ASAR probes run inside stock Electron and may override isPackaged.
    // They must never register Electron.lnk under the installed player's identity.
    const stockElectron = /^electron(?:\.exe)?$/i.test(path.win32.basename(execPath));
    const installed = isPackaged && !defaultApp && !stockElectron;
    const quote = value => '"' + value + '"';
    return {
        appId: installed ? 'com.noctune.player' : 'com.noctune.player.dev',
        // The Windows shell cannot read icon files inside app.asar.
        appIconPath: installed || /\.asar[\\/]/i.test(iconPath) ? execPath : iconPath,
        appIconIndex: 0,
        relaunchCommand: installed ? quote(execPath) : quote(execPath) + ' ' + quote(appPath),
        relaunchDisplayName: installed ? 'Noctune' : 'Noctune (development)',
    };
}

function configureWindowsAppIdentity({ app, platform = process.platform, execPath = process.execPath, defaultApp = process.defaultApp, iconPath }) {
    if (platform !== 'win32') return;
    const details = windowsAppDetails({ isPackaged: app.isPackaged, defaultApp, execPath, appPath: app.getAppPath(), iconPath });
    // Set the process identity before windows or notifications can register links.
    app.setAppUserModelId(details.appId);
    app.on('browser-window-created', (_event, window) => window.setAppDetails(details));
    return details;
}

module.exports = { windowsAppDetails, configureWindowsAppIdentity };
