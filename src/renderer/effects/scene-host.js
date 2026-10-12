(() => {
    'use strict';
    let current = null, candidate = null, dormant = null, epoch = 0, last = 0, time = 0, queued = false;
    let spectrum = new Uint8Array(0), sampleRate = 44100, playing = false;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let config, diagnosticsEnabled = false;
    function refreshConfig() {
        config = {
            motion: appStorage.getItem('setting_scene_motion') !== '0',
            visualizer: appStorage.getItem('setting_scene_visualizer_enabled') !== '0',
            intensity: Math.max(.1, Math.min(3, Number(appStorage.getItem('setting_scene_intensity')) || 1)),
        };
        for (const entry of [current, candidate]) if (entry) { entry.settings = preferences(entry.metadata); entry.dirty = true; }
    }
    const listeners = new Set();
    function preferences(metadata, incoming) {
        let all; try { all=JSON.parse(appStorage.getItem('setting_scene_preferences') || '{}'); } catch (_) {}
        const stored = incoming ?? all?.[metadata.apiVersion === 2 ? metadata.packageId : metadata.id] ?? all?.[metadata.id];
        const defaults=metadata.parameters || {};
        const bounded=(value,fallback,max)=>Number.isFinite(value)?Math.max(0,Math.min(max,value)):fallback;
        const result = { frequencyMix: bounded(stored?.frequencyMix,defaults.frequencyMix ?? .6,1), glowIntensity: bounded(stored?.glowIntensity,defaults.glowIntensity ?? 1,3) };
        for (const [key,p] of Object.entries(metadata.parameterSchema || {})) {
            const value=stored?.[key];
            result[key]=p.type==='slider' ? window.sceneParameterValues.normalizeSlider(value,p)
                : p.type==='toggle' ? (typeof value==='boolean' ? value : p.default) : p.options.some(o=>o.value===value) ? value : p.default;
        }
        return result;
    }
    const encode = text => { const bytes = new TextEncoder().encode(text); let result = ''; for (let i = 0; i < bytes.length; i += 8192) result += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(result); };
    const bootstrap = function () {
        const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(document.getElementById('scene-data').textContent), c => c.charCodeAt(0))));
        const reply = (type, extra = {}) => parent.postMessage({ sceneChannel: payload.channel, type, ...extra }, '*');
        const workerBootstrap = function () {
            let api, scene;
            const draw = frame => {
                const start = performance.now(); api.begin(frame); scene.render(api, frame);
                postMessage({ type: 'frame', runtime: 'worker', renderMs: performance.now() - start });
            };
            self.onmessage = async ({ data }) => {
                try {
                    if (data.type === 'init') {
                        const decodeStart = performance.now();
                        const images = Object.create(null);
                        await Promise.all(Object.entries(data.assets).map(async ([id, source]) => {
                            const bytes = Uint8Array.from(atob(source.split(',')[1]), c => c.charCodeAt(0));
                            images[id] = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
                        }));
                        const decodeMs = performance.now() - decodeStart;
                        scene = window.__noctuneScene;
                        if (!scene) throw new Error('Отсутствует NoctuneScene.define');
                        api = NoctuneScene.create(data.canvas, data.manifest, images, data.apiVersion, 'worker');
                        if (scene.init) await scene.init(api);
                        if (api.apiVersion === 2) for (const event of ['resize','parameters','audio','reset']) if (typeof scene[event] === 'function') api.on(event, value => scene[event](api, value));
                        draw(data.initialFrame); postMessage({ type: 'ready', runtime: 'worker', decodeMs });
                    } else if (data.type === 'frame') draw(data.frame);
                    else if (data.type === 'dispose') { try { if (api?.apiVersion === 2) scene?.dispose?.(api); } finally { api?.dispose?.(); self.close(); } }
                } catch (error) { postMessage({ type: 'error', message: String(error.message).slice(0, 240) }); }
            };
        };
        async function startWorker() {
            const canvas = document.querySelector('canvas');
            if (payload.manifest.runtimeRequirements?.dom) { reply('fallback', { reason: 'runtimeRequirements.dom' }); return false; }
            if (!canvas.transferControlToOffscreen || typeof Worker !== 'function') { reply('fallback', { reason: 'Worker/OffscreenCanvas unavailable' }); return false; }
            const source = 'globalThis.window=globalThis;\n' + payload.sdk + '\n' + payload.script + '\n(' + workerBootstrap.toString() + ')();';
            const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
            let worker;
            try {
                worker = new Worker(url);
                await new Promise((resolve, reject) => {
                    let ready = false;
                    const timeout = setTimeout(() => reject(new Error('Worker startup timeout')), 8000);
                    worker.onerror = event => {
                        event.preventDefault(); // Startup incompatibility falls back without bubbling to the scene error handler.
                        if (!ready) { clearTimeout(timeout); reject(new Error(event.message)); }
                        else reply('error', { message: String(event.message).slice(0, 240) });
                    };
                    worker.onmessage = ({ data }) => {
                        if (data.type === 'error' && !ready) { clearTimeout(timeout); reject(new Error(data.message)); return; }
                        if (data.type === 'ready') { ready = true; clearTimeout(timeout); resolve(); }
                        // Ready must precede first-frame promotion in the host.
                        if (ready) reply(data.type, data);
                    };
                    const offscreen = canvas.transferControlToOffscreen();
                    worker.postMessage({ type: 'init', canvas: offscreen, manifest: payload.manifest, apiVersion: payload.apiVersion, assets: payload.assets, initialFrame: payload.initialFrame }, [offscreen]);
                });
                window.addEventListener('message', event => {
                    if (event.source !== parent || event.data?.sceneChannel !== payload.channel || event.data.type !== 'frame') return;
                    const frame = event.data.frame, buffer = frame.audio.spectrum.buffer;
                    worker.postMessage({ type: 'frame', frame }, buffer ? [buffer] : []);
                });
                window.addEventListener('pagehide', () => { worker.postMessage({type:'dispose'}); setTimeout(()=>worker.terminate(),100); }, { once: true });
                reply('ready', { runtime: 'worker' }); reply('frame', { runtime: 'worker' });
                return true;
            } catch (error) {
                reply('fallback', { reason: String(error.message).slice(0,240) });
                worker?.terminate();
                canvas.replaceWith(document.createElement('canvas'));
                return false;
            } finally { URL.revokeObjectURL(url); }
        }
        const runScript = text => new Promise((resolve, reject) => {
            const script = document.createElement('script'); script.src = 'data:text/javascript;base64,' + btoa(unescape(encodeURIComponent(text)));
            script.onload = resolve; script.onerror = () => reject(new Error('Не удалось загрузить скрипт')); document.head.append(script);
        });
        window.addEventListener('error', e => reply('error', { message: String(e.message).slice(0, 240) }));
        window.addEventListener('unhandledrejection', e => reply('error', { message: String(e.reason?.message || e.reason || 'Ошибка скрипта темы').slice(0, 240) }));
        (async () => {
            reply('stage', { stage: 'запуск отдельного потока отрисовки' });
            if (await startWorker()) return;
            const images = Object.create(null);
            const decodeStart = performance.now();
            reply('stage', { stage: 'загрузка PNG-слоёв' });
            await Promise.all(Object.entries(payload.assets).map(async ([id, src]) => {
                const img = new Image(); img.decoding = 'sync';
                await new Promise((resolve, reject) => {
                    img.onload = resolve; img.onerror = () => reject(new Error('Не удалось загрузить PNG-слой: ' + id));
                    img.src = src;
                });
                images[id] = img;
            }));
            const decodeMs = performance.now() - decodeStart;
            reply('stage', { stage: 'загрузка SDK' }); await runScript(payload.sdk);
            reply('stage', { stage: 'загрузка скрипта сцены' }); await runScript(payload.script);
            const scene = window.__noctuneScene;
            if (!scene) throw new Error('Отсутствует NoctuneScene.define');
            const api = NoctuneScene.create(document.querySelector('canvas'), payload.manifest, images, payload.apiVersion, 'iframe');
            reply('stage', { stage: 'инициализация сцены' });
            if (scene.init) await scene.init(api);
            if (api.apiVersion === 2) for (const event of ['resize','parameters','audio','reset']) if (typeof scene[event] === 'function') api.on(event, value => scene[event](api, value));
            window.addEventListener('pagehide', () => { try { if(api.apiVersion===2)scene.dispose?.(api); } finally { api.dispose?.(); } }, {once:true});
            window.addEventListener('message', e => {
                if (e.source !== parent || e.data?.sceneChannel !== payload.channel || e.data.type !== 'frame') return;
                try { const start = performance.now(); api.begin(e.data.frame); scene.render(api, e.data.frame); reply('frame', { runtime: 'iframe', renderMs: performance.now() - start }); }
                catch (error) { reply('error', { message: String(error.message).slice(0, 240) }); }
            });
            // The first frame must not depend on rAF in a hidden candidate iframe.
            // Chromium may throttle such frames until they become visible.
            api.begin(payload.initialFrame); scene.render(api, payload.initialFrame);
            reply('ready', { runtime: 'iframe', decodeMs }); reply('frame', { runtime: 'iframe' });
        })().catch(error => reply('error', { message: String(error.message).slice(0, 240) }));
    };
    function html(pkg, channel, initialFrame) {
        const data = encode(JSON.stringify({ ...pkg, channel, initialFrame }));
        return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' data:; worker-src blob:; img-src data:; style-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${pkg.manifest.palette.background}}canvas{width:100%;height:100%;display:block}</style></head><body><canvas></canvas><script id="scene-data" type="application/octet-stream">${data}</script><script>(${bootstrap.toString()})();<\/script></body></html>`;
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
    function safeArea() {
        const element=document.getElementById('mini-player'), rect=element?.getBoundingClientRect();
        return rect && rect.width>0 && rect.height>0 ? {x:rect.x,y:rect.y,width:rect.width,height:rect.height} : null;
    }
    function tick(now) {
        queued = false; if (!current && !candidate) return;
        schedule();
        const paused = window._rafSuspended || document.hidden;
        const dt = last && !paused ? Math.min((now - last) / 1000, .08) : 0; last = now;
        if (paused) return;
        const motion = config.motion && !reducedMotion.matches;
        if (motion) time += dt;
        const overlay = document.getElementById('lyrics-modal')?.style.display === 'flex' || document.getElementById('settings-overlay')?.classList.contains('open');
        for (const entry of [current, candidate]) {
            if (!entry?.ready) continue;
            if (entry.busy) {
                if (diagnosticsEnabled) entry.skipped = (entry.skipped || 0) + 1;
                if (now - entry.sentAt > 5000) failure(entry, 'Тема перестала отвечать');
                continue;
            }
            // A changing canvas invalidates backdrop-filter surfaces too. Leave GPU
            // headroom for the UI while a costly scene runs behind transparent panels.
            const fps = window.effectsPerformance?.fps ?? 60;
            if (entry.renderAverage > 5) entry.panelLimited = true;
            else if (entry.renderAverage < 3) entry.panelLimited = false;
            entry.frameLimit = overlay && entry.panelLimited ? Math.min(fps || 60, 30) : fps;
            const interval = entry.frameLimit ? 1000 / entry.frameLimit : 0;
            if (entry.lastDraw && now - entry.lastDraw < interval - .5) continue;
            const viewport = `${innerWidth}:${innerHeight}:${devicePixelRatio}`;
            const animated = motion && entry.metadata.capabilities.motion;
            const reactive = playing && config.visualizer && entry.metadata.capabilities.visualizer !== 'none';
            if (reactive) entry.settleUntil = now + 2000;
            if (!animated && !reactive && now >= (entry.settleUntil || 0) && !entry.dirty && entry.viewport === viewport && entry.staticFrame) continue;
            entry.busy = true; entry.sentAt = now;
            const frameDt = entry.lastDraw ? Math.min((now - entry.lastDraw) / 1000, .08) : dt;
            entry.lastDraw = now; entry.viewport = viewport; entry.staticFrame = !animated && !reactive; entry.dirty = false;
            entry.frames = (entry.frames || 0) + 1;
            const settings = entry.settings;
            const audio = { spectrum, sampleRate, playing, frequencyMix: settings.frequencyMix, enabled: entry.metadata.capabilities.visualizer !== 'none' && config.visualizer, intensity: config.intensity };
            entry.frame.contentWindow.postMessage({ sceneChannel: entry.channel, type: 'frame', frame: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, time, dt: frameDt, motion: animated, reducedMotion: reducedMotion.matches, safeArea: safeArea(), parameters: settings, lighting: {intensity:settings.glowIntensity}, audio } }, '*');
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
        if (event.data.type === 'fallback') { entry.fallbackReason = String(event.data.reason).slice(0,240); return; }
        if (event.data.type === 'stage') { entry.stage = String(event.data.stage).slice(0, 120); return; }
        if (event.data.type === 'error') { failure(entry, 'Ошибка интерактивной темы: ' + String(event.data.message).slice(0, 240)); return; }
        if (event.data.type === 'ready') { entry.ready = true; if(Number.isFinite(event.data.decodeMs))entry.decodeMs=event.data.decodeMs; schedule(); }
        if (event.data.type === 'frame') {
            entry.runtime = event.data.runtime || entry.runtime;
            if (Number.isFinite(event.data.renderMs)) {
                entry.renderMs = event.data.renderMs;
                entry.renderAverage = entry.renderAverage == null ? entry.renderMs : entry.renderAverage * .9 + entry.renderMs * .1;
                if (diagnosticsEnabled) {
                    (entry.samples ||= []).push(entry.renderMs); if (entry.samples.length > 240) entry.samples.shift();
                    entry.roundTripMs = Math.max(0, performance.now() - (entry.sentAt || performance.now()));
                    (entry.completions ||= []).push(performance.now()); if(entry.completions.length>240)entry.completions.shift();
                }
            }
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
        get performance() {
            if(!current)return null;
            const samples=[...(current.samples||[])].sort((a,b)=>a-b), completions=current.completions||[];
            return { runtime: current.runtime, fallbackReason: current.fallbackReason || null, decodeMs: current.decodeMs ?? null, renderMs: current.renderMs, frameLimit: current.frameLimit, frames: current.frames || 0,
                ...(diagnosticsEnabled ? { p50: samples[Math.floor(samples.length*.5)] ?? null, p95: samples[Math.min(samples.length-1,Math.floor(samples.length*.95))] ?? null,
                    roundTripMs: current.roundTripMs ?? null, skipped: current.skipped || 0, effectiveFps: completions.length>1 ? (completions.length-1)*1000/(completions.at(-1)-completions[0]) : null } : {}) };
        },
        diagnostics(enabled=true) { diagnosticsEnabled=!!enabled; for(const entry of [current,candidate])if(entry){entry.samples=[];entry.completions=[];entry.skipped=0;} },
        get parameters() { return current ? {...current.settings} : null; },
        setParameter(key, value) {
            if (!current || !Object.hasOwn(current.metadata.parameterSchema || {}, key)) return;
            let stored;try{stored=JSON.parse(appStorage.getItem('setting_scene_preferences')||'{}');}catch(_){}
            if(!stored || typeof stored!=='object' || Array.isArray(stored))stored={};
            const id=current.metadata.packageId;
            stored[id]=preferences(current.metadata,{...preferences(current.metadata),[key]:value});
            appStorage.setItem('setting_scene_preferences',JSON.stringify(stored));this.preferencesChanged();
        },
        get active() { return !!current; },
        get metadata() { return current?.metadata || null; },
        audio(data, rate, isPlaying) {
            if (!current && !candidate) return;
            if (!data || !isPlaying) { if (spectrum.length) spectrum = new Uint8Array(0); playing = false; return; }
            // Keep the original FFT length: changing it changes the Hz/bin mapping.
            // postMessage snapshots synchronously; reuse the analyser's buffer between frames.
            spectrum = data; sampleRate = rate; playing = !!isPlaying;
        },
        async activate(metadata) {
            const request = ++epoch; destroy(candidate); candidate = null;
            const pkg = await noctune.sceneThemes.read(metadata.id);
            if (request !== epoch) throw new Error('Выбор темы отменён');
            metadata = { ...metadata, ...pkg.manifest, id: metadata.id, packageId: pkg.manifest.id, apiVersion: pkg.apiVersion, preview: metadata.preview };
            return new Promise((resolve, reject) => {
                const frame = document.createElement('iframe'); frame.className = 'scene-frame'; frame.setAttribute('sandbox', 'allow-scripts');
                frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1; frame.style.opacity = '0';
                const channel = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
                const entry = { frame, channel, metadata, resolve, reject, ready: false, busy: false };
                candidate = entry;
                refreshConfig();
                frame.srcdoc = html(pkg, channel, { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, time, dt: 0, motion: false, reducedMotion: reducedMotion.matches, safeArea: safeArea(), parameters: entry.settings, lighting:{intensity:entry.settings.glowIntensity}, audio: { spectrum: [], sampleRate, playing: false, enabled: false, intensity: 1 } });
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
                for(const [key,value] of Object.entries(p).slice(0,26))if(/^[a-z][a-zA-Z0-9]{0,47}$/.test(key) && !['constructor','prototype','frequencyMix','glowIntensity'].includes(key) && (typeof value==='boolean' || Number.isFinite(value) || typeof value==='string' && /^[a-zA-Z0-9-]{1,48}$/.test(value)))entry[key]=value;
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
        preferencesChanged() { refreshConfig(); colors(); emit(); },
    };
})();
