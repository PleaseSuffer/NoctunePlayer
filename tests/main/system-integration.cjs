const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createSystemIntegration, linuxDesktopEntry, DESKTOP_ID, AUDIO_MIME_TYPES } = require('../../src/main/system-integration');
const { LinuxTargetHelper } = require('app-builder-lib/out/targets/LinuxTargetHelper');
const metadata = require('../../package.json');

(async () => {
    const helper = new LinuxTargetHelper({
        info: { metadata }, config: metadata.build, platformSpecificBuildOptions: metadata.build.linux,
        executableName: metadata.name, fileAssociations: [],
        appInfo: { productName: metadata.productName, sanitizedProductName: metadata.productName, description: metadata.description },
    });
    const installedDesktop = await helper.computeDesktopEntry(metadata.build.linux);
    assert.equal(helper.getDesktopFileName() + '.desktop', DESKTOP_ID, 'installed and portable desktop IDs match');
    assert.match(installedDesktop, /Exec=.* %F\n/, 'builder preserves unquoted multiple-file field code');
    assert(installedDesktop.includes(`MimeType=${AUDIO_MIME_TYPES.join(';')};`));
    assert(installedDesktop.includes('StartupWMClass=com.noctune.player'));
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'noctune-integration-'));
    try {
        const icon = path.join(directory, 'app.png');
        await fs.writeFile(icon, 'icon');
        const app = { isPackaged: true, getPath: name => name === 'home' ? directory : '/opt/Noctune/noctune' };
        const calls = [];
        const env = { XDG_DATA_HOME: path.join(directory, 'data'), APPIMAGE: '/home/user/Music apps/Noctune.AppImage' };
        const run = async (command, args, options) => {
            calls.push({ command, args, options });
            if (command === 'update-desktop-database') throw new Error('Optional tool unavailable');
            return { stdout: DESKTOP_ID + '\n' };
        };
        const integration = createSystemIntegration({ app, iconPath: icon, platform: 'linux', env, run });
        assert.equal((await integration.apply('register')).ok, true);
        assert(!calls.some(call => call.command === 'xdg-mime'), 'registration does not change defaults');
        const desktop = await fs.readFile(path.join(env.XDG_DATA_HOME, 'applications', DESKTOP_ID), 'utf8');
        assert(desktop.includes('Exec="/home/user/Music apps/Noctune.AppImage" %F'));
        assert(desktop.includes(`MimeType=${AUDIO_MIME_TYPES.join(';')};`));
        assert.equal((await integration.apply('default')).ok, true);
        assert.deepEqual(calls.find(call => call.command === 'xdg-mime').args, ['default', DESKTOP_ID, ...AUDIO_MIME_TYPES]);
        assert(calls.every(call => !call.options.shell), 'commands never use a shell');
        const denied = createSystemIntegration({ app, iconPath: icon, platform: 'linux', env, run: async () => ({ stdout: 'other.desktop' }) });
        assert.equal((await denied.apply('default')).ok, false, 'verify desktop actually accepted defaults');
        const missing = createSystemIntegration({ app, iconPath: icon, platform: 'linux', env, run: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); } });
        assert.match((await missing.apply('default')).message, /xdg-utils/);
        const links = [];
        const windows = createSystemIntegration({ app, platform: 'win32', shell: { openExternal: async url => links.push(url) } });
        assert.equal((await windows.apply('default')).ok, true);
        assert.deepEqual(links, ['ms-settings:defaultapps']);
        const dev = createSystemIntegration({ app: { isPackaged: false }, platform: 'linux' });
        assert.equal((await dev.apply('register')).ok, false);
        assert.equal((await integration.apply('invalid')).ok, false);
        const escaped = linuxDesktopEntry('/opt/My "app"/$cash`\\100%.AppImage', '/opt/icon\nInjected=true');
        assert(escaped.includes('100%%.AppImage'));
        assert(escaped.includes('\\\\$cash'));
        assert(escaped.includes('\\\\"app\\\\"'));
        assert(!escaped.includes('\nInjected=true'), 'desktop values cannot inject new fields');
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
    console.log('PASS: Windows settings, Linux portable registration, desktop escaping, MIME defaults, verification and tool failures.');
})().catch(error => { console.error(error); process.exitCode = 1; });
