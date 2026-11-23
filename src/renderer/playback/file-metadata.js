// Keep the parsed tags so switching their display never requires restarting audio.
function fileMetadataView(metadata, name) {
    const tags = metadata._embeddedTags || metadata;
    if (appStorage.getItem('setting_read_tags') !== '0') return { ...tags, _embeddedTags: tags };
    const clean = String(name || '').replace(/\.[^/.]+$/, '');
    const parts = clean.split(/ (?:-|—|–) /);
    return {
        ...tags, _embeddedTags: tags,
        title: (parts.length > 1 ? parts.slice(1).join(' - ') : clean).trim() || (globalThis.noctuneI18n?.t("preload.untitled", {}) ?? "Без названия"),
        artist: parts.length > 1 ? parts[0].trim() || (globalThis.noctuneI18n?.t("player.interface.unknownArtist", {}) ?? "Неизвестный исполнитель") : (globalThis.noctuneI18n?.t("player.interface.unknownArtist", {}) ?? "Неизвестный исполнитель"),
        album: '', coverDataUrl: null, coverThumbnailDataUrl: null, hasEmbeddedCover: false,
    };
}

async function readFileMetadata(filePath, name) {
    return fileMetadataView(await noctune.metadata.parseFile(filePath, name), name);
}

function refreshFileMetadataViews(updatedMetadata, updatedPath) {
    fileEntries.forEach((entry, index) => {
        if (entry.kind === 'radio' || entry.kind === 'provider') return;
        const cached = parsedMetadataCache[index];
        if (!cached) return;
        const meta = fileMetadataView(cached, entry.name);
        parsedMetadataCache[index] = meta;
        const title = document.getElementById(`title-${index}`);
        const artist = document.getElementById(`artist-${index}`);
        if (title) title.textContent = meta.title;
        if (artist) artist.textContent = meta.artist;
        window.updateTrackArtwork?.(index, meta, entry.path);
    });
    return window.refreshPlayingFileMetadata?.(updatedMetadata, updatedPath);
}
