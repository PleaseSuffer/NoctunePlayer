/* Noctune Chroma · official Noctune extension · MIT */
NoctuneAddon.define(async api => {
    const presets = {
        aurora: ['#34d399', '#22d3ee', '#818cf8', '#c084fc'],
        sunset: ['#fb7185', '#fb923c', '#facc15', '#c084fc'],
        ocean: ['#2dd4bf', '#38bdf8', '#6366f1', '#22d3ee'],
        neon: ['#f472b6', '#a78bfa', '#38bdf8', '#4ade80'],
    };
    function parsePalette(value) {
        const colors = String(value).trim().split(/[\s,;]+/).filter(Boolean);
        if (colors.length < 2 || colors.length > 12 || colors.some(color => !/^#(?:[a-f\d]{3}|[a-f\d]{6})$/i.test(color))) {
            throw new Error('Укажите от 2 до 12 цветов в формате #RRGGBB или #RGB через запятую.');
        }
        return colors.map(color => color.length === 4 ? '#' + [...color.slice(1)].map(part => part + part).join('') : color.toLowerCase());
    }
    const wrap = value => ((value % 1) + 1) % 1;
    const rgb = color => [1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16) / 255);
    function rainbow(phase) {
        const hue = wrap(phase) * 6, sector = Math.floor(hue), x = 1 - Math.abs(hue % 2 - 1);
        return [[1,x,0],[x,1,0],[0,1,x],[0,x,1],[x,0,1],[1,0,x]][sector];
    }
    function colorAt(phase) {
        let channels;
        if (settings.mode === 'rainbow') {
            const position = settings.direction === 'bounce' ? 1 - Math.abs(2 * wrap(phase) - 1) : phase;
            channels = rainbow(position);
        } else {
            const palette = (settings.mode === 'custom' ? custom : presets[settings.mode]).map(rgb);
            const bounce = settings.direction === 'bounce';
            const position = bounce ? (1 - Math.abs(2 * wrap(phase) - 1)) * (palette.length - 1) : wrap(phase) * palette.length;
            const index = Math.min(Math.floor(position), palette.length - 1);
            let blend = position - index;
            if (settings.easing === 'smooth') blend = blend * blend * (3 - 2 * blend);
            const from = palette[index], to = palette[bounce ? Math.min(index + 1, palette.length - 1) : (index + 1) % palette.length];
            channels = from.map((value, i) => value + (to[i] - value) * blend);
        }
        const max = Math.max(...channels), saturation = settings.saturation / 100, brightness = settings.brightness / 100;
        return '#' + channels.map(value => Math.round((max - (max - value) * saturation) * brightness * 255).toString(16).padStart(2, '0')).join('');
    }

    let settings = await api.settings.get();
    let custom = parsePalette('#ff6b9d, #a78bfa, #38bdf8');
    let phase = 0, lastTime = performance.now(), lastColor, lastError, dirty = true, reportedInvalid = null, lastNotice = -Infinity;
    async function notify(message) {
        const now = performance.now();
        if (now - lastNotice < 3100) return;
        lastNotice = now;
        try { await api.notify(message); } catch (_) { /* Notification throttling must never stop the animation. */ }
    }
    function validatePalette() {
        try { custom = parsePalette(settings.colors); reportedInvalid = null; return null; }
        catch (error) { return error.message; }
    }
    async function reportPaletteError() {
        const message = validatePalette();
        if (message && settings.mode === 'custom' && reportedInvalid !== settings.colors) {
            reportedInvalid = settings.colors;
            await notify(message + ' Используется последняя корректная палитра.');
        }
    }
    function advance(now) {
        // Integrate real elapsed time, not frame count. Parameter edits never restart the cycle.
        if (settings.animated) phase = wrap(phase + Math.max(0, now - lastTime) / (settings.duration * 1000) * (settings.direction === 'reverse' ? -1 : 1));
        lastTime = now;
    }
    api.on('settings.changed', async event => {
        advance(performance.now()); settings = event.values; dirty = true;
        await reportPaletteError();
    });
    api.onCommand('restart-cycle', () => { phase = 0; lastTime = performance.now(); dirty = true; });
    api.onCommand('check-palette', async () => {
        const error = validatePalette();
        await notify(error || `Палитра готова: ${custom.length} цветов. Выберите режим «Свои цвета».`);
    });
    await reportPaletteError();
    async function tick() {
        advance(performance.now());
        const color = settings.animated ? colorAt(phase + settings.offset / 360) : null;
        try {
            if (dirty || color !== lastColor) {
                dirty = false;
                await api.themes.accent({ color });
                lastColor = color; lastError = null;
            }
        } catch (error) {
            // Release a stale layer on a failed update and retry slowly; never enqueue overlapping frames.
            lastColor = undefined; dirty = true;
            try { await api.themes.accent({ color: null }); } catch (_) {}
            if (lastError !== error.message) { lastError = error.message; await notify('Chroma: ' + error.message); }
            setTimeout(tick, 2000); return;
        }
        setTimeout(tick, settings.animated ? 1000 / Number(settings.quality) : 250);
    }
    await tick();
});
