(function initPerformanceSettings() {
    const fps = document.getElementById('setting-effects-fps');
    const fpsMenu = document.getElementById('effects-fps-menu');
    const fpsLabel = document.getElementById('effects-fps-label');
    const fpsWrapper = document.getElementById('effects-fps-dropdown');
    const options = Array.from(fpsMenu.querySelectorAll('[data-fps]'));
    function updateFpsLabel() {
        for (const option of options) {
            const selected = Number(option.dataset.fps) === window.effectsPerformance.fps;
            option.classList.toggle('active', selected);
            option.setAttribute('aria-selected', String(selected));
            if (selected) fpsLabel.textContent = option.textContent;
        }
    }
    function openFps(open, focus = false) {
        fpsMenu.classList.toggle('open', open);
        fps.classList.toggle('open', open);
        fps.setAttribute('aria-expanded', String(open));
        if (open && focus) (options.find(option => option.classList.contains('active')) || options[0]).focus();
    }
    updateFpsLabel();
    fps.addEventListener('click', () => openFps(!fpsMenu.classList.contains('open')));
    for (const option of options) option.addEventListener('click', () => {
        window.effectsPerformance.setFps(option.dataset.fps);
        updateFpsLabel(); openFps(false); fps.focus();
    });
    document.addEventListener('click', event => { if (!fpsWrapper.contains(event.target)) openFps(false); });
    fpsWrapper.addEventListener('focusout', event => { if (!fpsWrapper.contains(event.relatedTarget)) openFps(false); });
    fpsWrapper.addEventListener('keydown', event => {
        if (event.key === 'Escape') { openFps(false); fps.focus(); event.preventDefault(); }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            if (!fpsMenu.classList.contains('open')) { openFps(true, true); return; }
            const index = options.indexOf(document.activeElement);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
            options[next].focus();
        }
    });
    const toggle = document.getElementById('setting-hardware-acceleration');
    const notice = document.getElementById('hardware-acceleration-notice');
    const status = document.getElementById('hardware-acceleration-status');
    const restart = document.getElementById('hardware-acceleration-restart');
    let enabled = true;
    function showState(state) {
        enabled = state.enabled;
        toggle.checked = enabled;
        notice.hidden = !state.restartRequired;
        restart.hidden = !state.restartRequired;
        status.textContent = state.restartRequired ? 'Настройка сохранена. Применится после перезапуска.' : '';
    }
    function showError(message) { notice.hidden = false; restart.hidden = true; status.textContent = message; }
    noctune.performance.getHardwareAcceleration().then(showState).catch(() => {
        showError('Не удалось загрузить настройку.');
    }).finally(() => { toggle.disabled = false; });
    toggle.addEventListener('change', async () => {
        toggle.disabled = true;
        try { showState(await noctune.performance.setHardwareAcceleration(toggle.checked)); }
        catch (_) { toggle.checked = enabled; showError('Не удалось сохранить настройку.'); }
        finally { toggle.disabled = false; }
    });
    restart.addEventListener('click', async () => {
        restart.disabled = true;
        try { await noctune.performance.restart(); }
        catch (_) { status.textContent = 'Не удалось перезапустить приложение.'; restart.disabled = false; }
    });
})();
