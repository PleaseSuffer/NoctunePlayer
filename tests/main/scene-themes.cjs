const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { validatePackage, packDirectory, createSceneThemeStore, MAX_BYTES } = require('../../src/main/scene-themes');
(async () => {
    const root = path.resolve(__dirname, '../..'), temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'noctune-scenes-'));
    try {
        const builtinDirectory = path.join(root, 'themes/builtin');
        const valid = await packDirectory(path.join(builtinDirectory, '03-rain-window'));
        for(const id of ['02-night-hill','03-rain-window']){
            const scene=await packDirectory(path.join(builtinDirectory,id));assert.equal(scene.manifest.width,1920);assert.equal(scene.manifest.height,1080);
            for(const [key,data] of Object.entries(scene.assets)){if(key==='preview')continue;const png=Buffer.from(data.split(',')[1],'base64');assert.equal(png.readUInt32BE(16),1920);assert.equal(png.readUInt32BE(20),1080);}
        }
        const store = createSceneThemeStore({ directory: () => temporary, builtinDirectory, sdkFile: path.join(root, 'src/renderer/effects/scene-sdk.js'), presetsDirectory: path.join(root, 'themes/backgrounds') });
        const source = path.join(temporary, 'source-package.tmp'); await fs.writeFile(source, JSON.stringify(valid));
        const first = await store.importFile(source), second = await store.importFile(source);
        assert.equal(first.id, second.id, 'identical imports deduplicate');
        const list = await store.list(); assert.equal(list.presets.length, 8); assert.equal(list.themes.length, 4);
        assert.equal(list.themes.filter(t => t.builtin).length, 3);
        assert.equal((await store.read('builtin-obsessed-over-camera')).manifest.parameters.frequencyMix,.75);
        assert.equal((await store.read(first.id)).manifest.parameters.glowIntensity,1,'parameters survive import packing');
        assert.equal((await store.read('builtin-night-hill')).manifest.capabilities.visualizer, 'bars');
        assert.equal((await store.read('builtin-obsessed-over-camera')).manifest.capabilities.visualizer, 'character');
        assert.equal(list.themes[0].id, 'builtin-rain-window'); assert.equal((await store.read(first.id)).script, valid.script);
        await assert.rejects(store.read('../config.json')); await assert.rejects(store.remove('builtin-rain-window'));
        for (const mutate of [
            p => p.apiVersion = 3,
            p => p.manifest.id = '../other',
            p => p.manifest.palette.accent = '</style><script>',
            p => p.manifest.parameters.frequencyMix=2,
            p => p.manifest.parameters.glowIntensity=-1,
            p => p.assets.outside = 'file:///C:/secret.png',
            p => p.assets['../escape'] = p.assets.outside,
            p => p.assets.outside = 'data:image/png;base64,AAAA',
            p => p.script = 'x'.repeat(128 * 1024 + 1),
        ]) { const p = structuredClone(valid); mutate(p); assert.throws(() => validatePackage(p)); }
        const huge = path.join(temporary, 'huge.noctheme'); const fd = await fs.open(huge, 'w'); await fd.truncate(MAX_BYTES + 1); await fd.close(); await assert.rejects(store.importFile(huge));
        await fs.writeFile(path.join(temporary, 'import-' + 'f'.repeat(24) + '.noctheme'), '{bad');
        assert.equal((await store.list()).themes.length, 4, 'a corrupt import does not break other scenes');
        await store.remove(first.id); assert.equal((await store.list()).themes.length, 3);
        const userSource = path.join(temporary, 'custom-noctilia'); await fs.cp(path.join(builtinDirectory, '03-rain-window'), userSource, { recursive: true });
        const sourceManifest = JSON.parse(await fs.readFile(path.join(userSource, 'manifest.json'), 'utf8'));
        sourceManifest.id = 'custom-source-test';await fs.writeFile(path.join(userSource, 'manifest.json'), JSON.stringify(sourceManifest));
        const custom = (await store.list()).themes.find(t => t.id.startsWith('user-'));
        assert.ok(custom && !custom.builtin && custom.removable);
        assert.equal((await store.read(custom.id)).script, valid.script);
        await store.remove(custom.id);
        assert.ok(await fs.stat(path.join(userSource, 'manifest.json')), 'source files survive gallery removal');
        assert.ok(!(await store.list()).themes.some(t => t.packageId === 'custom-source-test'));
        await assert.rejects(store.read(custom.id), /удалена/);
        const legacy = path.join(temporary, 'legacy'), migrated = path.join(temporary, 'migrated'); await fs.mkdir(legacy);
        await fs.copyFile(source, path.join(legacy, first.id + '.noctheme'));
        const migratedStore = createSceneThemeStore({ directory: () => migrated, builtinDirectory, legacyDirectory: legacy, sdkFile: path.join(root, 'src/renderer/effects/scene-sdk.js'), presetsDirectory: path.join(root, 'themes/backgrounds') });
        assert.equal((await migratedStore.list()).themes.length, 4);
        assert.equal((await migratedStore.read(first.id)).script, valid.script);
        assert.ok(await fs.stat(path.join(legacy, first.id + '.noctheme')));
        await migratedStore.remove(first.id);
        assert.equal((await migratedStore.list()).themes.length, 3, 'removed migrated themes stay removed');
        const restartedStore = createSceneThemeStore({ directory: () => migrated, builtinDirectory, legacyDirectory: legacy, sdkFile: path.join(root, 'src/renderer/effects/scene-sdk.js'), presetsDirectory: path.join(root, 'themes/backgrounds') });
        assert.equal((await restartedStore.list()).themes.length, 3, 'legacy migration runs only once across restarts');
        const sourceDirectory = path.join(temporary, 'source'); await fs.mkdir(sourceDirectory);
        await fs.writeFile(path.join(sourceDirectory, 'manifest.json'), JSON.stringify({ ...valid.manifest, assets: { outside: '../source-package.tmp' }, script: '../source-package.tmp' }));
        await assert.rejects(packDirectory(sourceDirectory), /вне директории/);
        console.log('PASS: scene containers, asset/palette validation, size limits, safe packing, deduplication, builtin protection, corruption recovery and eight presets.');
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
