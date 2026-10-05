(() => {
    const zone = document.getElementById('playlist-drop-zone');
    const isFileDrag = event => Array.from(event.dataTransfer?.types || []).includes('Files');
    const currentPlaylist = () => userPlaylists.find(playlist => playlist.id === currentPlaylistId);
    const clear = () => { delete zone.dataset.dropState; delete zone.dataset.dropMessage; };

    // Prevent Chromium from navigating to a file dropped outside the playlist.
    document.addEventListener('dragover', event => {
        if (isFileDrag(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'none'; }
    });
    document.addEventListener('drop', event => {
        if (isFileDrag(event)) event.preventDefault();
        clear();
    });
    zone.addEventListener('dragover', event => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        const playlist = currentPlaylist();
        const acceptsTracks = playlist?.type === 'folder';
        event.dataTransfer.dropEffect = acceptsTracks ? 'copy' : 'none';
        zone.dataset.dropState = acceptsTracks ? 'accept' : 'reject';
        zone.dataset.dropMessage = acceptsTracks ? 'Отпустите, чтобы добавить треки'
            : playlist ? 'Радиоплейлист не поддерживает треки' : 'Выберите музыкальный плейлист';
    });
    zone.addEventListener('dragleave', event => {
        if (!event.relatedTarget || !zone.contains(event.relatedTarget)) clear();
    });
    zone.addEventListener('drop', event => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        clear();
        const playlist = currentPlaylist();
        if (playlist?.type !== 'folder') {
            statusText.textContent = 'Выберите музыкальный плейлист для добавления треков';
            return;
        }
        const paths = Array.from(event.dataTransfer.files || []).map(file => noctune.getDroppedFilePath(file)).filter(Boolean);
        const playlistId = playlist.id;
        queueAudioImport(() => addFilesToPlaylist(paths, playlistId));
    });
    window.addEventListener('blur', clear);
})();
