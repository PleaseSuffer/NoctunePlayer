(function initAddonHost() {
    if (!window.noctune?.addons) return;
    const running = new Map();
    const states = new Map();
    let generation = 0;
    function changed(id, state) {
        states.set(id, state);
        document.dispatchEvent(new CustomEvent('addons-runtime-changed', { detail: { id, ...state } }));
    }
    // Runs in a Worker belonging to an opaque-origin, sandboxed iframe.
    // Its CSP blocks direct network, remote scripts and browser storage.
    function workerSdk() {
        let activate, handlers = new Map(), providers = new Map(), providerSequence = 0, commands = new Map(), requests = new Map(), sequence = 0;
        self.NoctuneAddon = Object.freeze({ define(callback) {
            if (activate || typeof callback !== 'function') throw new Error('NoctuneAddon.define вызывается один раз');
            activate = callback;
        } });
        const call = (method, args) => new Promise((resolve, reject) => {
            if (requests.size >= 24) return reject(new Error('Слишком много запросов SDK'));
            const id = ++sequence;
            const timer = setTimeout(() => { requests.delete(id); reject(new Error('Время ожидания SDK истекло')); }, ['oauth.authorize','credentials.configure'].includes(method) ? 310000 : 20000);
            requests.set(id, { resolve, reject, timer });
            postMessage({ type: 'call', id, method, args });
        });
        self.onmessage = async ({ data }) => {
            if (data.type === 'reply') {
                const request = requests.get(data.id);
                if (!request) return;
                requests.delete(data.id); clearTimeout(request.timer);
                if (data.error) request.reject(new Error(data.error)); else request.resolve(data.value);
            } else if (data.type === 'init') {
                try {
                    const common = Object.freeze({
                        version: 1,
                        manifest: Object.freeze(data.manifest),
                        onCommand(id, callback) {
                            if (!data.manifest.commands.some(command => command.id === id) || typeof callback !== 'function') throw new Error('Неизвестная команда');
                            commands.set(id, callback);
                        },
                        readText(file) { if (!Object.hasOwn(data.files, file) || typeof data.files[file] !== 'string') throw new Error('Файл отсутствует в пакете'); return data.files[file]; },
                        storage: Object.freeze({ get: key => call('storage.get', { key }), set: (key, value) => call('storage.set', { key, value }) }),
                        notify: (message, options = {}) => call('notify', { message, key: options.key }),
                        player: Object.freeze({ current: () => call('playback.read', {}) }),
                        network: Object.freeze({ text: url => call('network', { url }), json: async url => JSON.parse(await call('network', { url })) }),
                    });
                    const api = {
                        ...common,
                        on(type, callback) {
                            if (typeof callback !== 'function') throw new Error('Нужен обработчик');
                            if (handlers.size >= 64) throw new Error('Не более 64 обработчиков событий');
                            const token = ++providerSequence; handlers.set(token, { type, callback, pending: [], busy: false });
                            const subscribed = call('events.subscribe', { type }).catch(error => { handlers.delete(token); throw error; });
                            subscribed.catch(error => postMessage({ type: 'error', message: error.message }));
                            return () => { handlers.delete(token); };
                        },
                        assets: {
                            read(file) { const item = data.files[file]; if (!Object.hasOwn(data.files, file) || !item || item.encoding !== 'base64') throw new Error('Ресурс отсутствует'); const mime = data.assetTypes[file.split('.').pop().toLowerCase()]; return { mime, base64: item.data, size: item.data.length / 4 * 3 - (item.data.endsWith('==') ? 2 : item.data.endsWith('=') ? 1 : 0) }; },
                            url(file) { const item = this.read(file); return 'data:' + item.mime + ';base64,' + item.base64; },
                        },
                        settings: { get: () => call('settings.get', {}) },
                        player: { current: () => call('playback.read', {}), ...Object.fromEntries(['play','pause','stop','next','previous','seek','volume','speed','shuffle','repeat'].map(action => [action, (value = {}, context = {}) => call('playback.' + action, typeof value === 'object' ? value : { ...(action === 'seek' ? { position: value } : { value }), ...context })])) },
                        queue: Object.fromEntries(['read','add','remove','reorder'].map(action => [action, (args = {}) => call('queue.' + action, args)])),
                        playlists: Object.fromEntries(['read','create','rename','delete','edit','select','addTracks','removeTracks','reorder'].map(action => [action, (args = {}) => call('playlists.' + action, args)])),
                        themes: Object.fromEntries(['list','switch','apply','accent'].map(action => [action, (args = {}) => call('themes.' + action, args)])),
                        backgrounds: Object.fromEntries(['list','switch','override','apply'].map(action => [action, (args = {}) => call('backgrounds.' + action, args)])),
                        audio: Object.fromEntries(['analyse','pcm','equalizer','effects','gain'].map(action => [action, (args = {}) => call('audio.' + action, args)])),
                        network: { ...common.network, request: args => call('network.request', args) },
                        appearance: Object.fromEntries(['read','list','select','mode','palette','register','switch','persist'].map(action => [action, (args = {}) => call('appearance.' + action, args)])),
                        credentials: Object.fromEntries(['configure','status','disconnect'].map(action => [action, profile => call('credentials.' + action, { profile })])),
                        catalog: {
                            async register(catalog) {
                                if (!catalog || !['browse','read'].some(action => typeof catalog[action] === 'function')) throw new Error('Нужен browse или read');
                                const id = '@catalog:' + catalog.id; if (providers.has(id)) throw new Error('Каталог уже зарегистрирован');
                                providers.set(id, catalog);
                                try { return await call('catalog.register', { id:catalog.id,name:catalog.name,providerId:catalog.providerId,accountId:catalog.accountId,capabilities:['browse','search','read','create','rename','delete','addTracks','removeTracks','reorder'].filter(action=>typeof catalog[action]==='function') }); }
                                catch(error) { providers.delete(id); throw error; }
                            },
                            browse: args => call('catalog.browse', args),
                            search: args => call('catalog.search', args),
                            async unregister(id) { providers.delete('@catalog:'+id);return call('catalog.unregister',{id}); },
                        },
                        servicePlaylists: Object.fromEntries(['read','create','rename','delete','addTracks','removeTracks','reorder'].map(action => [action, args => call('servicePlaylists.' + action, args)])),
                        artwork: { read: (args = {}) => call('artwork.read', args) },
                        lyrics: {
                            read: (args = {}) => call('lyrics.read', args),
                            async provide(source) { if (!source || typeof source.resolve !== 'function' || providers.has('@lyrics:'+source.id)) throw new Error('Нужен новый источник resolve');providers.set('@lyrics:'+source.id, source);try{return await call('lyrics.provide',{id:source.id});}catch(error){providers.delete('@lyrics:'+source.id);throw error;} },
                        },
                        hotkeys: { register: args => call('hotkeys.register', args) },
                        oauth: Object.fromEntries(['authorize','status','disconnect'].map(action => [action, provider => call('oauth.' + action, { provider })])),
                        secrets: { get: key => call('secrets.get', { key }), set: (key, value) => call('secrets.set', { key, value }), delete: key => call('secrets.delete', { key }) },
                        files: Object.fromEntries(['select','save','read','write','library','reveal'].map(action => [action, (args = {}) => call('files.' + action, args)])),
                        clipboard: { read: () => call('clipboard.read', {}), write: text => call('clipboard.write', { text }) },
                        system: { openExternal: url => call('system.openExternal', { url }), openFile: handle => call('system.openFile', { handle }) },
                        providers: {
                            async register(provider) {
                                if (!provider || typeof provider.resolve !== 'function') throw new Error('Нужен обработчик resolve');
                                const trackActions = typeof provider.trackActions === 'function' && typeof provider.trackAction === 'function';
                                providers.set(provider.id, provider);
                                try { return await call('providers.register', { id: provider.id, name: provider.name, trackActions, inlineActions: provider.inlineActions === true }); }
                                catch (error) { providers.delete(provider.id); throw error; }
                            },
                            search: (provider, query) => call('providers.search', { provider, query }),
                            play: (provider, track) => call('providers.play', { provider, track }),
                            enqueue: (provider, track) => call('providers.enqueue', { provider, track }),
                            invalidate: (provider, trackIds) => call('providers.invalidate', { provider, trackIds }),
                        },
                    };
                    const url = URL.createObjectURL(new Blob([data.files[data.manifest.entry]], { type: 'text/javascript' }));
                    try { importScripts(url); } finally { URL.revokeObjectURL(url); }
                    if (!activate) throw new Error('Входной файл должен вызвать NoctuneAddon.define');
                    await activate(Object.freeze(api));
                    postMessage({ type: 'ready' });
                } catch (error) { postMessage({ type: 'error', message: String(error.message).slice(0, 240) }); }
            } else if (data.type === 'event') {
                for (const handler of handlers.values()) {
                    const { type } = handler;
                    if (!(type === data.event.type || type.endsWith('.*') && data.event.type.startsWith(type.slice(0, -1)))) continue;
                    if (data.event.type === 'progress.updated') handler.pending = handler.pending.filter(event => event.type !== 'progress.updated');
                    if (handler.pending.length >= 16) { postMessage({ type: 'error', message: 'Обработчик событий не успевает обрабатывать очередь' }); continue; }
                    handler.pending.push(data.event);
                    if (!handler.busy) {
                        handler.busy = true;
                        (async () => { try { while (handler.pending.length) { try { await handler.callback(Object.freeze(handler.pending.shift())); } catch (error) { postMessage({ type: 'event-error', message: String(error.message).slice(0, 240) }); } } } finally { handler.busy = false; } })();
                    }
                }
            } else if (data.type === 'provider') {
                try { const provider = providers.get(data.provider); if (!provider || typeof provider[data.action] !== 'function') throw new Error('Метод провайдера отсутствует'); const value = await provider[data.action](data.args); postMessage({ type: 'provider-done', token: data.token, value }); }
                catch (error) { postMessage({ type: 'provider-done', token: data.token, error: String(error.message).slice(0, 240) }); }
            } else if (data.type === 'command') {
                try {
                    if (!commands.has(data.command)) throw new Error('Обработчик команды не зарегистрирован');
                    await commands.get(data.command)();
                    postMessage({ type: 'command-done', token: data.token });
                } catch (error) { postMessage({ type: 'command-done', token: data.token, error: String(error.message).slice(0, 240) }); }
            } else if (data.type === 'ping') postMessage({ type: 'pong' });
        };
        self.addEventListener('unhandledrejection', event => {
            event.preventDefault(); postMessage({ type: 'error', message: String(event.reason?.message || 'Ошибка расширения').slice(0, 240) });
        });
    }
    function frameBootstrap() {
        const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(document.getElementById('addon-data').textContent), c => c.charCodeAt(0))));
        const reply = data => parent.postMessage({ channel: payload.channel, ...data }, '*');
        const blob = URL.createObjectURL(new Blob([payload.sdk], { type: 'text/javascript' }));
        const worker = new Worker(blob);
        URL.revokeObjectURL(blob);
        worker.onmessage = ({ data }) => reply(data);
        worker.onerror = event => { event.preventDefault(); reply({ type: 'error', message: 'Ошибка выполнения расширения' }); };
        window.addEventListener('message', event => {
            if (event.source !== parent || event.data?.channel !== payload.channel) return;
            worker.postMessage(event.data);
        });
        worker.postMessage({ type: 'init', manifest: payload.manifest, files: payload.files, assetTypes: payload.assetTypes });
    }
    function encode(value) {
        const bytes = new TextEncoder().encode(JSON.stringify(value));
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return btoa(binary);
    }
    function stop(id, state = { status: 'stopped' }) {
        const item = running.get(id);
        if (item) {
            running.delete(id); window.removeEventListener('message', item.listener);
            clearTimeout(item.startup); clearInterval(item.heartbeat);
            for (const task of [...item.commands.values(), ...item.providers.values()]) { clearTimeout(task.timer); task.reject(new Error('Расширение остановлено')); }
            item.unsubscribe?.(); window.addonPlayer?.cleanup(id); window.addonProviders?.cleanup(id); item.frame.remove();
            noctune.addons.cancelRequests(id).catch(() => {});
        }
        changed(id, state);
    }
    function start(pkg) {
        const { manifest: m } = pkg, channel = crypto.randomUUID();
        const frame = document.createElement('iframe');
        frame.hidden = true; frame.title = m.name; frame.setAttribute('sandbox', 'allow-scripts');
        const item = { frame, channel, digest: pkg.digest, commands: new Map(), providers: new Map(), subscriptions: new Set(), ready: false, windowStart: performance.now(), calls: 0, lastPong: performance.now() };
        const grants = new Set(pkg.grants || AddonPermissions.expand(m.permissions));
        const send = data => frame.contentWindow?.postMessage({ channel, ...data }, '*');
        const providerCall = (provider, action, args) => new Promise((resolve, reject) => {
            if (item.providers.size >= 8) return reject(new Error('Слишком много запросов провайдера'));
            const token = crypto.randomUUID(), timer = setTimeout(() => { item.providers.delete(token); reject(new Error('Провайдер не ответил за 20 секунд')); }, 20000);
            item.providers.set(token, { resolve, reject, timer }); send({ type: 'provider', provider, action, args, token });
        });
        item.unsubscribe = window.addonEvents.on(event => {
            if (!item.ready || event.type.startsWith('settings.') && event.addonId !== m.id) return;
            if ([...item.subscriptions].some(type => type === event.type || type.endsWith('.*') && event.type.startsWith(type.slice(0, -1)))) send({ type: 'event', event });
        });
        const failure = message => stop(m.id, { status: 'error', message });
        item.listener = async event => {
            if (event.source !== frame.contentWindow || event.data?.channel !== channel || running.get(m.id) !== item) return;
            const data = event.data;
            if (data.type === 'ready') { clearTimeout(item.startup); item.ready = true; item.lastPong = performance.now(); changed(m.id, { status: 'running' }); return; }
            if (data.type === 'pong') { item.lastPong = performance.now(); return; }
            if (data.type === 'event-error') { changed(m.id, { status: 'running', message: String(data.message).slice(0, 240) }); return; }
            if (data.type === 'error') { failure(String(data.message || 'Ошибка расширения').slice(0, 240)); return; }
            if (data.type === 'command-done' || data.type === 'provider-done') {
                const tasks = data.type === 'command-done' ? item.commands : item.providers;
                const task = tasks.get(data.token);
                if (data.type === 'provider-done' && JSON.stringify(data.value || null).length > 1024*1024) data.error = 'Ответ провайдера превышает 1 МБ';
                if (task) { clearTimeout(task.timer); tasks.delete(data.token); if (data.error) task.reject(new Error(String(data.error).slice(0, 240))); else task.resolve(data.value); }
                return;
            }
            if (data.type !== 'call') return;
            if (performance.now() - item.windowStart > 1000) { item.windowStart = performance.now(); item.calls = 0; }
            if (++item.calls > 40) { failure('Расширение отправляет слишком много запросов'); return; }
            try {
                if (!Number.isSafeInteger(data.id) || data.id < 1 || JSON.stringify(data.args)?.length > (data.method === 'files.write' ? 6 * 1024 * 1024 : 64 * 1024)) throw new Error('Некорректный запрос SDK');
                const args = data.args || {}; let value = null;
                if (data.method === 'notify') {
                    if (!grants.has('notifications.show') || typeof args.message !== 'string' || args.message.length > 500) throw new Error('Уведомление не разрешено');
                    if (args.key !== undefined && (typeof args.key !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(args.key))) throw new Error('Некорректный ключ уведомления');
                    if (args.key === undefined) {
                        if (item.lastNotification && performance.now() - item.lastNotification < 3000) throw new Error('Уведомления доступны раз в три секунды');
                        item.lastNotification = performance.now();
                    }
                    // Existing toast markup interpolates strings, so escape addon text.
                    const escape = text => text.replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
                    showNotification(args.message, 'info', escape(m.name), null, { replaceKey: args.key === undefined ? undefined : m.id + ':' + args.key });
                } else if (data.method === 'playback.read') {
                    if (!grants.has('playback.read')) throw new Error('Нет доступа к текущему треку');
                    value = window.addonEvents.snapshot();
                } else if (data.method === 'network') {
                    value = await noctune.addons.request(m.id, pkg.digest, args.url);
                } else if (['storage.get','storage.set'].includes(data.method)) {
                    value = await noctune.addons.invoke(m.id, pkg.digest, data.method, args);
                } else if (data.method === 'events.subscribe') {
                    const group = String(args.type).split('.')[0];
                    const permission = { track: 'events.track', playback: 'events.playback', progress: 'events.progress', queue: 'events.queue', playlists: 'events.playlists', settings: 'settings.events', themes: 'themes.events', backgrounds: 'backgrounds.events', appearance: 'appearance.events' }[group];
                    if (!permission || !grants.has(permission) || !/^(track|playback|progress|queue|playlists|settings|themes|backgrounds|appearance)\.(\*|[a-z]+)$/.test(args.type)) throw new Error('Нет разрешения на событие');
                    if (item.subscriptions.size >= 64 && !item.subscriptions.has(args.type)) throw new Error('Слишком много подписок');
                    item.subscriptions.add(args.type);
                } else if (data.method === 'providers.register') {
                    if (!grants.has('providers.register')) throw new Error('Регистрация провайдера не разрешена');
                    window.addonProviders.register(m.id, pkg.digest, args, (action, value) => providerCall(args.id, action, value));
                } else if (data.method === 'providers.invalidate') {
                    if (!grants.has('providers.register')) throw new Error('Нет разрешения провайдера');
                    window.addonProviders.invalidate(m.id, args);
                } else if (data.method === 'providers.search' || data.method === 'providers.play' || data.method === 'providers.enqueue') {
                    if (data.method === 'providers.enqueue' && !grants.has('queue.add')) throw new Error('Нет разрешения queue.add');
                    if (!grants.has(data.method === 'providers.search' ? 'providers.register' : 'providers.play')) throw new Error('Нет разрешения провайдера');
                    value = await window.addonProviders[data.method.split('.')[1]](m.id, args);
                } else {
                    const permission = { 'catalog.browse': 'catalog.register', 'catalog.search': 'catalog.register', 'catalog.unregister':'catalog.register', 'settings.get': 'settings.read', 'secrets.get': 'secrets.read', 'secrets.set': 'secrets.write', 'files.save': 'files.write' }[data.method] || data.method;
                    if (!grants.has(permission)) throw new Error('Нет разрешения: ' + permission);
                    if (/^(appearance|catalog|servicePlaylists|artwork|lyrics|hotkeys)\./.test(data.method)) {
                        value = await window.addonContributions.invoke(m.id, pkg.digest, data.method, args, { manifest:m, grants, call:(action, value)=>providerCall((data.method==='lyrics.provide'?'@lyrics:':'@catalog:')+args.id,action,value) });
                    } else if (/^(playback|queue|playlists|themes|backgrounds|audio)\./.test(data.method) || data.method === 'files.library') value = await window.addonPlayer.invoke(m.id, pkg.digest, data.method, args);
                    else value = await noctune.addons.services(m.id, pkg.digest, data.method, args);
                }
                if (running.get(m.id) === item) send({ type: 'reply', id: data.id, value });
            } catch (error) { if (running.get(m.id) === item) send({ type: 'reply', id: data.id, error: String(error.message).slice(0, 240) }); }
        };
        running.set(m.id, item); window.addEventListener('message', item.listener);
        item.startup = setTimeout(() => failure('Расширение не запустилось за 10 секунд'), 10000);
        let lastTick = performance.now();
        item.heartbeat = setInterval(() => {
            const now = performance.now();
            if (now - lastTick > 20000) item.lastPong = now; // Resume after sleep/background throttling.
            lastTick = now;
            if (item.ready && now - item.lastPong > 20000) { failure('Расширение перестало отвечать'); return; }
            send({ type: 'ping' });
        }, 5000);
        const data = encode({ channel, manifest: m, files: pkg.files, assetTypes: AddonAssets.types, sdk: '(' + workerSdk.toString() + ')();' });
        frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><script id="addon-data" type="application/octet-stream">${data}</script><script>(${frameBootstrap.toString()})();<\/script>`;
        document.body.appendChild(frame);
        changed(m.id, { status: 'starting' });
    }
    async function refresh() {
        const serial = ++generation;
        const packages = await noctune.addons.runtime();
        if (serial !== generation) return;
        const available = new Map(packages.map(pkg => [pkg.manifest.id, pkg]));
        for (const [id, item] of running) if (available.get(id)?.digest !== item.digest) stop(id);
        for (const pkg of packages) if (!running.has(pkg.manifest.id)) start(pkg);
    }
    function command(id, command) {
        const item = running.get(id);
        if (!item?.ready) return Promise.reject(new Error('Расширение не запущено'));
        if (item.commands.size) return Promise.reject(new Error('Предыдущая команда ещё выполняется'));
        return new Promise((resolve, reject) => {
            const token = crypto.randomUUID();
            const timer = setTimeout(() => stop(id, { status: 'error', message: 'Команда не завершилась за 5 минут' }), 310000);
            item.commands.set(token, { resolve, reject, timer });
            item.frame.contentWindow.postMessage({ channel: item.channel, type: 'command', token, command }, '*');
        });
    }
    window.addonHost = { refresh, command, state: id => states.get(id), active: (id,hash) => running.get(id)?.digest === hash };
    document.addEventListener('addons-changed', () => refresh().catch(error => changed('host', { status: 'error', message: error.message })));
    refresh().catch(error => changed('host', { status: 'error', message: error.message }));
})();
