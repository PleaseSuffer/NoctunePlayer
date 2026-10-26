(() => {
    const $ = id => document.getElementById(id);
    let state = { volume: .8, duration: 0 }, settings = {}, seeking = false;
    const format = seconds => { const s = Math.max(0, Math.floor(seconds || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
    const paintRange = input => input.style.setProperty('--range-progress', ((Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100) + '%');
    function icon(action, name, label) {
        const button = document.querySelector(`[data-action="${action}"]`);
        if (button.dataset.icon !== name) { button.innerHTML = `<i data-lucide="${name}"></i>`; button.dataset.icon = name; lucide.createIcons({ root: button }); }
        button.title = label; button.setAttribute('aria-label', label);
    }
    function renderSettings(value) {
        settings = value;
        document.body.classList.toggle('hover-controls', settings.hoverControls);
        document.body.classList.toggle('no-cover', !settings.cover);
        document.body.classList.toggle('no-progress', !settings.progress);
        document.body.classList.toggle('locked', settings.locked);
        document.body.style.setProperty('--mini-font-size', settings.fontSize + 'px');
        renderColors();
        renderPin();
    }
    function renderColors() {
        document.body.dataset.theme = state.theme || 'dark';
        for (const key of ['--bg-color', '--container-bg', '--text-color', '--text-muted', '--accent-color', '--accent-fg', '--border-color', '--track-hover', '--mini-play-fg']) document.body.style.removeProperty(key);
        for (const [key, color] of Object.entries(window.miniPlayerColors(settings, state.colors || {}))) document.body.style.setProperty(key, color);
    }
    function renderPin() {
        const pin = document.querySelector('[data-action="pin"]');
        const active = state.onTopMode === settings.onTop && state.alwaysOnTop === true;
        pin.classList.toggle('active', active);
        pin.setAttribute('aria-pressed', String(active));
        icon('pin', active ? 'pin' : 'pin-off', settings.onTop === 'playing'
            ? 'Поверх окон во время воспроизведения' : active ? 'Открепить от переднего плана' : 'Закрепить поверх других окон');
    }
    function render(value) {
        state = value;
        renderPin();
        renderColors();
        $('title').textContent = state.title || 'Музыка не выбрана';
        $('artist').textContent = state.artist || 'Noctune';
        $('track-info').title = [state.artist, state.title].filter(Boolean).join(' — ');
        const cover = $('cover');
        if (cover.getAttribute('src') !== state.artwork) { if (state.artwork) cover.src = state.artwork; else cover.removeAttribute('src'); }
        cover.hidden = !state.artwork;
        if (document.activeElement !== $('volume')) $('volume').value = state.muted ? 0 : state.volume;
        if (!seeking) $('seek').value = state.duration > 0 ? state.position / state.duration * 1000 : 0;
        paintRange($('volume')); paintRange($('seek'));
        $('seek').disabled = state.radio || !state.duration;
        $('elapsed').textContent = state.radio ? 'LIVE' : format(state.position);
        $('duration').textContent = state.radio ? '' : format(state.duration);
        icon('playpause', state.playing ? 'pause' : 'play', state.playing ? 'Пауза' : 'Воспроизвести');
        icon('mute', state.muted || state.volume === 0 ? 'volume-x' : 'volume-2', state.muted ? 'Включить звук' : 'Выключить звук');
        const shuffle = document.querySelector('[data-action="shuffle"]');
        shuffle.classList.toggle('active', state.shuffle); shuffle.setAttribute('aria-pressed', String(state.shuffle));
        const repeat = document.querySelector('[data-action="repeat"]');
        repeat.classList.toggle('active', state.repeat > 0);
        icon('repeat', state.repeat === 1 ? 'repeat-1' : 'repeat', ['Повтор выключен', 'Повторять трек', 'Повторять плейлист'][state.repeat]);
    }
    document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => miniPlayer.command(button.dataset.action)));
    $('volume').addEventListener('input', () => { paintRange($('volume')); miniPlayer.command('volume', Number($('volume').value)); });
    $('seek').addEventListener('input', () => { seeking = true; paintRange($('seek')); $('elapsed').textContent = format(Number($('seek').value) / 1000 * state.duration); });
    $('seek').addEventListener('change', () => { miniPlayer.command('seek', Number($('seek').value) / 1000); seeking = false; });
    $('seek').addEventListener('pointercancel', () => { seeking = false; });
    $('track-info').addEventListener('dblclick', () => miniPlayer.command('expand'));
    document.addEventListener('wheel', event => {
        event.preventDefault();
        if (!event.deltaY) return;
        state.volume = Math.max(0, Math.min(1, state.volume + (event.deltaY < 0 ? .05 : -.05)));
        miniPlayer.command('volume', state.volume);
    }, { passive: false });
    document.addEventListener('keydown', event => {
        if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
        const combo = ['ctrl', 'alt', 'shift', 'meta'].filter(key => event[key + 'Key']).concat(event.code).join('+');
        if (state.hotkeyCombos?.includes(combo)) {
            event.preventDefault();
            miniPlayer.command('hotkey', { code: event.code, ctrlKey: event.ctrlKey, altKey: event.altKey, shiftKey: event.shiftKey, metaKey: event.metaKey });
        } else if (event.code === 'Escape') { event.preventDefault(); miniPlayer.command('expand'); }
    });
    miniPlayer.onState(render); miniPlayer.onSettings(renderSettings);
    miniPlayer.getSettings().then(renderSettings).catch(() => {});
    lucide.createIcons();
})();
