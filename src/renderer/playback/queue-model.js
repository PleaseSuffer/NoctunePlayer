// The playing playlist owns its timeline, independently of the playlist being browsed.
// Explicit SDK/file additions retain their public queue IDs and share this timeline.
(() => {
    let source = null, order = [], automatic = new Map(), launching = null, cleared = false;
    let manualOrder = [], lastPlayed = null, wrapped = new Set(), unavailable = new Set();
    const providerKey = entry => entry.provider ? `${entry.provider.addonId}:${entry.provider.providerId}:${entry.provider.track.id}` : null;
    const key = entry => entry.kind === 'provider'
        ? `provider:${entry.addonId}:${entry.providerId}:${entry.entryId || entry.trackId || entry.id}`
        : `${entry.kind || 'file'}:${entry.path}`;
    const manualKey = entry => entry.provider ? key({ kind: 'provider', ...entry.provider, ...entry.provider.track, trackId: entry.provider.track.id }) : key(entry);
    function descriptor(index) {
        const track = fileEntries[index];
        const meta = parsedMetadataCache[index] || track;
        return { queueId: crypto.randomUUID(), playlistId: currentPlaylistId, sourceIndex: index,
            sourceKey: key(track), path: track.path, kind: track.kind, title: meta.title || track.title || track.name,
            artist: meta.artist || '', track: { ...track }, automatic: true,
            ...(track.kind === 'provider' ? { provider: { addonId: track.addonId, providerId: track.providerId, track: { ...track, id: track.trackId } } } : {}) };
    }
    function syncManual() {
        for (const entry of externalAudioQueue) entry.queueId ||= crypto.randomUUID();
        const ids = externalAudioQueue.map(entry => entry.queueId), valid = new Set([...automatic.keys(), ...ids]);
        order = order.filter(id => valid.has(id));
        for (let i = 0; i < ids.length; i++) {
            if (order.includes(ids[i])) continue;
            const next = ids.slice(i + 1).find(id => order.includes(id));
            const previous = ids.slice(0, i).reverse().find(id => order.includes(id));
            const position = next ? order.indexOf(next) : previous ? order.indexOf(previous) + 1 : 0;
            order.splice(position, 0, ids[i]);
        }
        // SDK reorders affect the manual slots without discarding playlist edits.
        if (manualOrder.filter(id => ids.includes(id)).join() !== ids.filter(id => manualOrder.includes(id)).join()) {
            let index = 0;
            order = order.map(id => ids.includes(id) ? ids[index++] : id);
        }
        manualOrder = ids;
    }
    function view() {
        syncManual();
        const manual = new Map(externalAudioQueue.map(entry => [entry.queueId, entry]));
        return order.map(id => automatic.get(id) || manual.get(id)).filter(Boolean);
    }
    function notify() { window.addonEvents?.emit('queue.changed'); }
    function setFuture(entries) {
        const position = source.sequence.findIndex(entry => entry.queueId === source.currentId);
        wrapped = new Set(repeatMode === 2 ? source.sequence.slice(0, position + 1).map(entry => entry.queueId) : []);
        automatic = new Map(entries.filter(entry => !unavailable.has(providerKey(entry))).map(entry => [entry.queueId, entry]));
        order = order.filter(id => externalAudioQueue.some(entry => entry.queueId === id));
        order.push(...automatic.keys());
        syncManual();
    }
    function sequenceFromCurrent(wrap = repeatMode === 2) {
        if (!source) return [];
        const sequence = source.sequence;
        const position = sequence.findIndex(entry => entry.queueId === source.currentId);
        const tail = sequence.slice(position + 1);
        return wrap ? tail.concat(sequence.slice(0, position + 1)) : tail;
    }
    function capture(index) {
        const entries = playlistOrder.map(descriptor);
        const sequence = isShuffle ? shuffleList.map(position => entries[position]).filter(Boolean) : entries.slice();
        source = { playlistId: currentPlaylistId, entries, sequence,
            currentId: entries[index]?.queueId, signature: playlistOrder.map(i => key(fileEntries[i])).join('\n') };
        cleared = false; unavailable.clear();
        setFuture(sequenceFromCurrent());
    }
    function trackSelected(track, index) {
        const wasCurrent = lastPlayed?.playlistId === currentPlaylistId && lastPlayed.key === key(track);
        lastPlayed = { playlistId: currentPlaylistId, key: key(track) };
        const samePlaylist = launching && (!launching.playlistId || launching.playlistId === currentPlaylistId);
        const sameTrack = launching?.providerId
            ? launching.providerId === track.providerId && launching.addonId === track.addonId && launching.trackId === track.trackId
            : launching?.sourceKey === key(track);
        if (samePlaylist && sameTrack) {
            if (launching.automatic) source.currentId = launching.queueId;
            launching = null;
            if (!automatic.size && source && repeatMode === 2 && !cleared) setFuture(sequenceFromCurrent(true));
            return;
        }
        if (source && wasCurrent && repeatMode === 1) return;
        capture(index);
    }
    function refreshMetadata() {
        if (source?.playlistId !== currentPlaylistId) return;
        for (const entry of source.entries) {
            const index = entry.sourceIndex;
            if (fileEntries[index] && key(fileEntries[index]) === entry.sourceKey) {
                const metadata = parsedMetadataCache[index] || fileEntries[index];
                entry.title = metadata.title || fileEntries[index].name;
                entry.artist = metadata.artist || '';
            }
        }
    }
    function refreshSource() {
        if (!source || source.playlistId !== currentPlaylistId || cleared) return;
        // Continuous providers append pages. Keep edited pending tracks and append new entries.
        const signature = playlistOrder.map(i => key(fileEntries[i])).join('\n');
        if (signature === source.signature) { refreshMetadata(); return; }
        const known = new Map(), previousIds = new Set(source.entries.map(entry => entry.queueId)), entries = [];
        for (const entry of source.entries) {
            if (!known.has(entry.sourceKey)) known.set(entry.sourceKey, { entries: [], cursor: 0 });
            known.get(entry.sourceKey).entries.push(entry);
        }
        for (const index of playlistOrder) {
            const bucket = known.get(key(fileEntries[index]));
            const entry = bucket?.entries[bucket.cursor++] || descriptor(index);
            entry.sourceIndex = index; entries.push(entry);
        }
        const valid = new Set(entries.map(entry => entry.queueId));
        for (const id of automatic.keys()) if (!valid.has(id)) automatic.delete(id);
        for (const entry of entries) if (!previousIds.has(entry.queueId) && !unavailable.has(providerKey(entry))) { automatic.set(entry.queueId, entry); order.push(entry.queueId); }
        source.entries = entries;
        source.sequence = isShuffle ? shuffleList.map(index => entries[index]).filter(Boolean) : entries.slice();
        source.signature = signature;
        refreshMetadata();
    }
    function move(id, index) {
        view();
        const from = order.indexOf(id);
        if (from < 0 || !Number.isInteger(index) || index < 0 || index >= order.length) return false;
        order.splice(index, 0, order.splice(from, 1)[0]);
        const manual = new Map(externalAudioQueue.map(entry => [entry.queueId, entry]));
        externalAudioQueue.splice(0, externalAudioQueue.length, ...order.filter(id => manual.has(id)).map(id => manual.get(id)));
        manualOrder = externalAudioQueue.map(entry => entry.queueId);
        notify(); return true;
    }
    function remove(id) {
        automatic.delete(id); wrapped.delete(id);
        const index = externalAudioQueue.findIndex(entry => entry.queueId === id);
        if (index >= 0) externalAudioQueue.splice(index, 1);
        order = order.filter(value => value !== id);
        notify();
    }
    function clear() {
        cleared = true; automatic.clear(); wrapped.clear(); order = []; externalAudioQueue.length = 0; notify();
    }
    async function advance(token, { automatic: allowAutomatic = true } = {}) {
        refreshSource();
        while (view().length) {
            if (token !== _loadToken) return true;
            const next = view()[0];
            if (!next.automatic) {
                const expected = { playlistId: next.playlistId, sourceKey: manualKey(next) };
                // Providers may play through their own collection rather than the source playlist.
                if (next.provider) Object.assign(expected, { playlistId: null, addonId: next.provider.addonId, providerId: next.provider.providerId, trackId: next.provider.track.id });
                launching = expected;
                let played;
                const options = { bypassTimeline: true, single: true };
                try { played = await playQueuedAudioFile(token, options); }
                finally { if (launching === expected) launching = null; }
                if (played) return true;
                token = options.resumeToken ?? token;
                continue;
            }
            if (!allowAutomatic) return false;
            if (!userPlaylists.some(playlist => playlist.id === next.playlistId)) { if (next.provider) notifyQueueTrackUnavailable(next); remove(next.queueId); continue; }
            const valid = next.kind !== 'file' || (await validatedAudioPaths([next.path])).length > 0;
            if (token !== _loadToken) return true;
            if (view()[0] !== next) continue;
            if (!valid) { remove(next.queueId); continue; }
            if (currentPlaylistId !== next.playlistId) await selectPlaylist(next.playlistId);
            if (token !== _loadToken) return true;
            if (view()[0] !== next) continue;
            let index = next.sourceIndex;
            if (!fileEntries[index] || key(fileEntries[index]) !== next.sourceKey) index = fileEntries.findIndex(entry => key(entry) === next.sourceKey);
            const position = playlistOrder.indexOf(index);
            automatic.delete(next.queueId); order = order.filter(id => id !== next.queueId);
            if (position < 0) { if (next.provider) notifyQueueTrackUnavailable(next); notify(); continue; }
            launching = next;
            try { await playTrack(position, 0, { queuePlayback: next.kind === 'provider' }); return true; }
            catch (error) {
                if (error.queueLoadToken !== _loadToken) return true;
                notifyQueueTrackUnavailable(next);
                token = _loadToken;
            }
            finally { if (launching === next) launching = null; notify(); }
        }
        return false;
    }
    function markUnavailable(entry) {
        const identity = providerKey(entry);
        if (!identity) return;
        unavailable.add(identity);
        for (const [id, pending] of automatic) if (providerKey(pending) === identity) { automatic.delete(id); wrapped.delete(id); }
        for (let index = externalAudioQueue.length - 1; index >= 0; index--) {
            if (providerKey(externalAudioQueue[index]) === identity) externalAudioQueue.splice(index, 1);
        }
        syncManual(); notify();
    }
    window.playbackQueue = {
        view() { refreshSource(); return view(); }, move, remove, clear, advance, trackSelected, markUnavailable,
        get managed() { return !!source; },
        nextIndex() {
            refreshSource();
            if (!source) return undefined;
            const next = view()[0];
            return next?.automatic && next.playlistId === currentPlaylistId ? playlistOrder.indexOf(next.sourceIndex) : -1;
        },
    };
    window.addonEvents.on(event => {
        if (!source) return;
        if (event.type === 'playback.shuffle') {
            if (source.playlistId === currentPlaylistId) {
                source.sequence = isShuffle ? shuffleList.map(index => source.entries[index]).filter(Boolean) : source.entries.slice();
            } else if (!isShuffle) source.sequence = source.entries.slice();
            else source.sequence = createShuffleOrder(source.entries.length, source.entries.findIndex(entry => entry.queueId === source.currentId)).map(index => source.entries[index]);
            cleared = false; setFuture(sequenceFromCurrent());
        } else if (event.type === 'playback.repeat') {
            if (repeatMode === 2) {
                if (cleared) { cleared = false; setFuture(sequenceFromCurrent(true)); }
                else for (const entry of sequenceFromCurrent(true)) {
                    if (!automatic.has(entry.queueId) && !unavailable.has(providerKey(entry))) { automatic.set(entry.queueId, entry); order.push(entry.queueId); wrapped.add(entry.queueId); }
                }
            } else {
                for (const id of wrapped) automatic.delete(id);
                order = order.filter(id => !wrapped.has(id)); wrapped.clear();
            }
        }
    });
    if (currentIndex >= 0 && fileEntries[playlistOrder[currentIndex]]) trackSelected(fileEntries[playlistOrder[currentIndex]], currentIndex);
})();
