// The container is deliberately JSON, not ZIP: no extraction paths or native code.
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { compareThemeVersions } = require('./theme-versions');
const MAX_BYTES = 64 * 1024 * 1024;
const BUILTINS = { 'builtin-rain-window': '03-rain-window', 'builtin-night-hill': '02-night-hill', 'builtin-obsessed-over-camera': '05-obsessed-over-camera' };
const fail = message => { throw new Error(message); };
function validatePackage(value) {
    if (!value || value.format !== 'noctune-scene') fail('Не поддерживается формат темы');
    if (![1, 2].includes(value.apiVersion)) fail(`Не поддерживается API темы ${value.apiVersion}; поддерживаются версии 1 и 2`);
    const m = value.manifest;
    if (m?.apiVersion !== undefined && m.apiVersion !== value.apiVersion) fail('Версии API пакета и манифеста не совпадают');
    if (!m || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(m.id)) fail('Некорректный ID темы');
    for (const key of ['name', 'description', 'author', 'version']) {
        if (typeof m[key] !== 'string' || m[key].length > (key === 'description' ? 1200 : 120)) fail('Некорректное описание темы');
    }
    if (!Number.isInteger(m.width) || !Number.isInteger(m.height) || m.width < 320 || m.height < 180 || m.width > 4096 || m.height > 4096) fail('Некорректный размер сцены');
    const color = c => typeof c === 'string' && /^#[\da-f]{6}$/i.test(c);
    if (!m.palette || !color(m.palette.accent) || !color(m.palette.background) || !Array.isArray(m.palette.gradient) || m.palette.gradient.length !== 3 || !m.palette.gradient.every(color)) fail('Некорректная палитра');
    if (!(value.apiVersion === 2 ? ['bars', 'line', 'radial', 'character', 'none'] : ['bars', 'line', 'character', 'none']).includes(m.capabilities?.visualizer)) fail('Неизвестный визуализатор');
    if(m.parameters !== undefined && (!m.parameters || typeof m.parameters !== 'object' || Array.isArray(m.parameters))) fail('Некорректные параметры темы');
    const parameters = { frequencyMix: .6, glowIntensity: 1, ...(m.parameters || {}) };
    if (!Number.isFinite(parameters.frequencyMix) || parameters.frequencyMix < 0 || parameters.frequencyMix > 1 || !Number.isFinite(parameters.glowIntensity) || parameters.glowIntensity < 0 || parameters.glowIntensity > 3) fail('Некорректные параметры частот/свечения');
    const v2 = value.apiVersion === 2 ? validateV2(m) : {};
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
    return { format: value.format, apiVersion: value.apiVersion, manifest: {
        id: m.id, name: m.name, description: m.description, author: m.author, version: m.version,
        width: m.width, height: m.height, preview: m.preview,
        palette: { accent: m.palette.accent, background: m.palette.background, gradient: [...m.palette.gradient] },
        capabilities: { visualizer: m.capabilities.visualizer, motion: !!m.capabilities.motion },
        parameters: { frequencyMix: parameters.frequencyMix, glowIntensity: parameters.glowIntensity },
        ...v2,
    }, assets: Object.fromEntries(entries), script: value.script };
}
function validateV2(m) {
    const runtimeRequirements = m.runtimeRequirements ?? { dom: false };
    if (!runtimeRequirements || typeof runtimeRequirements !== 'object' || Array.isArray(runtimeRequirements) || typeof runtimeRequirements.dom !== 'boolean' || Object.keys(runtimeRequirements).some(k => k !== 'dom')) fail('runtimeRequirements допускает только dom: boolean');
    const visualizers = m.capabilities?.visualizers ?? [m.capabilities.visualizer];
    if (!Array.isArray(visualizers) || !visualizers.length || visualizers.length > 5 || !visualizers.every(v => ['bars', 'line', 'radial', 'character', 'none'].includes(v)) || new Set(visualizers).size !== visualizers.length) fail('Некорректный список визуализаторов');
    if (!visualizers.includes(m.capabilities.visualizer) || visualizers.includes('none') && visualizers.length !== 1) fail('Список визуализаторов не соответствует основному типу');
    const schema = m.parameterSchema ?? {};
    if (!schema || typeof schema !== 'object' || Array.isArray(schema) || Object.keys(schema).length > 24) fail('Некорректная схема параметров');
    const label = value => {
        const valid = text => typeof text === 'string' && text.length > 0 && text.length <= 120 && !/[<>]/.test(text);
        if (valid(value)) return value;
        if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0 && Object.keys(value).length <= 8 && Object.entries(value).every(([locale, text]) => /^[a-z]{2}(-[A-Z]{2})?$/.test(locale) && valid(text))) return { ...value };
        fail('Некорректная подпись параметра');
    };
    const parameterSchema = {};
    for (const [key, p] of Object.entries(schema)) {
        if (!/^[a-z][a-zA-Z0-9]{0,47}$/.test(key) || ['frequencyMix', 'glowIntensity', 'constructor', 'prototype'].includes(key) || !p || typeof p !== 'object' || Array.isArray(p)) fail('Некорректный ключ параметра');
        const allowed = p.type === 'slider' ? ['type', 'label', 'default', 'min', 'max', 'step'] : p.type === 'select' ? ['type', 'label', 'default', 'options'] : ['type', 'label', 'default'];
        if (Object.keys(p).some(k => !allowed.includes(k))) fail('Неизвестное поле схемы параметра');
        const result = { type: p.type, label: label(p.label), default: p.default };
        if (p.type === 'slider') {
            if (![p.min, p.max, p.step, p.default].every(Number.isFinite) || p.min >= p.max || p.step <= 0 || p.step > p.max - p.min || p.default < p.min || p.default > p.max) fail('Некорректный slider');
            Object.assign(result, { min: p.min, max: p.max, step: p.step });
        } else if (p.type === 'toggle') {
            if (typeof p.default !== 'boolean') fail('Некорректный toggle');
        } else if (p.type === 'select') {
            if (!Array.isArray(p.options) || !p.options.length || p.options.length > 16 || !p.options.every(o => o && typeof o.value === 'string' && /^[a-zA-Z0-9-]{1,48}$/.test(o.value)) || new Set(p.options.map(o => o.value)).size !== p.options.length || !p.options.some(o => o.value === p.default)) fail('Некорректный select');
            result.options = p.options.map(o => ({ value: o.value, label: label(o.label) }));
        } else fail('Неизвестный тип параметра');
        parameterSchema[key] = result;
    }
    const quality = m.quality ?? 'balanced';
    if (!['low', 'balanced', 'high'].includes(quality)) fail('Некорректный профиль качества');
    return { apiVersion: 2, runtimeRequirements: { dom: runtimeRequirements.dom }, parameterSchema, quality,
        capabilities: { visualizer: m.capabilities.visualizer, visualizers: [...visualizers], motion: !!m.capabilities.motion } };
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
    return validatePackage({ format: 'noctune-scene', apiVersion: m.apiVersion ?? 1, manifest: m, assets, script: (await readRelative(m.script)).toString('utf8') });
}
function createSceneThemeStore({ directory, builtinDirectory, sdkFile, presetsDirectory, userThemesDirectory, legacyDirectory }) {
    const importedPath = id => {
        if (!/^import-[a-f0-9]{24}$/.test(id)) fail('Неизвестная тема');
        return path.join(directory(), id + '.noctheme');
    };
    const metadata = (p, id, builtin, removable = false) => ({ ...p.manifest, apiVersion: p.apiVersion, packageId: p.manifest.id, id, builtin, removable, preview: p.assets[p.manifest.preview] });
    let migration;
    let installationTask = Promise.resolve();
    // Source folders may live inside read-only app.asar. Removing them from the
    // gallery must survive restarts without deleting a developer's source files.
    const hiddenFile = () => path.join(directory(), '.hidden-themes.json');
    async function hiddenThemes() {
        const value = await fs.readFile(hiddenFile(), 'utf8').catch(error => { if (error.code === 'ENOENT') return '[]'; throw error; });
        const ids = JSON.parse(value);
        if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) fail('Повреждён список удалённых тем');
        return new Set(ids);
    }
    async function setHidden(packageId, hidden) {
        const ids = await hiddenThemes();
        if (hidden) ids.add(packageId); else ids.delete(packageId);
        const target = hiddenFile(), temp = target + '.' + crypto.randomUUID() + '.tmp';
        await fs.writeFile(temp, JSON.stringify([...ids]));
        await fs.rename(temp, target);
    }
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
                entries.set(id, { file, isDirectory, imported: imported && root === path.resolve(directory()), removable: true });
            }
        }
        return entries;
    }
    return {
        async list() {
            const themes = [];
            for (const [id, folder] of Object.entries(BUILTINS)) themes.push(metadata(await packDirectory(path.join(builtinDirectory, folder)), id, true));
            const hidden = await hiddenThemes();
            for (const [id, entry] of await userEntries()) {
                try {
                    const pkg = await (entry.isDirectory ? packDirectory(entry.file) : readPackage(entry.file));
                    if (!hidden.has(pkg.manifest.id)) themes.push(metadata(pkg, id, false, entry.removable));
                }
                catch (_) { /* One broken file must not prevent the gallery from loading. */ }
            }
            const overrides = new Map();
            for (const builtin of themes.filter(theme => theme.builtin)) {
                const newest = themes.filter(theme => !theme.builtin && theme.packageId === builtin.packageId)
                    .reduce((best, theme) => compareThemeVersions(theme.version, best.version) > 0 ? theme : best, builtin);
                if (newest !== builtin) overrides.set(builtin.packageId, { ...newest, id: builtin.id, builtin: true, removable: false });
            }
            const newestUsers = new Map();
            for (const theme of themes.filter(theme => !theme.builtin)) {
                const previous = newestUsers.get(theme.packageId);
                const newer = previous ? compareThemeVersions(theme.version, previous.version) : 1;
                if (!previous || newer > 0 || (newer === 0 && theme.id.startsWith('import-') && !previous.id.startsWith('import-'))) newestUsers.set(theme.packageId, theme);
            }
            const visibleThemes = themes.filter(theme => theme.builtin || (!overrides.has(theme.packageId) && newestUsers.get(theme.packageId) === theme))
                .map(theme => theme.builtin ? overrides.get(theme.packageId) || theme : theme);
            const presets = JSON.parse(await fs.readFile(path.join(presetsDirectory, 'presets.json'), 'utf8')).map(p => ({ ...p, path: path.join(presetsDirectory, p.file) }));
            return { themes: visibleThemes, presets };
        },
        async read(id) {
            let theme;
            if (Object.hasOwn(BUILTINS, id)) {
                theme = await packDirectory(path.join(builtinDirectory, BUILTINS[id]));
                const hidden = await hiddenThemes();
                for (const entry of (await userEntries()).values()) {
                    try {
                        const candidate = await (entry.isDirectory ? packDirectory(entry.file) : readPackage(entry.file));
                        if (!hidden.has(candidate.manifest.id) && candidate.manifest.id === theme.manifest.id && compareThemeVersions(candidate.manifest.version, theme.manifest.version) > 0) theme = candidate;
                    } catch (_) { /* Ignore damaged overrides as in the gallery. */ }
                }
            }
            else {
                const entry = (await userEntries()).get(id);
                if (!entry) fail('Неизвестная тема');
                theme = await (entry.isDirectory ? packDirectory(entry.file) : readPackage(entry.file));
                if ((await hiddenThemes()).has(theme.manifest.id)) fail('Тема удалена из галереи');
            }
            return { ...theme, sdk: await fs.readFile(sdkFile, 'utf8') };
        },
        async importFile(file) { return this.importPackage(await readPackage(file)); },
        async installationStatus(value) {
            const incoming = validatePackage(value);
            const matches = (await this.list()).themes.filter(theme => theme.packageId === incoming.manifest.id);
            if (!matches.length) return { state: 'install' };
            const current = matches.reduce((best, theme) => compareThemeVersions(theme.version, best.version) > 0 ? theme : best);
            return { state: compareThemeVersions(incoming.manifest.version, current.version) > 0 ? 'update' : 'installed', installedVersion: current.version, current };
        },
        async installPackage(value) {
            const task = installationTask.then(async () => {
                const status = await this.installationStatus(value);
                if (status.state === 'installed') return { ...status.current, unchanged: true };
                const installed = await this.importPackage(value, status.current?.id.startsWith('import-') ? status.current.id : null);
                return { ...installed, ...(status.current?.builtin ? { id: status.current.id, builtin: true, removable: false } : {}), action: status.state === 'update' ? 'update' : 'install' };
            });
            installationTask = task.catch(() => {});
            return task;
        },
        async importPackage(value, replaceId = null) {
            await (migration ||= migrateLegacy().catch(error => { migration = null; throw error; }));
            const theme = validatePackage(value);
            const content = JSON.stringify(theme);
            const id = replaceId || 'import-' + crypto.createHash('sha256').update(content).digest('hex').slice(0, 24);
            await fs.mkdir(directory(), { recursive: true });
            const target = importedPath(id), temp = target + '.' + crypto.randomUUID() + '.tmp';
            await fs.writeFile(temp, content, { flag: 'w' });
            await fs.rename(temp, target);
            await setHidden(theme.manifest.id, false);
            return metadata(theme, id, false, true);
        },
        async remove(id) {
            if (!/^(import|user)-[a-f0-9]{24}$/.test(id)) fail('Неизвестная тема');
            const task = installationTask.then(async () => {
                const entries = await userEntries(), entry = entries.get(id);
                if (!entry) fail('Неизвестная тема');
                const pkg = await (entry.isDirectory ? packDirectory(entry.file) : readPackage(entry.file));
                await setHidden(pkg.manifest.id, true);
                for (const candidate of entries.values()) {
                    if (!candidate.imported) continue;
                    let other;
                    try { other = await readPackage(candidate.file); } catch (_) { continue; }
                    if (other.manifest.id === pkg.manifest.id) await fs.rm(candidate.file, { force: true });
                }
                return true;
            });
            installationTask = task.catch(() => {});
            return task;
        },
    };
}
module.exports = { validatePackage, readPackage, packDirectory, createSceneThemeStore, MAX_BYTES };
