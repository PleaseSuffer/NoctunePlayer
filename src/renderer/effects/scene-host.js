(() => {
    'use strict';
    let current = null, candidate = null, dormant = null, epoch = 0, last = 0, time = 0, queued = false;
    let spectrum = new Uint8Array(0), sampleRate = 44100, playing = false;
    const listeners = new Set();
    function preferences(metadata) {
        let stored; try { stored=JSON.parse(appStorage.getItem('setting_scene_preferences') || '{}')[metadata.id]; } catch (_) {}
        const defaults=metadata.parameters || {};
        const bounded=(value,fallback,max)=>Number.isFinite(value)?Math.max(0,Math.min(max,value)):fallback;
        return { frequencyMix: bounded(stored?.frequencyMix,defaults.frequencyMix ?? .6,1), glowIntensity: bounded(stored?.glowIntensity,defaults.glowIntensity ?? 1,3) };
    }
    const encode = text => { const bytes = new TextEncoder().encode(text); let result = ''; for (let i = 0; i < bytes.length; i += 8192) result += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(result); };
    const bootstrap = function () {
        const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(document.getElementById('scene-data').textContent), c => c.charCodeAt(0))));
        const reply = (type, extra = {}) => parent.postMessage({ sceneChannel: payload.channel, type, ...extra }, '*');
        const runScript = text => new Promise((resolve, reject) => {
            const script = document.createElement('script'); script.src = 'data:text/javascript;base64,' + btoa(unescape(encodeURIComponent(text)));
            script.onload = resolve; script.onerror = () => reject(new Error('Не удалось загрузить скрипт')); document.head.append(script);
        });
        window.addEventListener('error', e => reply('error', { message: String(e.message).slice(0, 240) }));
        window.addEventListener('unhandledrejection', e => reply('error', { message: String(e.reason?.message || e.reason || 'Ошибка скрипта темы').slice(0, 240) }));
        (async () => {
            const images = Object.create(null);
            reply('stage', { stage: 'загрузка PNG-слоёв' });
            await Promise.all(Object.entries(payload.assets).map(async ([id, src]) => {
                const img = new Image(); img.decoding = 'sync';
                await new Promise((resolve, reject) => {
                    img.onload = resolve; img.onerror = () => reject(new Error('Не удалось загрузить PNG-слой: ' + id));
                    img.src = src;
                });
                images[id] = img;
            }));
            reply('stage', { stage: 'загрузка SDK' }); await runScript(payload.sdk);
            reply('stage', { stage: 'загрузка скрипта сцены' }); await runScript(payload.script);
            const scene = window.__noctuneScene;
            if (!scene) throw new Error('Отсутствует NoctuneScene.define');
            const api = NoctuneScene.create(document.querySelector('canvas'), payload.manifest, images);
            reply('stage', { stage: 'инициализация сцены' });
            if (scene.init) await scene.init(api);
            window.addEventListener('message', e => {
                if (e.source !== parent || e.data?.sceneChannel !== payload.channel || e.data.type !== 'frame') return;
                try { api.begin(e.data.frame); scene.render(api, e.data.frame); reply('frame'); }
                catch (error) { reply('error', { message: String(error.message).slice(0, 240) }); }
            });
            // The first frame must not depend on rAF in a hidden candidate iframe.
            // Chromium may throttle such frames until they become visible.
            api.begin(payload.initialFrame); scene.render(api, payload.initialFrame);
            reply('ready'); reply('frame');
        })().catch(error => reply('error', { message: String(error.message).slice(0, 240) }));
    };
    function html(pkg, channel, initialFrame) {
        const data = encode(JSON.stringify({ ...pkg, channel, initialFrame }));
        return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' data:; img-src data:; style-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${pkg.manifest.palette.background}}canvas{width:100%;height:100%;display:block}</style></head><body><canvas></canvas><script id="scene-data" type="application/octet-stream">${data}</script><script>(${bootstrap.toString()})();<\/script></body></html>`;
    }
    function emit() { listeners.forEach(fn => fn(current?.metadata || null)); document.dispatchEvent(new Event('settings-sections-changed')); }
    function colors() {
        const inherit = current && appStorage.getItem('setting_scene_colors') !== '0';
        let gradient;
        try { gradient = JSON.parse(appStorage.getItem('setting_viz_grad') || 'null'); } catch (_) { /* use defaults */ }
        if (!Array.isArray(gradient) || gradient.length !== 3 || !gradient.every(c => /^#[\da-f]{6}$/i.test(c))) gradient = null;
        const palette = inherit ? current.metadata.palette : { accent: appStorage.getItem('setting_accent_color') || '#4a90e2', gradient: gradient || ['#bb86fc', '#4a90e2', '#03dac6'] };
        window.backgroundSettings?.palette(palette);
    }
    function destroy(entry) { if (!entry) return; clearTimeout(entry.timer); entry.frame.remove(); if (entry.reject) { entry.reject(new Error('Выбор темы отменён')); entry.reject = null; } }
    function deactivate(persist = true) {
        const wasActive = !!current;
        dormant = persist ? null : current?.metadata || dormant;
        epoch++; destroy(candidate); candidate = null; destroy(current); current = null;
        document.body.classList.remove('scene-active');
        if (persist) { appStorage.removeItem('setting_scene_theme'); appStorage.setItem('setting_scene_enabled', '0'); }
        last = 0; spectrum = new Uint8Array(0); playing = false; colors(); window.imageEffects?.refreshVisibility(); emit();
        if (persist && wasActive && window.bgImageEnabled) window.backgroundSettings?.enable(true);
    }
    function schedule() { if (!queued) { queued = true; window.requestEffectsFrame(tick); } }
    function tick(now) {
        queued = false; if (!current && !candidate) return;
        schedule();
        const paused = window._rafSuspended || document.hidden;
        const dt = last && !paused ? Math.min((now - last) / 1000, .08) : 0; last = now;
        if (paused) return;
        const motion = appStorage.getItem('setting_scene_motion') !== '0' && !matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (motion) time += dt;
        colors();
        for (const entry of [current, candidate]) {
            if (!entry?.ready) continue;
            if (entry.busy) {
                if (now - entry.sentAt > 5000) failure(entry, 'Тема перестала отвечать');
                continue;
            }
            entry.busy = true; entry.sentAt = now;
            const settings=preferences(entry.metadata);
            const audio = { spectrum, sampleRate, playing, frequencyMix: settings.frequencyMix, enabled: entry.metadata.capabilities.visualizer !== 'none' && appStorage.getItem('setting_scene_visualizer_enabled') !== '0', intensity: Math.max(.1, Math.min(3, Number(appStorage.getItem('setting_scene_intensity')) || 1)) };
            entry.frame.contentWindow.postMessage({ sceneChannel: entry.channel, type: 'frame', frame: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, time, dt, motion: motion && entry.metadata.capabilities.motion, lighting: {intensity:settings.glowIntensity}, audio } }, '*');
        }
    }
    function failure(entry, message) {
        if (entry === candidate) {
            candidate = null;
            if (!current && appStorage.getItem('setting_scene_theme') === entry.metadata.id) appStorage.removeItem('setting_scene_theme');
            if (entry.reject) { const error = new Error(message); error.sceneNotified = true; entry.reject(error); entry.reject = null; }
            destroy(entry);
        }
        else if (entry === current) deactivate();
        const details = `Тема: ${entry.metadata.name} (${entry.metadata.id})\nЭтап: ${entry.stage || 'загрузка iframe'}\n${message}`;
        if (typeof showNotification === 'function') showNotification(message, 'warning', null, null, { copyText: details });
    }
    window.addEventListener('message', event => {
        const entry = [current, candidate].find(e => e && event.source === e.frame.contentWindow && event.data?.sceneChannel === e.channel);
        if (!entry) return;
        if (event.data.type === 'stage') { entry.stage = String(event.data.stage).slice(0, 120); return; }
        if (event.data.type === 'error') { failure(entry, 'Ошибка интерактивной темы: ' + String(event.data.message).slice(0, 240)); return; }
        if (event.data.type === 'ready') { entry.ready = true; schedule(); }
        if (event.data.type === 'frame') {
            entry.busy = false;
            if (entry === candidate) {
                clearTimeout(entry.timer); destroy(current); current = entry; candidate = null; current.frame.style.opacity = '1';
                document.body.classList.add('scene-active'); document.getElementById('custom-bg-video')?.pause();
                appStorage.setItem('setting_scene_theme', entry.metadata.id);
                appStorage.setItem('setting_scene_enabled', '1');
                appStorage.setItem('setting_bg_image_enabled', '0'); window.backgroundSettings?.enable(false);
                colors(); window.imageEffects?.refreshVisibility(); emit(); entry.resolve(entry.metadata); entry.reject = null;
            }
        }
    });
    window.sceneThemes = {
        get active() { return !!current; },
        get metadata() { return current?.metadata || null; },
        audio(data, rate, isPlaying) {
            if (!current && !candidate) return;
            if (!data || !isPlaying) { spectrum = new Uint8Array(0); playing = false; return; }
            // Keep the original FFT length: changing it changes the Hz/bin mapping.
            spectrum = new Uint8Array(data); sampleRate = rate; playing = !!isPlaying;
        },
        async activate(metadata) {
            const request = ++epoch; destroy(candidate); candidate = null;
            const pkg = await noctune.sceneThemes.read(metadata.id);
            if (request !== epoch) throw new Error('Выбор темы отменён');
            return new Promise((resolve, reject) => {
                const frame = document.createElement('iframe'); frame.className = 'scene-frame'; frame.setAttribute('sandbox', 'allow-scripts');
                frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1; frame.style.opacity = '0';
                const channel = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
                const entry = { frame, channel, metadata, resolve, reject, ready: false, busy: false };
                candidate = entry;
                frame.srcdoc = html(pkg, channel, { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, time, dt: 0, motion: false, audio: { spectrum: [], sampleRate, playing: false, enabled: false, intensity: 1 } });
                document.body.prepend(frame);
                entry.timer = setTimeout(() => { if (entry === candidate) failure(entry, 'Не удалось запустить тему: ' + (entry.stage || 'загрузка iframe') + ' (тайм-аут 15 с)'); }, 15000);
                schedule();
            });
        },
        deactivate, applyPalette: colors,
        appearance() { try { return JSON.parse(appStorage.getItem('setting_scene_preferences')||'{}'); } catch (_) { return {}; } },
        applyAppearance(value) {
            if(!value || typeof value!=='object' || Array.isArray(value))return;
            const settings={};
            for(const [id,p] of Object.entries(value).slice(0,128)){
                if(!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id) || !p)continue;
                const entry={};
                if(Number.isFinite(p.frequencyMix))entry.frequencyMix=Math.max(0,Math.min(1,p.frequencyMix));
                if(Number.isFinite(p.glowIntensity))entry.glowIntensity=Math.max(0,Math.min(3,p.glowIntensity));
                settings[id]=entry;
            }
            appStorage.setItem('setting_scene_preferences',JSON.stringify(settings));this.preferencesChanged();
        },
        async resumeSaved() {
            const id = appStorage.getItem('setting_scene_theme'), request = epoch;
            if (!id || current || appStorage.getItem('setting_scene_enabled') !== '1') return;
            try {
                const metadata = dormant?.id === id ? dormant : (await noctune.sceneThemes.list()).themes.find(t => t.id === id);
                if (request !== epoch || appStorage.getItem('setting_scene_enabled') !== '1' || appStorage.getItem('setting_scene_theme') !== id) return;
                if (metadata) await this.activate(metadata);
                else { appStorage.removeItem('setting_scene_theme'); emit(); }
            } catch (error) { if (error.message !== 'Выбор темы отменён' && !error.sceneNotified) showNotification(error.message, 'warning', null, null, { copyText: error.stack || error.message }); }
        },
        onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        preferencesChanged() { colors(); emit(); },
    };
})();
