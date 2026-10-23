(function () {
    const providers = new Map(), collections = new Map();
    const key = (id, provider) => id + ':' + provider;
    function get(entry) { const provider = providers.get(key(entry.addonId, entry.providerId)); if (!provider) throw new Error('Провайдер выключен'); return provider; }
    function validate(track) {
        if (!track || typeof track.id !== 'string' || !track.id || track.id.length > 300 || typeof track.title !== 'string' || !track.title || track.title.length > 300 || (track.artist !== undefined && (typeof track.artist !== 'string' || track.artist.length > 300))) throw new Error('Некорректный трек провайдера');
        return { kind: 'provider', trackId: track.id, name: track.title, title: track.title, artist: track.artist || '', album: typeof track.album === 'string' ? track.album.slice(0, 300) : '' };
    }
    window.addonProviders = {
        has(id, provider) {return providers.has(key(id,provider));},
        async collection(id, args, entryId) {
            get({addonId:id,providerId:args.provider});
            if(!Array.isArray(args.tracks)||args.tracks.length>10000)throw new Error('Не более 10000 загруженных треков');
            const collectionKey=JSON.stringify([id,args.provider,args.accountId,args.id]);
            let playlistId=collections.get(collectionKey);if(!playlistId){playlistId='provider_'+crypto.randomUUID();collections.set(collectionKey,playlistId);}
            const tracks=args.tracks.map(track=>({...validate(track),entryId:track.entryId,addonId:id,providerId:args.provider}));
            let pl=userPlaylists.find(pl=>pl.id===playlistId);if(!pl){pl={id:playlistId,type:'provider',addonId:id};userPlaylists.push(pl);}
            pl.name=String(args.name).slice(0,300);pl.tracks=tracks;pl.accountId=args.accountId;
            renderPlaylistsDropdown();await selectPlaylist(playlistId);
            if(entryId!==undefined){const index=tracks.findIndex(track=>track.entryId===entryId);if(index<0)throw new Error('Трек больше не находится в плейлисте');return playTrack(index);}
        },
        register(id, hash, args, call) {
            if (!/^[a-z][a-z0-9-]{1,63}$/.test(args.id) || typeof args.name !== 'string' || args.name.length > 120 || providers.has(key(id, args.id))) throw new Error('Некорректный или повторный провайдер');
            if ([...providers.values()].filter(provider => provider.id === id).length >= 8) throw new Error('Не более восьми провайдеров на расширение');
            providers.set(key(id, args.id), { id, hash, name: args.name, call, trackActions: args.trackActions === true, inlineActions: args.trackActions === true && args.inlineActions === true, revision: 0, offered: new Map(), pending: new Set() });
            document.dispatchEvent(new Event('addon-contributions-changed'));
        },
        async actions(entry, surface = 'menu', retries = 0) {
            const provider = get(entry);
            if (!provider.trackActions) return [];
            const revision = provider.revision;
            const result = await provider.call('trackActions', { trackId: entry.trackId || entry.id, surface });
            if (providers.get(key(entry.addonId, entry.providerId)) !== provider) throw new Error('Провайдер выключен или обновлён');
            if (revision !== provider.revision) {
                if (retries < 2) return this.actions(entry, surface, retries + 1);
                throw new Error('Состояние трека изменилось');
            }
            if (!Array.isArray(result) || result.length > 16) throw new Error('Не более 16 действий трека');
            const ids = new Set();
            const actions = result.map(action => {
                if (!action || typeof action.id !== 'string' || !/^[a-z][a-z0-9-]{1,63}$/.test(action.id) || ids.has(action.id) || typeof action.title !== 'string' || !action.title.trim() || action.title.length > 120) throw new Error('Некорректное действие трека');
                ids.add(action.id);
                return { id: action.id, title: action.title, icon: typeof action.icon === 'string' && /^[A-Z][A-Za-z0-9]{0,63}$/.test(action.icon) ? action.icon : 'Circle', inline: provider.inlineActions && action.inline === true, active: action.active === true };
            });
            provider.offered.set(entry.trackId || entry.id, { ids, expires: Date.now() + 60000 });
            while (provider.offered.size > 64) provider.offered.delete(provider.offered.keys().next().value);
            return actions;
        },
        hasInline(entry) { return providers.get(key(entry.addonId, entry.providerId))?.inlineActions === true; },
        invalidate(id, { provider: providerId, trackIds }) {
            const provider = get({ addonId: id, providerId });
            if (trackIds !== undefined && (!Array.isArray(trackIds) || trackIds.length > 100 || trackIds.some(track => typeof track !== 'string' || !track || track.length > 300))) throw new Error('Не более 100 ID треков');
            provider.revision++;
            if (trackIds) for (const track of trackIds) provider.offered.delete(track); else provider.offered.clear();
            document.dispatchEvent(new CustomEvent('provider-track-actions-changed', { detail: { addonId: id, providerId, trackIds } }));
        },
        async action(entry, action) {
            const provider = get(entry), trackId = entry.trackId || entry.id, offered = provider.offered.get(trackId);
            if (!provider.trackActions || !offered || offered.expires < Date.now() || !offered.ids.has(action)) throw new Error('Действие устарело. Откройте меню трека заново.');
            if (provider.pending.has(trackId)) throw new Error('Действие с треком уже выполняется');
            provider.pending.add(trackId);
            try { await provider.call('trackAction', { trackId, action }); if (providers.get(key(entry.addonId, entry.providerId)) === provider) this.invalidate(entry.addonId, { provider: entry.providerId, trackIds: [trackId] }); }
            finally { provider.pending.delete(trackId); provider.offered.delete(trackId); }
        },
        async search(id, args) { const provider = get({ addonId: id, providerId: args.provider }); const result = await provider.call('search', { query: String(args.query).slice(0, 300) }); if (!Array.isArray(result) || result.length > 100) throw new Error('Не более 100 результатов'); return result.map(track => { const item = validate(track); return { id: item.trackId, title: item.title, artist: item.artist, album: item.album }; }); },
        enqueue(id, args) {
            get({ addonId: id, providerId: args.provider }); validate(args.track);
            if (externalAudioQueue.length >= 500) throw new Error('Очередь заполнена');
            const queueId = crypto.randomUUID(); externalAudioQueue.push({ queueId, provider: { addonId: id, providerId: args.provider, track: args.track } });
            addonEvents.emit('queue.changed'); return queueId;
        },
        async play(id, args) {
            const provider = get({ addonId: id, providerId: args.provider }), track = { ...validate(args.track), addonId: id, providerId: args.provider };
            const playlistId = 'provider_' + id + '_' + args.provider;
            let pl = userPlaylists.find(item => item.id === playlistId);
            if (!pl) { pl = { id: playlistId, name: provider.name, type: 'provider', tracks: [] }; userPlaylists.push(pl); }
            const index = pl.tracks.findIndex(item => item.trackId === track.trackId);
            if (index < 0) pl.tracks.push(track); else pl.tracks[index] = track;
            renderPlaylistsDropdown(); await selectPlaylist(pl.id);
            return playTrack(index < 0 ? pl.tracks.length - 1 : index);
        },
        render(pl) {
            fileEntries = pl.tracks.slice(); playlistOrder = fileEntries.map((_, i) => i); parsedMetadataCache = {}; currentIndex = -1; playlistElem.replaceChildren();
            fileEntries.forEach((track, i) => { const li = document.createElement('li'); li.dataset.id = i; const label = document.createElement('span'); label.className = 'track-name-block'; label.textContent = `${track.artist ? track.artist + ' — ' : ''}${track.title}`; li.append(label); li.addEventListener('click', () => playTrack(i)); playlistElem.append(li); });
        },
        async resolve(entry, token, reason = 'play') {
            const provider = get(entry), descriptor = await provider.call('resolve', { trackId: entry.trackId, reason, sessionId: window.addonEvents.snapshot().sessionId });
            if (token !== _loadToken) throw new Error('Трек уже переключён');
            if (descriptor?.error) { const error = new Error(String(descriptor.error.message || 'Поток недоступен').slice(0, 240)); error.code = descriptor.error.code; throw error; }
            if (!descriptor || typeof descriptor.url !== 'string' || (descriptor.transport && descriptor.transport !== 'direct')) throw new Error('Поддерживаются прямые аудиопотоки без DRM');
            return noctune.addons.services(entry.addonId, provider.hash, 'providers.stream', { url: descriptor.url, oauth: descriptor.oauth, credential: descriptor.credential, headers: descriptor.headers });
        },
        watch(element, entry, token) {
            let retried = false, failed = false;
            element._noctuneProvider = true;
            const failure = error => {
                if (token !== _loadToken || failed) return;
                failed = true;
                addonEvents.emit('playback.error', { error: { code: error.code || 'STREAM_UNAVAILABLE', message: error.message }, retryable: false });
                stopTrack(); updatePlayIcons(false); statusText.textContent = error.message;
            };
            element.addEventListener('error', async () => {
                if (token !== _loadToken) return;
                if (retried) { failure(new Error('Не удалось воспроизвести поток после обновления ссылки')); return; }
                retried = true; element._noctuneRecovering = true;
                const position = element.currentTime || 0, paused = element.paused && !isPlaying;
                statusText.textContent = 'Обновление ссылки на поток…';
                try {
                    const url = await this.resolve(entry, token, 'refresh'); if (token !== _loadToken) return;
                    element.src = url;
                    element.addEventListener('loadedmetadata', () => {
                        if (token !== _loadToken) return;
                        element._noctuneRecovering = false;
                        if (position && Number.isFinite(element.duration)) element.currentTime = Math.min(position, element.duration);
                        if (!paused) element.play().then(() => { if (token === _loadToken) statusText.textContent = 'Воспроизведение'; }).catch(error => { if (error.name !== 'AbortError') failure(error); });
                    }, { once: true });
                    element.load();
                } catch (error) { failure(error); }
            });
        },
        cleanup(id) {
            for(const [name,playlistId] of collections)if(userPlaylists.some(pl=>pl.id===playlistId&&pl.addonId===id))collections.delete(name);
            for (const [name, provider] of providers) if (provider.id === id) providers.delete(name);
            if (fileEntries[playlistOrder[currentIndex]]?.addonId === id) { stopTrack(); updatePlayIcons(false); }
            const removed = userPlaylists.filter(pl => pl.type === 'provider' && (pl.addonId === id || pl.tracks.some(track => track.addonId === id)));
            userPlaylists = userPlaylists.filter(pl => !removed.includes(pl));
            if (removed.some(pl => pl.id === currentPlaylistId)) { currentPlaylistId = null; fileEntries = []; playlistOrder = []; playlistElem.replaceChildren(); }
            for (let i = externalAudioQueue.length - 1; i >= 0; i--) if (externalAudioQueue[i].provider?.addonId === id) externalAudioQueue.splice(i, 1);
            addonEvents.emit('queue.changed');
            renderPlaylistsDropdown();
        },
    };
})();
