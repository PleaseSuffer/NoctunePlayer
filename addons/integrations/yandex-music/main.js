/* Noctune SDK 1: no Node, DOM, direct fetch or access to the credential value. */
NoctuneAddon.define(async api => {
    const ORIGIN = 'https://api.music.yandex.net', PROFILE = 'yandex-token';
    const PROVIDER = 'yandex-music', CATALOG = 'yandex-library';
    const snapshots = new Map(), waves = new Map(), sessions = new Map(), ownSessions = new Set(), radioBatches = new Set();
    let settings = await api.settings.get(), generation = 0, serial = 0;
    let accountRequest = null, registeredAccount = null, cooldown = 0;
    let networkTail = Promise.resolve(), lastNotice = 0, lastError = '';
    let likesArtwork = '', waveArtwork = '';
    const short = (value, fallback = '') => String(value || fallback).slice(0, 300);
    const numeric = value => /^\d+$/.test(String(value));
    const failure = (code, message) => Object.assign(new Error(message), { code });
    const stale = () => failure('AUTH_REQUIRED', 'Аккаунт изменился. Откройте каталог заново; при смене аккаунта выключите и включите расширение.');
    function reset() {
        generation++; accountRequest = null;
        snapshots.clear(); waves.clear(); sessions.clear(); radioBatches.clear(); cooldown = 0;
        likesArtwork='';waveArtwork='';
    }
    async function notice(message) {
        if (Date.now() - lastNotice < 3100) return;
        lastNotice = Date.now(); await api.notify(short(message));
    }
    // A single lane keeps command, catalog and feedback requests inside SDK quotas.
    // Never retry writes or sleep inside a provider callback (20 second SDK deadline).
    async function request(path, { body, form, authenticated = true, raw = false } = {}) {
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
                    ...(payload === undefined ? {} : { body: payload, headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' } }) });
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
    async function wave(uid,{cursor,after}={}) {
        let previous=after&&waves.get(after)?.realId;
        if(cursor){const match=/^wave:(\d+):(\d+(?::\d+)?)$/.exec(cursor);if(!match||Number(match[1])!==generation)throw failure('NOT_FOUND','Подборка устарела. Откройте Мою волну заново.');previous=previous||match[2];}
        await feedbackTail;
        const result = await request('/rotor/station/user:onyourwave/tracks?settings2=true'+(previous?'&queue='+encodeURIComponent(previous.split(':')[0]):''));
        const items = (result.sequence || []).filter(item => item.track?.id).slice(0, 100);
        const batch = 'b' + (++serial);
        const tracks = items.map((item, index) => {
            const view = trackView(item.track, uid), id = uid + '/w/' + batch + '/' + index;
            waves.set(id, { realId: trackId(item.track), batchId: String(result.batchId || ''), generation });
            return { ...view, id, entryId: 'wave-' + batch + '-' + index };
        });
        while (waves.size > 2000) waves.delete(waves.keys().next().value);
        waveArtwork=tracks[0]?.artwork||waveArtwork;
        return { id: 'wave', name: 'Моя волна', revision: batch, tracks,artwork:waveArtwork,continuous:settings.autoWave!==false,cursor:settings.autoWave!==false&&tracks.length?'wave:'+generation+':'+trackId(items.at(-1).track):null };
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
    async function resolve({ trackId: id, sessionId }) {
        try {
            const { uid } = await identity(), epoch = generation;
            if (!id.startsWith(uid + '/')) throw stale();
            const context = waves.get(id);
            const realId = context?.generation === epoch ? context.realId : /^\d+\/t\/(\d+(?::\d+)?)$/.exec(id)?.[1];
            if (!realId) throw failure('NOT_FOUND', 'Подборка устарела. Откройте её заново.');
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
            if (epoch !== generation) throw stale();
            ownSessions.add(sessionId);
            while (ownSessions.size > 100) ownSessions.delete(ownSessions.values().next().value);
            if (context && !sessions.has(sessionId)) sessions.set(sessionId, { ...context, started: false, finished: false, played: 0, last: null });
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
        if (!settings.feedback || state.generation !== generation) return;
        await identity();
        if (state.generation !== generation) return;
        await request('/rotor/station/user:onyourwave/feedback?batch-id=' + encodeURIComponent(state.batchId), { body: {
            type, timestamp: new Date().toISOString(), trackId: state.realId.split(':')[0],
            from: 'noctune-addon', totalPlayedSeconds: state.played,
        } });
    }
    // One handler preserves ordering; network work runs separately so progress cannot overflow the SDK event queue.
    let feedbackTail = Promise.resolve(), pendingFeedback = 0;
    function sendFeedback(state, type) {
        if (pendingFeedback >= 24) return;
        pendingFeedback++;
        feedbackTail = feedbackTail.then(() => feedback(state, type))
            .catch(() => notice('Не удалось отправить события Моей волны. Воспроизведение продолжается.'))
            .catch(() => {}).finally(() => { pendingFeedback--; });
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
            if (!radioBatches.has(state.batchId)) {
                radioBatches.add(state.batchId); sendFeedback(state, 'radioStarted');
                while (radioBatches.size > 100) radioBatches.delete(radioBatches.values().next().value);
            }
            sendFeedback(state, 'trackStarted');
        }
        if (['playback.pause', 'playback.buffering', 'playback.stop', 'playback.ended', 'playback.error'].includes(event.type)) state.last = null;
        if (event.type === 'playback.ended' && state.started && !state.finished) { state.finished = true; sendFeedback(state, 'trackFinished'); }
        if (event.type === 'playback.skip' && state.started && !state.finished) {state.finished=true;sendFeedback(state,'skip');}
        // stop-or-replace does not distinguish a user stop from skip: do not invent skip feedback.
    });
    api.on('progress.*', event => {
        const state = sessions.get(event.sessionId);
        if (!state || state.finished) return;
        if (event.type !== 'progress.updated' || !event.playing) { state.last = null; return; }
        const now = event.timestamp;
        if (state.last) {
            const elapsed = (now - state.last.time) / 1000, delta = event.position - state.last.position;
            if (elapsed > 0 && elapsed < 2 && delta > 0 && delta <= elapsed * (event.speed || 1) + 0.5) state.played += delta;
        }
        state.last = { time: now, position: event.position };
    });
    api.on('settings.changed', event => { settings = { ...settings, ...event.values }; });
    async function stopOwnStream() {
        const current = await api.player.current();
        if (ownSessions.has(current.sessionId)) await api.player.stop({ sessionId: current.sessionId });
        ownSessions.clear();
    }
    api.onCommand('token-help', () => api.system.openExternal('https://ym.marshal.dev/token/'));
    // Command errors are shown inline by the existing SDK UI, even when notifications are disabled.
    api.onCommand('last-error', () => { throw new Error(lastError ? 'Последняя ошибка Яндекс Музыки: ' + lastError : 'Ошибок воспроизведения в этом запуске пока нет.'); });
    api.onCommand('check', async () => {
        const user = await identity(); await registerCatalog(user.uid);
        await notice('Яндекс Музыка: ' + user.name + '. Авторизация подтверждена.');
    });
    let catalogRegistration = null;
    async function registerCatalog(uid) {
        if (catalogRegistration) return catalogRegistration;
        registeredAccount = uid;
        catalogRegistration = api.catalog.register({ id: CATALOG, name: 'Яндекс Музыка', providerId: PROVIDER, accountId: uid, browse, read, search });
        try { await catalogRegistration; } catch (error) { catalogRegistration = null; throw error; }
        await api.storage.set('account',{uid});
    }
    await api.providers.register({ id: PROVIDER, name: 'Яндекс Музыка', resolve,
        search: async ({ query }) => {
            return (await search({query})).items;
        } });
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
