(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api; else root.AddonContributions = api;
})(globalThis, function () {
    const operations = ['read','create','rename','delete','addTracks','removeTracks','reorder'];
    const roles = { background: '--bg-color', surface: '--container-bg', text: '--text-color', muted: '--text-muted', border: '--border-color', hover: '--track-hover', accent: '--accent-color', secondary: '--artist-color' };
    const object = value => value && typeof value === 'object' && !Array.isArray(value);
    const name = value => typeof value === 'string' && /^[a-z][a-z0-9-]{1,63}$/.test(value) && !['constructor','prototype'].includes(value);
    const fail = message => { throw new Error(message); };
    function keys(value, allowed) { if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('Неизвестное поле декларации расширения'); }
    // Origin declarations may cover a DNS subtree; actual request URLs never contain '*'.
    // Authentication profiles remain restricted to exact origins, independently of this match.
    function validOrigin(value, allowSubdomains = true) {
        if (typeof value !== 'string' || value.length > 2048) return false;
        const wildcard = value.startsWith('https://*.');
        if (value.includes('*') && (!wildcard || !allowSubdomains)) return false;
        const base = wildcard ? 'https://' + value.slice(10) : value;
        let url;
        try { url = new URL(base); } catch (_) { return false; }
        if (url.protocol !== 'https:' || url.origin !== base || url.port || url.hostname.includes('*')) return false;
        if (!wildcard) return true;
        const labels = url.hostname.split('.');
        return labels.length >= 2 && labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) && /[a-z]/.test(labels.at(-1));
    }
    function originMatches(declaration, actual) {
        if (!validOrigin(declaration) || !validOrigin(actual, false)) return false;
        if (!declaration.startsWith('https://*.')) return declaration === actual;
        const base = declaration.slice(10), host = new URL(actual).hostname;
        return host.length > base.length + 1 && host.endsWith('.' + base);
    }
    const allowsOrigin = (origins, actual) => Array.isArray(origins) && origins.some(value => originMatches(value, actual));
    function route(manifest, grants, value, method = 'GET') {
        const url = new URL(value), routes = manifest.network?.routes;
        if (!routes) return;
        if (/%(?:2f|5c|2e|25)/i.test(url.pathname)) fail('Неоднозначное кодирование пути недоступно для маршрутов');
        const found = routes.filter(item => originMatches(item.origin, url.origin) && item.methods.includes(method) && (item.prefix ? url.pathname.startsWith(item.path) : url.pathname === item.path));
        if (!found.length || found.some(item => item.permission && !grants.includes(item.permission))) fail('Маршрут или действие не разрешены');
        return found;
    }
    function validate(manifest, grants) {
        for (const field of Object.values(manifest.settings || {})) {
            const permission = { 'appearance.schemes':'appearance.list', backgrounds:'backgrounds.list' }[field.source];
            if (permission && !grants.includes(permission)) fail('Источник вариантов требует разрешения ' + permission);
        }
        if (manifest.network?.routes !== undefined) {
            if (!Array.isArray(manifest.network.routes) || !manifest.network.routes.length || manifest.network.routes.length > 64) fail('Нужно от 1 до 64 сетевых маршрутов');
            for (const item of manifest.network.routes) {
                keys(item, ['origin','path','prefix','methods','permission']);
                if (!manifest.network.origins.includes(item.origin) || typeof item.path !== 'string' || !/^\/[a-zA-Z0-9_./~-]*$/.test(item.path) || item.path.includes('..') || (item.prefix !== undefined && typeof item.prefix !== 'boolean') || (item.prefix && !item.path.endsWith('/')) || !Array.isArray(item.methods) || !item.methods.length || item.methods.some(verb => !['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(verb))) fail('Некорректный сетевой маршрут');
                if (item.permission !== undefined && (!operations.some(operation => item.permission === 'servicePlaylists.' + operation) || !grants.includes(item.permission))) fail('Не выдано право маршрута');
            }
        }
        if (manifest.network && grants.some(key => key.startsWith('servicePlaylists.')) && !manifest.network.routes) fail('Удалённым плейлистам нужны явные сетевые маршруты');
        if (manifest.credentials !== undefined) {
            if (!object(manifest.credentials) || Object.keys(manifest.credentials).length > 8) fail('Не более восьми профилей авторизации');
            for (const [id, profile] of Object.entries(manifest.credentials)) {
                keys(profile, ['name','description','origins','header','scheme']);
                if (!name(id) || typeof profile.name !== 'string' || !profile.name.trim() || profile.name.length > 120 || (profile.description !== undefined && (typeof profile.description !== 'string' || profile.description.length > 500)) || !Array.isArray(profile.origins) || !profile.origins.length || profile.origins.some(origin => !validOrigin(origin, false) || !manifest.network?.origins.includes(origin)) || !/^(Authorization|X-[a-z0-9-]{1,60})$/i.test(profile.header) || typeof profile.scheme !== 'string' || !/^[a-zA-Z0-9_-]{0,32}$/.test(profile.scheme)) fail('Некорректный профиль авторизации');
            }
            if (!grants.includes('network.request')) fail('Профилю авторизации требуется network.request');
        }
        if (manifest.ui !== undefined) {
            keys(manifest.ui, ['integrations']); keys(manifest.ui.integrations, ['title','description','sections']);
            const panel = manifest.ui.integrations;
            if (!grants.includes('ui.integrations') || typeof panel.title !== 'string' || !panel.title.trim() || panel.title.length > 120 || (panel.description !== undefined && (typeof panel.description !== 'string' || panel.description.length > 500)) || !Array.isArray(panel.sections) || panel.sections.length > 8) fail('Некорректная панель интеграции');
            const used = new Set(), ids = new Set();
            for (const section of panel.sections) {
                keys(section, ['id','title','fields']);
                if (!name(section.id) || ids.has(section.id) || typeof section.title !== 'string' || section.title.length > 120 || !Array.isArray(section.fields) || section.fields.some(field => !Object.hasOwn(manifest.settings || {}, field) || used.has(field))) fail('Некорректный раздел панели');
                ids.add(section.id); section.fields.forEach(field => used.add(field));
            }
        }
    }
    function palette(value) {
        if (!object(value) || Object.keys(value).some(key => !Object.hasOwn(roles, key)) || Object.values(value).some(color => typeof color !== 'string' || !/^#[a-f0-9]{6}$/i.test(color))) fail('Нужны семантические цвета #RRGGBB');
        return { ...value };
    }
    return { operations, roles, validate, route, palette, name, keys, validOrigin, originMatches, allowsOrigin };
});
