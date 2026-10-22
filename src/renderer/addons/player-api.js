(function () {
    const ids = new Map(), paths = new Map(), listeners = new Set(), effects = new Map(), backgrounds = new Map();
    let session = null, serial = 0, sequence = 0, current = null, media = null, lastProgress = 0;
    const opaque = value => { if (!ids.has(value)) { if (ids.size >= 50000) throw new Error('Слишком много идентификаторов медиатеки'); const id = crypto.randomUUID(); ids.set(value, id); paths.set(id, value); } return ids.get(value); };
    const audio = () => isRadioMode ? radioAudioElement : localAudioElement;
    const snapshot = () => ({ ...(current || { trackId: null, title: '', artist: '', radio: false }), sessionId: session, playing: !!isPlaying, shuffle: typeof isShuffle === 'boolean' ? isShuffle : false, repeat: typeof repeatMode === 'number' ? repeatMode : 0, position: Number(audio()?.currentTime) || 0, duration: Number.isFinite(audio()?.duration) ? audio().duration : 0, volume: Number(volumeSlider.value), speed: Number(audio()?.playbackRate) || 1 });
    function emit(type, detail = {}) { const event = { type, sequence: ++sequence, timestamp: Date.now(), ...(/^(track|playback|progress)\./.test(type) ? snapshot() : {}), ...detail }; for (const fn of listeners) fn(event); }
    window.addonEvents = {
        playlistsChanged() { emit('playlists.changed',{initiator:playlistInitiator,playlists:userPlaylists.map(pl=>({id:pl.id,revision:playlistState(pl).revision}))}); },
        snapshot, on(fn) { listeners.add(fn); return () => listeners.delete(fn); }, emit,
        begin(entry) { serial++; session = crypto.randomUUID(); current = { trackId: opaque(entry.kind === 'provider' ? `provider:${entry.addonId}:${entry.providerId}:${entry.trackId}` : entry.path), title: entry.title || entry.name || '', artist: entry.artist || '', radio: entry.kind === 'radio', source: entry.kind || 'file' }; media = null; emit('track.changed', { reason: 'selection' }); },
        metadata(value) { if (!current || !value) return; current = { ...current, title: value.title || current.title, artist: value.artist || '' }; emit('track.metadata'); },
        stop() { if (session) emit('playback.stop', { reason: 'stop-or-replace', playing: false }); serial++; media = null; session = null; },
        media(element) {
            const token = serial; media = element;
            for (const [dom, type] of Object.entries({ playing: 'playback.play', pause: 'playback.pause', waiting: 'playback.buffering', stalled: 'playback.buffering', ended: 'playback.ended', error: 'playback.error', seeking: 'progress.seek', seeked: 'progress.seeked', durationchange: 'progress.duration', ratechange: 'playback.speed', volumechange: 'playback.volume' })) {
                element.addEventListener(dom, () => { if (token === serial && media === element) emit(type, { playing: !element.paused && !element.ended, ...(dom === 'error' ? { error: { code: element.error?.code || 0, message: 'Не удалось воспроизвести аудио' } } : {}) }); });
            }
        },
    };
    setInterval(() => { if (media && !media.paused && performance.now() - lastProgress >= 240) { lastProgress = performance.now(); emit('progress.updated'); } }, 250);
    const entryFor = id => {
        const path = paths.get(id); if (!path || path.startsWith('provider:')) throw new Error('Неизвестный локальный трек');
        for (const pl of userPlaylists) if (pl.type === 'folder' && (pl.files || []).includes(path)) return { path, playlistId: pl.id };
        if (fileEntries.some(entry => entry.path === path)) return { path, playlistId: currentPlaylistId };
        throw new Error('Трек отсутствует в медиатеке');
    };
    const library = pl => [...new Set([...(pl.files || []), ...(pl.id === currentPlaylistId ? fileEntries.filter(entry => entry.kind === 'file').map(entry => entry.path) : [])])].map(path => ({ trackId: opaque(path), title: path.split(/[\\/]/).pop() }));
    let playlistInitiator = null;
    function changedPlaylist(owner) { playlistInitiator=owner; try { savePlaylistsToStorage(); } finally { playlistInitiator=null; } renderPlaylistsDropdown(); }
    function text(value, max = 120) { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Некорректный текст'); return value; }
    function number(value, min, max) { if (!Number.isFinite(value) || value < min || value > max) throw new Error('Значение вне диапазона'); return value; }
    function attachEffects() {
        if (!audioCtx || !window.pannerNode) return;
        window.pannerNode.disconnect();
        let tail = window.pannerNode;
        for (const chain of effects.values()) for (const node of chain) { node.disconnect(); tail.connect(node); tail = node; }
        tail.connect(audioCtx.destination);
    }
    function clearEffects(id) { const nodes = effects.get(id); if (nodes) { nodes.forEach(node => node.disconnect()); effects.delete(id); attachEffects(); } }
    const playlistVersions = new Map();
    function playlistState(pl) {
        const signature = JSON.stringify([pl.name, pl.type, pl.path, pl.files]);
        let state = playlistVersions.get(pl.id);
        if (!state || state.signature !== signature) {
            const remaining = new Map();
            for (const entry of state?.entries || []) { if (!remaining.has(entry.path)) remaining.set(entry.path, []); remaining.get(entry.path).push(entry); }
            state = { revision: (state?.revision || 0) + 1, signature, entries: (pl.files || []).map(path => remaining.get(path)?.shift() || { path, entryId: crypto.randomUUID() }) };
            playlistVersions.set(pl.id, state);
        }
        return state;
    }
    function playlistView(pl) {
        const state = playlistState(pl);
        return { id: pl.id, name: pl.name, type: pl.type, revision: state.revision, tracks: pl.type === 'folder' ? (pl.path ? library(pl) : state.entries.map(entry => ({ entryId: entry.entryId, trackId: opaque(entry.path), title: entry.path.split(/[\\/]/).pop() }))) : [] };
    }
    function editPlaylist(id, args, action) {
        const pl = userPlaylists.find(item => item.id === args.id);
        if (!pl || pl.type !== 'folder' || pl.path) throw new Error('Редактируется только файловый плейлист без привязанной папки');
        const state = playlistState(pl);
        if (args.revision !== state.revision) throw new Error('REVISION_CONFLICT: плейлист уже изменился');
        const entries = state.entries.slice();
        if (action === 'addTracks') {
            if (!Array.isArray(args.tracks) || !args.tracks.length || entries.length + args.tracks.length > 10000) throw new Error('Некорректный список треков');
            const added = args.tracks.map(track => ({ path: entryFor(track).path, entryId: crypto.randomUUID() }));
            const index = args.index === undefined ? entries.length : number(args.index, 0, entries.length);
            if (!Number.isInteger(index)) throw new Error('Нужен целый индекс');
            entries.splice(index, 0, ...added);
        } else {
            if (!Array.isArray(args.entries) || !args.entries.length || new Set(args.entries).size !== args.entries.length || args.entries.some(key => !entries.some(entry => entry.entryId === key))) throw new Error('Неизвестные вхождения треков');
            if (action === 'removeTracks') { const remove = new Set(args.entries); for (let i = entries.length - 1; i >= 0; i--) if (remove.has(entries[i].entryId)) entries.splice(i, 1); }
            else { if (args.entries.length !== entries.length) throw new Error('Нужен полный порядок вхождений'); const ordered = args.entries.map(key => entries.find(entry => entry.entryId === key)); entries.splice(0, entries.length, ...ordered); }
        }
        pl.files = entries.map(entry => entry.path); state.entries = entries; state.revision++; state.signature = JSON.stringify([pl.name, pl.type, pl.path, pl.files]);
        changedPlaylist(id);
        if (currentPlaylistId === pl.id) selectPlaylist(pl.id);
        return playlistView(pl);
    }
    window.addonPlayer = {
        cleanup(id) { window.addonContributions?.cleanup(id); clearEffects(id); window.backgroundSettings?.accent(id, null); }, attachEffects,
        async invoke(id, hash, method, args) {
            if (args.sessionId !== undefined && args.sessionId !== session) throw new Error('Сеанс трека уже изменился');
            if (method === 'playback.read') return snapshot();
            if (method === 'playback.play') { if (args.trackId) { const entry = entryFor(args.trackId); await selectPlaylist(entry.playlistId); const index = playlistOrder.findIndex(i => fileEntries[i]?.path === entry.path); if (index < 0) throw new Error('Трек недоступен'); return playTrack(index); } if (!isPlaying) return togglePlayback(); return; }
            if (method === 'playback.shuffle') { if (typeof args.value !== 'boolean') throw new Error('Нужен переключатель'); if (isShuffle !== args.value) toggleShuffle(); return; }
            if (method === 'playback.repeat') { if (!Number.isInteger(args.value) || args.value < 0 || args.value > 2) throw new Error('Повтор: 0, 1 или 2'); if (repeatMode !== args.value) setRepeatMode(args.value); return; }
            if (method === 'playback.pause') { if (isPlaying) togglePlayback(); return; }
            if (method === 'playback.stop') { stopTrack(); updatePlayIcons(false); return; }
            if (method === 'playback.next') return playNext();
            if (method === 'playback.previous') return playPrev();
            if (method === 'playback.seek') { if (isRadioMode || !audio() || !Number.isFinite(audio().duration)) throw new Error('Перемотка недоступна'); audio().currentTime = number(args.position, 0, audio().duration); return; }
            if (method === 'playback.volume') { volumeSlider.value = number(args.value, Number(volumeSlider.min), Number(volumeSlider.max)); volumeSlider.dispatchEvent(new Event('input', { bubbles: true })); return; }
            if (method === 'playback.speed') { if (isRadioMode || !audio()) throw new Error('Скорость недоступна'); audio().playbackRate = number(args.value, .25, 4); return; }
            if (method === 'queue.read') return externalAudioQueue.map((entry, i) => ({ id: entry.queueId || (entry.queueId = crypto.randomUUID()), trackId: opaque(entry.provider ? `provider:${entry.provider.addonId}:${entry.provider.providerId}:${entry.provider.track.id}` : entry.path), playlistId: entry.playlistId || null, index: i }));
            if (method === 'queue.add') { if (externalAudioQueue.length >= 500) throw new Error('Очередь заполнена'); const entry = entryFor(args.trackId), queueId = crypto.randomUUID(); externalAudioQueue.push({ ...entry, queueId }); emit('queue.changed'); return queueId; }
            if (method === 'queue.remove' || method === 'queue.reorder') { const index = externalAudioQueue.findIndex(entry => entry.queueId === args.id); if (index < 0) throw new Error('Элемент очереди отсутствует'); const target = method === 'queue.reorder' ? Math.trunc(number(args.index, 0, externalAudioQueue.length - 1)) : 0; const [entry] = externalAudioQueue.splice(index, 1); if (method === 'queue.reorder') externalAudioQueue.splice(target, 0, entry); emit('queue.changed'); return; }
            if (method === 'playlists.read') return userPlaylists.filter(pl=>pl.type!=='provider').map(playlistView);
            if (['playlists.addTracks','playlists.removeTracks','playlists.reorder'].includes(method)) return editPlaylist(id, args, method.split('.')[1]);
            if (method === 'playlists.create') { const pl = { id: 'pl_' + crypto.randomUUID(), name: text(args.name), type: 'folder', path: null, files: [], stations: [] }; userPlaylists.push(pl); changedPlaylist(id); return pl.id; }
            if (method.startsWith('playlists.')) {
                const pl = userPlaylists.find(pl => pl.id === args.id); if (!pl) throw new Error('Плейлист отсутствует');
                if (method === 'playlists.select') return selectPlaylist(pl.id);
                if(pl.type==='provider')throw new Error('Каталог сервиса редактируется через servicePlaylists');
                if(args.revision!==playlistState(pl).revision)throw new Error('REVISION_CONFLICT: плейлист уже изменился');
                if (method === 'playlists.rename') pl.name = text(args.name);
                else if (method === 'playlists.delete') { if (pl.id === activePlaylistId) stopTrack(); userPlaylists = userPlaylists.filter(item => item !== pl); if (pl.id === currentPlaylistId) { fileEntries = []; playlistOrder = []; playlistElem.replaceChildren(); currentPlaylistId = null; } }
                else if (method === 'playlists.edit') { if (pl.type !== 'folder' || pl.path || !Array.isArray(args.tracks) || args.tracks.length > 10000) throw new Error('Редактируются только файловые плейлисты'); pl.files = args.tracks.map(track => entryFor(track).path); }
                else throw new Error('Неизвестный метод плейлиста');
                changedPlaylist(id); if (currentPlaylistId === pl.id && method === 'playlists.edit') await selectPlaylist(pl.id); return;
            }
            if (method === 'themes.list') { const data = await noctune.sceneThemes.list(); return data.themes.map(theme => ({ id: theme.id, name: theme.name, parameters: theme.parameterSchema || {} })); }
            if (method === 'themes.switch') { if (args.id === null) { sceneThemes.deactivate(); return; } const data = await noctune.sceneThemes.list(), theme = data.themes.find(theme => theme.id === args.id); if (!theme) throw new Error('Тема не установлена'); if (args.sessionId !== undefined && args.sessionId !== session) throw new Error('Сеанс изменился'); return sceneThemes.activate(theme, args.sessionId === undefined ? undefined : () => args.sessionId === session); }
            if (method === 'themes.accent') {
                if (args.color !== null && (typeof args.color !== 'string' || !/^#[a-f0-9]{6}$/i.test(args.color))) throw new Error('Цвет акцента должен быть #rrggbb или null');
                backgroundSettings.accent(id, args.color); return;
            }
            if (method === 'themes.apply') {
                if (args.palette) { const palette = args.palette; if (![palette.accent, ...(palette.gradient || [])].every(color => typeof color === 'string' && /^#[a-f0-9]{6}$/i.test(color)) || palette.gradient?.length !== 3) throw new Error('Палитра должна содержать #rrggbb'); backgroundSettings.palette(palette); }
                for (const [key, value] of Object.entries(args.parameters || {})) sceneThemes.setParameter(key, value);
                emit('themes.changed', { id: sceneThemes.metadata?.id || null }); return;
            }
            if (method === 'backgrounds.list') { const catalog = await noctune.sceneThemes.list(); const data = [...backgroundSettings.list(), ...catalog.presets].filter((item, index, items) => items.findIndex(other => other.path === item.path) === index); backgrounds.clear(); return data.map(item => { const key = opaque('background:' + item.path); backgrounds.set(key, item.path); return { id: key, name: item.path.split(/[\\/]/).pop(), video: !!item.isVideo }; }); }
            if (method === 'backgrounds.switch') { const path = backgrounds.get(args.id); if (!path) throw new Error('Сначала получите список фонов'); backgroundSettings.select(path); return; }
            if (method === 'backgrounds.apply') { backgroundSettings.apply(args); return; }
            if (method === 'files.library') { const entry = entryFor(args.trackId); return noctune.addons.libraryFile(id, hash, entry.path); }
            if (method === 'audio.analyse' || method === 'audio.pcm') { if (!analyzer || !audioCtx) return { sampleRate: 0, samples: [] }; const buffer = method === 'audio.analyse' ? new Uint8Array(analyzer.frequencyBinCount) : new Float32Array(analyzer.fftSize); if (method === 'audio.analyse') analyzer.getByteFrequencyData(buffer); else analyzer.getFloatTimeDomainData(buffer); return { sampleRate: audioCtx.sampleRate, samples: Array.from(buffer), sessionId: session }; }
            if (method === 'audio.equalizer') { initAudioEngine(); if (args.preset) { if (!Object.hasOwn(presets, args.preset)) throw new Error('Неизвестный пресет'); applyPreset(args.preset); } else { if (!Array.isArray(args.bands) || args.bands.length !== eqFilters.length) throw new Error('Нужно ' + eqFilters.length + ' полос'); args.bands.forEach(value => number(value, -12, 12)); args.bands.forEach((value, index) => { eqFilters[index].gain.value = value; writeEqBandUI(index, value); }); saveEqState(); } return; }
            if (method === 'audio.effects') {
                if (!Array.isArray(args.chain) || args.chain.length > 8) throw new Error('Не более восьми эффектов'); initAudioEngine(); const nodes = [];
                try { for (const fx of args.chain) { let node; if (fx.type === 'gain') { node = audioCtx.createGain(); node.gain.value = number(fx.gain, 0, 2); } else if (fx.type === 'biquad') { if (!['lowpass','highpass','bandpass','lowshelf','highshelf','peaking','notch','allpass'].includes(fx.filter)) throw new Error('Неизвестный фильтр'); node = audioCtx.createBiquadFilter(); node.type = fx.filter; node.frequency.value = number(fx.frequency, 20, 20000); node.Q.value = number(fx.q ?? 1, .01, 30); node.gain.value = number(fx.gain ?? 0, -12, 12); } else if (fx.type === 'compressor') { node = audioCtx.createDynamicsCompressor(); node.threshold.value = number(fx.threshold ?? -24, -100, 0); node.ratio.value = number(fx.ratio ?? 4, 1, 20); } else throw new Error('Неизвестный эффект'); nodes.push(node); } }
                catch (error) { nodes.forEach(node => node.disconnect()); throw error; }
                clearEffects(id); effects.set(id, nodes); attachEffects(); return;
            }
            throw new Error('Неизвестный метод плеера: ' + method);
        },
    };
    window.sceneThemes?.onChange(() => emit('themes.changed', { id: sceneThemes.metadata?.id || null }));
})();
