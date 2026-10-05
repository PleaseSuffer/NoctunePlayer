const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/renderer/library/playlists.js', 'utf8');
function extract(name) {
    const start = source.search(new RegExp('        async function ' + name + '\\('));
    assert(start >= 0);
    return source.slice(start, source.indexOf('\n        }', start) + 10);
}

(async () => {
    const nodes = [];
    const context = {
        console, userPlaylists: [{ id: 'music', type: 'folder', path: '/music', files: [] }, { id: 'radio', type: 'radio' }],
        currentPlaylistId: 'music', fileEntries: [{ path: '/music/original.mp3' }], playlistOrder: [0],
        isShuffle: false, parsedMetadataCache: {}, statusText: {}, lucide: { createIcons() {} },
        savePlaylistsToStorage() {}, buildShuffleList() {}, formatTime: () => '0:00',
        window: { updateTrackArtwork() {} },
        noctune: {
            fs: { isAudioExt: value => /\.(mp3|flac)$/i.test(value), stat: async value => ({ isFile: !value.includes('directory') && !value.includes('missing') }) },
            metadata: { parseFile: async () => ({ title: 'Title', artist: 'Artist', duration: 0 }) },
        },
        playlistElem: { querySelector: () => null, appendChild: node => nodes.push(node) },
        document: {
            getElementById: () => null,
            createElement: () => ({ setAttribute() {}, addEventListener() {}, querySelector: () => ({ textContent: '', addEventListener() {} }) }),
        },
    };
    vm.createContext(context);
    for (const name of ['validatedAudioPaths', 'addFilesToPlaylist', 'selectPlaylist']) vm.runInContext(extract(name), context);
    const paths = ['/outside/new.flac', '/outside/new.flac', '/folder/directory.mp3', '/missing.mp3', 'notes.txt'];
    assert.deepEqual(Array.from(await context.validatedAudioPaths(paths)), ['/outside/new.flac']);
    await context.addFilesToPlaylist(paths, 'music');
    assert.equal(nodes.length, 1);
    assert.deepEqual(Array.from(context.userPlaylists[0].files), ['/outside/new.flac']);
    assert.equal(context.fileEntries[0].path, '/music/original.mp3');
    assert.equal(context.fileEntries[1].path, '/outside/new.flac');
    await context.addFilesToPlaylist(paths, 'music');
    assert.equal(nodes.length, 1, 'duplicates do not create new rows');
    await context.addFilesToPlaylist(paths, 'radio');
    assert.equal(context.userPlaylists[1].files, undefined);
    context.currentPlaylistId = 'radio';
    await context.addFilesToPlaylist(['/outside/second.mp3'], 'music');
    assert.equal(nodes.length, 1, 'adding to a hidden playlist leaves the visible list alone');
    assert.equal(context.userPlaylists[0].files.length, 2);
    context._updateDropdownSelected = () => {};
    context.updatePlaylistActionsBar = () => {};
    context.loadMusicFromDirectory = async () => { context.fileEntries = [{ path: '/music/original.mp3' }]; context.playlistOrder = [0]; };
    await context.selectPlaylist('music');
    assert.deepEqual(Array.from(context.fileEntries, entry => entry.path), ['/music/original.mp3', '/outside/new.flac', '/outside/second.mp3'], 'directory playlists retain individually imported files after switching back');
    let finishMetadata;
    context.noctune.metadata.parseFile = () => new Promise(resolve => { finishMetadata = resolve; });
    const pending = context.addFilesToPlaylist(['/outside/slow.mp3'], 'music');
    while (!finishMetadata) await Promise.resolve();
    context.fileEntries = [];
    context.parsedMetadataCache = {};
    finishMetadata({ title: 'Stale', duration: 0 });
    await pending;
    assert.equal(Object.keys(context.parsedMetadataCache).length, 0, 'old metadata cannot mutate a newly selected playlist');
    console.log('PASS: shared file import validation, directories, missing files, deduplication, radio rejection, folder persistence and stale metadata.');
})().catch(error => { console.error(error); process.exitCode = 1; });
