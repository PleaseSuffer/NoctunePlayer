const { app } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = process.cwd();
const output = path.join(root, 'tests/.artifacts/search-languages'); fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(output, 'profile-'));
app.setPath('userData', profile);
const language = process.argv.includes('--english') ? 'en' : 'ru';
fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify({ language, hardwareAcceleration: '0' }));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let started = false;
const timeout = setTimeout(() => app.exit(2), 60000);
app.on('browser-window-created', (_, win) => win.webContents.on('did-finish-load', async () => {
    if (started || !win.webContents.getURL().endsWith('/renderer/index.html')) return;
    started = true;
    const run = code => win.webContents.executeJavaScript(code);
    try {
        await delay(900);
        await run(`window.openSettingsPanel('panel-general');document.getElementById('settings-search-toggle').click()`);
        const search = async query => {
            await run(`{const input=document.getElementById('settings-search-input');input.value=${JSON.stringify(query)};input.dispatchEvent(new Event('input',{bubbles:true}));}`);
            await delay(350);
            assert.equal(await run(`document.getElementById('settings-search-input').value`), query);
        };
        const visible = id => run(`!document.getElementById(${JSON.stringify(id)}).closest('.settings-search-hidden')`);
        for (const [query, id] of [
            ['одинаковая громкость', 'setting-normalize'], ['equal loudness', 'setting-normalize'],
            ['плавная смена песен', 'setting-crossfade'], ['smooth transition between songs', 'setting-crossfade'],
            ['не уходить в сон', 'setting-keep-awake'], ['keep screen awake', 'setting-keep-awake'],
            ['свернуть к часам', 'setting-minimize-to-tray'], ['close to system tray', 'setting-minimize-to-tray'],
            ['продолжить слушать', 'setting-restore-playback'], ['resume playback', 'setting-restore-playback'],
            ['частота кадров', 'setting-effects-fps'], ['frame rate limit', 'setting-effects-fps'],
            ['hardware acceleration', 'setting-hardware-acceleration'], ['аппаратное ускорение', 'setting-hardware-acceleration'],
            ['слова песни', 'setting-lyrics-enabled'], ['song words', 'setting-lyrics-enabled'],
            ['форма волны', 'setting-waveform-enabled'], ['audio wave', 'setting-waveform-enabled'],
            ['индикаторы новых уведомлений', 'notification-badges'], ['notification indicators', 'notification-badges'],
        ]) {
            await search(query); assert(await visible(id), `${language}: ${query} should find ${id}`);
            assert(!await run(`document.getElementById('settings-search-status').textContent.includes(${JSON.stringify(language==='ru'?'другая раскладка':'different keyboard layout')})`), 'direct matches take priority');
        }
        for (const [query, expected, id] of [
            ['ntvf', 'тема', 'setting-dark-theme'],
            ['ghjphfxyjcnm', 'прозрачность', 'setting-glass-opacity'],
            ['еруьу', 'theme', 'setting-dark-theme'],
            ['днкшсы', 'lyrics', 'setting-lyrics-enabled'],
            [';ehyfk', 'журнал', 'notification-history-filter'],
        ]) {
            await search(query); assert(await visible(id), `${query} -> ${expected}`);
            assert((await run(`document.getElementById('settings-search-status').textContent`)).includes(expected));
            assert(await run(`document.querySelector('.settings-nav-item.settings-search-found')!==null`));
        }
        await search(language === 'ru' ? 'ntvf' : 'еруьу');
        assert(await run(`CSS.highlights.has('settings-search')`), 'corrected visible text is highlighted');
        await search('previous errors');
        assert(await visible('notification-history-filter'));
        await search('zzzzzzzzzzzzzzzz');
        assert(await run(`document.querySelectorAll('.settings-search-found').length===0`));
        assert(!await run(`document.getElementById('settings-search-status').textContent.includes(${JSON.stringify(language==='ru'?'другая раскладка':'different keyboard layout')})`));
        await search('');
        assert(await run(`!document.querySelector('.settings-search-hidden')&&!CSS.highlights.has('settings-search')&&document.getElementById('settings-search-status').textContent===''`));
        console.log('PASS bilingual search and layout correction:', language);
        clearTimeout(timeout); app.exit(0);
    } catch(error) {console.error(error); app.exit(1);}
}));
require(path.join(root, 'src/main/index'));
