// Run with the project's Electron executable. Uses a temporary app profile.
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const archiveOption = process.argv.find(value => value.startsWith('--app-asar='));
const archive = archiveOption ? path.resolve(archiveOption.slice('--app-asar='.length)) : null;
const output = path.join(__dirname, '.artifacts/addons');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(output, 'profile-'));
app.setPath('userData', profile);
const showProbe = BrowserWindow.prototype.showInactive;
BrowserWindow.prototype.show = function () {};
BrowserWindow.prototype.showInactive = function () {};
const { canonical, sign } = require('../src/main/addons/package');
const { createAddonStore } = require('../src/main/addons/store');
const key = crypto.generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' });
const base = {
    format: 'noctune-addon', formatVersion: 1,
    manifest: { id: 'native-addon-probe', name: 'Проверка расширений', description: 'Изолированное выполнение, команды и настройки', author: 'Noctune tests', version: '1.0.0', revision: 1, apiVersion: 1, minNoctuneVersion: '1.4.0', type: 'extension', entry: 'main.js', permissions: ['storage.*','settings.*','notifications.show','playback.read','events.*','themes.*','backgrounds.*','audio.*','providers.*','network.request'], commands: [{ id: 'probe-command', title: 'Проверить SDK' }] },
    files: {},
};
base.manifest.network = { origins: ['https://stream.example'] };
base.manifest.icon = 'assets/logo.png'; base.manifest.banner = 'assets/banner.png';
base.files['assets/logo.png'] = { encoding: 'base64', data: fs.readFileSync(path.join(root,'resources/app.png')).toString('base64') };
base.files['assets/banner.png'] = { encoding: 'base64', data: fs.readFileSync(path.join(root,'resources/app.png')).toString('base64') };
base.manifest.settings = {
    enabled: { type: 'toggle', label: 'Автосмена темы', default: true },
    title: { type: 'text', label: 'Подпись', default: 'Noctune' },
    intensity: { type: 'slider', label: 'Интенсивность', min: 0, max: 1, step: .1, default: .5 },
    interval: { type: 'number', label: 'Интервал', min: 1, max: 60, step: 1, default: 10 },
    mode: { type: 'select', label: 'Режим', default: 'calm', options: [{ value: 'calm', label: 'Спокойный' }, { value: 'bright', label: 'Яркий' }] },
};
base.files['main.js'] = `NoctuneAddon.define(async api => {
    let resolves = 0;
    api.on('track.changed', event => api.storage.set('track-event', event));
    api.on('progress.updated', event => api.storage.set('progress-event', event));
    api.on('settings.changed', event => api.storage.set('settings-event', event.values));
    await api.providers.register({ id: 'mock-provider', name: 'Тестовый поток', resolve: async ({reason}) => { await api.storage.set('provider-reason', reason); return { url: ++resolves === 1 ? 'https://stream.example/expired.wav' : 'https://stream.example/audio.wav' }; } });
    api.onCommand('probe-command', async () => {
        let networkBlocked = false; try { await fetch('https://example.invalid/'); } catch (_) { networkBlocked = true; }
        let denied = false; try { await api.network.text('https://example.com/'); } catch (_) { denied = true; }
        await api.storage.set('isolation', { node: typeof require, document: typeof document, networkBlocked, denied });
        await api.storage.set('settings-sdk', await api.settings.get());
        await api.storage.set('asset-sdk', { ...api.assets.read('assets/logo.png'), base64: undefined, url: api.assets.url('assets/logo.png').slice(0,22) });
        await api.storage.set('themes-sdk', await api.themes.list());
        await api.providers.play('mock-provider', { id: 'tone', title: 'Тестовый тон', artist: 'Noctune SDK' });
        await api.audio.effects({ chain: [{ type: 'gain', gain: .5 }, { type: 'biquad', filter: 'lowpass', frequency: 4000 }] });
        await api.storage.set('pcm-sdk', (await api.audio.pcm()).sampleRate);
    });
});`;

const file = path.join(output, 'fixture.noctaddon');
fs.writeFileSync(file, canonical(sign(base, key)));
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
app.on('browser-window-created', (_, win) => {
    win.webContents.on('did-finish-load', async () => {
        if (!win.webContents.getURL().endsWith('/renderer/index.html')) return;
        try {
            const run = async code => { try { return await win.webContents.executeJavaScript(code); } catch (error) { console.error('Renderer check failed:', code); throw error; } };
            const wait = async (code, message) => {
                for (let i = 0; i < 100; i++) { if (await run(code)) return; await delay(100); }
                throw new Error(message);
            };
            const installerWindow = async (name = 'Проверка расширений') => {
                for (let i = 0; i < 100; i++) {
                    const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().endsWith('/addon-install/index.html'));
                    if (window && await window.webContents.executeJavaScript(`document.getElementById('name').textContent === ${JSON.stringify(name)}`)) return window;
                    await delay(100);
                }
                throw new Error('Separate addon installer did not become ready');
            };
            win.webContents.setBackgroundThrottling(false);
            await run(`document.getElementById('settings-fab').click(); document.querySelector('[data-panel="panel-addons"]').click(); document.getElementById('addons-import').click();`);
            let installer = await installerWindow();
            assert.notEqual(installer.id, win.id);
            assert.equal(installer.getParentWindow(), null, 'installer is an independent window');
            assert.equal(installer.webContents.getLastWebPreferences().sandbox, true);
            assert.equal(await installer.webContents.executeJavaScript(`document.getElementById('install').disabled`), true, 'consent required');
            assert.equal(await run(`typeof addonInstaller`), 'undefined', 'main page cannot invoke installer confirmation');
            assert.equal(await run(`noctune.addons.list().then(items => items.length)`), 0, 'preview performs no installation');
            assert.equal(await installer.webContents.executeJavaScript(`document.querySelector('#permissions').textContent.includes('[audio.effects]')`), true);
            assert.equal(await installer.webContents.executeJavaScript(`document.querySelector('[data-namespace="themes"]').closest('li').classList.contains('is-full')`), true);
            assert.equal(await installer.webContents.executeJavaScript(`document.querySelector('[data-namespace="playback"]').closest('li').classList.contains('is-partial')`), true);
            assert.equal(await installer.webContents.executeJavaScript(`document.querySelector('[data-namespace="playback"] .permission-children').children.length`), 1);
            assert.equal(await installer.webContents.executeJavaScript(`document.querySelector('[data-namespace="themes"] summary code').textContent`), '[themes.*]');
            await installer.webContents.executeJavaScript(`document.querySelector('[data-namespace="playback"]').open=true;`);
            assert.equal(await installer.webContents.executeJavaScript(`document.getElementById('addon-icon').src.startsWith('data:image/png;base64,') && !document.getElementById('addon-banner').hidden`), true);
            installer.webContents.setBackgroundThrottling(false); showProbe.call(installer);
            await installer.webContents.executeJavaScript(`document.querySelector('[data-namespace="events"]').open=true; document.querySelector('[data-namespace="events"]').scrollIntoView({block:'center'});`);
            assert.equal(await installer.webContents.executeJavaScript(`document.querySelector('[data-namespace="events"] .permission-description').textContent.includes('Подписки')`), false);
            assert.equal(await installer.webContents.executeJavaScript(`!!document.querySelector('.permission-group-icon')?.matches('svg')`), true);
            for (const size of [[640,780],[520,600]]) {
                installer.setSize(...size); await delay(150);
                const layout = await installer.webContents.executeJavaScript(`({footer:document.querySelector('footer').getBoundingClientRect().bottom,height:innerHeight,width:document.documentElement.scrollWidth,viewport:innerWidth})`);
                assert(layout.footer <= layout.height + 1, 'footer remains visible');
                assert(layout.width <= layout.viewport, 'no horizontal overflow');
                await fs.promises.writeFile(path.join(output,`installer-${size[0]}.png`),(await installer.webContents.capturePage()).toPNG());
            }
            await installer.webContents.executeJavaScript(`document.getElementById('cancel').click()`);
            await wait(`document.getElementById('panel-addons').getAttribute('aria-busy')==='false'`, 'cancel returns control to settings');
            assert.equal(await run(`noctune.addons.list().then(items => items.length)`), 0);
            await run(`document.getElementById('addons-import').click()`);
            installer = await installerWindow();
            await installer.webContents.executeJavaScript(`document.getElementById('consent').click(); document.getElementById('install').click();`);
            await wait(`document.querySelectorAll('.addon-card').length===1`, 'extension installed');
            assert.equal(await run(`document.querySelector('.addon-card .toggle-switch input').checked`), false);
            const inspect = createAddonStore({ directory: path.join(profile, 'addons'), appVersion: app.getVersion() });
            // A deterministic HTTPS origin feeds a generated tone through the real protocol and media element.
            const dns = require('node:dns').promises, https = require('node:https'), { Readable } = require('node:stream'), { EventEmitter } = require('node:events');
            const originalLookup = dns.lookup, originalGet = https.get;
            const wav = Buffer.alloc(44 + 44100 * 2 * 8); wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(44100,24); wav.writeUInt32LE(88200,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(wav.length-44,40);
            for (let i = 0; i < (wav.length-44)/2; i++) wav.writeInt16LE(Math.round(Math.sin(i/44100*Math.PI*880)*8000),44+i*2);
            if (archive) {
                const audioFile = path.join(output, 'tone.wav');
                fs.writeFileSync(audioFile, wav);
                const metadata = await run(`noctune.metadata.parseFile(${JSON.stringify(audioFile)}, 'tone.wav')`);
                assert(Math.abs(metadata.duration - 8) < .1, 'packaged music-metadata parses local audio');
            }
            dns.lookup = (host, ...args) => host === 'stream.example' ? Promise.resolve([{ address: '93.184.216.34', family: 4 }]) : originalLookup(host,...args);
            https.get = (url, options, callback) => {
                if (url.hostname !== 'stream.example') return originalGet(url, options, callback);
                const request = new EventEmitter(); request.destroy = error => { if (error) request.emit('error',error); request.emit('close'); };
                queueMicrotask(() => { const response = Readable.from([wav]); response.statusCode = url.pathname === '/expired.wav' ? 403 : 200; response.headers = { 'content-type': 'audio/wav', 'content-length': String(wav.length), 'accept-ranges': 'bytes' }; response.setTimeout = () => {}; response.on('end', () => request.emit('close')); callback(response); });
                return request;
            };
            await wait(`!!document.querySelector('#addon-native-addon-probe-mode')`, 'SDK 1 settings rendered');
            await run(`document.querySelector('.addon-card > .addon-card-header .toggle-switch input').click()`);
            await wait(`addonHost.state('native-addon-probe')?.status === 'running'`, 'SDK 1 worker running');
            await run(`document.querySelector('.addon-configuration').open=true; document.getElementById('addon-native-addon-probe-mode').scrollIntoView({block:'center'}); document.getElementById('addon-native-addon-probe-mode').click();`);
            assert.equal(await run(`document.getElementById('addon-native-addon-probe-mode').getAttribute('aria-expanded')`), 'true');
            assert.equal(await run(`document.querySelector('.addon-dropdown-menu [data-value="calm"]').getAttribute('aria-selected')`), 'true');
            await run(`const control=document.getElementById('addon-native-addon-probe-mode'); control.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})); document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true})); document.activeElement.click();`);
            assert.equal(await run(`document.getElementById('addon-native-addon-probe-mode').value`), 'bright');
            assert.equal(await run(`document.querySelector('.addon-dropdown-menu')===null`), true, 'selection closes the popup');
            await run(`for (const [key,value] of [['title','SDK concurrency'],['intensity','.9']]) { const input=document.getElementById('addon-native-addon-probe-'+key); input.value=value; input.dispatchEvent(new Event('change')); }`);
            await wait(`['mode','title','intensity'].every(key=>!document.getElementById('addon-native-addon-probe-'+key).disabled)`, 'concurrent settings persisted');
            await run(`addonHost.command('native-addon-probe','probe-command')`);
            const runtime = (await inspect.runtime())[0];
            const sdkRead = key => inspect.invoke(base.manifest.id, runtime.digest, 'storage.get', { key });
            assert.deepEqual(await sdkRead('isolation'), { node: 'undefined', document: 'undefined', networkBlocked: true, denied: true });
            assert.equal((await sdkRead('asset-sdk')).mime, 'image/png');
            assert.equal((await sdkRead('asset-sdk')).size, fs.statSync(path.join(root,'resources/app.png')).size);
            assert.equal((await sdkRead('asset-sdk')).url, 'data:image/png;base64,');
            assert.equal((await sdkRead('settings-sdk')).mode, 'bright');
            assert.equal((await sdkRead('settings-sdk')).title, 'SDK concurrency');
            assert.equal((await sdkRead('settings-sdk')).intensity, .9);
            assert((await sdkRead('themes-sdk')).length > 0);
            if (archive) {
                await run(`(async () => { const gallery=await noctune.sceneThemes.list(); await sceneThemes.activate(gallery.themes[0]); })()`);
                assert.equal(await run(`sceneThemes.active`), true, 'packaged theme SDK and image assets render');
            }
            await wait(`localAudioElement && localAudioElement.currentTime > .25`, 'provider plays through HTML audio');
            assert.equal(await run(`localAudioElement.currentSrc.startsWith('noctune-stream://') && !!localMediaSource && audioCtx.state==='running'`), true);
            assert((await sdkRead('pcm-sdk')) > 0);
            assert.equal(await sdkRead('provider-reason'), 'refresh', 'expired initial URL is refreshed once without losing the play session');
            assert.equal((await sdkRead('track-event')).source, 'provider');
            await delay(400);
            assert((await sdkRead('progress-event')).position > 0);
            assert.equal(await run(`(() => {const samples=new Uint8Array(analyzer.frequencyBinCount);analyzer.getByteFrequencyData(samples);return samples.some(value=>value>0)})()`), true, 'stream reaches the existing analyser');
            showProbe.call(win); win.setSize(1100, 1000);
            for (const theme of ['dark', 'light']) {
                await run(`document.getElementById('setting-dark-theme').checked=${theme === 'dark'}; document.getElementById('setting-dark-theme').dispatchEvent(new Event('change')); document.querySelector('.addon-configuration').scrollIntoView({block:'center'});`);
                await delay(450);
                await fs.promises.writeFile(path.join(output, `controls-${theme}.png`), (await win.webContents.capturePage()).toPNG());
                await run(`document.getElementById('addon-native-addon-probe-mode').click()`);
                assert.equal(await run(`document.querySelector('.addon-dropdown-menu').getBoundingClientRect().bottom <= innerHeight`), true);
                await delay(250);
                assert.equal(await run(`!!document.querySelector('.addon-dropdown-menu')`), true, 'popup remains open');
                await fs.promises.writeFile(path.join(output, `dropdown-${theme}.png`), (await win.webContents.capturePage()).toPNG());
                await run(`document.getElementById('addon-native-addon-probe-mode').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); document.querySelector('.addon-details').open=true; { const events=document.querySelector('.addon-details [data-namespace="events"]'); events.open=true; events.scrollIntoView({block:'center'}); }`);
                assert.equal(await run(`document.querySelector('.addon-dropdown-menu')===null`), true, 'Escape closes the popup');
                await delay(450);
                await fs.promises.writeFile(path.join(output, `permissions-${theme}.png`), (await win.webContents.capturePage()).toPNG());
                await run(`document.querySelector('.addon-details').open=false;`);
            }
            await run(`document.querySelector('.addon-card > .addon-card-header .toggle-switch input').click()`);
            await wait(`addonHost.state('native-addon-probe')?.status === 'stopped'`, 'SDK 1 disposal');
            assert.equal(await run(`localAudioElement.paused`), true);
            dns.lookup = originalLookup; https.get = originalGet;
            // Optionally verify a release package through the actual signed installation flow.
            const officialOption = process.argv.find(value => value.startsWith('--official-package='));
            if (officialOption) {
                const officialFile = path.resolve(officialOption.slice('--official-package='.length));
                const official = JSON.parse(fs.readFileSync(officialFile, 'utf8'));
                const { validatePackage, signingIdentity } = require('../src/main/addons/package');
                validatePackage(official);
                assert.equal(signingIdentity(official, true), require('../addons/official/publisher.json').fingerprint);
                assert.equal(official.files['main.js'], fs.readFileSync(path.join(root, 'addons/official/noctune-chroma/main.js'), 'utf8'));
                dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [officialFile] });
                await run(`document.getElementById('addons-import').click()`);
                installer = await installerWindow('Noctune Chroma');
                assert.equal(await installer.webContents.executeJavaScript(`!document.getElementById('verified-publisher').hidden`), true);
                showProbe.call(installer); await delay(200);
                await fs.promises.writeFile(path.join(output, 'chroma-installer.png'), (await installer.webContents.capturePage()).toPNG());
                await installer.webContents.executeJavaScript(`document.getElementById('consent').click(); document.getElementById('install').click();`);
                await wait(`!!document.querySelector('[data-addon-id="noctune-chroma"]')`, 'Chroma installed');
                const card = `document.querySelector('[data-addon-id="noctune-chroma"]')`;
                const accent = `getComputedStyle(document.body).getPropertyValue('--accent-color').trim()`;
                await run(`backgroundSettings.palette({accent:'#123456',gradient:['#111111','#222222','#333333']});`);
                await run(`${card}.querySelector('.addon-card-header input').click()`);
                await wait(`addonHost.state('noctune-chroma')?.status==='running' && ${accent}!=='#123456'`, 'Chroma layer active');
                await wait(`!!document.querySelector('head style:last-of-type') && document.documentElement.style.getPropertyValue('--addon-accent-color')!==''`, 'temporary accent stylesheet ready');
                const accentRule = await run(`document.querySelector('head style:last-of-type').textContent`);
                const firstColor = await run(accent); await delay(250); assert.notEqual(await run(accent), firstColor, 'accent animates');
                assert.equal(await run(`document.querySelector('head style:last-of-type').textContent`), accentRule, 'animated accent keeps the stylesheet stable');
                await run(`backgroundSettings.palette({accent:'#654321',gradient:['#112233','#334455','#556677']});`);
                assert.notEqual(await run(accent), '#654321', 'theme updates cannot overwrite the extension layer');
                assert.equal(await run(`vizGradColor1`), '#112233', 'extension preserves theme gradients');
                await run(`backgroundSettings.accent('second-owner','#abcdef')`);
                await delay(150); assert.equal(await run(accent), '#abcdef', 'latest layer stays on top across frames');
                await run(`backgroundSettings.accent('second-owner',null)`); await delay(100);
                assert.notEqual(await run(accent), '#abcdef', 'underlying animation reappears');
                for (const theme of ['dark','light']) {
                    await run(`document.getElementById('setting-dark-theme').checked=${theme === 'dark'}; document.getElementById('setting-dark-theme').dispatchEvent(new Event('change')); ${card}.querySelector('.addon-configuration').open=true; ${card}.scrollIntoView({block:'start'});`);
                    await delay(250);
                    await fs.promises.writeFile(path.join(output, 'chroma-' + theme + '.png'), (await win.webContents.capturePage()).toPNG());
                    assert.equal(await run(`document.documentElement.scrollWidth<=innerWidth`), true);
                }
                await run(`{const input=document.getElementById('addon-noctune-chroma-animated');input.checked=false;input.dispatchEvent(new Event('change'));}`);
                await wait(`${accent}==='#654321'`, 'effect toggle releases overlay');
                await run(`{const input=document.getElementById('addon-noctune-chroma-animated');input.checked=true;input.dispatchEvent(new Event('change'));}`);
                await wait(`${accent}!=='#654321'`, 'effect resumes');
                await run(`${card}.querySelector('.addon-card-header input').click()`);
                await wait(`addonHost.state('noctune-chroma')?.status==='stopped'`, 'Chroma disposed');
                assert.equal(await run(accent), '#654321', 'disable restores current theme, not stale captured color');
                assert.equal(await run(`vizGradColor1`), '#112233');
                assert.equal(await run(`appStorage.getItem('setting_accent_color')`), null, 'animation never persists an accent');
                console.log('PASS: signed Chroma release, changing accent, theme coexistence, layer priority, light/dark layouts, toggle and disposal restoration.');
            }
            // Exercise the new SDK through a real isolated Worker and host-rendered UI.
            const {packDirectory}=require('../src/main/addons/package');
            const workbench=await packDirectory(path.join(root,'addons/examples/service-workbench'));
            workbench.manifest.permissions.push('storage.*');
            workbench.manifest.commands.push({id:'native-capabilities',title:'Проверить новые API'});
            const extra = `
    api.onCommand('native-capabilities',async()=>{
        let denied=false;try{await api.queue.read();}catch(_){denied=true;}
        let secretDenied=false;try{await api.secrets.get('credential:demo-key');}catch(_){secretDenied=true;}
        const listed=await api.servicePlaylists.read({catalog:'demo-catalog'});
        const playlist=await api.servicePlaylists.read({catalog:'demo-catalog',id:listed.items[0].id});
        const request={catalog:'demo-catalog',id:playlist.id,revision:playlist.revision,name:'Изменено через SDK',requestId:'native-operation-0001'};
        const first=await api.servicePlaylists.rename(request),retry=await api.servicePlaylists.rename(request);
        const changed=await api.servicePlaylists.read({catalog:'demo-catalog',id:playlist.id});
        await api.player.shuffle(true);await api.player.repeat(2);
        await api.storage.set('native-sdk',{denied,secretDenied,listed,first,retry,changed,state:await api.player.current(),artwork:await api.artwork.read(),lyrics:await api.lyrics.read(),credentials:await api.credentials.status('demo-key')});
    });
`;
            const end=workbench.files['main.js'].lastIndexOf('});');workbench.files['main.js']=workbench.files['main.js'].slice(0,end)+extra+workbench.files['main.js'].slice(end);
            const workbenchFile=path.join(output,'workbench.noctaddon');fs.writeFileSync(workbenchFile,canonical(sign(workbench,key)));
            dialog.showOpenDialog=async()=>({canceled:false,filePaths:[workbenchFile]});
            await run(`document.getElementById('addons-import').click()`);installer=await installerWindow('Мастерская SDK 1');
            assert.equal(await installer.webContents.executeJavaScript(`document.getElementById('permissions').textContent.includes('Ключ доступа:')`),true);
            await installer.webContents.executeJavaScript(`document.getElementById('consent').click();document.getElementById('install').click();`);
            const workbenchId='service-workbench-demo';
            await wait(`!!document.getElementById('integration-addon-service-workbench-demo')`,'declarative integration panel');
            await run(`document.querySelector('[data-addon-id="service-workbench-demo"] .addon-card-header input').click()`);
            await wait(`addonHost.state('service-workbench-demo')?.status==='running'`,'extended SDK worker ready');
            await wait(`!!document.querySelector('#addon-catalogs .addon-catalog')`,'catalog registered in host UI');
            await run(`document.querySelector('[data-panel="panel-integrations"]').click();document.querySelector('#integration-addon-service-workbench-demo .addon-configuration').open=true;`);
            assert.equal(await run(`document.getElementById('addon-service-workbench-demo-note').closest('.settings-row').hidden`),true);
            await run(`document.getElementById('addon-service-workbench-demo-demoLyrics').click()`);
            await wait(`!document.getElementById('addon-service-workbench-demo-note').closest('.settings-row').hidden`,'conditional settings become visible');
            const {safeStorage}=require('electron');const cipherKey=crypto.randomBytes(32);
            // This process has an isolated temporary profile; never touches the user's OS vault.
            safeStorage.isEncryptionAvailable=()=>true;safeStorage.getSelectedStorageBackend=()=> 'native-test';
            safeStorage.encryptString=value=>{const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',cipherKey,iv);return Buffer.concat([iv,cipher.update(value),cipher.final(),cipher.getAuthTag()]);};
            safeStorage.decryptString=value=>{const cipher=crypto.createDecipheriv('aes-256-gcm',cipherKey,value.subarray(0,12));cipher.setAuthTag(value.subarray(-16));return Buffer.concat([cipher.update(value.subarray(12,-16)),cipher.final()]).toString();};
            await run(`(()=>{const panel=document.getElementById('integration-addon-service-workbench-demo');[...panel.querySelectorAll('button')].find(button=>button.textContent==='Настроить ключ').click();})()`);
            let credentialWindow;
            for(let i=0;i<100;i++){credentialWindow=BrowserWindow.getAllWindows().find(item=>item.webContents.getURL().endsWith('/addon-credential/index.html'));if(credentialWindow)break;await delay(100);}
            assert(credentialWindow,'protected credential dialog opened');
            assert.equal(credentialWindow.webContents.getLastWebPreferences().sandbox,true);
            assert.equal(await run(`typeof credentialDialog`),'undefined');
            await credentialWindow.webContents.executeJavaScript(`document.getElementById('secret').value='native-private-test-key';document.getElementById('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));`);
            await wait(`document.getElementById('integration-addon-service-workbench-demo').textContent.includes('Ключ сохранён')`,'manual key configured without passing through main renderer');
            const image='data:image/png;base64,'+fs.readFileSync(path.join(root,'resources/app.png')).toString('base64');
            await run(`setLyricsTrack({title:'Учебный трек',artist:'Noctune',album:'SDK',duration:120,coverDataUrl:${JSON.stringify(image)}},999);document.getElementById('btn-lyrics').click();`);
            await wait(`document.getElementById('lyrics-content').textContent.includes('Текст от расширения SDK 1')`,'registered source supplies lyrics');
            await run(`addonHost.command('service-workbench-demo','native-capabilities')`);
            const workbenchRuntime=(await inspect.runtime()).find(pkg=>pkg.manifest.id===workbenchId);
            const observed=await inspect.invoke(workbenchId,workbenchRuntime.digest,'storage.get',{key:'native-sdk'});
            assert.equal(observed.denied,true);assert.equal(observed.secretDenied,true);assert.equal(observed.changed.name,'Изменено через SDK');assert.deepEqual(observed.first,observed.retry);
            assert.equal(observed.credentials.configured,true);assert(!JSON.stringify(observed).includes('native-private-test-key'));
            assert.equal(observed.state.shuffle,true);assert.equal(observed.state.repeat,2);assert.equal(observed.lyrics.status,'found');assert(observed.artwork.width<=256&&observed.artwork.height<=256);
            await run(`document.getElementById('lyrics-close').click();addonHost.command('service-workbench-demo','apply-gray')`);
            assert.equal(await run(`getComputedStyle(document.body).getPropertyValue('--bg-color').trim()`),'#202024');
            await run(`backgroundSettings.accent('priority-test','#aa55cc')`);assert.equal(await run(`getComputedStyle(document.body).getPropertyValue('--accent-color').trim()`),'#aa55cc');await run(`backgroundSettings.accent('priority-test',null)`);
            await run(`document.querySelector('[data-panel="panel-integrations"]').click();document.getElementById('integration-addon-service-workbench-demo').scrollIntoView({block:'start'});`);
            await wait(`getComputedStyle(document.querySelector('.settings-modal')).backgroundColor==='rgb(43, 43, 48)'`,'registered scheme reaches settings surfaces');
            await delay(350);await fs.promises.writeFile(path.join(output,'sdk-integrations.png'),(await win.webContents.capturePage()).toPNG());
            await run(`document.querySelector('[data-panel="panel-addons"]').click();[...document.querySelectorAll('#addon-catalogs button')].find(button=>button.textContent==='Плейлисты').click();`);
            await wait(`document.getElementById('addon-catalogs').textContent.includes('Изменено через SDK')`,'remote playlists in host browser');
            await run(`document.querySelector('[data-addon-id="service-workbench-demo"] .addon-card-header input').click()`);
            await wait(`addonHost.state('service-workbench-demo')?.status==='stopped'`,'extended contributions disposed');
            assert.equal(await run(`addonContributions.catalogs().length`),0);assert.equal(await run(`addonContributions.schemes().length`),0);assert.equal(await run(`addonContributions.hotkeys().length`),0);
            assert.notEqual(await run(`getComputedStyle(document.body).getPropertyValue('--bg-color').trim()`),'#202024');
            console.log('PASS: extended SDK Worker, integration sections/conditions, protected credentials, catalog/playlist revisions and retry, artwork/lyrics, playback modes, appearance priority and cleanup.');
            console.log('PASS: SDK 1 controls/settings, permission review, provider stream, PCM/analyser, track/progress events and disposal.');
            console.log('PASS: sandboxed addon installer, consent/cancel, grouped permissions, artwork and bounded layouts.');
            app.exit(0);
        } catch (error) { console.error(error); app.exit(1); }
    });
});
if (archive) {
    app.setAppPath(archive);
    Object.defineProperty(app, 'isPackaged', { value: true });
    // The probe verifies packaged code, without contacting the release service.
    require('electron-updater').autoUpdater.checkForUpdates = async () => null;
}
require(archive ? path.join(archive, 'src/main/index.js') : '../src/main/index.js');
setTimeout(() => { console.error('Addon probe timed out'); app.exit(1); }, 90000);
