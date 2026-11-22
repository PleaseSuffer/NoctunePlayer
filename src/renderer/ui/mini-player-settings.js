(() => {
    let container = document.getElementById('mini-player-settings');
    if (!container || !noctune.miniPlayer) return;
    const controls = new Map();
    let settings, pending = Promise.resolve();
    const element = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; };
    function row(title, description) {
        const row = element('div', 'settings-row');
        const text = element('div'); text.append(element('div', 'settings-row-label', title));
        if (description) text.append(element('div', 'settings-row-desc', description));
        row.append(text); container.append(row); return row;
    }
    function save(key, value) {
        const status = document.getElementById('mini-player-settings-status');
        pending = pending.then(async () => {
            try { render(await noctune.miniPlayer.setSettings({ [key]: value })); status.textContent = ''; }
            catch (_) { status.textContent = (globalThis.noctuneI18n?.t("ui.miniPlayerSettings.couldNotSaveMiniPlayerSetting", {}) ?? "Не удалось сохранить настройку мини-плеера."); if (settings) render(settings); }
        });
        return pending;
    }
    function toggle(key, title, description) {
        const r = row(title, description), label = element('label', 'toggle-switch'), input = element('input');
        input.type = 'checkbox'; input.id = 'mini-setting-' + key; input.setAttribute('aria-label', title); input.disabled = true;
        label.append(input, element('span', 'slider-round')); r.append(label);
        controls.set(key, value => { input.checked = value; input.disabled = false; });
        input.addEventListener('change', () => save(key, input.checked));
    }
    function select(key, title, choices, description) {
        const r = row(title, description), wrapper = element('div', 'viz-type-dropdown-wrapper mini-settings-dropdown');
        const button = element('button', 'viz-type-dropdown-btn'), label = element('span', 'pd-label');
        button.type = 'button'; button.id = 'mini-setting-' + key;
        button.setAttribute('aria-label', title); button.setAttribute('aria-haspopup', 'listbox'); button.setAttribute('aria-expanded', 'false');
        const arrow = element('span', 'pd-chevron'); arrow.innerHTML = '<i data-lucide="chevron-down" style="width:14px;height:14px"></i>';
        button.append(label, arrow); button.disabled = true;
        const menu = element('div', 'viz-type-dropdown-menu'); menu.id = 'mini-setting-menu-' + key;
        menu.setAttribute('role', 'listbox'); menu.setAttribute('aria-label', title); button.setAttribute('aria-controls', menu.id);
        const options = choices.map(([value, text]) => {
            const option = element('button', 'viz-type-menu-item', text); option.type = 'button'; option.dataset.value = value; option.setAttribute('role', 'option');
            option.addEventListener('click', () => { save(key, value); open(false); button.focus(); }); menu.append(option); return option;
        });
        function open(value) { menu.classList.toggle('open', value); button.classList.toggle('open', value); button.setAttribute('aria-expanded', String(value)); }
        button.addEventListener('click', () => open(!menu.classList.contains('open')));
        wrapper.addEventListener('focusout', event => { if (!wrapper.contains(event.relatedTarget)) open(false); });
        document.addEventListener('click', event => { if (!wrapper.contains(event.target)) open(false); });
        wrapper.addEventListener('keydown', event => {
            if (event.key === 'Escape') { open(false); button.focus(); event.preventDefault(); }
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault(); open(true);
                const index = options.indexOf(document.activeElement);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
                options[next].focus();
            }
        });
        controls.set(key, value => {
            label.textContent = choices.find(choice => choice[0] === value)?.[1] || '';
            button.disabled = false;
            options.forEach(option => { const on = option.dataset.value === value; option.classList.toggle('active', on); option.setAttribute('aria-selected', String(on)); });
        });
        wrapper.append(button, menu); r.append(wrapper);
    }
    function range(key, title, min, max, unit, description) {
        const r = row(title, description), wrapper = element('div', 'mini-settings-range'), input = element('input'), output = element('output');
        input.type = 'range'; input.id = 'mini-setting-' + key; input.min = min; input.max = max; input.step = 1; input.setAttribute('aria-label', title); input.disabled = true;
        output.htmlFor = input.id;
        input.title = (globalThis.noctuneI18n?.t("ui.miniPlayerSettings.rightClickToResetToDefault", {}) ?? "ПКМ — сбросить по умолчанию");
        // Null lets normalizeSettings use the authoritative defaults in the main process.
        input.addEventListener('contextmenu', async event => {
            event.preventDefault();
            await save(key, null);
            if (settings) input.value = settings[key];
        });
        controls.set(key, value => { if (document.activeElement !== input) input.value = value; output.textContent = value + unit; input.disabled = false; });
        input.addEventListener('input', () => { output.textContent = input.value + unit; });
        input.addEventListener('change', () => save(key, Number(input.value)));
        wrapper.append(input, output); r.append(wrapper);
    }
    toggle('enabled', (globalThis.noctuneI18n?.t("ui.miniPlayerSettings.separateMiniPlayerWindow", {}) ?? "Отдельное окно мини-плеера"), (globalThis.noctuneI18n?.t("ui.miniPlayerSettings.aCompactWindowForTheMinimizedApplicationTheEmbeddedMiniPlayerWorksIndependently", {}) ?? "Компактное окно для свёрнутого приложения. Встроенный мини-плеер внутри приложения работает отдельно."));
    toggle('onMinimize', (globalThis.noctuneI18n?.t("ui.miniPlayerSettings.showWhenMinimizingApplication", {}) ?? "Показывать при сворачивании приложения"));
    toggle('onTrayHover', (globalThis.noctuneI18n?.t("ui.miniPlayerSettings.showWhenHoveringOverTrayIcon", {}) ?? "Показывать при наведении на значок в трее"), (globalThis.noctuneI18n?.t("ui.miniPlayerSettings.whenTheMainWindowIsHiddenOrMinimized", {}) ?? "Когда основное окно скрыто или свёрнуто."));
    select('onMainClose', (globalThis.noctuneI18n?.t("ui.miniPlayerSettings.whenClosingMainWindow", {}) ?? "При закрытии основного окна"), [['playing', (globalThis.noctuneI18n?.t("ui.miniPlayerSettings.miniPlayerIfMusicIsPlaying", {}) ?? "Мини-плеер, если играет музыка")], ['always', (globalThis.noctuneI18n?.t("ui.miniPlayerSettings.alwaysOpenMiniPlayer", {}) ?? "Всегда открывать мини-плеер")], ['default', (globalThis.noctuneI18n?.t("ui.miniPlayerSettings.normalApplicationBehavior", {}) ?? "Обычное поведение приложения")]]);
    toggle('hideOnRestore', (globalThis.noctuneI18n?.t("ui.miniPlayerSettings.hideWhenRestoringApplication", {}) ?? "Скрывать при разворачивании приложения"));
    select('onClose', (globalThis.noctuneI18n?.t("ui.miniPlayerSettings.whenClosingMiniPlayer", {}) ?? "При закрытии мини-плеера"), [['restore', (globalThis.noctuneI18n?.t("ui.miniPlayerSettings.restoreMainPlayer", {}) ?? "Развернуть основной плеер")], ['quit', (globalThis.noctuneI18n?.t("ui.miniPlayerSettings.quitPlayer", {}) ?? "Закрыть плеер")], ['hide', (globalThis.noctuneI18n?.t("miniPlayer.hideMiniPlayer", {}) ?? "Скрыть мини-плеер")]]);
    select('onTop', (globalThis.noctuneI18n?.t("ui.miniPlayerSettings.aboveOtherWindows", {}) ?? "Поверх других окон"), [['always', (globalThis.noctuneI18n?.t("settings.appearance.always", {}) ?? "Всегда")], ['playing', (globalThis.noctuneI18n?.t("ui.miniPlayerSettings.duringPlayback", {}) ?? "Во время воспроизведения")], ['never', (globalThis.noctuneI18n?.t("ui.addonSettings.disabled", {}) ?? "Выключено")]]);
    toggle('rememberPosition', (globalThis.noctuneI18n?.t("ui.miniPlayerSettings.rememberWindowPosition", {}) ?? "Запоминать положение окна"));
    toggle('snap', (globalThis.noctuneI18n?.t("ui.miniPlayerSettings.snapToScreenEdges", {}) ?? "Привязывать к краям экрана"), (globalThis.noctuneI18n?.t("ui.miniPlayerSettings.theWindowSnapsWhenNearAnEdgeMoveItFartherFromTheEdgeToDetach", {}) ?? "Окно прилипает при приближении к краю. Чтобы оторвать его, отведите дальше от края."));
    toggle('locked', (globalThis.noctuneI18n?.t("ui.miniPlayerSettings.lockPositionAndSize", {}) ?? "Закрепить положение и размер"), (globalThis.noctuneI18n?.t("ui.miniPlayerSettings.disableMovingAndResizingWithTheMouse", {}) ?? "Отключает перемещение и изменение размера мышью."));
    container = document.getElementById('mini-player-appearance-settings');
    toggle('hoverControls', (globalThis.noctuneI18n?.t("ui.miniPlayerSettings.showControlsOnHover") ?? "Показывать кнопки при наведении"), (globalThis.noctuneI18n?.t("ui.miniPlayerSettings.showTitleAndArtistNormallyShowPlaybackControlsOnHover") ?? "Без наведения видны название и исполнитель; при наведении — управление воспроизведением."));
    toggle('cover', (globalThis.noctuneI18n?.t("ui.miniPlayerSettings.showArtwork") ?? "Показывать обложку"));
    toggle('progress', (globalThis.noctuneI18n?.t("ui.miniPlayerSettings.showProgressAndTime") ?? "Показывать прогресс и время"));
    range('width', (globalThis.noctuneI18n?.t("ui.miniPlayerSettings.width") ?? "Ширина"), 300, 900, ' px');
    range('height', (globalThis.noctuneI18n?.t("ui.miniPlayerSettings.height") ?? "Высота"), 64, 220, ' px');
    range('fontSize', (globalThis.noctuneI18n?.t("settings.appearance.textSize") ?? "Размер текста"), 10, 20, ' px');
    range('opacity', (globalThis.noctuneI18n?.t("ui.miniPlayerSettings.opacity") ?? "Непрозрачность"), 30, 100, '%', (globalThis.noctuneI18n?.t("miniPlayer.opacity.description") ?? "При наведении окно становится полностью непрозрачным. Когда курсор уходит, возвращается выбранное значение."));
    select('colorMode', (globalThis.noctuneI18n?.t("ui.miniPlayerSettings.miniPlayerColor") ?? "Цвет мини-плеера"), [['custom', (globalThis.noctuneI18n?.t("settings.appearance.effects.customColor") ?? "Свой цвет")], ['accent', (globalThis.noctuneI18n?.t("settings.appearance.accent") ?? "От акцента")], ['theme', (globalThis.noctuneI18n?.t("settings.appearance.theme") ?? "От темы")]]);
    const colorRow = row((globalThis.noctuneI18n?.t("settings.appearance.effects.customColor") ?? "Свой цвет")), colorInput = element('input', 'mini-settings-color');
    colorInput.type = 'color'; colorInput.id = 'mini-setting-customColor'; colorInput.setAttribute('aria-label', (globalThis.noctuneI18n?.t("ui.miniPlayerSettings.customMiniPlayerColor") ?? "Свой цвет мини-плеера"));
    colorInput.addEventListener('input', () => save('customColor', colorInput.value));
    colorRow.append(colorInput);
    controls.set('customColor', value => { colorInput.value = value; });
    const actions = row((globalThis.noctuneI18n?.t("ui.miniPlayerSettings.preview", {}) ?? "Предпросмотр"), (globalThis.noctuneI18n?.t("ui.miniPlayerSettings.settingsApplyImmediatelyDragTheWindowByItsTitleArtworkOrTopEdge", {}) ?? "Настройки применяются сразу. Окно можно перетаскивать за название, обложку или верхний край."));
    const preview = element('button', 'btn', (globalThis.noctuneI18n?.t("ui.miniPlayerSettings.preview", {}) ?? "Предпросмотр")); preview.type = 'button'; preview.id = 'mini-player-preview'; preview.disabled = true;
    preview.addEventListener('click', () => window.floatingMiniPlayer.open(false)); actions.append(preview);
    function render(value) {
        settings = value;
        controls.forEach((render, key) => render(value[key]));
        preview.disabled = !value.enabled;
        colorRow.hidden = value.colorMode !== 'custom';
        const section = document.getElementById('mini-player-appearance-section');
        if (section.hidden === value.enabled) {
            section.hidden = !value.enabled;
            document.dispatchEvent(new Event('settings-sections-changed'));
        }
    }
    window.addEventListener('mini-player-settings', event => render(event.detail));
    noctune.miniPlayer.getSettings().then(render).catch(() => { document.getElementById('mini-player-settings-status').textContent = (globalThis.noctuneI18n?.t("ui.miniPlayerSettings.couldNotLoadMiniPlayerSettings", {}) ?? "Не удалось загрузить настройки мини-плеера."); });
    lucide.createIcons();
    document.dispatchEvent(new Event('settings-sections-changed'));
})();
