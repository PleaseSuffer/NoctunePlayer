// The container is deliberately JSON, not ZIP: no extraction paths or native code.
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const MAX_BYTES = 64 * 1024 * 1024;
const BUILTINS = { 'builtin-rain-window': '03-rain-window', 'builtin-night-hill': '02-night-hill', 'builtin-obsessed-over-camera': '05-obsessed-over-camera' };
const fail = message => { throw new Error(message); };
function validatePackage(value) {
    if (!value || value.format !== 'noctune-scene' || value.apiVersion !== 1) fail('Не поддерживается формат/API темы');
    const m = value.manifest;
    if (!m || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(m.id)) fail('Некорректный ID темы');
    for (const key of ['name', 'description', 'author', 'version']) {
        if (typeof m[key] !== 'string' || m[key].length > (key === 'description' ? 1200 : 120)) fail('Некорректное описание темы');
    }
    if (!Number.isInteger(m.width) || !Number.isInteger(m.height) || m.width < 320 || m.height < 180 || m.width > 4096 || m.height > 4096) fail('Некорректный размер сцены');
    const color = c => typeof c === 'string' && /^#[\da-f]{6}$/i.test(c);
    if (!m.palette || !color(m.palette.accent) || !color(m.palette.background) || !Array.isArray(m.palette.gradient) || m.palette.gradient.length !== 3 || !m.palette.gradient.every(color)) fail('Некорректная палитра');
    if (!['bars', 'line', 'character', 'none'].includes(m.capabilities?.visualizer)) fail('Неизвестный визуализатор');
    if(m.parameters !== undefined && (!m.parameters || typeof m.parameters !== 'object' || Array.isArray(m.parameters))) fail('Некорректные параметры темы');
    const parameters = { frequencyMix: .6, glowIntensity: 1, ...(m.parameters || {}) };
    if (!Number.isFinite(parameters.frequencyMix) || parameters.frequencyMix < 0 || parameters.frequencyMix > 1 || !Number.isFinite(parameters.glowIntensity) || parameters.glowIntensity < 0 || parameters.glowIntensity > 3) fail('Некорректные параметры частот/свечения');
    if (typeof value.script !== 'string' || Buffer.byteLength(value.script) > 128 * 1024) fail('Слишком большой скрипт');
    if (!value.assets || typeof value.assets !== 'object' || Array.isArray(value.assets)) fail('Отсутствуют слои');
    const entries = Object.entries(value.assets);
    if (!entries.length || entries.length > 24) fail('Слишком много слоёв');
    let total = 0, pixels = 0;
    for (const [key, data] of entries) {
        if (!/^[a-z][a-z0-9-]{0,63}$/.test(key) || typeof data !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(data)) fail('Разрешены только встроенные PNG-слои');
        total += data.length;
        if (total > MAX_BYTES) fail('Тема превышает 64 МБ');
        const buffer = Buffer.from(data.slice(22), 'base64');
        if (buffer.length < 33 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || buffer.toString('ascii', 12, 16) !== 'IHDR') fail('Повреждённый PNG');
        const w = buffer.readUInt32BE(16), h = buffer.readUInt32BE(20);
        if (!w || !h || w > 4096 || h > 4096 || (pixels += w * h) > 48 * 1024 * 1024) fail('Превышен размер изображений');
    }
    if (!Object.hasOwn(value.assets, m.preview)) fail('Отсутствует превью');
    // Pick known properties; no package-controlled filesystem or HTML fields survive.
    return { format: value.format, apiVersion: 1, manifest: {
        id: m.id, name: m.name, description: m.description, author: m.author, version: m.version,
        width: m.width, height: m.height, preview: m.preview,
        palette: { accent: m.palette.accent, background: m.palette.background, gradient: [...m.palette.gradient] },
        capabilities: { visualizer: m.capabilities.visualizer, motion: !!m.capabilities.motion },
        parameters: { frequencyMix: parameters.frequencyMix, glowIntensity: parameters.glowIntensity },
    }, assets: Object.fromEntries(entries), script: value.script };
}
async function readPackage(file) {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > MAX_BYTES) fail('Тема превышает 64 МБ');
    return validatePackage(JSON.parse(await fs.readFile(file, 'utf8')));
}
async function packDirectory(directory) {
    const root = await fs.realpath(directory);
    const m = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
    async function readRelative(relative) {
        if (typeof relative !== 'string' || path.isAbsolute(relative)) fail('Путь должен быть относительным');
        const file = await fs.realpath(path.resolve(root, relative));
        const rel = path.relative(root, file);
        if (rel.startsWith('..') || path.isAbsolute(rel)) fail('Файл вне директории темы');
        if ((await fs.stat(file)).size > MAX_BYTES) fail('Слишком большой файл');
        return fs.readFile(file);
    }
    const assets = {};
    for (const [id, relative] of Object.entries(m.assets || {})) assets[id] = 'data:image/png;base64,' + (await readRelative(relative)).toString('base64');
    return validatePackage({ format: 'noctune-scene', apiVersion: 1, manifest: m, assets, script: (await readRelative(m.script)).toString('utf8') });
}
function createSceneThemeStore({ directory, builtinDirectory, sdkFile, presetsDirectory, userThemesDirectory, legacyDirectory }) {
    const importedPath = id => {
        if (!/^import-[a-f0-9]{24}$/.test(id)) fail('Неизвестная тема');
        return path.join(directory(), id + '.noctheme');
    };
    const metadata = (p, id, builtin, removable = false) => ({ ...p.manifest, id, builtin, removable, preview: p.assets[p.manifest.preview] });
    let migration;
    async function migrateLegacy() {
        await fs.mkdir(directory(), { recursive: true });
        if (legacyDirectory && path.resolve(legacyDirectory) !== path.resolve(directory())) {
            const marker = path.join(directory(), '.legacy-migrated');
            if (await fs.stat(marker).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) return;
            for (const file of await fs.readdir(legacyDirectory).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
                if (!/^import-[a-f0-9]{24}\.noctheme$/.test(file)) continue;
                await fs.copyFile(path.join(legacyDirectory, file), path.join(directory(), file), constants.COPYFILE_EXCL).catch(error => { if (error.code !== 'EEXIST') throw error; });
            }
            await fs.writeFile(marker, '1\n');
        }
    }
    async function userEntries() {
        await (migration ||= migrateLegacy().catch(error => { migration = null; throw error; }));
        const entries = new Map();
        const roots = [...new Set([userThemesDirectory, directory()].filter(Boolean).map(p => path.resolve(p)))];
        for (const root of roots) {
            for (const entry of (await fs.readdir(root, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; })).sort((a,b) => a.name.localeCompare(b.name))) {
                if (!/^[a-z0-9][a-z0-9-]*(\.noctheme)?$/.test(entry.name) || (!entry.isFile() && !entry.isDirectory())) continue;
                const file = path.join(root, entry.name), isDirectory = entry.isDirectory();
                if (isDirectory && !(await fs.stat(path.join(file, 'manifest.json')).catch(() => null))) continue;
                if (!isDirectory && !entry.name.endsWith('.noctheme')) continue;
                const imported = !isDirectory && /^import-[a-f0-9]{24}\.noctheme$/.test(entry.name);
                const id = imported ? entry.name.slice(0, -9) : 'user-' + crypto.createHash('sha256').update(entry.name).digest('hex').slice(0,24);
                entries.set(id, { file, isDirectory, removable: imported && root === path.resolve(directory()) });
            }
        }
        return entries;
    }
    return {
        async list() {
            const themes = [];
            for (const [id, folder] of Object.entries(BUILTINS)) themes.push(metadata(await packDirectory(path.join(builtinDirectory, folder)), id, true));
            for (const [id, entry] of await userEntries()) {
                try { themes.push(metadata(await (entry.isDirectory ? packDirectory(entry.file) : readPackage(entry.file)), id, false, entry.removable)); }
                catch (_) { /* One broken file must not prevent the gallery from loading. */ }
            }
            const presets = JSON.parse(await fs.readFile(path.join(presetsDirectory, 'presets.json'), 'utf8')).map(p => ({ ...p, path: path.join(presetsDirectory, p.file) }));
            return { themes, presets };
        },
        async read(id) {
            let theme;
            if (Object.hasOwn(BUILTINS, id)) theme = await packDirectory(path.join(builtinDirectory, BUILTINS[id]));
            else {
                const entry = (await userEntries()).get(id);
                if (!entry) fail('Неизвестная тема');
                theme = await (entry.isDirectory ? packDirectory(entry.file) : readPackage(entry.file));
            }
            return { ...theme, sdk: await fs.readFile(sdkFile, 'utf8') };
        },
        async importFile(file) {
            await (migration ||= migrateLegacy().catch(error => { migration = null; throw error; }));
            const theme = await readPackage(file);
            const content = JSON.stringify(theme);
            const id = 'import-' + crypto.createHash('sha256').update(content).digest('hex').slice(0, 24);
            await fs.mkdir(directory(), { recursive: true });
            const target = importedPath(id), temp = target + '.tmp';
            await fs.writeFile(temp, content, { flag: 'w' });
            await fs.rename(temp, target);
            return metadata(theme, id, false, true);
        },
        async remove(id) {
            const target = importedPath(id);
            await (migration ||= migrateLegacy().catch(error => { migration = null; throw error; }));
            await fs.rm(target, { force: true }); return true;
        },
    };
}
module.exports = { validatePackage, readPackage, packDirectory, createSceneThemeStore, MAX_BYTES };
