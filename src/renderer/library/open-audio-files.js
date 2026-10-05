// One sequence for Explorer commands and dropped files.
let externalAudioOpenTask = Promise.resolve();
let externalPlaylistSerial = 0;
const externalAudioQueue = [];

function queueAudioImport(task) {
    externalAudioOpenTask = externalAudioOpenTask.then(task).catch(error => {
        console.error('Import external audio files:', error);
        statusText.textContent = 'Не удалось открыть аудиофайл';
    });
    return externalAudioOpenTask;
}

function externalFilePlaylist(id = 'pl_external_files', name = 'Открытые файлы') {
    let playlist = userPlaylists.find(value => value.id === id);
    if (!playlist) {
        playlist = { id, name, type: 'folder', path: null, files: [], stations: [] };
        userPlaylists.push(playlist);
        renderPlaylistsDropdown();
    }
    return playlist;
}

async function openExternalAudioFiles(request) {
    const { files: paths, action = 'play' } = Array.isArray(request) ? { files: request } : (request || {});
    if (!['play', 'new-playlist', 'add-playlist', 'enqueue'].includes(action)) return;
    const files = await validatedAudioPaths(paths);
    if (!files.length) { statusText.textContent = 'Нет доступных аудиофайлов'; return; }
    const current = userPlaylists.find(value => value.id === currentPlaylistId);

    if (action === 'add-playlist') {
        if (current && current.type !== 'folder') {
            statusText.textContent = 'Аудиофайлы можно добавить только в музыкальный плейлист';
            return;
        }
        const target = current || externalFilePlaylist();
        if (!current) await selectPlaylist(target.id);
        await addFilesToPlaylist(files, target.id, { validated: true });
        return;
    }

    if (action === 'enqueue') {
        const active = userPlaylists.find(value => value.id === activePlaylistId);
        const target = active?.type === 'folder' ? active : current?.type === 'folder' ? current : externalFilePlaylist('pl_external_queue', 'Очередь воспроизведения');
        // Save first so a track ending during metadata extraction can consume the queue.
        target.files = [...new Set([...(target.files || []), ...files])];
        savePlaylistsToStorage();
        externalAudioQueue.push(...files.map(path => ({ playlistId: target.id, path })));
        sendTrayState();
        await addFilesToPlaylist(files, target.id, { validated: true });
        statusText.textContent = `Добавлено в очередь: ${files.length}`;
        if (currentIndex < 0 && !isPlaying && !_trackLoading) await playQueuedAudioFile(_loadToken);
        return;
    }

    stopTrack();
    externalAudioQueue.length = 0;
    const playlist = action === 'new-playlist'
        ? externalFilePlaylist(`pl_external_${Date.now()}_${++externalPlaylistSerial}`, 'Новый плейлист')
        : externalFilePlaylist();
    playlist.files = [...new Set([...(playlist.files || []), ...files])];
    savePlaylistsToStorage();
    renderPlaylistsDropdown();
    await selectPlaylist(playlist.id);
    const index = playlistOrder.findIndex(id => fileEntries[id]?.path === files[0]);
    if (index >= 0) await playTrack(index);
}

async function playQueuedAudioFile(token = _loadToken) {
    while (externalAudioQueue.length) {
        const next = externalAudioQueue.shift();
        if (!userPlaylists.some(value => value.id === next.playlistId && value.type === 'folder')) continue;
        if (!(await validatedAudioPaths([next.path])).length) continue;
        if (token !== _loadToken) return true;
        if (currentPlaylistId !== next.playlistId) await selectPlaylist(next.playlistId);
        if (token !== _loadToken) return true;
        const index = playlistOrder.findIndex(id => fileEntries[id]?.path === next.path);
        if (index < 0) continue;
        await playTrack(index);
        return true;
    }
    return false;
}

noctune.onOpenAudioFiles(request => queueAudioImport(() => openExternalAudioFiles(request)));
