'use strict';
const path = require('node:path');
const { stat } = require('node:fs/promises');

function createCoverCacheDirectoryResolver({ settings, userData, statFile = stat }) {
    let lastMusicFile = null;
    return async payload => {
        const { location, customPath } = settings();
        const local = path.join(userData(), 'lastfm-cover-cache');
        if (location === 'custom' && typeof customPath === 'string' && path.isAbsolute(customPath)) return path.resolve(customPath);
        const file = typeof payload?.filePath === 'string' ? payload.filePath : lastMusicFile;
        if (file && path.isAbsolute(file) && /\.(mp3|wav|ogg|m4a|flac)$/i.test(file)) {
            try {
                if ((await statFile(file)).isFile()) {
                    lastMusicFile = file;
                    if (location === 'music') return path.join(path.dirname(file), '.noctune-cache', 'covers');
                }
            } catch (_) {}
        }
        return local;
    };
}
module.exports = { createCoverCacheDirectoryResolver };
