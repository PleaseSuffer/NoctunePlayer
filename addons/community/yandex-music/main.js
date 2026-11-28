/* Noctune SDK 1: no Node, DOM, direct fetch or access to the credential value. */
NoctuneAddon.define(async api => {
    const ORIGIN = 'https://api.music.yandex.net', PROFILE = 'yandex-token';
    const PROVIDER = 'yandex-music', CATALOG = 'yandex-library';
    const snapshots = new Map(), waves = new Map(), sessions = new Map(), ownSessions = new Set(), radioBatches = new Set();
    let settings = await api.settings.get(), generation = 0, serial = 0;
    let accountRequest = null, registeredAccount = null, cooldown = 0;
    let networkTail = Promise.resolve(), lastNotice = 0, lastError = '';
    let likesArtwork = '', waveArtwork = '';
    let ratingCache = null, ratingRequest = null, ratingRevision = 0;
    const lyricCache = new Map(), trackMetadata = new Map(), ratingAliases = new Map(), downloadJobs = new Map();
    let historyStatus = await api.storage.get('history-report-status');
    if (historyStatus?.formatVersion !== 1) historyStatus = { formatVersion: 1, accepted: 0, failed: 0, last: null, lastPlayed: null };
    const short = (value, fallback = '') => String(value || fallback).slice(0, 300);
    const numeric = value => /^\d+$/.test(String(value));
    const failure = (code, message) => Object.assign(new Error(message), { code });
    const stale = () => failure('AUTH_REQUIRED', 'Аккаунт изменился. Откройте каталог заново; при смене аккаунта выключите и включите расширение.');
    function reset() {
        generation++; accountRequest = null;
        snapshots.clear(); waves.clear(); sessions.clear(); radioBatches.clear(); cooldown = 0;
        likesArtwork='';waveArtwork='';
        ratingCache=null;ratingRequest=null;ratingRevision++;
        lyricCache.clear(); trackMetadata.clear(); ratingAliases.clear();
        historyStatus = { formatVersion: 1, accepted: 0, failed: 0, last: null, lastPlayed: null };
        api.storage.set('history-report-status', historyStatus).catch(() => {});
    }
    async function notice(message, key, options = {}) {
        if (key) return api.notifications.show(short(message), { title: 'Яндекс Музыка', key, ...options });
        if (Date.now() - lastNotice < 3100) return;
        lastNotice = Date.now(); await api.notifications.show(short(message), { title: 'Яндекс Музыка', ...options });
    }
    // A single lane keeps command, catalog and feedback requests inside SDK quotas.
    // Never retry writes or sleep inside a provider callback (20 second SDK deadline).
    async function request(path, { body, form, headers, authenticated = true, raw = false } = {}) {
        const epoch = generation;
        const run = async () => {
            if (epoch !== generation) throw stale();
            if (Date.now() < cooldown) throw failure('RATE_LIMITED', 'Яндекс ограничил запросы. Повторите позже.');
            let response;
            try {
                const payload = form ? Object.entries(form).map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(value)).join('&') : body === undefined ? undefined : JSON.stringify(body);
                response = await api.network.request({ url: path.startsWith('https://') ? path : ORIGIN + path,
                    method: payload === undefined ? 'GET' : 'POST',
                    ...(authenticated ? { credential: PROFILE } : {}),
                    ...(headers ? { headers } : {}),
                    ...(payload === undefined ? {} : { body: payload, headers: { ...headers, 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' } }) });
            } catch (error) {
                const detail = String(error.message || 'Сетевая ошибка').replace(/https?:\/\/\S+/g, '[адрес скрыт]').replace(/\b(?:OAuth|Bearer)\s+\S+/gi, '[авторизация скрыта]').slice(0, 160);
                throw failure('NETWORK', 'Не выполнен запрос: ' + detail);
            }
            if (epoch !== generation) throw stale();
            if (response.status === 429) {
                const retry = response.headers['retry-after'];
                const seconds = /^\d+$/.test(retry || '') ? Number(retry) : (Date.parse(retry) - Date.now()) / 1000;
                cooldown = Date.now() + Math.max(1, Math.min(3600, seconds || 30)) * 1000 + Math.random() * 1000;
                throw failure('RATE_LIMITED', 'Яндекс ограничил запросы. Повторите после паузы.');
            }
            if (response.status === 401) { reset(); throw failure('AUTH_REQUIRED', 'Токен отклонён. Повторно настройте вход в Яндекс Музыку.'); }
            if (response.status === 403) throw failure('NETWORK', 'Сервис отказал в доступе (403). Проверьте права токена и подписку.');
            if (response.status === 404) throw failure('NOT_FOUND', 'Объект Яндекс Музыки не найден.');
            if (response.status < 200 || response.status >= 300) throw failure('NETWORK', 'Яндекс Музыка временно недоступна. Повторите вручную.');
            if (raw) return response.body;
            let data;
            try { data = JSON.parse(response.body); } catch (_) { throw failure('NETWORK', 'Сервис вернул некорректный JSON.'); }
            if (data.error) throw failure('NETWORK', 'Яндекс Музыка вернула ошибку API.');
            if (!Object.hasOwn(data, 'result')) throw failure('NETWORK', 'Неизвестный формат ответа Яндекс Музыки.');
            return data.result;
        };
        const task = networkTail.then(run, run);
        networkTail = task.catch(() => {});
        return task;
    }
    async function identity() {
        // The native credentials UI can replace a key without a Worker event.
        // Revalidate the server identity at every public operation, not only at login.
        if (!accountRequest) {
            const epoch = generation;
            const pending = (async () => {
                const status = await api.credentials.status(PROFILE);
                if (!status.configured) throw failure('AUTH_REQUIRED', status.secureStorage ? 'Настройте токен Яндекс Музыки.' : 'Защищённое хранилище ОС недоступно.');
                const result = await request('/account/status');
                if (epoch !== generation) throw stale();
                if (!numeric(result.account?.uid)) throw failure('AUTH_REQUIRED', 'Не удалось определить аккаунт Яндекс Музыки.');
                const next = { uid: String(result.account.uid), name: short(result.account.displayName, result.account.login || result.account.uid) };
                if (registeredAccount && registeredAccount !== next.uid) throw stale();
                return next;
            })();
            accountRequest = pending;
            pending.finally(() => { if (accountRequest === pending) accountRequest = null; }).catch(() => {});
        }
        return accountRequest;
    }
    function remember(kind, scope, value) {
        const id = 's' + (++serial);
        snapshots.set(id, { kind, scope, value, generation, expires: Date.now() + 600000 });
        while (snapshots.size > 24) snapshots.delete(snapshots.keys().next().value);
        return id;
    }
    function snapshot(cursor, kind, scope) {
        const match = /^(s\d+):(\d+)$/.exec(cursor || '');
        const state = match && snapshots.get(match[1]);
        if (!state || state.generation !== generation || state.expires < Date.now() || state.kind !== kind || state.scope !== scope) {
            throw failure('NOT_FOUND', 'Страница устарела. Откройте список заново.');
        }
        const offset = Number(match[2]);
        if (!Number.isSafeInteger(offset) || offset > state.value.items.length) throw failure('NOT_FOUND', 'Некорректная страница.');
        return { key: match[1], state, offset };
    }
    function page(key, offset = 0) {
        const { items } = snapshots.get(key).value;
        return { items: items.slice(offset, offset + 100), cursor: offset + 100 < items.length ? key + ':' + (offset + 100) : null };
    }
    function trackId(track) {
        const id = String(track.id || '');
        if (!/^\d+(?::\d+)?$/.test(id)) throw failure('NOT_FOUND', 'Этот тип трека пока не поддерживается.');
        const album = track.albumId || track.albums?.[0]?.id;
        return id.includes(':') || !numeric(album) ? id : id + ':' + album;
    }
    function trackView(track, uid) {
        const realId = trackId(track);
        const album=track.albums?.[0]||{},position=album.trackPosition||{};
        const artists=(track.artists||[]).map(item=>short(item.name)).filter(Boolean);
        const albumArtists=(album.artists||[]).map(item=>short(item.name)).filter(Boolean);
        const tags={};
        for(const [field,value]of Object.entries({title:short(track.title),artist:artists.join('; '),album:short(album.title),albumArtist:albumArtists.join('; '),genre:short(album.genre)}))if(value)tags[field]=value;
        for(const [field,value]of Object.entries({year:album.year,track:position.index,disc:position.volume,trackCount:album.volumes?.[Number(position.volume)-1]?.length,discCount:album.volumes?.length})){
            const number=Number(value);if(Number.isInteger(number)&&number>0&&number<=(field==='year'?9999:65535))tags[field]=number;
        }
        trackMetadata.set(realId.split(':')[0], {title:short(track.title, 'Трек ' + track.id),artist:short(artists.join(', ')),tags});
        while(trackMetadata.size>2000)trackMetadata.delete(trackMetadata.keys().next().value);
        return { id: uid + '/t/' + trackId(track), title: short(track.title, 'Трек ' + track.id),
            artist: short((track.artists || []).map(item => item.name).filter(Boolean).join(', ')), album: short(track.albums?.[0]?.title),
            duration: Math.max(0,Number(track.durationMs)||0)/1000,artwork:cover(track.coverUri||track.albums?.[0]?.coverUri),canonicalId:uid+'/t/'+trackId(track) };
    }
    function cover(value) {
        const uri=typeof value==='string'?value:value?.uri||value?.itemsUri?.[0];
        if(!uri)return '';
        try {const url=new URL((uri.startsWith('https://')?uri:uri.startsWith('//')?'https:'+uri:'https://'+uri).replace(/%%/g,'200x200'));return url.protocol==='https:'&&!url.username&&!url.password&&!url.hash&&!url.port&&['avatars.yandex.net','avatars.mds.yandex.net'].includes(url.hostname)?url.href:'';}catch(_){return '';}
    }
    function playlistView(value) {
        const owner = value.owner?.uid || value.uid;
        if (!numeric(owner) || !numeric(value.kind)) return null;
        return { id: 'playlist/' + owner + '/' + value.kind, name: short(value.title, 'Плейлист'), revision: String(value.revision ?? 'unknown'), artwork:cover(value.cover||value.ogImage),total:Number(value.trackCount)||0 };
    }
    async function hydrate(entries, uid, offset) {
        const ids = entries.filter(item => !item.track?.title && !item.title).map(trackId);
        // A real 100-track batch exceeds the broker's 2048-character URL limit.
        // This endpoint reads metadata through a form POST, without changing the library.
        const full = ids.length ? await request('/tracks', { form: { 'track-ids': ids.join(','), 'with-positions': 'true' } }) : [];
        if (!Array.isArray(full)) throw failure('NETWORK', 'Некорректный список треков.');
        const byId = new Map(full.map(track => [String(track.id), track]));
        return entries.map((entry, index) => {
            const track = entry.track || (entry.title ? entry : byId.get(String(entry.id).split(':')[0]));
            const view = trackView(track || { id: entry.id, albumId: entry.albumId, title: 'Недоступный трек ' + entry.id }, uid);
            return { ...view, entryId: 'entry-' + (offset + index) };
        });
    }
    async function listPlaylists(group, uid) {
        if (group === 'mine') {
            const list = await request('/users/' + uid + '/playlists/list');
            if (!Array.isArray(list)) throw failure('NETWORK', 'Некорректный список плейлистов.');
            return list.map(playlistView).filter(Boolean);
        }
        if (group === 'saved') {
            const list = await request('/users/' + uid + '/likes/playlists');
            if (!Array.isArray(list)) throw failure('NETWORK', 'Некорректный список сохранённых плейлистов.');
            return list.map(item => playlistView(item.playlist || item)).filter(Boolean);
        }
        const feed = await request('/feed');
        return (feed.generatedPlaylists || []).map(item => playlistView(item.data || item.playlist || item)).filter(Boolean);
    }
    async function listing(scope, cursor) {
        const { uid } = await identity();
        if (cursor) { const saved = snapshot(cursor, 'listing', scope); return page(saved.key, saved.offset); }
        const group = scope.split('/')[1];
        let items;
        if (scope === 'root') items = [
            { id: 'likes', name: 'Мне нравится', revision: 'virtual',artwork:likesArtwork },
            { id: 'wave', name: 'Моя волна', revision: 'virtual',artwork:waveArtwork },
            ...['mine', 'saved', 'recommendations'].map((id, index) => ({ id: 'group/' + id, type: 'album', name: ['Мои плейлисты', 'Сохранённые плейлисты', 'Для вас'][index] })) ];
        else if (['mine', 'saved', 'recommendations'].includes(group)) items = await listPlaylists(group, uid);
        else throw failure('NOT_FOUND', 'Раздел не найден.');
        return page(remember('listing', scope, { items }));
    }
    async function wave(uid,{cursor,after,seed}={}) {
        const scope=seed?'track-wave:'+seed:'wave',station=seed?'track:'+seed:'user:onyourwave';
        const previousState=after&&waves.get(after);
        if(previousState&&(previousState.station!==station||previousState.generation!==generation))throw failure('NOT_FOUND','Трек не относится к этой волне.');
        let previous=previousState?.realId;
        if(cursor){const prefix=scope+':'+generation+':';if(!cursor.startsWith(prefix)||!/^\d+(?::\d+)?$/.test(cursor.slice(prefix.length)))throw failure('NOT_FOUND','Подборка устарела. Откройте волну заново.');previous=previous||cursor.slice(prefix.length);}
        await feedbackTail;
        const result = await request('/rotor/station/'+station+'/tracks?settings2=true'+(previous?'&queue='+encodeURIComponent(previous.split(':')[0]):''));
        const items = (result.sequence || []).filter(item => item.track?.id).slice(0, 100);
        const batch = 'b' + (++serial);
        const tracks = items.map((item, index) => {
            const view = trackView(item.track, uid), id = uid + '/w/' + batch + '/' + index;
            waves.set(id, { realId: trackId(item.track), batchId: String(result.batchId || ''), station, generation });
            return { ...view, id, entryId: 'wave-' + batch + '-' + index };
        });
        while (waves.size > 2000) waves.delete(waves.keys().next().value);
        if(!seed)waveArtwork=tracks[0]?.artwork||waveArtwork;
        return { id: seed?'track-wave/'+seed:'wave', name: seed?'Волна по треку':'Моя волна', revision: batch, tracks,artwork:seed?tracks[0]?.artwork||'':waveArtwork,continuous:settings.autoWave!==false,cursor:settings.autoWave!==false&&tracks.length?scope+':'+generation+':'+trackId(items.at(-1).track):null };
    }
    async function read({ id, cursor, after }) {
        if (!id) {
            const result = await listing('group/mine', cursor);
            return { ...result, items: result.items.map(item => ({ ...item, revision: item.revision || 'virtual' })) };
        }
        const { uid } = await identity();
        if (id === 'wave') {
            return wave(uid,{cursor,after});
        }
        if(/^track-wave\/\d+$/.test(id))return wave(uid,{cursor,after,seed:id.slice('track-wave/'.length)});
        let saved;
        if (cursor) saved = snapshot(cursor, 'tracks', id);
        else {
            let value;
            if (id === 'likes') {
                const result = await request('/users/' + uid + '/likes/tracks');
                if (!Array.isArray(result.library?.tracks)) throw failure('NETWORK', 'Некорректный список понравившихся треков.');
                value = { name: 'Мне нравится', revision: String(result.library.revision ?? 'unknown'), items: result.library.tracks };
            } else {
                const match = /^playlist\/(\d+)\/(\d+)$/.exec(id);
                if (!match) throw failure('NOT_FOUND', 'Плейлист не найден.');
                const result = await request('/users/' + match[1] + '/playlists/' + match[2]);
                if (!Array.isArray(result.tracks)) throw failure('NETWORK', 'Сервис не вернул состав плейлиста.');
                value = { name: short(result.title, 'Плейлист'), revision: String(result.revision ?? 'unknown'), items: result.tracks,artwork:cover(result.cover||result.ogImage) };
            }
            if (value.items.length > 10000) throw failure('NOT_FOUND', 'В списке более 10000 треков — предел текущей интеграции.');
            const key = remember('tracks', id, value);
            saved = { key, state: snapshots.get(key), offset: 0 };
        }
        const { key, state, offset } = saved, result = page(key, offset);
        const tracks = await hydrate(result.items, uid, offset);
        if (state.generation !== generation) throw stale();
        if(id==='likes'&&tracks[0]?.artwork)likesArtwork=tracks[0].artwork;
        return { id, name: state.value.name, revision: key + '-' + state.value.revision, tracks, cursor: result.cursor,total:state.value.items.length,artwork:state.value.artwork||(id==='likes'?likesArtwork:'') };
    }
    async function browse({ parent, cursor }) {
        if (parent?.type === 'playlist') {
            const result = await read({ id: parent.id, cursor });
            return { items: result.tracks.map(track => ({ ...track, type: 'track' })), cursor: result.cursor };
        }
        const result = await listing(parent?.id || 'root', cursor);
        return { ...result, items: result.items.map(item => ({ ...item,id: item.id, type: item.type || 'playlist', title: item.title || item.name, artist: item.artist || '' })) };
    }
    async function search({query,cursor}) {
        const {uid}=await identity();query=String(query||'').trim().slice(0,200);if(!query)return {items:[],cursor:null};
        let page=0;if(cursor){let value;try{value=JSON.parse(cursor);}catch(_){throw failure('NOT_FOUND','Страница поиска устарела');}if(value.query!==query||!Number.isInteger(value.page)||value.page<0||value.page>100)throw failure('NOT_FOUND','Страница поиска устарела');page=value.page;}
        const result=await request('/search?type=track&page='+page+'&text='+encodeURIComponent(query));
        const block=result.tracks,items=(block?.results||[]).slice(0,100).map(track=>({...trackView(track,uid),type:'track'}));
        const perPage=Number(block?.perPage||result.perPage)||items.length;
        const more=items.length>0&&page<100&&Number(block?.total)>(page+1)*perPage;
        return {items,cursor:more?JSON.stringify({query,page:page+1}):null};
    }
    async function ratingTrack(id, cached = false) {
        // Row reads only paint known state; commands and mutations always verify identity.
        const known = cached && ratingCache?.uid === registeredAccount && Date.now() - ratingCache.at < 60000;
        const { uid } = known ? {uid:registeredAccount} : await identity(), epoch = generation;
        if (typeof id !== 'string' || !id.startsWith(uid + '/')) throw stale();
        const context = waves.get(id);
        const realId = context?.generation === epoch ? context.realId : /^\d+\/t\/(\d+(?::\d+)?)$/.exec(id)?.[1];
        if (!realId) throw failure('NOT_FOUND', 'Трек устарел. Откройте список заново.');
        ratingAliases.set(id, realId.split(':')[0]);
        while(ratingAliases.size>2000)ratingAliases.delete(ratingAliases.keys().next().value);
        return { uid, realId, epoch };
    }
    async function ratings(uid, cached = false) {
        if(cached&&ratingCache?.uid===uid&&Date.now()-ratingCache.at<60000)return ratingCache.values;
        if(ratingRequest?.uid===uid)return ratingRequest.promise;
        const epoch=generation,revision=ratingRevision;
        const promise=readRatings(uid).then(values=>{if(epoch!==generation)throw stale();if(revision!==ratingRevision)throw new Error('Состояние отметок изменилось.');ratingCache={uid,at:Date.now(),values};return values;});
        const pending={uid,promise};ratingRequest=pending;
        try{return await promise;}finally{if(ratingRequest===pending)ratingRequest=null;}
    }
    async function readRatings(uid) {
        const values = [];
        for (const kind of ['likes', 'dislikes']) {
            const result = await request('/users/' + uid + '/' + kind + '/tracks');
            if (!Array.isArray(result.library?.tracks)) throw failure('NETWORK', 'Не удалось получить отметки треков.');
            values.push(new Set(result.library.tracks.map(track => String(track.id).split(':')[0])));
        }
        return values;
    }
    async function trackActions({ trackId: id, surface }) {
        const { uid, realId, epoch } = await ratingTrack(id, surface === 'row'), [likes, dislikes] = await ratings(uid, true);
        if (epoch !== generation) throw stale();
        const track = realId.split(':')[0];
        return [
            { id: likes.has(track) ? 'unlike' : 'like', title: likes.has(track) ? 'Не нравится' : 'Нравится', icon: 'Heart', inline: true, active: likes.has(track) },
            { id: dislikes.has(track) ? 'undislike' : 'dislike', title: dislikes.has(track) ? 'Отменить дизлайк' : 'Не рекомендовать', icon: dislikes.has(track) ? 'Undo2' : 'ThumbsDown' },
            { id:'track-wave',title:'Волна по треку',icon:'Radio' },
            { id:'share',title:'Поделиться',icon:'Share2' },
            { id:'save-mp3',title:'Сохранить MP3',icon:'Download' },
        ];
    }
    // Serialize explicit ratings so rapid hotkeys cannot race a menu operation.
    let ratingTail = Promise.resolve();
    function trackAction({ trackId: id, action }) {
        if(action==='save-mp3')return saveTrack(id);
        const task = ratingTail.then(async () => {
            if(action==='share'||action==='track-wave'){
                const {realId}=await ratingTrack(id),[track,album]=realId.split(':');
                if(action==='share'){
                    await api.clipboard.write(album?'https://music.yandex.ru/album/'+album+'/track/'+track:'https://music.yandex.ru/track/'+track);
                    await notice('Ссылка на трек скопирована.','track-share').catch(()=>{});
                }else await api.providers.openCollection(PROVIDER,{catalog:CATALOG,id:'track-wave/'+track,play:true});
                return;
            }
            if (!['like', 'unlike', 'toggle-like', 'dislike', 'undislike', 'toggle-dislike'].includes(action)) throw new Error('Неизвестное действие трека.');
            const { uid, realId, epoch } = await ratingTrack(id);
            const values = await ratings(uid, true);
            let selected = action;
            if (selected === 'toggle-like' || selected === 'toggle-dislike') {
                const [likes, dislikes] = values, track = realId.split(':')[0];
                selected = selected === 'toggle-like' ? (likes.has(track) ? 'unlike' : 'like') : (dislikes.has(track) ? 'undislike' : 'dislike');
            }
            if (epoch !== generation) throw stale();
            const kind = ['like', 'unlike'].includes(selected) ? 'likes' : 'dislikes';
            const removing = ['unlike', 'undislike'].includes(selected);
            const result = await request('/users/' + uid + '/' + kind + '/tracks/' + (removing ? 'remove' : 'add-multiple'), { form: { 'track-ids': realId } });
            if (!result || !['number', 'string'].includes(typeof result.revision)) throw failure('NETWORK', 'Сервис не подтвердил изменение отметки.');
            if(epoch!==generation)throw stale();
            const [likes,dislikes]=values.map(value=>new Set(value)),track=realId.split(':')[0];
            const target=kind==='likes'?likes:dislikes;
            if(removing)target.delete(track);else{target.add(track);(kind==='likes'?dislikes:likes).delete(track);}
            ratingRevision++;ratingRequest=null;
            ratingCache={uid,at:Date.now(),values:[likes,dislikes]};
            const aliases=[...ratingAliases].filter(([,value])=>value===track).map(([id])=>id);
            for(let offset=0;offset<aliases.length;offset+=100)await api.providers.invalidate(PROVIDER,aliases.slice(offset,offset+100)).catch(()=>{});
            await notice({ like: 'Трек добавлен в «Мне нравится».', unlike: 'Лайк снят.', dislike: 'Дизлайк отправлен: реже рекомендовать этот трек.', undislike: 'Дизлайк отменён.' }[selected], 'track-rating').catch(() => {});
        });
        ratingTail = task.catch(() => {});
        return task.catch(error => { lastError = short(error.message); throw error; });
    }
    async function rateCurrent(action) {
        const current = await api.player.current(), state = sessions.get(current.sessionId);
        if (!state || !ownSessions.has(current.sessionId) || state.generation !== generation) throw new Error('Выберите играющий трек Яндекс Музыки.');
        return trackAction({ trackId: state.uid + '/t/' + state.realId, action });
    }
    // Legacy download-info uses an MD5 URL signature, not audio decryption.
    function md5(text) {
        const bytes = new TextEncoder().encode(text), size = ((bytes.length + 8 >>> 6) + 1) * 64;
        const data = new Uint8Array(size); data.set(bytes); data[bytes.length] = 128;
        const view = new DataView(data.buffer); view.setUint32(size - 8, bytes.length * 8, true);
        const shifts = [7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21];
        let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
        for (let offset = 0; offset < size; offset += 64) {
            let a = a0, b = b0, c = c0, d = d0;
            for (let i = 0; i < 64; i++) {
                const round = i >>> 4;
                const f = round === 0 ? (b & c) | (~b & d) : round === 1 ? (d & b) | (~d & c) : round === 2 ? b ^ c ^ d : c ^ (b | ~d);
                const g = round === 0 ? i : round === 1 ? (5 * i + 1) % 16 : round === 2 ? (3 * i + 5) % 16 : 7 * i % 16;
                const sum = (a + f + Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) + view.getUint32(offset + 4 * g, true)) | 0;
                const shift = shifts[round * 4 + i % 4];
                const next = b + ((sum << shift) | (sum >>> (32 - shift))) | 0;
                a = d; d = c; c = b; b = next;
            }
            a0 = a0 + a | 0; b0 = b0 + b | 0; c0 = c0 + c | 0; d0 = d0 + d | 0;
        }
        return [a0,b0,c0,d0].map(value => [0,8,16,24].map(shift => ((value >>> shift) & 255).toString(16).padStart(2, '0')).join('')).join('');
    }
    function allowedUrl(value) {
        let url;
        try { url = new URL(value); } catch (_) { throw failure('UNSUPPORTED_TRANSPORT', 'Некорректный адрес аудиопотока.'); }
        if (url.protocol === 'http:') url.protocol = 'https:';
        if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) throw failure('UNSUPPORTED_TRANSPORT', 'Допускается только публичный HTTPS-поток.');
        const allowed = api.manifest.network.origins.some(origin => origin === url.origin ||
            (origin.startsWith('https://*.') && url.hostname.endsWith('.' + origin.slice(10))));
        if (!allowed) throw failure('UNSUPPORTED_TRANSPORT', 'CDN ' + url.hostname + ' не объявлен в пакете. Обновите сетевые разрешения расширения.');
        return url.href;
    }
    function xmlField(xml, field) {
        const value = new RegExp('<' + field + '>([^<]+)</' + field + '>').exec(xml)?.[1];
        if (!value) throw failure('UNSUPPORTED_TRANSPORT', 'Неизвестный формат download-info.');
        return value.replace(/&amp;/g, '&');
    }
    // Public protocol signature used by tracks/{id}/lyrics, not a user secret.
    // WebCrypto is unavailable in the opaque-origin extension Worker.
    function lyricsSignature(message) {
        const constants=[];
        for(let n=2;constants.length<64;n++){
            let prime=true;for(let d=2;d*d<=n;d++)if(n%d===0){prime=false;break;}
            if(prime)constants.push((Math.cbrt(n)%1*4294967296)>>>0);
        }
        const rotate=(v,n)=>(v>>>n)|(v<<(32-n));
        function sha(bytes){
            const data=new Uint8Array(Math.ceil((bytes.length+9)/64)*64);data.set(bytes);data[bytes.length]=128;
            const view=new DataView(data.buffer);view.setUint32(data.length-4,bytes.length*8);
            const hash=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]),w=new Uint32Array(64);
            for(let offset=0;offset<data.length;offset+=64){
                for(let i=0;i<64;i++)w[i]=i<16?view.getUint32(offset+i*4):(w[i-16]+(rotate(w[i-15],7)^rotate(w[i-15],18)^(w[i-15]>>>3))+w[i-7]+(rotate(w[i-2],17)^rotate(w[i-2],19)^(w[i-2]>>>10)));
                let [a,b,c,d,e,f,g,h]=hash;
                for(let i=0;i<64;i++){
                    const t1=(h+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+constants[i]+w[i])>>>0;
                    const t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))>>>0;
                    h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
                }
                [a,b,c,d,e,f,g,h].forEach((v,i)=>{hash[i]+=v;});
            }
            const result=new Uint8Array(32),out=new DataView(result.buffer);hash.forEach((v,i)=>out.setUint32(i*4,v));return result;
        }
        const key=new TextEncoder().encode('kzqU4XhfCaY6B6JTHODeq5'),body=new TextEncoder().encode(message),inner=new Uint8Array(64+body.length),outer=new Uint8Array(96);
        for(let i=0;i<64;i++){inner[i]=(key[i]||0)^0x36;outer[i]=(key[i]||0)^0x5c;}
        inner.set(body,64);outer.set(sha(inner),64);const bytes=sha(outer),alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let encoded='';
        for(let i=0;i<bytes.length;i+=3){const v=(bytes[i]<<16)|((bytes[i+1]||0)<<8)|(bytes[i+2]||0);encoded+=alphabet[v>>>18]+alphabet[(v>>>12)&63]+(i+1<bytes.length?alphabet[(v>>>6)&63]:'=')+(i+2<bytes.length?alphabet[v&63]:'=');}
        return encoded;
    }
    function parseLyrics(text) {
        if(typeof text!=='string'||text.length>200000)throw new Error('Некорректный текст песни.');
        const lines=[],offset=Number(text.match(/\[offset:([+-]?\d+)\]/i)?.[1]||0)/1000,plain=[];
        for(const raw of text.replace(/^\uFEFF/,'').split(/\r?\n/)){
            const stamps=[...raw.matchAll(/\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]/g)],lyric=raw.replace(/\[[^\]]*\]/g,'').trim();
            if(lyric)plain.push(lyric);
            for(const stamp of stamps)if(Number(stamp[2])<60)lines.push({time:Math.max(0,Number(stamp[1])*60+Number(stamp[2])+Number('0.'+(stamp[3]||'0'))+offset),text:lyric.slice(0,2000)});
        }
        if(lines.length>3000)throw new Error('Слишком большой текст песни.');
        return {status:lines.some(line=>line.text)||plain.length?'found':'missing',lines:lines.sort((a,b)=>a.time-b.time),plain:plain.join('\n'),source:'Яндекс Музыка'};
    }
    async function lyrics({sessionId}) {
        const state=sessions.get(sessionId);
        if(!state||!ownSessions.has(sessionId)||state.generation!==generation)return {status:'missing'};
        const {uid}=await identity(),epoch=generation;
        if(uid!==state.uid)throw stale();
        const id=state.realId.split(':')[0],cacheKey=uid+':'+id,cached=lyricCache.get(cacheKey);
        if(cached&&cached.expires>Date.now())return cached.value;
        for(const format of ['LRC','TEXT']){
            const timestamp=Math.floor(Date.now()/1000),sign=lyricsSignature(id+timestamp);
            let info;
            try{info=await request('https://api.music.yandex.ru/tracks/'+id+'/lyrics?format='+format+'&timeStamp='+timestamp+'&sign='+encodeURIComponent(sign),{headers:{'X-Yandex-Music-Client':'YandexMusicDesktopAppWindows/5.124.1'}});}
            catch(error){if(error.code==='NOT_FOUND')continue;throw error;}
            if(epoch!==generation)throw stale();
            if(!info?.downloadUrl)continue;
            const url=new URL(info.downloadUrl);
            if(url.origin!=='https://music-lyrics.s3-private.mds.yandex.net'||url.username||url.password||url.hash||url.href.length>2048)throw new Error('Неизвестный адрес текста Яндекс Музыки.');
            const result=parseLyrics(await request(url.href,{authenticated:false,raw:true}));
            if(epoch!==generation)throw stale();
            if(result.status==='found'){
                lyricCache.set(cacheKey,{value:result,expires:Date.now()+600000});while(lyricCache.size>24)lyricCache.delete(lyricCache.keys().next().value);
                return result;
            }
        }
        // Some catalog tracks expose only the older plain-text representation.
        // Never display a preview or a text that the API marks as unavailable.
        let supplement;
        try{supplement=await request('/tracks/'+id+'/supplement');}catch(error){if(error.code==='NOT_FOUND')return {status:'missing'};throw error;}
        if(epoch!==generation)throw stale();
        if(supplement?.lyrics?.hasRights===true&&typeof supplement.lyrics.fullLyrics==='string'&&supplement.lyrics.fullLyrics.trim()){
            const result=parseLyrics(supplement.lyrics.fullLyrics);
            if(result.status==='found'){lyricCache.set(cacheKey,{value:result,expires:Date.now()+600000});while(lyricCache.size>24)lyricCache.delete(lyricCache.keys().next().value);return result;}
        }
        return {status:'missing'};
    }
    async function mp3Source(realId) {
        const variants = await request('/tracks/' + realId + '/download-info');
        if (!Array.isArray(variants)) throw failure('UNSUPPORTED_TRANSPORT', 'Неизвестный формат вариантов аудио.');
        const options = variants.filter(item => item.codec === 'mp3' && item.preview !== true && item.downloadInfoUrl && !item.transport?.includes('enc'));
        options.sort((a, b) => Math.abs(Number(a.bitrateInKbps) - Number(settings.bitrate || 192)) - Math.abs(Number(b.bitrateInKbps) - Number(settings.bitrate || 192)));
        if (!options.length) throw failure('UNSUPPORTED_TRANSPORT', 'Полный прямой MP3-поток не предоставлен. Проверьте подписку; preview и зашифрованное аудио не воспроизводятся.');
        const xml = await request(allowedUrl(options[0].downloadInfoUrl), { authenticated: false, raw: true });
        const host = xmlField(xml, 'host'), path = xmlField(xml, 'path'), ts = xmlField(xml, 'ts'), salt = xmlField(xml, 's');
        // Yandex's ts is an opaque hexadecimal string, not a decimal Unix timestamp.
        if (!/^[a-z0-9.-]+$/i.test(host) || !/^\/[a-z0-9/_.%~-]+$/i.test(path) || !/^[a-f0-9]{1,32}$/i.test(ts) || !/^[a-z0-9]+$/i.test(salt)) throw failure('UNSUPPORTED_TRANSPORT', 'Некорректные параметры аудиопотока.');
        const sign = md5('XGRlBW9FXlekgbPrRHuSiA' + path.slice(1) + salt);
        const url = allowedUrl('https://' + host + '/get-mp3/' + sign + '/' + ts + path);
        return {url,transport:'direct'};
    }
    async function saveTrack(id) {
        const {realId,epoch}=await ratingTrack(id),key=realId.split(':')[0];
        if(downloadJobs.has(key))throw new Error('Этот трек уже сохраняется.');
        downloadJobs.set(key,null);
        try{
            let metadata=trackMetadata.get(key);
            if(!metadata){
                const tracks=await request('/tracks',{form:{'track-ids':realId}});
                const track=Array.isArray(tracks)&&tracks.find(item=>String(item.id).split(':')[0]===key);
                if(track){trackView(track,registeredAccount);metadata=trackMetadata.get(key);}
            }
            const source=await mp3Source(realId);
            if(epoch!==generation)throw stale();
            const title=metadata?.title||'Трек '+key,artist=metadata?.artist||'';
            const name=(settings.downloadName==='title'||!artist?title:artist+' — '+title)+'.mp3';
            const job=await api.downloads.start({url:source.url,filename:name,folder:'downloadFolder',metadata:metadata?.tags||{title,...(artist?{artist}:{})}});
            downloadJobs.set(key,job.id);
            const noticeKey='mp3-'+job.id;
            let previousBytes=0,previousAt=Date.now();
            await notice('Сохраняется: '+title,noticeKey,{pinned:true,progress:null,progressLabel:'Подготовка загрузки',actions:[{label:'Отменить все загрузки',command:'cancel-downloads',dismissOnClick:false}]}).catch(()=>{});
            const poll=async()=>{
                try{
                    const current=await api.downloads.status({id:job.id});
                    if(current.state==='running'){
                        const now=Date.now(),bytes=Math.max(0,Number(current.bytes)||0),total=Number(current.total);
                        const speed=Math.max(0,(bytes-previousBytes)/Math.max(1,now-previousAt)*1000);
                        previousBytes=bytes;previousAt=now;
                        const size=value=>(value/1048576).toFixed(1)+' МБ';
                        const progress=total>0?Math.min(1,bytes/total):null;
                        await api.notifications.update({key:noticeKey,progress,progressLabel:current.phase==='tagging'?'Запись метаданных MP3…':(progress===null?'':Math.floor(progress*100)+'% · ')+size(bytes)+(total>0?' / '+size(total):'')+' · '+size(speed)+'/с'}).catch(()=>{});
                        setTimeout(poll,750);return;
                    }
                    downloadJobs.delete(key);
                    if(current.state==='canceled'){
                        await api.notifications.update({key:noticeKey,message:'Сохранение отменено: '+title,pinned:false,type:'info',progress:null,progressLabel:'Отменено',actions:[]}).catch(()=>{});return;
                    }
                    if(current.state!=='completed')throw new Error(current.error||'Не удалось сохранить MP3.');
                    await api.notifications.update({key:noticeKey,message:short('MP3 сохранён: '+current.name),pinned:false,type:'success',progress:1,progressLabel:'Готово',actions:[{label:'Открыть папку',command:'open-download-folder'}]}).catch(()=>{});
                }catch(error){downloadJobs.delete(key);lastError=short(error.message);await api.notifications.update({key:noticeKey,message:short('Сохранение MP3: '+lastError),pinned:false,type:'error',important:true,progress:null,progressLabel:'Ошибка',actions:[],copyText:lastError}).catch(()=>{});}
            };
            setTimeout(poll,750);
        }catch(error){downloadJobs.delete(key);lastError=short(error.message);throw error;}
    }
    api.onCommand('cancel-downloads', async () => {
        const jobs=[...downloadJobs.values()].filter(Boolean);
        const results=await Promise.allSettled(jobs.map(id=>api.downloads.cancel({id})));
        if(results.some(result=>result.status==='rejected'))throw new Error('Не все загрузки удалось отменить. Повторите команду.');
    });
    api.onCommand('open-download-folder', () => api.downloads.folder({setting:'downloadFolder',action:'open'}));
    async function resolve({ trackId: id, sessionId }) {
        try {
            const { uid } = await identity(), epoch = generation;
            if (!id.startsWith(uid + '/')) throw stale();
            const context = waves.get(id);
            const realId = context?.generation === epoch ? context.realId : /^\d+\/t\/(\d+(?::\d+)?)$/.exec(id)?.[1];
            if (!realId) throw failure('NOT_FOUND', 'Подборка устарела. Откройте её заново.');
            const {url} = await mp3Source(realId);
            if (epoch !== generation) throw stale();
            ownSessions.add(sessionId);
            while (ownSessions.size > 100) ownSessions.delete(ownSessions.values().next().value);
            if (!sessions.has(sessionId)) sessions.set(sessionId, { ...context, realId, uid, generation: epoch,
                playId: sessionId, started: false, finished: false, played: 0, position: 0, duration: 0, last: null, historyPlayed: 0 });
            while (sessions.size > 32) sessions.delete(sessions.keys().next().value);
            return { url, transport: 'direct' }; // Credentials never travel to the CDN.
        } catch (error) {
            // The host's main playback label collapses provider errors to «Ошибка загрузки».
            // Notify here as well, so a denied CDN or transport remains actionable.
            lastError = short(error.message);
            await notice('Яндекс Музыка: ' + lastError).catch(() => {});
            return { error: { code: error.code || 'NETWORK', message: short(error.message) } };
        }
    }
    async function feedback(state, type) {
        if (!settings.feedback || !state.batchId || state.generation !== generation) return;
        await identity();
        if (state.generation !== generation) return;
        await request('/rotor/station/'+(state.station||'user:onyourwave')+'/feedback?batch-id=' + encodeURIComponent(state.batchId), { body: {
            type, timestamp: new Date().toISOString(), trackId: state.realId.split(':')[0],
            from: 'noctune-addon', totalPlayedSeconds: state.played,
        } });
    }
    // One handler preserves ordering; network work runs separately so progress cannot overflow the SDK event queue.
    let feedbackTail = Promise.resolve(), pendingFeedback = 0;
    function enqueueReport(task, label) {
        if (pendingFeedback >= 24) return;
        pendingFeedback++;
        feedbackTail = feedbackTail.then(task)
            .catch(error => {
                lastError = short(label + ': ' + error.message);
                return notice('Яндекс Музыка: ' + lastError + '. Воспроизведение продолжается.');
            })
            .catch(() => {}).finally(() => { pendingFeedback--; });
    }
    function sendFeedback(state, type) {
        if (settings.feedback && state.batchId) {
            const report = { ...state };
            enqueueReport(() => feedback(report, type), 'Не отправлены события Моей волны');
        }
    }
    async function history(state) {
        if (!settings.history || state.generation !== generation) return;
        const { uid } = await identity();
        if (state.generation !== generation || uid !== state.uid || !settings.history) return;
        let [track, album] = state.realId.split(':'), duration = state.duration;
        if (!album) {
            const tracks = await request('/tracks', { form: { 'track-ids': track } });
            const metadata = Array.isArray(tracks) && tracks.find(item => String(item.id) === track);
            album = metadata?.albums?.[0]?.id;
            duration = duration || Number(metadata?.durationMs) / 1000;
            if (!numeric(album)) throw failure('NOT_FOUND', 'Не найден альбом трека для записи прослушивания.');
        }
        if (!settings.history || state.generation !== generation) return;
        const timestamp = state.reportAt, report = {
            trackId: track, albumId: String(album), fromCache: false, from: 'noctune-addon',
            playId: state.playId, timestamp, startTimestamp: state.startedAt,
            trackLengthSeconds: duration || 0, totalPlayedSeconds: state.played, endPositionSeconds: state.position,
            context: state.batchId ? 'radio' : 'other', contextItem: state.batchId ? state.station||'user:onyourwave' : null,
            pause: state.reportType === 'pause', seek: !!state.sought,
            ...(state.changeReason ? { changeReason: state.changeReason } : {}),
            ...(state.batchId ? { batchId: state.batchId } : {}),
        };
        const detail = { accountId: uid, trackId: track, albumId: String(album), playId: state.playId,
            playedSeconds: state.played, type: state.reportType, startTimestamp: state.startedAt, at: timestamp };
        try {
            const result = await request('/plays?clientNow=' + encodeURIComponent(new Date().toISOString()), { body: { plays: [report] } });
            if (result !== 'ok') throw failure('NETWORK', 'Сервис не подтвердил приём отчёта прослушивания.');
            if (state.generation !== generation) return;
            historyStatus.accepted++;
            historyStatus.last = { ...detail, status: 'accepted' };
            if (state.played > 0) historyStatus.lastPlayed = historyStatus.last;
        } catch (error) {
            if (state.generation === generation) {
                historyStatus.failed++;
                historyStatus.last = { ...detail, status: 'failed', error: short(error.message) };
            }
            throw error;
        } finally {
            if (state.generation === generation) await api.storage.set('history-report-status', historyStatus).catch(() => {});
        }
    }
    function sendHistory(state, reason = 'playing') {
        if (!settings.history || !state.started || pendingFeedback >= 24) return;
        const reportType = reason === 'start' ? 'start' : ['pause', 'buffering'].includes(reason) ? 'pause' : reason === 'playing' ? 'playing' : 'end';
        const changeReason = reason === 'ended' ? 'finish' : reason === 'skip' ? 'skip' : reportType === 'playing' ? 'in_progress' : reportType === 'end' ? 'other_track' : null;
        const report = { ...state, reportType, changeReason, reportAt: new Date().toISOString() };
        state.historyPlayed = state.played;
        enqueueReport(() => history(report), 'Не записано прослушивание');
    }
    function updateProgress(state, event) {
        const position = Number(event.position), duration = Number(event.duration);
        if (Number.isFinite(duration) && duration > 0) state.duration = duration;
        if (!Number.isFinite(position) || position < 0) { state.last = null; return; }
        if (state.last) {
            const elapsed = (event.timestamp - state.last.time) / 1000, delta = position - state.last.position;
            if (elapsed > 0 && elapsed < 2 && delta > 0 && delta <= elapsed * (event.speed || 1) + 0.5) state.played += delta;
        }
        state.position = position;
        state.last = { time: event.timestamp, position };
    }
    api.on('playback.*', event => {
        if (event.type === 'playback.error' && ownSessions.has(event.sessionId)) {
            lastError = short(String(event.error?.message || 'Не удалось загрузить аудиопоток.').replace(/https?:\/\/\S+/g, '[адрес потока скрыт]'));
            notice('Яндекс Музыка: ' + lastError).catch(() => {});
        }
        const state = sessions.get(event.sessionId);
        if (!state) return;
        if (event.type === 'playback.play' && !state.started) {
            state.started = true;
            state.startedAt = new Date().toISOString();
            updateProgress(state, event);
            sendHistory(state, 'start');
            if (state.batchId && !radioBatches.has(state.batchId)) {
                radioBatches.add(state.batchId); sendFeedback(state, 'radioStarted');
                while (radioBatches.size > 100) radioBatches.delete(radioBatches.values().next().value);
            }
            sendFeedback(state, 'trackStarted');
        }
        else if (event.type === 'playback.play' && !state.finished) updateProgress(state, event);
        if (!state.finished && ['playback.pause', 'playback.buffering', 'playback.stop', 'playback.ended', 'playback.error', 'playback.skip'].includes(event.type)) {
            updateProgress(state, event);
            // A terminal record is still required when the final progress
            // checkpoint already contains exactly the same played seconds.
            if (state.started && (state.played > state.historyPlayed || ['playback.stop','playback.ended','playback.error','playback.skip'].includes(event.type))) sendHistory(state, event.type.slice('playback.'.length));
            state.last = null;
        }
        if (event.type === 'playback.ended' && state.started && !state.finished) { state.finished = true; sendFeedback(state, 'trackFinished'); }
        if (event.type === 'playback.skip' && state.started && !state.finished) {state.finished=true;sendFeedback(state,'skip');}
        if (['playback.stop', 'playback.error'].includes(event.type)) state.finished = true;
        // stop-or-replace does not distinguish a user stop from skip: do not invent skip feedback.
    });
    api.on('progress.*', event => {
        const state = sessions.get(event.sessionId);
        if (!state || state.finished) return;
        if (event.type !== 'progress.updated' || !event.playing) { if (event.type === 'progress.seek') state.sought = true; state.last = null; return; }
        updateProgress(state, event);
        if (state.played - state.historyPlayed >= 30) sendHistory(state);
    });
    api.on('settings.changed', event => { settings = { ...settings, ...event.values }; });
    async function stopOwnStream() {
        const current = await api.player.current();
        if (ownSessions.has(current.sessionId)) await api.player.stop({ sessionId: current.sessionId });
        ownSessions.clear();
    }
    api.onCommand('save-mp3', async () => {
        const current=await api.player.current(),state=sessions.get(current.sessionId);
        if(!state||state.generation!==generation)throw new Error('Выберите играющий трек Яндекс Музыки.');
        return saveTrack(state.uid+'/t/'+state.realId);
    });
    api.onCommand('history-status', async () => {
        await feedbackTail;
        const { uid } = await identity(), epoch = generation;
        const report = historyStatus.lastPlayed || historyStatus.last;
        if (!report || report.accountId !== uid) throw new Error('Отчётов этого аккаунта пока нет. Проверка доступна после начала следующего трека Яндекс Музыки.');
        const result = await request('/music-history?fullModelsCount=0');
        if (epoch !== generation) throw stale();
        if (!Array.isArray(result.historyTabs)) throw failure('NETWORK', 'Неизвестный формат серверной истории.');
        const matches = result.historyTabs.filter(tab => (tab.items || []).some(group => (group.tracks || []).some(item => item.type === 'track' && String(item.data?.itemId?.trackId) === report.trackId)));
        const summary = 'Отчётов принято API: ' + historyStatus.accepted + ', ошибок: ' + historyStatus.failed + '. Последний трек: ' + report.trackId + ', прослушано ' + Number(report.playedSeconds.toFixed(1)) + ' с.';
        const status = matches.length ? ' Трек найден в серверной истории за ' + matches.map(tab => tab.date).join(', ') + '; это не доказывает создание новой записи этим отчётом.' : ' Трек не найден в серверной истории. Успешный ответ /plays означает приём отчёта, а не запись в историю.';
        const verification = { at: new Date().toISOString(), trackId: report.trackId, found: matches.length > 0, dates: matches.map(tab => tab.date) };
        historyStatus.verification = verification;
        await api.storage.set('history-report-status', historyStatus).catch(() => {});
        await notice(summary + status,'history-status',{type:matches.length?'success':'info',copyText:summary+status});
    });
    for (const action of ['toggle-like', 'dislike']) {
        // Keep the existing dislike binding while making it a toggle.
        api.onCommand(action, () => rateCurrent(action === 'dislike' ? 'toggle-dislike' : action));
        await api.hotkeys.register({ command: action });
    }
    // Command errors are shown inline by the existing SDK UI, even when notifications are disabled.
    api.onCommand('last-error', () => notice(lastError ? 'Последняя ошибка Яндекс Музыки: ' + lastError : 'Ошибок в этом запуске пока нет.','last-error',{type:lastError?'error':'info',...(lastError?{copyText:lastError}:{})}));
    api.onCommand('check', async () => {
        const user = await identity(); await registerCatalog(user.uid);
        await notice('Яндекс Музыка: ' + user.name + '. Авторизация подтверждена.','connection-status',{type:'success'});
    });
    let catalogRegistration = null;
    async function registerCatalog(uid) {
        if (catalogRegistration) return catalogRegistration;
        registeredAccount = uid;
        catalogRegistration = api.catalog.register({ id: CATALOG, name: 'Яндекс Музыка', providerId: PROVIDER, accountId: uid, browse, read, search });
        try { await catalogRegistration; } catch (error) { catalogRegistration = null; throw error; }
        await api.storage.set('account',{uid});
    }
    await api.providers.register({ id: PROVIDER, name: 'Яндекс Музыка', resolve, trackActions, trackAction, inlineActions: true,
        search: async ({ query }) => {
            return (await search({query})).items;
        } });
    await api.lyrics.provide({id:'yandex-lyrics',resolve:lyrics});
    async function bootstrap(){const status=await api.credentials.status(PROFILE);if(!status.configured)return;const user=await identity();await registerCatalog(user.uid);}
    api.on('settings.credentials',async event=>{
        if(event.profile!==PROFILE)return;
        reset();await stopOwnStream();
        if(catalogRegistration){await catalogRegistration.catch(()=>{});await api.catalog.unregister(CATALOG);}
        catalogRegistration=null;registeredAccount=null;await api.storage.set('account',null);
        if(event.configured)await bootstrap();
    });
    const saved=await api.storage.get('account');
    if(numeric(saved?.uid))await registerCatalog(String(saved.uid));
    // A first connection can take longer than the SDK activation deadline.
    // Previously linked accounts register without HTTP; verification remains per operation.
    else setTimeout(()=>bootstrap().catch(error=>{lastError=short(error.message);}),0);
});
