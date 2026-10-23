(function () {
    const notes = {
        servicePlaylists: 'Операции с плейлистами аккаунта на сервере. Сетевые маршруты проверяются отдельно; права самого сервиса также обязательны.',
        credentials: 'Только заявленные профили этого расширения. Форма ввода и подстановка ключа работают в плеере; право использования не выдаёт значение коду расширения.',
        appearance: 'Режим и семантические цвета интерфейса. Временные изменения снимаются при остановке; сохранение требует отдельного права.',
        ui: 'Карточка со штатными настройками во вкладке интеграций, без произвольного HTML и собственных окон.',
        catalog: 'Каталог, зарегистрированный этим расширением: альбомы, исполнители, треки и плейлисты.',
        hotkeys: 'Только собственные объявленные команды. Сочетания назначает пользователь; расширение не получает нажатия клавиш.',
        artwork: 'Уменьшенная обложка текущего трека без пути к файлу.',
        lyrics: 'Текущий текст или собственный источник текста. Доступ к файлам медиатеки не предоставляется.',
        storage: 'Доступ только к собственным JSON-данным расширения.',
        settings: 'Настройки, заданные пользователем в карточке этого расширения.',
        playback: 'Действия относятся к основному плееру Noctune.',
        events: 'Расширение получает сообщения об изменениях в плеере: например, о смене трека, паузе, перемотке или изменении очереди.',
        themes: 'Установленные темы, их параметры и палитра плеера.',
        backgrounds: 'Встроенные и сохранённые фоны плеера.',
        network: 'Только заявленные HTTPS-домены. Запись https://*.example.com разрешает все поддомены example.com, кроме самого example.com. Куки и локальные адреса недоступны; токены передаются только точным доменам профиля.',
        oauth: 'Вход только в сервисы, заявленные в manifest; токены остаются в основном процессе.',
        files: 'Доступ через выбранные пользователем файлы или разрешённые треки медиатеки.',
        secrets: 'Только собственные секреты расширения; OAuth-токены этим доступом не раскрываются.',
        audio: 'Обработка и анализ звука в основном аудиографе Noctune.',
    };
    function element(tag, className, text) {
        const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;
    }
    const icons = { catalog:'Library',servicePlaylists:'ListMusic',ui:'PanelsTopLeft',credentials:'KeyRound',appearance:'Palette',artwork:'Image',lyrics:'Text',hotkeys:'Keyboard',storage: 'Database', notifications: 'Bell', settings: 'Settings2', playback: 'Music2', events: 'Activity', queue: 'ListMusic', playlists: 'Library', themes: 'Palette', backgrounds: 'Image', audio: 'AudioLines', providers: 'Radio', network: 'Globe', oauth: 'LogIn', secrets: 'KeyRound', files: 'Folder', clipboard: 'Clipboard', system: 'Monitor' };
    function icon(name, className) {
        const shape = window.lucide?.icons?.[name];
        const node = shape ? window.lucide.createElement(shape, { 'aria-hidden': 'true' }) : element('span');
        node.classList.add(className); return node;
    }
    function summary(title, symbol) {
        const node = element('summary', 'addon-disclosure-summary');
        node.append(icon(symbol, 'addon-disclosure-icon'), element('span', 'addon-disclosure-title', title), icon('ChevronDown', 'addon-disclosure-chevron'));
        return node;
    }
    window.AddonPermissionView = {
        icon, summary,
        originLabel: value => value.startsWith('https://*.') ? value + ' · все поддомены, кроме основного домена' : value,
        renderNetwork(target, addon) {
            target.replaceChildren();
            const added = new Set(addon.state === 'update' ? addon.addedOrigins || [] : []);
            for (const origin of addon.network?.origins || []) {
                const routes = (addon.network.routes || []).filter(route => route.origin === origin);
                const item = element('li', 'addon-permission-group addon-network-group');
                const details = element('details'), heading = summary(origin, 'Globe');
                details.dataset.origin = origin;
                const title = heading.querySelector('.addon-disclosure-title');
                title.append(element('span', 'addon-network-count', routes.length ? `Маршрутов: ${routes.length}` : 'Доступ к домену'));
                if (added.has(origin)) {
                    item.classList.add('is-new');
                    title.append(element('span', 'new-label', 'Новый домен'));
                }
                const content = element('div', 'permission-group-content');
                if (origin.startsWith('https://*.')) content.append(element('p', 'permission-description', 'Все поддомены, кроме основного домена.'));
                if (routes.length) {
                    const list = element('ul', 'addon-network-routes');
                    for (const route of routes) {
                        const row = element('li', 'addon-network-route'), methods = element('span', 'addon-network-methods');
                        for (const method of route.methods) methods.append(element('span', 'addon-network-method', method));
                        row.append(methods, element('code', 'addon-network-path', route.path));
                        if (route.prefix) row.append(element('span', 'addon-network-scope', 'Все пути, начинающиеся с указанного'));
                        if (route.permission) row.append(element('span', 'addon-network-scope', 'Необходимо право [' + route.permission + ']'));
                        list.append(row);
                    }
                    content.append(list);
                } else content.append(element('p', 'permission-description', addon.network.routes ? 'Сетевые маршруты для этого домена не заявлены.' : 'Все пути в рамках разрешённого доступа к сети.'));
                details.append(heading, content); item.append(details); target.append(item);
            }
        },
        render(target, addon) {
            target.replaceChildren();
            const added = new Set(addon.state === 'update' ? AddonPermissions.expand(addon.addedPermissions || []) : []);
            for (const group of AddonPermissions.grouped(addon.permissions, addon.grants)) {
                const item = element('li', 'permission addon-permission-group ' + (group.full ? 'is-full' : 'is-partial'));
                const details = element('details'), summary = element('summary', 'permission-title');
                details.dataset.namespace = group.namespace;
                const heading = element('span', 'permission-group-heading'), title = element('span', 'permission-group-title');
                title.append(element('span', 'permission-group-name', group.title));
                heading.append(title, element('code', '', `[${group.namespace}${group.full ? '.*' : ''}]`));
                summary.append(icon(icons[group.namespace], 'permission-group-icon'), heading);
                const badge = element('span', 'permission-access-badge', group.full ? 'Полный доступ' : `Частичный доступ · ${group.used.length}/${group.total}`);
                title.append(badge);
                if (group.used.some(key => added.has(key))) { item.classList.add('is-new'); title.append(element('span', 'new-label', 'Новое')); }
                summary.append(icon('ChevronDown', 'addon-disclosure-chevron'));
                details.append(summary);
                const content = element('div', 'permission-group-content');
                if (notes[group.namespace]) content.append(element('p', 'permission-description', notes[group.namespace]));
                const children = element('ul', 'permission-children');
                for (const permission of group.used) {
                    const child = element('li', added.has(permission) ? 'is-new' : '');
                    child.append(element('span', '', AddonPermissions.labels[permission]), element('code', '', `[${permission}]`));
                    if (added.has(permission)) child.append(element('span', 'new-label', 'Новое'));
                    children.append(child);
                }
                content.append(children); details.append(content); item.append(details); target.append(item);
            }
        },
    };
})();
