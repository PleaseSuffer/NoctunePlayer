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
            catch (_) { status.textContent = 'Не удалось сохранить настройку мини-плеера.'; if (settings) render(settings); }
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
    function range(key, title, min, max, unit) {
        const r = row(title), wrapper = element('div', 'mini-settings-range'), input = element('input'), output = element('output');
        input.type = 'range'; input.id = 'mini-setting-' + key; input.min = min; input.max = max; input.step = 1; input.setAttribute('aria-label', title); input.disabled = true;
        output.htmlFor = input.id;
        input.title = 'ПКМ — сбросить по умолчанию';
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
    toggle('enabled', 'Отдельное окно мини-плеера', 'Компактное окно для свёрнутого приложения. Встроенный мини-плеер внутри приложения работает отдельно.');
    toggle('onMinimize', 'Показывать при сворачивании приложения');
    toggle('onTrayHover', 'Показывать при наведении на значок в трее', 'Когда основное окно скрыто или свёрнуто.');
    select('onMainClose', 'При закрытии основного окна', [['playing', 'Мини-плеер, если играет музыка'], ['always', 'Всегда открывать мини-плеер'], ['default', 'Обычное поведение приложения']]);
    toggle('hideOnRestore', 'Скрывать при разворачивании приложения');
    select('onClose', 'При закрытии мини-плеера', [['restore', 'Развернуть основной плеер'], ['quit', 'Закрыть плеер'], ['hide', 'Скрыть мини-плеер']]);
    select('onTop', 'Поверх других окон', [['always', 'Всегда'], ['playing', 'Во время воспроизведения'], ['never', 'Выключено']]);
    toggle('rememberPosition', 'Запоминать положение окна');
    toggle('snap', 'Привязывать к краям экрана', 'Окно прилипает при приближении к краю. Чтобы оторвать его, отведите дальше от края.');
    toggle('locked', 'Закрепить положение и размер', 'Отключает перемещение и изменение размера мышью.');
    container = document.getElementById('mini-player-appearance-settings');
    toggle('hoverControls', 'Показывать кнопки при наведении', 'Без наведения видны название и исполнитель; при наведении — управление воспроизведением.');
    toggle('cover', 'Показывать обложку');
    toggle('progress', 'Показывать прогресс и время');
    range('width', 'Ширина', 300, 900, ' px');
    range('height', 'Высота', 64, 220, ' px');
    range('fontSize', 'Размер текста', 10, 20, ' px');
    range('opacity', 'Непрозрачность', 30, 100, '%');
    select('colorMode', 'Цвет мини-плеера', [['custom', 'Свой цвет'], ['accent', 'От акцента'], ['theme', 'От темы']]);
    const colorRow = row('Свой цвет'), colorInput = element('input', 'mini-settings-color');
    colorInput.type = 'color'; colorInput.id = 'mini-setting-customColor'; colorInput.setAttribute('aria-label', 'Свой цвет мини-плеера');
    colorInput.addEventListener('input', () => save('customColor', colorInput.value));
    colorRow.append(colorInput);
    controls.set('customColor', value => { colorInput.value = value; });
    const actions = row('Предпросмотр', 'Настройки применяются сразу. Окно можно перетаскивать за название, обложку или верхний край.');
    const preview = element('button', 'btn', 'Предпросмотр'); preview.type = 'button'; preview.id = 'mini-player-preview'; preview.disabled = true;
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
    noctune.miniPlayer.getSettings().then(render).catch(() => { document.getElementById('mini-player-settings-status').textContent = 'Не удалось загрузить настройки мини-плеера.'; });
    lucide.createIcons();
    document.dispatchEvent(new Event('settings-sections-changed'));
})();
