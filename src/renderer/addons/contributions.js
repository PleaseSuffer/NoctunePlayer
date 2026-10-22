(function () {
    const { roles, palette: validatePalette, operations, name } = AddonContributions;
    const catalogs = new Map(), lyricSources = new Map(), schemes = new Map(), layers = new Map(), hotkeys = new Map();
    const mutations = new Map(), receipts = new Map();
    const baseColors = {
        light: { background:'#f4f7f6',surface:'#ffffff',text:'#333333',muted:'#666666',border:'#e0e0e0',hover:'#e8ebea',accent:'#4a90e2',secondary:'#8e44ad' },
        dark: { background:'#121212',surface:'#1e1e1e',text:'#e0e0e0',muted:'#aaaaaa',border:'#333333',hover:'#242424',accent:'#bb86fc',secondary:'#d19bf7' },
    };
    const system = matchMedia('(prefers-color-scheme: dark)');
    const modeName = mode => mode === 'system' ? (system.matches ? 'dark' : 'light') : mode;
    let base = { mode: document.body.getAttribute('data-theme') === 'dark' ? 'dark' : 'light', palette: {} }, style = null;
    try { const saved = JSON.parse(appStorage.getItem('setting_addon_appearance') || 'null'); if (saved && ['light','dark','system'].includes(saved.mode)) base = { mode: saved.mode, palette: validatePalette(saved.palette) }; } catch (_) {}
    const validRevision = value => typeof value==='string' ? !!value.trim()&&value.length<=300&&!/[\r\n\0]/.test(value) : Number.isSafeInteger(value)&&value>=0;
    const key = (owner, id) => owner + ':' + id;
    const canonical = value => Array.isArray(value) ? '['+value.map(canonical).join(',')+']' : value && typeof value==='object' ? '{'+Object.keys(value).filter(key=>value[key]!==undefined).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}' : JSON.stringify(value);
    function text(value, max = 120) { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Некорректный текст'); return value; }
    function validMode(value) { if (!['light','dark','system'].includes(value)) throw new Error('Режим: light, dark или system'); return value; }
    function cleanPalette(value, mode) {
        const manualAccent=document.body.style.getPropertyValue('--accent-color')||appStorage.getItem('setting_accent_color');
        const colors = { ...baseColors[modeName(mode)], ...(/^#[a-f0-9]{6}$/i.test(manualAccent||'')?{accent:manualAccent}:{}), ...validatePalette(value) };
        const luminance = color => { const rgb = [1,3,5].map(i => parseInt(color.slice(i,i+2),16)/255).map(v => v <= .04045 ? v/12.92 : Math.pow((v+.055)/1.055,2.4)); return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722; };
        const a = luminance(colors.background), b = luminance(colors.text);
        if ((Math.max(a,b)+.05)/(Math.min(a,b)+.05) < 3) throw new Error('Недостаточная читаемость текста на фоне');
        return colors;
    }
    function appearanceState() {
        let value = { mode: base.mode, palette: { ...base.palette } };
        for (const layer of layers.values()) { value.mode = layer.mode || value.mode; value.palette = { ...value.palette, ...(layer.palette || {}) }; }
        return { mode: value.mode, effectiveMode: modeName(value.mode), palette: cleanPalette(value.palette, value.mode) };
    }
    function applyAppearance(emit = true) {
        const state = appearanceState();
        if (state.effectiveMode === 'dark') document.body.setAttribute('data-theme','dark'); else document.body.removeAttribute('data-theme');
        const themeToggle=document.getElementById('theme-toggle');if(themeToggle&&window.AddonPermissionView)themeToggle.replaceChildren(AddonPermissionView.icon(state.effectiveMode==='dark'?'Sun':'Moon','theme-icon'));
        const toggle = document.getElementById('setting-dark-theme'); if (toggle) toggle.checked = state.effectiveMode === 'dark';
        if (layers.size || Object.keys(base.palette).length) {
            if (!style) {
                style = document.createElement('style'); style.textContent = ':where(:root,body){' + Object.entries(roles).map(([role, variable]) => variable + ':var(--addon-ui-' + role + ')!important').join(';') + '}'; document.head.append(style);
            }
            for (const [role, color] of Object.entries(state.palette)) document.documentElement.style.setProperty('--addon-ui-' + role, color);
        } else { style?.remove(); style = null; for (const role of Object.keys(roles)) document.documentElement.style.removeProperty('--addon-ui-' + role); }
        window.backgroundSettings?.refreshAccent();
        if (emit) window.addonEvents.emit('appearance.changed', { mode: state.mode, effectiveMode: state.effectiveMode });
    }
    system.addEventListener('change', () => { if (appearanceState().mode === 'system') applyAppearance(); });
    const userModeChanged = () => { base.mode = document.body.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; if (appStorage.getItem('setting_addon_appearance')) appStorage.setItem('setting_addon_appearance', JSON.stringify(base)); applyAppearance(); };
    document.getElementById('setting-dark-theme')?.addEventListener('change', userModeChanged);
    document.getElementById('theme-toggle')?.addEventListener('click', userModeChanged);
    function catalog(owner, id) { const item = catalogs.get(key(owner,id)); if (!item) throw new Error('Каталог выключен'); return item; }
    function page(result, item) {
        if (!result || !Array.isArray(result.items) || result.items.length > 100 || (result.cursor != null && (typeof result.cursor !== 'string' || result.cursor.length > 1000))) throw new Error('Нужна страница items (до 100) и cursor');
        return { items: result.items.map(entry => {
            if (!entry || !['track','album','artist','playlist'].includes(entry.type)) throw new Error('Неизвестный тип каталога');
            return { id: text(entry.id,300), type: entry.type, title: text(entry.title,300), artist: typeof entry.artist === 'string' ? entry.artist.slice(0,300) : '', addonId: item.owner, providerId: item.providerId, accountId: item.accountId };
        }), cursor: result.cursor || null };
    }
    async function service(owner, action, args) {
        const item = catalog(owner,args.catalog);
        args = {...args,addonId:owner,providerId:item.providerId,accountId:item.accountId};
        if (!operations.includes(action) || !item.grants.has('servicePlaylists.' + action) || !item.capabilities.includes(action)) throw new Error('Операция плейлиста не поддерживается или не разрешена');
        if (args.id !== undefined) text(args.id,300);
        if (action === 'read') {
            if(args.cursor!=null && (typeof args.cursor!=='string'||args.cursor.length>1000))throw new Error('Некорректный cursor');
            const result = await item.call('read', args);
            if(result?.cursor!=null && (typeof result.cursor!=='string'||result.cursor.length>1000))throw new Error('Некорректный cursor ответа');
            if (catalogs.get(key(owner,item.id)) !== item) throw new Error('Каталог остановлен');
            const validate = value => {
                if (!value || !validRevision(value.revision)) throw new Error('Плейлисту нужна ревизия');
                const result = { id:text(value.id,300), name:text(value.name,300), revision:String(value.revision), addonId:owner, providerId:item.providerId, accountId:item.accountId };
                if (value.tracks !== undefined) {
                    if (!Array.isArray(value.tracks) || value.tracks.length > 100) throw new Error('Страница содержит до 100 треков');
                    if(new Set(value.tracks.map(track=>track.entryId)).size!==value.tracks.length)throw new Error('Вхождения треков должны иметь разные entryId');
                    result.tracks = value.tracks.map(track => ({ id:text(track.id,300), entryId:text(track.entryId,300), title:text(track.title,300), artist:typeof track.artist === 'string' ? track.artist.slice(0,300) : '' }));
                }
                item.revisions.set(result.id,result.revision); return result;
            };
            if (args.id) return { ...validate(result), cursor: result.cursor || null };
            if (!Array.isArray(result?.items) || result.items.length > 100) throw new Error('Нужна страница плейлистов');
            return { items:result.items.map(validate), cursor:result.cursor || null };
        }
        if (typeof args.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(args.requestId)) throw new Error('Нужен стабильный requestId для повторного запроса');
        const receiptKey = key(owner,item.id) + ':' + args.requestId, fingerprint = canonical([action,args]);
        const previous = receipts.get(receiptKey);
        if (previous) { if (previous.fingerprint !== fingerprint) throw new Error('requestId уже использован'); return previous.promise; }
        if (action === 'create' || action === 'rename') text(args.name,300);
        if (action !== 'create' && (typeof args.id !== 'string' || String(args.revision) !== item.revisions.get(args.id))) throw new Error('REVISION_CONFLICT: перечитайте плейлист');
        if (['addTracks','removeTracks','reorder'].includes(action)) {
            const values = action === 'addTracks' ? args.tracks : args.entries;
            if (!Array.isArray(values) || !values.length || values.length > 100 || values.some(value => typeof value !== 'string' || !value || value.length > 300)) throw new Error('Некорректный список треков');
        }
        const lock = key(owner,item.id) + ':' + (args.id || '@create');
        if (mutations.has(lock)) throw new Error('Операция с плейлистом уже выполняется');
        const promise = (async () => {
            const result = await item.call(action,args);
            if (catalogs.get(key(owner,item.id)) !== item) throw new Error('Каталог остановлен');
            if (!result || !validRevision(result.revision) || (action === 'create' && typeof result.id !== 'string') || (action === 'delete' && result.deleted !== true)) throw new Error('Сервис не подтвердил операцию и новую ревизию');
            if (action !== 'create' && String(result.revision) === String(args.revision)) throw new Error('Сервис не изменил ревизию');
            if (action === 'delete') item.revisions.delete(args.id); else item.revisions.set(action === 'create' ? result.id : args.id,String(result.revision));
            window.addonEvents.emit('playlists.changed',{ addonId:owner,providerId:item.providerId,accountId:item.accountId,id:result.id||args.id,revision:String(result.revision),initiator:owner });
            return { id:result.id||args.id, revision:String(result.revision), deleted:action === 'delete' };
        })().finally(() => mutations.delete(lock));
        mutations.set(lock,promise); receipts.set(receiptKey,{fingerprint,promise});
        promise.catch(()=>{if(receipts.get(receiptKey)?.promise===promise)receipts.delete(receiptKey);});
        if (receipts.size > 500) receipts.delete(receipts.keys().next().value);
        return promise;
    }
    const api = window.addonContributions = {
        schemes: () => [...schemes.values()].map(({owner,id,name,mode})=>({owner,id,name,mode})),
        catalogs: () => [...catalogs.values()].map(({owner,id,name,providerId,accountId,capabilities,grants})=>({owner,id,name,providerId,accountId,capabilities:capabilities.filter(action=>action==='browse'||grants.has('servicePlaylists.'+action)),playable:grants.has('providers.play')&&!!window.addonProviders?.has(owner,providerId)})),
        hotkeys: () => [...hotkeys.values()].map(item=>({id:item.key,label:item.title})),
        userScheme(owner,id) { const scheme = schemes.get(key(owner,id)); if (!scheme) throw new Error('Схема не установлена'); layers.set(owner,{mode:scheme.mode,palette:scheme.palette}); applyAppearance(); },
        async lyrics(track) {
            for (const source of lyricSources.values()) {
                try { const result = await source.call('resolve',track); if (lyricSources.get(key(source.owner,source.id)) !== source) continue; if (result?.status === 'found') return validateLyrics(result); if(result?.status==='instrumental')return {status:'instrumental',lines:[],plain:''}; }
                catch (_) { /* A failed source does not suppress built-in lyrics. */ }
            }
            return null;
        },
        cleanup(owner) {
            const hadLayer = layers.delete(owner);
            for (const collection of [catalogs,lyricSources,schemes,hotkeys]) for (const [id,item] of collection) if (item.owner === owner) collection.delete(id);
            for (const id of receipts.keys()) if (id.startsWith(owner+':')) receipts.delete(id);
            if (hadLayer) applyAppearance();
            document.dispatchEvent(new Event('addon-contributions-changed'));
        },
        async invoke(owner, hash, method, args, context) {
            if(args.sessionId!==undefined&&args.sessionId!==window.addonEvents.snapshot().sessionId)throw new Error('Сеанс трека уже изменился');
            if (method.startsWith('appearance.')) {
                const action = method.split('.')[1];
                if (action === 'read') return {...appearanceState(),effectivePalette:Object.fromEntries(Object.entries(roles).map(([role,variable])=>[role,getComputedStyle(document.body).getPropertyValue(variable).trim()]))};
                if (action === 'register') {
                    if (!name(args.id) || schemes.size >= 128) throw new Error('Некорректная схема или превышен лимит');
                    const scheme = {owner,id:args.id,name:text(args.name),mode:validMode(args.mode),palette:validatePalette(args.palette)};
                    cleanPalette(scheme.palette,scheme.mode);
                    schemes.set(key(owner,args.id),scheme); document.dispatchEvent(new Event('addon-contributions-changed')); return;
                }
                if (action === 'switch') { if (args.id === null) { layers.delete(owner); applyAppearance(); return; } return api.userScheme(owner,args.id); }
                if (action === 'persist') {
                    const own = layers.get(owner); if (!own) throw new Error('Нет собственного слоя для сохранения');
                    base = { mode:own.mode||base.mode,palette:cleanPalette({...base.palette,...own.palette},own.mode||base.mode) };
                    appStorage.setItem('setting_addon_appearance',JSON.stringify(base)); appStorage.setItem('player_theme',modeName(base.mode)); layers.delete(owner); applyAppearance(); return;
                }
                const layer = {...layers.get(owner)};
                if (action === 'mode') { if (args.mode === null) delete layer.mode; else layer.mode=validMode(args.mode); }
                else if (action === 'palette') { if (args.palette === null) delete layer.palette; else layer.palette=validatePalette(args.palette); }
                else throw new Error('Неизвестное действие оформления');
                cleanPalette({...base.palette,...layer.palette},layer.mode||base.mode);
                if (Object.keys(layer).length) layers.set(owner,layer); else layers.delete(owner); applyAppearance(); return;
            }
            if (method === 'catalog.register') {
                if (!name(args.id) || !name(args.providerId) || catalogs.has(key(owner,args.id)) || [...catalogs.values()].filter(item=>item.owner===owner).length >= 8) throw new Error('Некорректный или повторный каталог');
                const capabilities = args.capabilities;
                if (!Array.isArray(capabilities) || capabilities.some(action=>!['browse',...operations].includes(action))) throw new Error('Неизвестная возможность каталога');
                catalogs.set(key(owner,args.id),{owner,id:args.id,name:text(args.name),accountId:text(args.accountId,300),providerId:args.providerId,capabilities,grants:context.grants,call:context.call,revisions:new Map()});
                document.dispatchEvent(new Event('addon-contributions-changed')); return;
            }
            if (method === 'catalog.browse') {
                const item=catalog(owner,args.catalog); if (!item.capabilities.includes('browse')) throw new Error('Каталог не поддерживает просмотр');
                const result=await item.call('browse',{...args,addonId:owner,providerId:item.providerId,accountId:item.accountId}); if (catalogs.get(key(owner,item.id))!==item) throw new Error('Каталог остановлен'); return page(result,item);
            }
            if (method.startsWith('servicePlaylists.')) return service(owner,method.split('.')[1],args);
            if (method === 'lyrics.read') return window.addonLyrics?.read() || {status:'missing',lines:[],plain:''};
            if (method === 'lyrics.provide') {
                if (!name(args.id) || lyricSources.size >= 32 || lyricSources.has(key(owner,args.id))) throw new Error('Некорректный или повторный источник текста');
                lyricSources.set(key(owner,args.id),{owner,id:args.id,call:context.call}); return;
            }
            if (method === 'artwork.read') {
                const sessionId=window.addonEvents.snapshot().sessionId;
                const image=window.addonLyrics?.artwork(); if (!image || !/^data:image\/(png|jpeg|webp);base64,/.test(image)) return null;
                const bitmap = new Image(); bitmap.src = image; await bitmap.decode();
                try { if(sessionId!==window.addonEvents.snapshot().sessionId)throw new Error('Сеанс трека уже изменился'); const canvas=document.createElement('canvas'),scale=Math.min(1,256/Math.max(bitmap.width,bitmap.height));canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);return {sessionId,dataUrl:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height}; } finally {bitmap.src='';}
            }
            if (method === 'hotkeys.register') {
                if (!context.manifest.commands.some(command=>command.id===args.command)) throw new Error('Нужна команда из manifest');
                const id='addon:'+owner+':'+args.command;
                hotkeys.set(id,{owner,key:id,title:context.manifest.name+' · '+context.manifest.commands.find(command=>command.id===args.command).title});
                document.dispatchEvent(new Event('addon-contributions-changed')); return;
            }
            throw new Error('Неизвестная возможность расширения');
        },
    };
    function validateLyrics(result) {
        if (!Array.isArray(result.lines) || result.lines.length > 3000 || typeof (result.plain||'') !== 'string' || (result.plain||'').length > 200000) throw new Error('Слишком большой текст');
        let previous=-1;
        const lines=result.lines.map(line=>{if(!Number.isFinite(line.time)||line.time<0||line.time<previous||typeof line.text!=='string'||line.text.length>2000)throw new Error('Некорректные строки текста');previous=line.time;return {time:line.time,text:line.text};});
        return {status:'found',lines,plain:result.plain||'',source:typeof result.source==='string'?result.source.slice(0,120):'Расширение'};
    }
    applyAppearance(false);
})();
