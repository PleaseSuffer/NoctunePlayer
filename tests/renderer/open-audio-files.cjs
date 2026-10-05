const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

(async () => {
    let listener;
    const played = [];
    let stops = 0;
    const context = {
        console, userPlaylists: [{ id: 'personal', type: 'folder', files: ['keep.mp3'] }],
        currentPlaylistId: 'personal', activePlaylistId: 'personal', currentIndex: 0, isPlaying: true, _trackLoading: false, _loadToken: 1,
        playlistOrder: [], fileEntries: [], statusText: {},
        noctune: { fs: { isAudioExt: value => /\.(mp3|wav|ogg|m4a|flac)$/i.test(value) }, onOpenAudioFiles: cb => { listener = cb; } },
        stopTrack: () => stops++, savePlaylistsToStorage() {}, renderPlaylistsDropdown() {},
        sendTrayState() {},
        selectPlaylist: async id => {
            await Promise.resolve();
            context.currentPlaylistId = id;
            const playlist = context.userPlaylists.find(value => value.id === id);
            context.fileEntries = playlist.files.map(path => ({ path }));
            context.playlistOrder = playlist.files.map((_, index) => index);
        },
        playTrack: async index => played.push(context.fileEntries[index].path),
        validatedAudioPaths: async paths => Array.isArray(paths) ? [...new Set(paths.filter(value => typeof value === 'string' && /\.(mp3|wav|ogg|m4a|flac)$/i.test(value)))] : [],
        addFilesToPlaylist: async (paths, id) => {
            const playlist = context.userPlaylists.find(value => value.id === id);
            playlist.files = [...new Set([...(playlist.files || []), ...paths])];
            if (context.currentPlaylistId === id) {
                context.fileEntries = playlist.files.map(path => ({ path }));
                context.playlistOrder = playlist.files.map((_, index) => index);
            }
        },
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync('src/renderer/library/open-audio-files.js', 'utf8'), context);
    listener(['Песня с пробелами.mp3', 'Песня с пробелами.mp3', 'b.flac', null, 'bad.txt']);
    listener(['b.flac', 'c.wav']);
    await vm.runInContext('externalAudioOpenTask', context);
    assert.deepEqual(played, ['Песня с пробелами.mp3', 'b.flac']);
    assert.equal(stops, 2);
    assert.deepEqual(context.userPlaylists[0].files, ['keep.mp3']);
    assert.deepEqual(Array.from(context.userPlaylists[1].files), ['Песня с пробелами.mp3', 'b.flac', 'c.wav']);
    listener(['b.flac']);
    await vm.runInContext('externalAudioOpenTask', context);
    assert.equal(context.userPlaylists.length, 2);
    assert.equal(played.at(-1), 'b.flac');
    const stopCount = stops;
    context.currentPlaylistId = 'personal';
    listener({ action: 'add-playlist', files: ['added.ogg'] });
    await vm.runInContext('externalAudioOpenTask', context);
    assert.equal(stops, stopCount, 'adding tracks does not interrupt playback');
    assert.deepEqual(Array.from(context.userPlaylists[0].files), ['keep.mp3', 'added.ogg']);
    context.userPlaylists.push({ id: 'radio', type: 'radio', stations: [] });
    context.currentPlaylistId = 'radio';
    listener({ action: 'add-playlist', files: ['reject.mp3'] });
    await vm.runInContext('externalAudioOpenTask', context);
    assert.equal(context.userPlaylists.at(-1).files, undefined, 'radio rejects audio tracks');
    context.currentPlaylistId = 'personal';
    listener({ action: 'enqueue', files: ['q1.mp3', 'q2.mp3'] });
    await vm.runInContext('externalAudioOpenTask', context);
    assert.equal(stops, stopCount, 'queueing does not interrupt playback');
    assert.equal(await vm.runInContext('playQueuedAudioFile()', context), true);
    assert.equal(played.at(-1), 'q1.mp3');
    assert.equal(await vm.runInContext('playQueuedAudioFile()', context), true);
    assert.equal(played.at(-1), 'q2.mp3');
    assert.equal(await vm.runInContext('playQueuedAudioFile()', context), false);
    listener({ action: 'new-playlist', files: ['new.wav'] });
    await vm.runInContext('externalAudioOpenTask', context);
    const newPlaylistId = context.currentPlaylistId;
    assert.notEqual(newPlaylistId, 'pl_external_files');
    assert.equal(played.at(-1), 'new.wav');
    listener({ action: 'new-playlist', files: ['other.wav'] });
    await vm.runInContext('externalAudioOpenTask', context);
    assert.notEqual(context.currentPlaylistId, newPlaylistId);
    context.selectPlaylist = async () => { throw new Error('load failure'); };
    context.console = { error() {} };
    listener(['failure.mp3']);
    await vm.runInContext('externalAudioOpenTask', context);
    assert.match(context.statusText.textContent, /Не удалось/);
    console.log('PASS: serialized Explorer actions, personal playlists, radio rejection, ordered queue, distinct new playlists and error handling.');
})().catch(error => { console.error(error); process.exitCode = 1; });
