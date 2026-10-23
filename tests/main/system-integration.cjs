const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createSystemIntegration, linuxDesktopEntry, DESKTOP_ID, FILE_MIME_TYPES, THEME_MIME_TYPE } = require('../../src/main/system-integration');
const { LinuxTargetHelper } = require('app-builder-lib/out/targets/LinuxTargetHelper');
const metadata = require('../../package.json');
const { audioRegistration, AUDIO_EXTENSIONS } = require('../../src/main/windows-audio-integration');

(async () => {
    const helper = new LinuxTargetHelper({
        info: { metadata }, config: metadata.build, platformSpecificBuildOptions: metadata.build.linux,
        executableName: metadata.name, fileAssociations: metadata.build.linux.fileAssociations,
        getTempFile: async extension => path.join(directory, 'builder-mime' + extension),
        appInfo: { productName: metadata.productName, sanitizedProductName: metadata.productName, description: metadata.description },
    });
    const installedDesktop = await helper.computeDesktopEntry(metadata.build.linux);
    assert.equal(helper.getDesktopFileName() + '.desktop', DESKTOP_ID, 'installed and portable desktop IDs match');
    assert.match(installedDesktop, /Exec=.* %F\n/, 'builder preserves unquoted multiple-file field code');
    assert(installedDesktop.includes(`MimeType=${THEME_MIME_TYPE};`));
    assert(!installedDesktop.includes('audio/'), 'Linux packages advertise only themes until explicitly enabled');
    assert(installedDesktop.includes('StartupWMClass=com.noctune.player'));
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'noctune-integration-'));
    try {
        const builderMime = await fs.readFile(await helper.computeMimeTypeFiles(), 'utf8');
        assert(builderMime.includes(THEME_MIME_TYPE) && builderMime.includes('*.noctheme'), 'Linux packages include the extension MIME definition');
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
        assert(desktop.includes(`MimeType=${FILE_MIME_TYPES.join(';')};`));
        const mime = await fs.readFile(path.join(env.XDG_DATA_HOME, 'mime/packages/com.noctune.player.xml'), 'utf8');
        assert(mime.includes(THEME_MIME_TYPE) && mime.includes('*.noctheme'));
        assert(mime.includes('application/x-noctune-addon')&&mime.includes('*.noctaddon'));
        assert(calls.some(call => call.command === 'update-mime-database'));
        assert.equal((await integration.apply('default')).ok, true);
        assert.deepEqual(calls.find(call => call.command === 'xdg-mime').args, ['default', DESKTOP_ID, ...FILE_MIME_TYPES]);
        assert(calls.every(call => !call.options.shell), 'commands never use a shell');
        const denied = createSystemIntegration({ app, iconPath: icon, platform: 'linux', env, run: async () => ({ stdout: 'other.desktop' }) });
        assert.equal((await denied.apply('default')).ok, false, 'verify desktop actually accepted defaults');
        const missing = createSystemIntegration({ app, iconPath: icon, platform: 'linux', env, run: async command => { if (command === 'xdg-mime') throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return {stdout:''}; } });
        assert.match((await missing.apply('default')).message, /xdg-utils/);
        const links = [];
        const registry = [], imports = [], windowsCalls = [];
        const windowsApp = { isPackaged: true, getPath: () => 'C:\\Program Files\\Noctune\\Noctune.exe' };
        const windowsRun = async (command, args, options) => {
            windowsCalls.push({command,args,options});
            if (command.endsWith('reg.exe')) {
                const bytes=await fs.readFile(args[1]);assert.equal(bytes.readUInt16LE(0),0xfeff);
                registry.push(bytes.toString('utf16le'));imports.push(args[1]);
            }
            return {stdout:''};
        };
        const windows = createSystemIntegration({ app:windowsApp, platform: 'win32', run:windowsRun, shell: { openExternal: async url => links.push(url) } });
        assert.equal(windowsCalls.length,0,'no automatic audio registration at startup');
        assert.equal((await windows.apply('register')).ok,true);assert.equal(links.length,0);
        assert.equal((await windows.apply('default')).ok, true);
        assert.deepEqual(links, ['ms-settings:defaultapps']);
        assert.equal(registry.length,2);
        for(const content of registry){
            assert(content.includes('AudioFileAssociationsEnabled"=dword:00000001'));
            assert(!content.includes('HKEY_LOCAL_MACHINE'));assert(!content.includes('UserChoice'));
            for(const extension of AUDIO_EXTENSIONS){assert(content.includes(`Noctune.Audio.${extension}`));assert(!content.includes(`[HKEY_CURRENT_USER\\Software\\Classes\\.${extension}]`),'never set extension defaults');}
            for(const action of ['play','new-playlist','add-playlist','enqueue'])assert(content.includes('--noctune-action='+action));
            assert(content.includes('C:\\\\Program Files\\\\Noctune\\\\Noctune.exe'));
        }
        for(const file of imports)await assert.rejects(fs.stat(file),{code:'ENOENT'});
        assert(windowsCalls.every(call=>call.options.windowsHide && !call.options.shell));
        const windowsDenied=createSystemIntegration({app:windowsApp,platform:'win32',run:async()=>{throw Error('Access denied');},shell:{openExternal:async()=>{throw Error('must not open settings');}}});
        assert.match((await windowsDenied.apply('default')).message,/Access denied/);
        assert.throws(()=>audioRegistration('C:\\Noctune\n[HKEY_LOCAL_MACHINE\\Injected]'));
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
