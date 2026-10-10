(function () {
    const defaults = { enabled: false, contours: true, waves: false, highlights: false, sparks: false, ripple: false, chromatic: false, strength: 1 };
    // [minimum, maximum, default, step, label, unit]
    const parameters = {
        contoursStrength: [0, 2, 1, .1, 'Интенсивность', '×'],
        wavesStrength: [0, 2, 1, .1, 'Интенсивность', '×'],
        highlightsStrength: [0, 2, 1, .1, 'Интенсивность', '×'],
        sparksStrength: [0, 2, 1, .1, 'Интенсивность', '×'],
        rippleStrength: [0, 2, 1, .1, 'Интенсивность', '×'],
        chromaticStrength: [0, 2, 1, .1, 'Интенсивность', '×'],
        contoursThreshold: [0, .5, 0, .02, 'Игнорировать тихие моменты', ''],
        contoursGain: [.2, 3, 1.4, .1, 'Яркость свечения', '×'],
        contoursResponse: [0, 100, 40, 1, 'Доля средних и высоких частот', '%'],
        contoursDecay: [60, 800, 180, 10, 'Затухание', ' мс'],
        wavesThreshold: [0, .5, 0, .02, 'Игнорировать тихие моменты', ''],
        wavesLimit: [1, 8, 4, 1, 'Одновременные волны', ''],
        wavesGain: [.2, 3, 1.3, .1, 'Яркость волны', '×'],
        wavesSensitivity: [.5, 3, 1.5, .1, 'Чувствительность к ударам', '×'],
        wavesSpeed: [.15, 1.2, .45, .05, 'Скорость волны', ''],
        wavesWidth: [.02, .2, .07, .01, 'Ширина волны', ''],
        highlightsThreshold: [0, .5, 0, .02, 'Игнорировать тихие моменты', ''],
        highlightsGain: [.2, 3, 1.4, .1, 'Яркость вспышек', '×'],
        highlightsResponse: [0, 100, 75, 1, 'Доля средних и высоких частот', '%'],
        highlightsDecay: [60, 800, 140, 10, 'Затухание', ' мс'],
        sparksThreshold: [0, .5, 0, .02, 'Игнорировать тихие моменты', ''],
        sparksSensitivity: [.5, 3, 1.5, .1, 'Чувствительность к ударам', '×'],
        sparksLimit: [20, 240, 160, 1, 'Одновременные искры', ''],
        sparksCount: [2, 40, 14, 1, 'Искр на удар', ''],
        sparksSize: [6, 40, 20, 1, 'Размер искр', ' px'],
        sparksLifetime: [.3, 2.5, 1, .1, 'Время жизни', ' с'],
        rippleThreshold: [0, .5, 0, .02, 'Игнорировать тихие моменты', ''],
        rippleLimit: [1, 8, 4, 1, 'Одновременная рябь', ''],
        rippleGain: [.2, 3, 1.2, .1, 'Сила искажения', '×'],
        rippleSensitivity: [.5, 3, 1.5, .1, 'Чувствительность к ударам', '×'],
        rippleSpeed: [.15, 1.2, .45, .05, 'Скорость ряби', ''],
        rippleWidth: [.02, .2, .08, .01, 'Ширина ряби', ''],
        chromaticThreshold: [0, .5, 0, .02, 'Игнорировать тихие моменты', ''],
        chromaticDistance: [2, 40, 14, 1, 'Смещение каналов', ' px'],
        chromaticResponse: [0, 100, 65, 1, 'Доля средних и высоких частот', '%'],
        chromaticDecay: [60, 800, 160, 10, 'Затухание', ' мс'],
        chromaticAngle: [-180, 180, 0, 1, 'Направление смещения', '°']
    };
    const parameterDefaults = Object.fromEntries(Object.entries(parameters).map(([key, spec]) => [key, spec[2]]));
    const response = window.createImageAudioResponse();
    const luminousEffects = ['contours', 'waves', 'highlights', 'sparks'];
    const colorModes = { accent: 'От акцента', custom: 'Свой цвет', gradient: 'Градиент темы' };
    const colorDefaults = () => Object.fromEntries(luminousEffects.map(key => [key, { mode: 'accent', custom: '#4a90e2' }]));
    const pulses = Object.fromEntries(['waves', 'sparks', 'ripple'].map(key => [key, window.createImagePulsePool()]));
    const waveUniforms = new Float32Array(32), rippleUniforms = new Float32Array(32);
    const sparkSprites = new Map();
    let reactive = { contours: 0, highlights: 0, chromatic: 0 }, audioPlaying = false;
    const storageKey = 'setting_image_effects';
    const tuningKey = 'setting_bg_mask_tuning';
    const host = document.getElementById('custom-bg-image');
    const section = document.getElementById('image-effects-settings');
    const status = document.getElementById('image-effects-status');
    const dialog = document.getElementById('image-mask-dialog');
    const slider = document.getElementById('image-mask-sensitivity');
    const preview = document.getElementById('image-mask-preview');
    const previewStatus = document.getElementById('image-mask-status');
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    function parse(key) { try { const value = JSON.parse(appStorage.getItem(key) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch (_) { return {}; } }
    let config = { ...defaults, parameters: { ...parameterDefaults }, colors: colorDefaults() }, tuning = parse(tuningKey);
    let file = null, info = null, source = null, base = null, sharp = null, glow = null, worker = null, loading = null;
    let generation = 0, request = 0, preparedRequest = '', prepareTimer = null;
    let gl = null, program = null, textures = [], uniforms = {}, gpuFailed = false;
    let points = [], particles = [], levels = [0, 0, 0], input = [0, 0, 0];
    let sparkPaletteKey = '';
    const waveCanvas = document.createElement('canvas');
    let lastTime = 0, dirty = true, staticImage = false, fallbackLayers = null, channels = null;
    const gpuCanvas = document.createElement('canvas');
    const overlay = document.createElement('canvas');
    gpuCanvas.className = overlay.className = 'image-effect-canvas';
    host.append(gpuCanvas, overlay);
    const ctx = overlay.getContext('2d');
    const hasEffects = () => ['contours','waves','highlights','sparks','ripple','chromatic'].some(key => config[key]);
    const sensitivity = () => Math.max(1, Math.min(100, Number(tuning[file]) || 50));
    const available = () => !!file && staticImage && window.bgImageEnabled && !window.bgImageIsVideo;
    function refreshVisibility() {
        const wasHidden = section.hidden;
        section.hidden = !available();
        if (wasHidden !== section.hidden) document.dispatchEvent(new Event('settings-sections-changed'));
        for (const effect of ['contours','waves','highlights','sparks','ripple','chromatic']) {
            const detail = document.getElementById('image-effects-' + effect + '-details');
            if (detail) detail.hidden = !config[effect];
        }
        document.getElementById('image-effects-controls').hidden = !config.enabled;
        const visible = available() && config.enabled && hasEffects();
        gpuCanvas.hidden = overlay.hidden = !visible;
        if (!available() && dialog.open) dialog.close();
        if (visible) ensureSource();
        dirty = true;
    }
    function applyAppearance(value) {
        config = { ...defaults, parameters: { ...parameterDefaults }, colors: colorDefaults() };
        if (value && typeof value === 'object') for (const key of Object.keys(defaults)) {
            if (key === 'strength') config[key] = Number.isFinite(Number(value[key])) ? Math.max(0.2, Math.min(2, Number(value[key]))) : 1;
            else if (typeof value[key] === 'boolean') config[key] = value[key];
        }
        for (const [key, spec] of Object.entries(parameters)) {
            const saved = value?.parameters?.[key];
            config.parameters[key] = Number.isFinite(Number(saved)) && saved !== null ? Math.max(spec[0], Math.min(spec[1], Number(saved))) : spec[2];
            if (key.endsWith('Limit')) config.parameters[key] = Math.round(config.parameters[key]);
            const element = document.getElementById('image-effects-' + key);
            if (element) element.value = config.parameters[key];
            const label = document.getElementById('image-effects-' + key + '-label');
            if (label) label.textContent = (key.endsWith('Threshold') ? config.parameters[key].toFixed(2) : Number(config.parameters[key].toFixed(2))) + spec[5];
        }
        for (const key of Object.keys(defaults)) {
            const element = document.getElementById('image-effects-' + key);
            if (key === 'strength') element.value = config[key]; else element.checked = config[key];
        }
        for (const key of luminousEffects) {
            const saved = value?.colors?.[key];
            const color = config.colors[key];
            if (saved && Object.hasOwn(colorModes, saved.mode)) color.mode = saved.mode;
            if (/^#[0-9a-f]{6}$/i.test(saved?.custom)) color.custom = saved.custom;
            const root = document.getElementById('image-effects-' + key + '-color');
            root.querySelector('.pd-label').textContent = colorModes[color.mode];
            for (const option of root.querySelectorAll('[role="option"]')) {
                const active = option.dataset.mode === color.mode;
                option.classList.toggle('active', active); option.setAttribute('aria-selected', String(active));
            }
            document.getElementById('image-effects-' + key + '-color-picker').value = color.custom;
            document.getElementById('image-effects-' + key + '-custom-color').hidden = color.mode !== 'custom';
        }
        for (const [key, pool] of Object.entries(pulses)) {
            if (!config.enabled || !config[key]) pool.clear();
            else pool.trim(config.parameters[key + 'Limit']);
        }
        if (!config.enabled || !config.sparks) particles = [];
        else particles.length = Math.min(particles.length, config.parameters.sparksLimit);
        document.getElementById('image-effects-strength-label').textContent = config.strength.toFixed(1);
        appStorage.setItem(storageKey, JSON.stringify(config));
        refreshVisibility();
    }
    for (const key of Object.keys(defaults)) {
        const element = document.getElementById('image-effects-' + key);
        element.addEventListener(key === 'strength' ? 'input' : 'change', () => applyAppearance({ ...config, [key]: key === 'strength' ? Number(element.value) : element.checked }));
    }
    for (const [key, spec] of Object.entries(parameters)) {
        const element = document.getElementById('image-effects-' + key);
        const update = value => applyAppearance({ ...config, parameters: { ...config.parameters, [key]: Number(value) } });
        element.addEventListener('input', () => update(element.value));
        element.addEventListener('contextmenu', event => { event.preventDefault(); update(spec[2]); });
    }
    for (const key of luminousEffects) {
        const root = document.getElementById('image-effects-' + key + '-color');
        const button = root.querySelector('.viz-type-dropdown-btn'), menu = root.querySelector('[role="listbox"]');
        const options = [...menu.querySelectorAll('[role="option"]')];
        function openOptions(open, focus = false) {
            menu.classList.toggle('open', open); button.classList.toggle('open', open);
            button.setAttribute('aria-expanded', String(open));
            if (open && focus) (options.find(option => option.classList.contains('active')) || options[0]).focus();
        }
        function updateColor(value) { applyAppearance({ ...config, colors: { ...config.colors, [key]: { ...config.colors[key], ...value } } }); }
        button.addEventListener('click', () => openOptions(!menu.classList.contains('open')));
        options.forEach(option => option.addEventListener('click', () => { updateColor({ mode: option.dataset.mode }); openOptions(false); button.focus(); }));
        document.getElementById('image-effects-' + key + '-color-picker').addEventListener('input', event => updateColor({ custom: event.target.value }));
        document.addEventListener('click', event => { if (!root.contains(event.target)) openOptions(false); });
        root.addEventListener('focusout', event => { if (!root.contains(event.relatedTarget)) openOptions(false); });
        root.addEventListener('keydown', event => {
            if (['Enter', ' '].includes(event.key) && options.includes(document.activeElement)) { event.preventDefault(); document.activeElement.click(); }
            if (event.key === 'Escape') { openOptions(false); button.focus(); event.preventDefault(); }
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                if (!menu.classList.contains('open')) { openOptions(true, true); return; }
                const index = options.indexOf(document.activeElement);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length-1 : (index+(event.key === 'ArrowDown'?1:-1)+options.length)%options.length;
                options[next].focus();
            }
        });
    }
    const rgb = hex => [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)/255);
    const validColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
    function getPalette() {
        const accent = validColor(getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim(), '#4a90e2');
        const gradient = [window.vizGradColor1, window.vizGradColor2, window.vizGradColor3].map((hex,i)=>rgb(validColor(hex, ['#bb86fc','#4a90e2','#03dac6'][i])));
        const result = { gradient };
        for (const key of luminousEffects) result[key] = config.colors[key].mode === 'gradient' ? gradient : [rgb(config.colors[key].mode === 'custom' ? config.colors[key].custom : accent)];
        return result;
    }
    function paletteColor(colors, position) {
        if (colors.length === 1) return colors[0];
        const progress = Math.max(0,Math.min(1,position))*2, i = Math.min(1,Math.floor(progress));
        return colors[i].map((value,c)=>value+(colors[i+1][c]-value)*(progress-i));
    }
    function sparkSpriteFor(colors, position) {
        const color = paletteColor(colors, Math.round(position*15)/15);
        const hex = '#' + color.map(value=>Math.round(value*255).toString(16).padStart(2,'0')).join('');
        if (!sparkSprites.has(hex)) {
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
            const c = canvas.getContext('2d'), gradient = c.createRadialGradient(16,16,0,16,16,16);
            gradient.addColorStop(0,'#ffffff'); gradient.addColorStop(.2,hex); gradient.addColorStop(1,hex+'00');
            c.fillStyle=gradient; c.fillRect(0,0,32,32); sparkSprites.set(hex,canvas);
        }
        return sparkSprites.get(hex);
    }
    function disposeMasks() {
        sharp?.close(); glow?.close();
        sharp = glow = null; fallbackLayers = null; points = []; particles = [];
    }
    function createWorker() {
        if (worker) return;
        worker = new Worker(new URL('effects/image-mask-worker.js', document.baseURI));
        worker.onerror = () => { status.textContent = previewStatus.textContent = 'Не удалось подготовить маску изображения'; };
        worker.onmessage = event => {
            const message = event.data;
            if (message.type === 'base') {
                if (message.token !== generation) return;
                base = { width: message.width, height: message.height, data: message.data };
                if (info) noctune.backgroundMasks.set({ file, key: info.key, revision: info.revision, ...base }).catch(() => {});
                prepareMask();
            } else if (message.type === 'prepared') {
                if (message.token !== preparedRequest) { message.sharp.close(); message.glow.close(); return; }
                disposeMasks();
                sharp = message.sharp; glow = message.glow; points = message.points;
                if (gl && program) { uploadTexture(1, sharp); uploadTexture(2, glow); }
                status.textContent = gpuFailed ? 'Упрощённая отрисовка эффектов' : '';
                previewStatus.textContent = '';
                drawPreview(); dirty = true;
            } else if (message.type === 'error') status.textContent = previewStatus.textContent = 'Не удалось подготовить маску изображения';
        };
    }
    function prepareMask() {
        if (!base || !worker) return;
        preparedRequest = `${generation}:${++request}`;
        worker.postMessage({ type: 'prepare', token: preparedRequest, sensitivity: sensitivity(), base });
    }
    async function ensureSource() {
        if (source) { if (!sharp && base) { createWorker(); prepareMask(); } return; }
        if (loading || !file || !staticImage) return loading;
        const token = generation, selectedFile = file;
        status.textContent = previewStatus.textContent = 'Подготовка маски…';
        loading = (async () => {
            try {
                const image = new Image();
                image.src = noctune.fs.toFileUrl(selectedFile) + '?mask=' + info.key;
                await image.decode();
                if (token !== generation) return;
                const scale = Math.min(1, 960 / Math.max(image.naturalWidth, image.naturalHeight), Math.sqrt(960 * 540 / (image.naturalWidth * image.naturalHeight)));
                const width = Math.max(1, Math.floor(image.naturalWidth * scale)), height = Math.max(1, Math.floor(image.naturalHeight * scale));
                const bitmap = await createImageBitmap(image, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
                if (token !== generation) { bitmap.close(); return; }
                // Only the analysis bitmap is reduced. The rendered background keeps its detail.
                source = image;
                initGpu(); layout();
                if (gl && program) uploadTexture(0, source);
                createWorker();
                if (info.mask) { base = info.mask; bitmap.close(); prepareMask(); }
                else worker.postMessage({ type: 'analyze', token, bitmap }, [bitmap]);
            } catch (error) {
                if (token === generation) { status.textContent = previewStatus.textContent = 'Не удалось загрузить изображение для эффектов'; console.error('Image effects:', error); }
            } finally { if (token === generation) loading = null; }
        })();
        return loading;
    }
    async function select(selectedFile) {
        const token = ++generation;
        worker?.terminate(); worker = null; clearTimeout(prepareTimer);
        file = selectedFile; info = source = base = loading = channels = null;
        preparedRequest = ''; staticImage = false; disposeMasks();
        ctx.clearRect(0, 0, overlay.width, overlay.height);
        if (gl) gl.clear(gl.COLOR_BUFFER_BIT);
        levels = [0, 0, 0]; input = [0, 0, 0]; audioPlaying = false; response.reset();
        reactive = { contours: 0, highlights: 0, chromatic: 0 };
        for (const pool of Object.values(pulses)) pool.clear();
        refreshVisibility();
        if (!file || window.bgImageIsVideo) return;
        const metadata = await noctune.backgroundMasks.get(file).catch(() => null);
        if (token !== generation) return;
        info = metadata; staticImage = metadata?.staticImage === true;
        refreshVisibility();
    }
    function remove(removedFile) {
        if (!removedFile) return;
        delete tuning[removedFile]; appStorage.setItem(tuningKey, JSON.stringify(tuning));
        noctune.backgroundMasks.remove(removedFile).catch(() => {});
        if (removedFile === file) {
            info = info ? { ...info, revision: -1 } : null;
            if (base) prepareMask();
            slider.value = sensitivity(); document.getElementById('image-mask-sensitivity-label').textContent = `${sensitivity()}%`;
        }
    }
    function setSensitivity(value) {
        if (!file) return;
        tuning[file] = Math.max(1, Math.min(100, Number(value) || 50));
        appStorage.setItem(tuningKey, JSON.stringify(tuning));
        slider.value = sensitivity(); document.getElementById('image-mask-sensitivity-label').textContent = `${sensitivity()}%`;
        clearTimeout(prepareTimer); prepareTimer = setTimeout(prepareMask, 80);
    }
    slider.addEventListener('input', () => setSensitivity(slider.value));
    slider.addEventListener('contextmenu', event => { event.preventDefault(); setSensitivity(50); });
    document.getElementById('image-effects-edit-mask').addEventListener('click', async () => {
        if (!available()) return;
        dialog.showModal(); slider.value = sensitivity(); document.getElementById('image-mask-sensitivity-label').textContent = `${sensitivity()}%`;
        await ensureSource(); drawPreview(); slider.focus();
    });
    document.getElementById('image-mask-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
    function drawPreview() {
        if (!dialog.open || !source || !sharp) return;
        preview.width = sharp.width; preview.height = sharp.height;
        const context = preview.getContext('2d');
        context.drawImage(source, 0, 0, preview.width, preview.height);
        const temporary = document.createElement('canvas'); temporary.width = sharp.width; temporary.height = sharp.height;
        const c = temporary.getContext('2d', { willReadFrequently: true }); c.drawImage(sharp, 0, 0);
        const pixels = c.getImageData(0, 0, temporary.width, temporary.height);
        for (let i = 0; i < pixels.data.length; i += 4) {
            const edge = pixels.data[i], light = pixels.data[i + 1];
            pixels.data[i] = light > edge ? 255 : 0; pixels.data[i + 1] = 220; pixels.data[i + 2] = light > edge ? 70 : 240;
            pixels.data[i + 3] = Math.max(edge, light) * 0.8;
        }
        c.putImageData(pixels, 0, 0); context.drawImage(temporary, 0, 0);
    }
    const vertex = 'attribute vec2 position; varying vec2 uv; void main(){uv=position*.5+.5;uv.y=1.-uv.y;gl_Position=vec4(position,0.,1.);}';
    const fragment = `#ifdef GL_FRAGMENT_PRECISION_HIGH
        precision highp float;
        #else
        precision mediump float;
        #endif
        varying vec2 uv; uniform sampler2D image, mask, glowMask;
        uniform vec2 fit, channelShift; uniform vec3 contourColor, waveColor, highlightColor, gradient1, gradient2, gradient3;
        uniform vec4 effects; uniform vec3 gradientModes;
        uniform float strength, energy, lightEnergy, aspect;
        uniform vec4 wave, ripple;
        uniform vec4 wavePulses[8], ripplePulses[8]; uniform int waveCount, rippleCount;
        vec3 palette(vec3 solid, float mode) {
            vec3 ramp=uv.x<.5?mix(gradient1,gradient2,uv.x*2.):mix(gradient2,gradient3,(uv.x-.5)*2.);
            return mix(solid,ramp,mode);
        }
        void main(){
            vec2 p=(uv-.5)*fit+.5;
            if(p.x<0.||p.x>1.||p.y<0.||p.y>1.){gl_FragColor=vec4(0.);return;}
            vec2 delta=(uv-.5)*vec2(aspect,1.);
            float distance=length(delta);
            float waveLight=0.; vec2 displacement=vec2(0.);
            for(int i=0;i<8;i++) {
                if(i<waveCount && effects.y>.5) {
                    float ring=exp(-pow((distance-wavePulses[i].x)/wave.y,2.));
                    waveLight+=ring*wavePulses[i].y*wave.z;
                }
                if(i<rippleCount && effects.w>.5) {
                    float ring=exp(-pow((distance-ripplePulses[i].x)/ripple.y,2.));
                    displacement+=normalize(delta+vec2(.0001))*sin(distance*45.-ripplePulses[i].y*14.)*ring*.016*ripplePulses[i].z*ripple.z*strength;
                }
            }
            displacement=clamp(displacement,vec2(-.045),vec2(.045));
            vec2 warped=clamp(p+displacement*fit,.001,.999);
            vec4 base=texture2D(image,warped);
            base.r=texture2D(image,clamp(warped+channelShift,.001,.999)).r;
            base.b=texture2D(image,clamp(warped-channelShift,.001,.999)).b;
            vec2 detail=texture2D(mask,warped).rg;
            vec2 halo=texture2D(glowMask,warped).rg;
            float edges=(detail.r*.45+halo.r*.9)*effects.x*energy;
            float waves=(detail.r*.45+halo.r*.9)*waveLight;
            float highlights=halo.g*effects.z*lightEnergy*.9;
            vec3 tint=palette(contourColor,gradientModes.x)*edges+palette(waveColor,gradientModes.y)*waves+palette(highlightColor,gradientModes.z)*highlights;
            float total=edges+waves+highlights;
            float light=clamp(total*strength,0.,.85);
            vec3 color=tint/max(total,.0001);
            base.rgb=mix(base.rgb,color,light*.65)+color*light*.25;
            gl_FragColor=vec4(clamp(base.rgb,0.,1.),max(base.a,light));
        }`;
    function initGpu() {
        if (gl || gpuFailed) return;
        try {
            gl = gpuCanvas.getContext('webgl', { alpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
            if (!gl) throw new Error('webgl-unavailable');
            const compile = (type, code) => { const shader = gl.createShader(type); gl.shaderSource(shader, code); gl.compileShader(shader); if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(shader)); return shader; };
            program = gl.createProgram(); const vs = compile(gl.VERTEX_SHADER, vertex), fs = compile(gl.FRAGMENT_SHADER, fragment);
            gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program); gl.deleteShader(vs); gl.deleteShader(fs);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('program: ' + gl.getProgramInfoLog(program));
            gl.useProgram(program);
            uniforms = Object.fromEntries(['image','mask','glowMask','fit','contourColor','waveColor','highlightColor','gradient1','gradient2','gradient3','gradientModes','wavePulses[0]','ripplePulses[0]','waveCount','rippleCount','effects','strength','energy','lightEnergy','aspect','channelShift','wave','ripple'].map(name => [name,gl.getUniformLocation(program,name)]));
            const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
            const position = gl.getAttribLocation(program, 'position'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
            textures = [0,1,2].map(index => { const texture = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + index); gl.bindTexture(gl.TEXTURE_2D, texture); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); gl.uniform1i(uniforms[['image','mask','glowMask'][index]], index); return texture; });
        } catch (error) { console.warn('Image effect GPU fallback:', error.message); gpuFailed = true; program = null; gl = null; }
    }
    function uploadTexture(index, image) {
        const limit = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        if (image.width > limit || image.height > limit) {
            const scale = limit / Math.max(image.width, image.height);
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.floor(image.width * scale)); canvas.height = Math.max(1, Math.floor(image.height * scale));
            const context = canvas.getContext('2d'); context.imageSmoothingQuality = 'high';
            context.drawImage(image, 0, 0, canvas.width, canvas.height); image = canvas;
        }
        gl.activeTexture(gl.TEXTURE0 + index); gl.bindTexture(gl.TEXTURE_2D, textures[index]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    }
    gpuCanvas.addEventListener('webglcontextlost', event => { event.preventDefault(); gl = program = null; gpuFailed = true; dirty = true; status.textContent = 'Упрощённая отрисовка эффектов'; });
    gpuCanvas.addEventListener('webglcontextrestored', () => { gpuFailed = false; gl = null; initGpu(); if (program && source && sharp) { uploadTexture(0, source); uploadTexture(1, sharp); uploadTexture(2, glow); } dirty = true; });
    function layout() {
        const rect = { width:host.clientWidth, height:host.clientHeight };
        const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
        const limit = gl ? gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) : 16384;
        const scale = Math.min(pixelRatio, limit / Math.max(1, rect.width, rect.height));
        const width = Math.max(1, Math.round(rect.width * scale)), height = Math.max(1, Math.floor(rect.height * scale));
        if (overlay.width !== width || overlay.height !== height) { overlay.width = gpuCanvas.width = width; overlay.height = gpuCanvas.height = height; }
        ctx.imageSmoothingQuality = 'high';
        dirty = true;
    }
    window.addEventListener('resize', layout);
    function fitScale() {
        const aspect = overlay.width / overlay.height, imageAspect = source.width / source.height;
        if (window.bgImageFit === 'fill') return [1,1];
        if (window.bgImageFit === 'contain') return aspect > imageAspect ? [aspect / imageAspect,1] : [1,imageAspect / aspect];
        return aspect > imageAspect ? [1,imageAspect / aspect] : [aspect / imageAspect,1];
    }
    function audio(data, sampleRate, playing) {
        input = [0,0,0]; audioPlaying = !!playing;
        if (!data || !playing || !available() || !config.enabled) return;
        const bands = [[20,400],[400,3000],[3000,12000]];
        input = bands.map(([low,high]) => {
            const first = Math.min(data.length - 1, Math.floor(low * data.length / (sampleRate / 2)));
            const last = Math.max(first + 1, Math.min(data.length, Math.ceil(high * data.length / (sampleRate / 2))));
            let sum = 0; for (let i = first; i < last; i++) sum += data[i];
            return sum / (last - first) / 255;
        });
    }
    function tint(bitmap, channel, colors) {
        const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
        const c = canvas.getContext('2d', { willReadFrequently: true }); c.drawImage(bitmap, 0, 0);
        const rgba = c.getImageData(0,0,canvas.width,canvas.height);
        for (let i = 0; i < rgba.data.length; i += 4) { const color = paletteColor(colors,(i/4%canvas.width)/Math.max(1,canvas.width-1)); const alpha = rgba.data[i + channel]; rgba.data[i] = color[0] * 255; rgba.data[i + 1] = color[1] * 255; rgba.data[i + 2] = color[2] * 255; rgba.data[i + 3] = alpha; }
        c.putImageData(rgba,0,0); return canvas;
    }
    function paintFallback(fit, palette, energy, moving, channelShift) {
        const key = JSON.stringify(palette);
        if (!fallbackLayers || fallbackLayers.key !== key) fallbackLayers = { key, edge:tint(sharp,0,palette.contours), halo:tint(glow,0,palette.contours), waves:tint(glow,0,palette.waves), lights:tint(glow,1,palette.highlights) };
        const w = overlay.width / fit[0], h = overlay.height / fit[1], x = (overlay.width - w) / 2, y = (overlay.height - h) / 2;
        if (moving && ((pulses.ripple.items.length > 0 && config.ripple) || (reactive.chromatic > .002 && config.chromatic))) {
            if (config.chromatic && !channels) {
                const original = document.createElement('canvas'); original.width = source.width; original.height = source.height;
                const originalContext = original.getContext('2d', { willReadFrequently: true });
                originalContext.drawImage(source, 0, 0);
                const pixels = originalContext.getImageData(0,0,source.width,source.height);
                channels = [0,1,2].map(channel => {
                    const canvas = document.createElement('canvas'); canvas.width=source.width; canvas.height=source.height;
                    const rgba = new Uint8ClampedArray(pixels.data);
                    for (let i=0;i<rgba.length;i+=4) for (let c=0;c<3;c++) if (c!==channel) rgba[i+c]=0;
                    canvas.getContext('2d').putImageData(new ImageData(rgba,source.width,source.height),0,0);
                    return canvas;
                });
            }
            ctx.save();
            if (config.chromatic) { ctx.fillStyle='#000';ctx.fillRect(x,y,w,h);ctx.globalCompositeOperation='screen'; }
            const images = config.chromatic ? channels : [source];
            for (let channel=0;channel<images.length;channel++) {
                const image = images[channel];
                const direction = config.chromatic ? (channel===0?1:channel===2?-1:0) : 0;
                const shift = direction * channelShift[0] * overlay.width / fit[0];
                const shiftY = direction * channelShift[1] * overlay.height / fit[1];
                if (!config.ripple) ctx.drawImage(image,x+shift,y+shiftY,w,h);
                else {
                    // The CPU fallback uses bounded horizontal strips instead of a per-pixel shader.
                    const strips=60, step=image.height/strips;
                    for(let row=0;row<strips;row++) {
                        const sy=row*step, screenY=y+sy/image.height*h;
                        const distance=Math.abs(screenY-overlay.height/2)/overlay.height;
                        let displacement=0;
                        for(const pulse of pulses.ripple.items) {
                            const ring=Math.exp(-Math.pow((distance-pulse.radius)/config.parameters.rippleWidth,2));
                            displacement+=Math.sin(distance*45-pulse.age*14)*ring*.016*pulse.amplitude*config.parameters.rippleGain*config.parameters.rippleStrength*config.strength;
                        }
                        displacement=Math.max(-.045,Math.min(.045,displacement))*overlay.width;
                        ctx.drawImage(image,0,sy,image.width,step,x+shift+displacement,screenY+shiftY,w,h/strips+1);
                    }
                }
            }
            ctx.restore();
        }
        function layer(image, alpha) { ctx.globalAlpha = Math.min(1, alpha * config.strength); ctx.drawImage(image,x,y,w,h); }
        if (config.contours) { layer(fallbackLayers.edge,energy * .5); layer(fallbackLayers.halo,energy); }
        if (config.highlights) layer(fallbackLayers.lights,reactive.highlights * config.parameters.highlightsGain * config.parameters.highlightsStrength * .9);
        if (config.waves && moving && pulses.waves.items.length) {
            ctx.save();
            // Draw a travelling annular portion of the contour mask on a temporary surface.
            const wave = waveCanvas; if(wave.width!==overlay.width || wave.height!==overlay.height){wave.width=overlay.width;wave.height=overlay.height;}
            const c = wave.getContext('2d');c.clearRect(0,0,wave.width,wave.height);c.globalCompositeOperation='source-over';
            for (const pulse of pulses.waves.items) {
                c.globalAlpha=pulse.amplitude; c.beginPath(); c.arc(wave.width/2,wave.height/2,pulse.radius*wave.height,0,Math.PI*2);
                c.lineWidth=wave.height*config.parameters.wavesWidth*2; c.strokeStyle='#fff'; c.stroke();
            }
            c.globalAlpha=1; c.globalCompositeOperation='source-in'; c.drawImage(fallbackLayers.waves,x,y,w,h);
            ctx.globalAlpha=Math.min(1,config.strength*config.parameters.wavesGain*config.parameters.wavesStrength); ctx.drawImage(wave,0,0); ctx.restore();
        }
        ctx.globalAlpha = 1;
    }
    function frame(now) {
        window.requestEffectsFrame(frame);
        const dt = Math.min(.1, Math.max(0,(now-lastTime)/1000)); lastTime = now;
        if (window._rafSuspended || !available() || !config.enabled || !hasEffects() || !source || !sharp) return;
        const playing = audioPlaying && (typeof isPlaying === 'undefined' || isPlaying);
        const bands = response.sample(playing ? input : [0,0,0], dt);
        for (let i=0;i<3;i++) levels[i] = bands[i].response;
        const mixed = (key, field) => {
            const weight = config.parameters[key + 'Response'] / 100;
            return bands[0][field] * (1-weight) + (bands[1][field]*.5 + bands[2][field]*.5) * weight;
        };
        for (const key of Object.keys(reactive)) {
            const target = mixed(key, 'response') * window.imageAudioGate(mixed(key, 'level'), config.parameters[key+'Threshold']);
            const seconds = target > reactive[key] ? .025 : config.parameters[key + 'Decay'] / 1000;
            reactive[key] += (target-reactive[key]) * (1-Math.exp(-dt/seconds));
        }
        const energy = reactive.contours * config.parameters.contoursGain * config.parameters.contoursStrength;
        const onset = bands[0].transient*.45 + bands[1].transient*.35 + bands[2].transient*.2;
        const loudness = bands[0].level*.45 + bands[1].level*.35 + bands[2].level*.2;
        const moving = !reducedMotion.matches;
        for (const [key, pool] of Object.entries(pulses)) {
            pool.advance(dt, config.parameters[key+'Speed'] || 1);
            if (config[key] && moving && playing && onset * window.imageAudioGate(loudness, config.parameters[key+'Threshold']) > .65/config.parameters[key+'Sensitivity'] && pool.cooldown === 0) {
                pool.cooldown = .24;
                if (key !== 'sparks') pool.spawn(config.parameters[key+'Limit']);
                else if (points.length) for (let i=0;i<Math.round(config.parameters.sparksCount*config.strength*config.parameters.sparksStrength) && particles.length<config.parameters.sparksLimit;i++) {
                    const p=points[Math.floor(Math.random()*points.length)];
                    particles.push({ x:p[0], y:p[1], vx:(Math.random()-.5)*.08, vy:-.03-Math.random()*.05, life:config.parameters.sparksLifetime, duration:config.parameters.sparksLifetime });
                }
            }
        }
        if (!dirty && Math.max(...Object.values(reactive))<.002 && !pulses.waves.items.length && !pulses.ripple.items.length && !particles.length) return;
        dirty = false;
        const fit = fitScale();
        const angle = config.parameters.chromaticAngle * Math.PI / 180;
        const distance = config.chromatic && moving ? config.parameters.chromaticDistance * reactive.chromatic * config.strength * config.parameters.chromaticStrength : 0;
        // Distances are CSS pixels, independent of the rendering resolution.
        const channelShift = [Math.cos(angle)*distance/Math.max(1,host.clientWidth)*fit[0], Math.sin(angle)*distance/Math.max(1,host.clientHeight)*fit[1]];
        const palette = getPalette();
        ctx.clearRect(0,0,overlay.width,overlay.height);
        if (gl && program) {
            gl.viewport(0,0,gpuCanvas.width,gpuCanvas.height); gl.useProgram(program);
            const uniform = name => uniforms[name];
            gl.uniform2fv(uniform('channelShift'),channelShift);
            gl.uniform4f(uniform('wave'),config.parameters.wavesSpeed,config.parameters.wavesWidth,config.parameters.wavesGain*config.parameters.wavesStrength,0);
            gl.uniform4f(uniform('ripple'),0,config.parameters.rippleWidth,config.parameters.rippleGain*config.parameters.rippleStrength,0);
            waveUniforms.fill(0); rippleUniforms.fill(0);
            pulses.waves.items.forEach((pulse,i)=>waveUniforms.set([pulse.radius,pulse.amplitude,0,0],i*4));
            pulses.ripple.items.forEach((pulse,i)=>rippleUniforms.set([pulse.radius,pulse.age,pulse.amplitude,0],i*4));
            gl.uniform4fv(uniform('wavePulses[0]'),waveUniforms); gl.uniform4fv(uniform('ripplePulses[0]'),rippleUniforms);
            gl.uniform1i(uniform('waveCount'),moving?pulses.waves.items.length:0); gl.uniform1i(uniform('rippleCount'),moving?pulses.ripple.items.length:0);
            gl.uniform3fv(uniform('contourColor'),palette.contours[0]); gl.uniform3fv(uniform('waveColor'),palette.waves[0]); gl.uniform3fv(uniform('highlightColor'),palette.highlights[0]);
            for (let i=0;i<3;i++) gl.uniform3fv(uniform('gradient'+(i+1)),palette.gradient[i]);
            gl.uniform3f(uniform('gradientModes'),+(palette.contours.length>1),+(palette.waves.length>1),+(palette.highlights.length>1));
            gl.uniform2fv(uniform('fit'),fit);
            gl.uniform4f(uniform('effects'),+config.contours,+(config.waves&&moving),+config.highlights,+(config.ripple&&moving));
            for (const [name,value] of Object.entries({ strength:config.strength,energy,lightEnergy:reactive.highlights*config.parameters.highlightsGain*config.parameters.highlightsStrength,aspect:overlay.width/overlay.height })) gl.uniform1f(uniform(name),value);
            gl.drawArrays(gl.TRIANGLES,0,6); gpuCanvas.hidden=false;
        } else { gpuCanvas.hidden=true; paintFallback(fit,palette,energy,moving,channelShift); }
        const sparkKey = JSON.stringify(palette.sparks);
        if (sparkPaletteKey !== sparkKey) { sparkSprites.clear(); sparkPaletteKey = sparkKey; }
        if (!config.sparks || !moving) particles = [];
        for (const p of particles) {
            p.life-=dt; p.x+=p.vx*dt; p.y+=p.vy*dt;
            const x=((p.x-.5)/fit[0]+.5)*overlay.width, y=((p.y-.5)/fit[1]+.5)*overlay.height;
            const sparkStrength = config.strength * config.parameters.sparksStrength;
            ctx.globalAlpha=Math.min(1,Math.max(0,p.life/p.duration)*.85*sparkStrength); const size=config.parameters.sparksSize*(.4+.6*p.life/p.duration)*Math.sqrt(sparkStrength)*overlay.width/Math.max(1,host.clientWidth); ctx.drawImage(sparkSpriteFor(palette.sparks,p.x),x-size/2,y-size/2,size,size);
        }
        particles=particles.filter(p=>p.life>0); ctx.globalAlpha=1;
    }
    window.imageEffects = { select, remove, layout, refreshVisibility, audio, appearance: () => ({ ...config, parameters: { ...config.parameters }, colors: Object.fromEntries(luminousEffects.map(key=>[key,{ ...config.colors[key] }])) }), applyAppearance };
    applyAppearance(parse(storageKey)); layout(); window.requestEffectsFrame(frame);
})();
