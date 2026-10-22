(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.AddonAssets = api;
})(globalThis, function () {
    const types = Object.freeze({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', mp3: 'audio/mpeg', ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4' });
    const extension = file => file.split('.').pop().toLowerCase();
    const mime = file => types[extension(file)] || null;
    function resource(files, file) {
        const item = Object.hasOwn(files, file) ? files[file] : null;
        if (!mime(file) || !item || item.encoding !== 'base64' || typeof item.data !== 'string') throw new Error('Двоичный ресурс отсутствует: ' + file);
        return { mime: mime(file), base64: item.data, size: item.data.length / 4 * 3 - (item.data.endsWith('==') ? 2 : item.data.endsWith('=') ? 1 : 0) };
    }
    function url(files, file) { const data = resource(files, file); return 'data:' + data.mime + ';base64,' + data.base64; }
    return { types, extension, mime, resource, url };
});
