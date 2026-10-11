const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { themeFilesFromArgv, createThemeOpenQueue } = require('../../src/main/open-theme-files');
const { packDirectory, createSceneThemeStore } = require('../../src/main/scene-themes');
(async () => {
    const root = path.resolve(__dirname, '../..');
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'noctune-theme-open-'));
    try {
        const file = path.join(temporary, 'Новая тема #1.NOCTHEME');
        const bad = path.join(temporary, 'broken.noctheme');
        const theme = await packDirectory(path.join(root, 'themes/builtin/03-rain-window'));
        await fs.writeFile(file, JSON.stringify(theme)); await fs.writeFile(bad, '{}');
        await fs.mkdir(path.join(temporary, 'directory.noctheme'));
        const argv = ['Noctune', file, pathToFileURL(file).href, bad, 'missing.noctheme', 'directory.noctheme', 'track.mp3', 'https://example.com/theme.noctheme'];
        assert.deepEqual(themeFilesFromArgv(argv, {cwd:temporary}), [file, bad]);
        assert.deepEqual(themeFilesFromArgv(['electron', 'app.noctheme', path.basename(file)], {cwd:temporary, defaultApp:true}), [file]);
        const store = createSceneThemeStore({directory:() => path.join(temporary, 'imported'), builtinDirectory:path.join(root, 'themes/builtin'), presetsDirectory:path.join(root, 'themes/backgrounds')});
        const reports = [];
        const queue = createThemeOpenQueue(file => store.importFile(file), result => reports.push(result));
        queue.enqueue([file]); queue.enqueue([file, bad]);
        await queue.whenIdle(); assert.equal(reports.length, 0, 'cold start waits for gallery readiness');
        queue.setReady(true); await queue.whenIdle();
        assert.equal(reports.length, 2, 'duplicate argv paths are coalesced');
        assert.equal(reports[0].theme.name, theme.manifest.name); assert.match(reports[1].error, /Не удалось добавить тему/);
        queue.enqueue([file]); await queue.whenIdle();
        assert.equal(reports[2].theme.id, reports[0].theme.id, 'warm reopening imports the same theme without duplication');
        assert.equal((await store.list()).themes.filter(t => !t.builtin).length, 1);
        queue.setReady(false); queue.enqueue([file]); await queue.whenIdle(); assert.equal(reports.length, 3);
        queue.setReady(true); await queue.whenIdle(); assert.equal(reports.length, 4, 'reload preserves pending requests');
        queue.enqueue([bad]); queue.enqueue([file]); await queue.whenIdle();
        assert.ok(reports.at(-1).theme, 'a broken file does not block subsequent imports');
    } finally { await fs.rm(temporary, {recursive:true, force:true}); }
    console.log('PASS: OS theme paths, cold/warm import, readiness, validation errors, duplicate themes, reload and serial import recovery.');
})().catch(error => {console.error(error); process.exitCode=1;});
