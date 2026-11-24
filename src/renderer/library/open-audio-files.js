// One sequence for Explorer commands and dropped files.
let externalAudioOpenTask = Promise.resolve();
let externalPlaylistSerial = 0;
const externalAudioQueue = [];

function queueAudioImport(task) {
    externalAudioOpenTask = externalAudioOpenTask.then(task).catch(error => {
        console.error('Import external audio files:', error);
        statusText.textContent = (globalThis.noctuneI18n?.t("library.openAudioFiles.couldNotOpenAudioFile", {}) ?? "Не удалось открыть аудиофайл");
    });
    return externalAudioOpenTask;
}

function externalFilePlaylist(id = 'pl_external_files', name = (globalThis.noctuneI18n?.t("library.openAudioFiles.openedFiles", {}) ?? "Открытые файлы")) {
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
    if (!files.length) { statusText.textContent = (globalThis.noctuneI18n?.t("library.openAudioFiles.noAvailableAudioFiles", {}) ?? "Нет доступных аудиофайлов"); return; }
    const current = userPlaylists.find(value => value.id === currentPlaylistId);

    if (action === 'add-playlist') {
        if (current && current.type !== 'folder') {
            statusText.textContent = (globalThis.noctuneI18n?.t("library.openAudioFiles.audioFilesCanOnlyBeAddedToMusicPlaylists", {}) ?? "Аудиофайлы можно добавить только в музыкальный плейлист");
            return;
        }
        const target = current || externalFilePlaylist();
        if (!current) await selectPlaylist(target.id);
        await addFilesToPlaylist(files, target.id, { validated: true });
        return;
    }

    if (action === 'enqueue') {
        const active = userPlaylists.find(value => value.id === activePlaylistId);
        const target = active?.type === 'folder' ? active : current?.type === 'folder' ? current : externalFilePlaylist('pl_external_queue', (globalThis.noctuneI18n?.t("library.openAudioFiles.playbackQueue", {}) ?? "Очередь воспроизведения"));
        // Save first so a track ending during metadata extraction can consume the queue.
        target.files = [...new Set([...(target.files || []), ...files])];
        savePlaylistsToStorage();
        externalAudioQueue.push(...files.map(path => ({ playlistId: target.id, path })));
        globalThis.addonEvents?.emit('queue.changed');
        sendTrayState();
        await addFilesToPlaylist(files, target.id, { validated: true });
        statusText.textContent = (globalThis.noctuneI18n?.t("library.openAudioFiles.addedToQueue", {p0: (files.length)}) ?? "Добавлено в очередь: {p0}".replace(/\{(p\d+)\}/g, (_, k) => ({p0: (files.length)})[k] ?? "{"+k+"}"));
        if (currentIndex < 0 && !isPlaying && !_trackLoading) await playQueuedAudioFile(_loadToken);
        return;
    }

    stopTrack();
    externalAudioQueue.length = 0;
    globalThis.addonEvents?.emit('queue.changed');
    const playlist = action === 'new-playlist'
        ? externalFilePlaylist(`pl_external_${Date.now()}_${++externalPlaylistSerial}`, (globalThis.noctuneI18n?.t("library.openAudioFiles.newPlaylist", {}) ?? "Новый плейлист"))
        : externalFilePlaylist();
    playlist.files = [...new Set([...(playlist.files || []), ...files])];
    savePlaylistsToStorage();
    renderPlaylistsDropdown();
    await selectPlaylist(playlist.id);
    const index = playlistOrder.findIndex(id => fileEntries[id]?.path === files[0]);
    if (index >= 0) await playTrack(index);
}

function notifyQueueTrackUnavailable(entry) {
    const title = entry.provider?.track?.title || entry.title || entry.name || (globalThis.noctuneI18n?.t('queue.unknownTrack') ?? 'Без названия');
    const message = globalThis.noctuneI18n?.t('queue.unavailable', { title }) ?? `Трек «${title}» недоступен и пропущен.`;
    const identity = entry.provider ? `${entry.provider.addonId}:${entry.provider.providerId}:${entry.provider.track.id}` : title;
    globalThis.showNotification?.(message, 'warning', globalThis.noctuneI18n?.t('queue.title'), null, { replaceKey: 'queue-unavailable:' + identity });
    globalThis.playbackQueue?.markUnavailable?.(entry);
}

async function playQueuedProviderTrack(next, token) {
    const provider = next.provider;
    const matches = track => track && track.addonId === provider.addonId && track.providerId === provider.providerId && track.trackId === provider.track.id;
    const candidates = userPlaylists.filter(playlist => playlist.type === 'provider');
    const playlist = next.playlistId ? candidates.find(playlist => playlist.id === next.playlistId)
        : candidates.find(playlist => playlist.tracks?.some(matches));
    try {
        if (!playlist) {
            if (next.playlistId) throw new Error('Queued source playlist is no longer available');
            // SDK search results may have no loaded collection. Existing collections are preferred.
            await window.addonProviders.play(provider.addonId, { provider: provider.providerId, track: provider.track, queuePlayback: true });
        } else {
            const entryId = next.entryId || provider.track.entryId;
            const track = (entryId && playlist.tracks.find(track => matches(track) && track.entryId === entryId)) || playlist.tracks.find(matches);
            if (!track) throw new Error('Queued track is no longer in its source playlist');
            if (currentPlaylistId !== playlist.id) await selectPlaylist(playlist.id);
            if (token !== _loadToken) return { played: true, token: _loadToken };
            const position = playlistOrder.findIndex(index => fileEntries[index] === track || (matches(fileEntries[index]) && (!entryId || fileEntries[index].entryId === entryId)));
            if (position < 0) throw new Error('Queued track is no longer available');
            await playTrack(position, 0, { queuePlayback: true });
        }
        return { played: true, token: _loadToken };
    } catch (error) {
        if ((error.queueLoadToken ?? token) !== _loadToken) return { played: true, token: _loadToken };
        notifyQueueTrackUnavailable(next);
        return { played: false, token: _loadToken };
    }
}

async function playQueuedAudioFile(token = _loadToken, options = {}) {
    if (globalThis.playbackQueue && !options.bypassTimeline) return globalThis.playbackQueue.advance(token, options);
    let attempts = 0;
    while (externalAudioQueue.length && (!options.single || attempts++ === 0)) {
        if (token !== _loadToken) return true;
        const next = externalAudioQueue[0];
        if (next.provider) {
            if (token !== _loadToken) return true;
            externalAudioQueue.shift();
            globalThis.addonEvents?.emit('queue.changed');
            const result = await playQueuedProviderTrack(next, token);
            if (result.played) return true;
            token = result.token;
            options.resumeToken = token;
            continue;
        }
        const exists = userPlaylists.some(value => value.id === next.playlistId && (value.type === 'folder' || (next.kind === 'radio' && value.type === 'radio')));
        const valid = exists && (next.kind === 'radio' || (await validatedAudioPaths([next.path])).length > 0);
        if (token !== _loadToken) return true;
        // A drag, removal or clear during validation must take effect before playback.
        if (externalAudioQueue[0] !== next) continue;
        if (options.single && globalThis.playbackQueue?.view()[0] !== next) return false;
        externalAudioQueue.shift();
        globalThis.addonEvents?.emit('queue.changed');
        if (!valid) continue;
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
