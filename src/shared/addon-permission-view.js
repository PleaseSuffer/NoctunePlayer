(function () {
    const notes = {
        interface: (globalThis.noctuneI18n?.t('permissions.interface.description') ?? 'Карточка интеграции, уведомления и команды горячих клавиш. Каждое действие требует указанного ниже права. Сочетания клавиш назначает пользователь.'),
        downloads: (globalThis.noctuneI18n?.t("permissions.downloads.description") ?? "Сохранение аудио, изображений и текстов по заявленным HTTPS-маршрутам или готового текста. Папку выбирает пользователь. Существующие файлы не перезаписываются."),
        servicePlaylists: (globalThis.noctuneI18n?.t("permissions.servicePlaylists.description") ?? "Операции с плейлистами аккаунта на сервере. Сетевые маршруты проверяются отдельно; права самого сервиса также обязательны."),
        credentials: (globalThis.noctuneI18n?.t("permissions.credentials.description") ?? "Только заявленные профили этого расширения. Форма ввода и подстановка ключа работают в плеере; право использования не выдаёт значение коду расширения."),
        appearance: (globalThis.noctuneI18n?.t("permissions.appearance.description") ?? "Режим и семантические цвета интерфейса. Временные изменения снимаются при остановке; сохранение требует отдельного права."),
        ui: (globalThis.noctuneI18n?.t("permissions.integrations.description") ?? "Карточка со штатными настройками во вкладке интеграций, без произвольного HTML и собственных окон."),
        catalog: (globalThis.noctuneI18n?.t("permissions.catalog.description") ?? "Каталог, зарегистрированный этим расширением: альбомы, исполнители, треки и плейлисты."),
        hotkeys: (globalThis.noctuneI18n?.t("permissions.hotkeys.description") ?? "Только собственные объявленные команды. Сочетания назначает пользователь; расширение не получает нажатия клавиш."),
        artwork: (globalThis.noctuneI18n?.t("addonPermissionView.aThumbnailOfTheCurrentArtworkWithoutAFilePath") ?? "Уменьшенная обложка текущего трека без пути к файлу."),
        lyrics: (globalThis.noctuneI18n?.t("permissions.lyrics.description") ?? "Текущий текст или собственный источник текста. Доступ к файлам медиатеки не предоставляется."),
        storage: (globalThis.noctuneI18n?.t("addonPermissionView.accessOnlyToTheExtensionSOwnJsonData") ?? "Доступ только к собственным JSON-данным расширения."),
        settings: (globalThis.noctuneI18n?.t("addonPermissionView.settingsConfiguredByTheUserOnThisExtensionSCard") ?? "Настройки, заданные пользователем в карточке этого расширения."),
        playback: (globalThis.noctuneI18n?.t("addonPermissionView.actionsAffectTheMainNoctunePlayer") ?? "Действия относятся к основному плееру Noctune."),
        events: (globalThis.noctuneI18n?.t("permissions.events.description") ?? "Расширение получает сообщения об изменениях в плеере: например, о смене трека, паузе, перемотке или изменении очереди."),
        themes: (globalThis.noctuneI18n?.t("addonPermissionView.installedThemesTheirParametersAndThePlayerPalette") ?? "Установленные темы, их параметры и палитра плеера."),
        backgrounds: (globalThis.noctuneI18n?.t("addonPermissionView.builtInAndSavedPlayerBackgrounds") ?? "Встроенные и сохранённые фоны плеера."),
        network: (globalThis.noctuneI18n?.t("permissions.network.description") ?? "Только заявленные HTTPS-домены. Запись https://*.example.com разрешает все поддомены example.com, кроме самого example.com. Куки и локальные адреса недоступны; токены передаются только точным доменам профиля."),
        oauth: (globalThis.noctuneI18n?.t("permissions.oauth.description") ?? "Вход только в сервисы, заявленные в manifest; токены остаются в основном процессе."),
        files: (globalThis.noctuneI18n?.t("addonPermissionView.accessThroughUserSelectedFilesOrAuthorizedLibraryTracks") ?? "Доступ через выбранные пользователем файлы или разрешённые треки медиатеки."),
        secrets: (globalThis.noctuneI18n?.t("addonPermissionView.onlyTheExtensionSOwnSecretsThisDoesNotExposeOauthTokens") ?? "Только собственные секреты расширения; OAuth-токены этим доступом не раскрываются."),
        audio: (globalThis.noctuneI18n?.t("addonPermissionView.audioProcessingAndAnalysisInNoctuneSMainAudioGraph") ?? "Обработка и анализ звука в основном аудиографе Noctune."),
    };
    function element(tag, className, text) {
        const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;
    }
    const icons = { downloads:'Download', catalog:'Library',servicePlaylists:'ListMusic',ui:'PanelsTopLeft',credentials:'KeyRound',appearance:'Palette',artwork:'Image',lyrics:'Text',hotkeys:'Keyboard',storage: 'Database', notifications: 'Bell', settings: 'Settings2', playback: 'Music2', events: 'Activity', queue: 'ListMusic', playlists: 'Library', themes: 'Palette', backgrounds: 'Image', audio: 'AudioLines', providers: 'Radio', network: 'Globe', oauth: 'LogIn', secrets: 'KeyRound', files: 'Folder', clipboard: 'Clipboard', system: 'Monitor' };
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
        originLabel: value => value.startsWith('https://*.') ? value + (globalThis.noctuneI18n?.t("addonPermissionView.allSubdomainsExcludingTheBaseDomain", {}) ?? " · все поддомены, кроме основного домена") : value,
        renderNetwork(target, addon) {
            target.replaceChildren();
            const added = new Set(addon.state === 'update' ? addon.addedOrigins || [] : []);
            for (const origin of addon.network?.origins || []) {
                const routes = (addon.network.routes || []).filter(route => route.origin === origin);
                const item = element('li', 'addon-permission-group addon-network-group');
                const details = element('details'), heading = summary(origin, 'Globe');
                details.dataset.origin = origin;
                const title = heading.querySelector('.addon-disclosure-title');
                title.append(element('span', 'addon-network-count', routes.length ? (globalThis.noctuneI18n?.t("addonPermissionView.routes", {p0: (routes.length)}) ?? "Маршрутов: {p0}".replace(/\{(p\d+)\}/g, (_, k) => ({p0: (routes.length)})[k] ?? "{"+k+"}")) : (globalThis.noctuneI18n?.t("addonPermissionView.domainAccess", {}) ?? "Доступ к домену")));
                if (added.has(origin)) {
                    item.classList.add('is-new');
                    title.append(element('span', 'new-label', (globalThis.noctuneI18n?.t("addonPermissionView.newDomain", {}) ?? "Новый домен")));
                }
                const content = element('div', 'permission-group-content');
                if (origin.startsWith('https://*.')) content.append(element('p', 'permission-description', (globalThis.noctuneI18n?.t("addonPermissionView.allSubdomainsExcludingTheBaseDomain.message", {}) ?? "Все поддомены, кроме основного домена.")));
                if (routes.length) {
                    const list = element('ul', 'addon-network-routes');
                    for (const route of routes) {
                        const row = element('li', 'addon-network-route'), methods = element('span', 'addon-network-methods');
                        for (const method of route.methods) methods.append(element('span', 'addon-network-method', method));
                        row.append(methods, element('code', 'addon-network-path', route.path));
                        if (route.prefix) row.append(element('span', 'addon-network-scope', (globalThis.noctuneI18n?.t("addonPermissionView.allPathsStartingWithTheSpecifiedPrefix", {}) ?? "Все пути, начинающиеся с указанного")));
                        if (route.permission) row.append(element('span', 'addon-network-scope', (globalThis.noctuneI18n?.t("addonPermissionView.requiresPermission", {}) ?? "Необходимо право [") + route.permission + ']'));
                        list.append(row);
                    }
                    content.append(list);
                } else content.append(element('p', 'permission-description', addon.network.routes ? (globalThis.noctuneI18n?.t("addonPermissionView.noNetworkRoutesDeclaredForThisDomain", {}) ?? "Сетевые маршруты для этого домена не заявлены.") : (globalThis.noctuneI18n?.t("addonPermissionView.allPathsWithinTheAllowedNetworkAccess", {}) ?? "Все пути в рамках разрешённого доступа к сети.")));
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
                heading.append(title);
                if (!group.displayOnly) heading.append(element('code', '', `[${group.namespace}${group.full ? '.*' : ''}]`));
                summary.append(icon(icons[group.namespace], 'permission-group-icon'), heading);
                const badge = element('span', 'permission-access-badge', group.full ? (globalThis.noctuneI18n?.t("addonPermissionView.fullAccess", {}) ?? "Полный доступ") : (globalThis.noctuneI18n?.t("addonPermissionView.partialAccess", {p0: (group.used.length), p1: (group.total)}) ?? "Частичный доступ · {p0}/{p1}".replace(/\{(p\d+)\}/g, (_, k) => ({p0: (group.used.length), p1: (group.total)})[k] ?? "{"+k+"}")));
                title.append(badge);
                if (group.used.some(key => added.has(key))) { item.classList.add('is-new'); title.append(element('span', 'new-label', (globalThis.noctuneI18n?.t("addonPermissionView.new", {}) ?? "Новое"))); }
                summary.append(icon('ChevronDown', 'addon-disclosure-chevron'));
                details.append(summary);
                const content = element('div', 'permission-group-content');
                const note = notes[group.displayOnly ? 'interface' : group.namespace];
                if (note) content.append(element('p', 'permission-description', note));
                const children = element('ul', 'permission-children');
                for (const permission of group.used) {
                    const child = element('li', added.has(permission) ? 'is-new' : '');
                    child.append(element('span', '', AddonPermissions.labels[permission]), element('code', '', `[${permission}]`));
                    if (added.has(permission)) child.append(element('span', 'new-label', (globalThis.noctuneI18n?.t("addonPermissionView.new", {}) ?? "Новое")));
                    children.append(child);
                }
                content.append(children); details.append(content); item.append(details); target.append(item);
            }
        },
    };
})();
