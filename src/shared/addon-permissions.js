(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.AddonPermissions = api;
})(globalThis, function () {
    const labels = {
        'i18n.register': (globalThis.noctuneI18n?.t('language.permission') ?? 'Добавление языковых пакетов интерфейса'),
        'playlists.addTracks': (globalThis.noctuneI18n?.t("addonPermissions.addTracksToALocalPlaylist") ?? "Добавление треков в локальный плейлист"),
        'playlists.removeTracks': (globalThis.noctuneI18n?.t("addonPermissions.removeTrackEntriesFromALocalPlaylist") ?? "Удаление вхождений треков из локального плейлиста"),
        'playlists.reorder': (globalThis.noctuneI18n?.t("addonPermissions.reorderLocalPlaylistTracks") ?? "Изменение порядка треков локального плейлиста"),
        'catalog.register': (globalThis.noctuneI18n?.t("addonPermissions.registerAServiceCatalog") ?? "Регистрация собственного каталога сервиса"),
        'servicePlaylists.read': (globalThis.noctuneI18n?.t("addonPermissions.readServicePlaylists") ?? "Чтение плейлистов сервиса"),
        'servicePlaylists.create': (globalThis.noctuneI18n?.t("addonPermissions.createServerPlaylists") ?? "Создание плейлиста на сервере"),
        'servicePlaylists.rename': (globalThis.noctuneI18n?.t("addonPermissions.renameServerPlaylists") ?? "Переименование плейлиста на сервере"),
        'servicePlaylists.delete': (globalThis.noctuneI18n?.t("addonPermissions.deleteServerPlaylists") ?? "Удаление плейлиста на сервере"),
        'servicePlaylists.addTracks': (globalThis.noctuneI18n?.t("addonPermissions.addServerTracks") ?? "Добавление треков на сервере"),
        'servicePlaylists.removeTracks': (globalThis.noctuneI18n?.t("addonPermissions.removeServerTrackEntries") ?? "Удаление вхождений на сервере"),
        'servicePlaylists.reorder': (globalThis.noctuneI18n?.t("addonPermissions.reorderServerTracks") ?? "Порядок треков на сервере"),
        'ui.integrations': (globalThis.noctuneI18n?.t("addonPermissions.cardInTheIntegrationsTab") ?? "Карточка во вкладке интеграций"),
        'credentials.configure': (globalThis.noctuneI18n?.t("addonPermissions.secureKeyOrTokenEntry") ?? "Защищённый ввод ключа или токена"),
        'credentials.status': (globalThis.noctuneI18n?.t("addonPermissions.readTheExtensionSOwnAuthorizationStatus") ?? "Статус собственного профиля авторизации"),
        'credentials.use': (globalThis.noctuneI18n?.t("addonPermissions.useAKeyInTheNetworkBroker") ?? "Использование ключа в сетевом брокере"),
        'credentials.disconnect': (globalThis.noctuneI18n?.t("addonPermissions.removeTheExtensionSOwnAuthorizationProfile") ?? "Удаление собственного профиля авторизации"),
        'appearance.read': (globalThis.noctuneI18n?.t("addonPermissions.readInterfaceModeAndColors") ?? "Чтение режима и цветов интерфейса"),
        'appearance.list': (globalThis.noctuneI18n?.t("addonPermissions.listAvailableColorSchemes") ?? "Список доступных цветовых схем"),
        'appearance.select': (globalThis.noctuneI18n?.t("addonPermissions.selectABuiltInSchemeOrAnotherExtensionSScheme") ?? "Выбор встроенной схемы или схемы другого расширения"),
        'appearance.mode': (globalThis.noctuneI18n?.t("addonPermissions.temporaryLightDarkOrSystemMode") ?? "Временный светлый, тёмный или системный режим"),
        'appearance.palette': (globalThis.noctuneI18n?.t("addonPermissions.temporaryInterfaceColors") ?? "Временные цвета интерфейса"),
        'appearance.register': (globalThis.noctuneI18n?.t("addonPermissions.registerColorSchemes") ?? "Регистрация собственных цветовых схем"),
        'appearance.switch': (globalThis.noctuneI18n?.t("addonPermissions.selectTheExtensionSOwnScheme") ?? "Выбор своей цветовой схемы"),
        'appearance.persist': (globalThis.noctuneI18n?.t("addonPermissions.saveAppearanceInUserSettings") ?? "Сохранение оформления в настройках пользователя"),
        'appearance.events': (globalThis.noctuneI18n?.t("addonPermissions.appearanceChangeEvents") ?? "События изменения оформления"),
        'playback.shuffle': (globalThis.noctuneI18n?.t("addonPermissions.shuffleTracks") ?? "Перемешивание треков"),
        'playback.repeat': (globalThis.noctuneI18n?.t("addonPermissions.repeatMode") ?? "Режим повтора"),
        'artwork.read': (globalThis.noctuneI18n?.t("addonPermissions.currentArtworkThumbnail") ?? "Миниатюра текущей обложки"),
        'artwork.provide': (globalThis.noctuneI18n?.t("addonPermissions.findArtworkUsingTrackMetadata") ?? "Подбор обложек по метаданным трека"),
        'lyrics.read': (globalThis.noctuneI18n?.t("addonPermissions.readCurrentLyrics") ?? "Чтение текущего текста песни"),
        'lyrics.provide': (globalThis.noctuneI18n?.t("addonPermissions.registerALyricsSource") ?? "Регистрация собственного источника текста"),
        'hotkeys.register': (globalThis.noctuneI18n?.t("addonPermissions.registerHotkeyActions") ?? "Регистрация действий для горячих клавиш"),
        'storage.read': (globalThis.noctuneI18n?.t("addonPermissions.readOwnData") ?? "Чтение собственных данных"), 'storage.write': (globalThis.noctuneI18n?.t("addonPermissions.modifyOwnData") ?? "Изменение собственных данных"),
        'notifications.show': (globalThis.noctuneI18n?.t("addonPermissions.showNotifications") ?? "Показ уведомлений"), 'settings.read': (globalThis.noctuneI18n?.t("addonPermissions.readExtensionSettings") ?? "Чтение настроек расширения"), 'settings.events': (globalThis.noctuneI18n?.t("addonPermissions.settingsChangeEvents") ?? "События изменения настроек"),
        'playback.read': (globalThis.noctuneI18n?.t("addonPermissions.currentTrackInformation") ?? "Информация о текущем треке"), 'playback.play': (globalThis.noctuneI18n?.t("addonPermissions.startPlayback") ?? "Начало воспроизведения"), 'playback.pause': (globalThis.noctuneI18n?.t("index.pause") ?? "Пауза"),
        'playback.stop': (globalThis.noctuneI18n?.t("addonPermissions.stop") ?? "Остановка"), 'playback.seek': (globalThis.noctuneI18n?.t("addonPermissions.seek") ?? "Перемотка"), 'playback.next': (globalThis.noctuneI18n?.t("miniPlayer.nextTrack") ?? "Следующий трек"), 'playback.previous': (globalThis.noctuneI18n?.t("miniPlayer.previousTrack") ?? "Предыдущий трек"),
        'playback.volume': (globalThis.noctuneI18n?.t("addonPermissions.volumeAndMute") ?? "Громкость и отключение звука"), 'playback.speed': (globalThis.noctuneI18n?.t("player.interface.playbackSpeed") ?? "Скорость воспроизведения"),
        'events.track': (globalThis.noctuneI18n?.t("addonPermissions.trackAndMetadataChanges") ?? "Смена трека и метаданных"), 'events.playback': (globalThis.noctuneI18n?.t("addonPermissions.playbackStateAndErrors") ?? "Состояние и ошибки воспроизведения"), 'events.progress': (globalThis.noctuneI18n?.t("addonPermissions.progressAndSeeking") ?? "Прогресс и перемотка"),
        'events.queue': (globalThis.noctuneI18n?.t("addonPermissions.queueChanges") ?? "Изменения очереди"), 'events.playlists': (globalThis.noctuneI18n?.t("addonPermissions.playlistChanges") ?? "Изменения плейлистов"),
        'queue.read': (globalThis.noctuneI18n?.t("addonPermissions.readQueue") ?? "Чтение очереди"), 'queue.add': (globalThis.noctuneI18n?.t("addonPermissions.addToQueue") ?? "Добавление в очередь"), 'queue.remove': (globalThis.noctuneI18n?.t("addonPermissions.removeFromQueue") ?? "Удаление из очереди"), 'queue.reorder': (globalThis.noctuneI18n?.t("addonPermissions.reorderQueue") ?? "Порядок очереди"),
        'playlists.read': (globalThis.noctuneI18n?.t("addonPermissions.readPlaylistsAndTracks") ?? "Чтение плейлистов и треков"), 'playlists.create': (globalThis.noctuneI18n?.t("addonPermissions.createPlaylists") ?? "Создание плейлистов"), 'playlists.rename': (globalThis.noctuneI18n?.t("addonPermissions.renamePlaylists") ?? "Переименование плейлистов"),
        'playlists.delete': (globalThis.noctuneI18n?.t("addonPermissions.deletePlaylists") ?? "Удаление плейлистов"), 'playlists.edit': (globalThis.noctuneI18n?.t("addonPermissions.editPlaylistTracks") ?? "Редактирование треков плейлиста"), 'playlists.select': (globalThis.noctuneI18n?.t("addonPermissions.selectPlaylist") ?? "Выбор плейлиста"),
        'themes.list': (globalThis.noctuneI18n?.t("addonPermissions.listInstalledThemes") ?? "Список установленных тем"), 'themes.switch': (globalThis.noctuneI18n?.t("addonPermissions.enableAndSwitchThemes") ?? "Включение и переключение темы"), 'themes.apply': (globalThis.noctuneI18n?.t("addonPermissions.themeParametersAndPalette") ?? "Параметры и палитра темы"), 'themes.events': (globalThis.noctuneI18n?.t("addonPermissions.themeChangeEvents") ?? "События изменения темы"), 'themes.accent': (globalThis.noctuneI18n?.t("addonPermissions.temporaryAccentOverrideRestoredWhenDisabled") ?? "Временная замена цвета акцента; восстановление при отключении"),
        'backgrounds.list': (globalThis.noctuneI18n?.t("addonPermissions.listSavedBackgrounds") ?? "Список сохранённых фонов"), 'backgrounds.switch': (globalThis.noctuneI18n?.t("addonPermissions.switchBackground") ?? "Переключение фона"), 'backgrounds.apply': (globalThis.noctuneI18n?.t("addonPermissions.backgroundSettings") ?? "Настройки фона"), 'backgrounds.events': (globalThis.noctuneI18n?.t("addonPermissions.backgroundChangeEvents") ?? "События изменения фона"),
        'backgrounds.override': (globalThis.noctuneI18n?.t("addonPermissions.temporaryWallpaperOverrideRestoredWhenDisabled") ?? "Временная замена обоев с восстановлением при отключении"),
        'audio.gain': (globalThis.noctuneI18n?.t("addonPermissions.ownTemporaryGainLevelAndFadeOut") ?? "Собственный временный уровень усиления и плавное затихание"),
        'audio.analyse': (globalThis.noctuneI18n?.t("addonPermissions.audioSpectrum") ?? "Спектр аудио"), 'audio.pcm': (globalThis.noctuneI18n?.t("addonPermissions.currentAudioSamples") ?? "Сэмплы текущего аудио"), 'audio.equalizer': (globalThis.noctuneI18n?.t("addonPermissions.controlEqualizer") ?? "Управление эквалайзером"), 'audio.effects': (globalThis.noctuneI18n?.t("addonPermissions.ownAudioEffectsChain") ?? "Собственная цепочка аудиоэффектов"),
        'providers.register': (globalThis.noctuneI18n?.t("addonPermissions.registerMusicProvider") ?? "Регистрация музыкального провайдера"), 'providers.play': (globalThis.noctuneI18n?.t("addonPermissions.playProviderStream") ?? "Воспроизведение потока провайдера"),
        'network.request': (globalThis.noctuneI18n?.t("addonPermissions.httpsRequestsToDeclaredDomains") ?? "HTTPS-запросы к заявленным доменам"), 'network.headers': (globalThis.noctuneI18n?.t("addonPermissions.additionalRequestHeaders") ?? "Дополнительные заголовки запросов"),
        'oauth.authorize': (globalThis.noctuneI18n?.t("addonPermissions.signInToDeclaredServices") ?? "Вход в заявленные сервисы"), 'oauth.status': (globalThis.noctuneI18n?.t("addonPermissions.authorizationStatus") ?? "Статус авторизации"), 'oauth.disconnect': (globalThis.noctuneI18n?.t("addonPermissions.signOutOfService") ?? "Выход из сервиса"),
        'secrets.read': (globalThis.noctuneI18n?.t("addonPermissions.readOwnSecrets") ?? "Чтение собственных секретов"), 'secrets.write': (globalThis.noctuneI18n?.t("addonPermissions.saveOwnSecrets") ?? "Сохранение собственных секретов"), 'secrets.delete': (globalThis.noctuneI18n?.t("addonPermissions.deleteOwnSecrets") ?? "Удаление собственных секретов"),
        'downloads.write': (globalThis.noctuneI18n?.t("permissions.downloads.write") ?? "Сохранение MP3 в папку приложения, загрузок или выбранную папку"),
        'files.select': (globalThis.noctuneI18n?.t("addonPermissions.userFileSelection") ?? "Выбор файлов пользователем"), 'files.read': (globalThis.noctuneI18n?.t("addonPermissions.readAuthorizedFiles") ?? "Чтение разрешённых файлов"), 'files.write': (globalThis.noctuneI18n?.t("addonPermissions.writeSelectedFiles") ?? "Запись выбранных файлов"),
        'files.library': (globalThis.noctuneI18n?.t("addonPermissions.accessLibraryTrackFiles") ?? "Получение файлов треков медиатеки"), 'files.reveal': (globalThis.noctuneI18n?.t("addonPermissions.revealAuthorizedFileInFileManager") ?? "Показ разрешённого файла в файловом менеджере"),
        'clipboard.read': (globalThis.noctuneI18n?.t("addonPermissions.readClipboard") ?? "Чтение буфера обмена"), 'clipboard.write': (globalThis.noctuneI18n?.t("addonPermissions.writeClipboard") ?? "Запись в буфер обмена"),
        'system.openExternal': (globalThis.noctuneI18n?.t("addonPermissions.openHttpsLinksInBrowser") ?? "Открытие HTTPS-ссылок в браузере"), 'system.openFile': (globalThis.noctuneI18n?.t("addonPermissions.openSelectedFileInSystemApplication") ?? "Открытие выбранного файла системным приложением"),
    };
    const groups = [...new Set(Object.keys(labels).filter(key => key.includes('.')).map(key => key.split('.')[0]))].map(group => group + '.*');
    function expand(values) {
        const result = new Set();
        for (const value of values || []) {
            if (Object.hasOwn(labels, value)) result.add(value);
            else if (groups.includes(value)) Object.keys(labels).filter(key => key.startsWith(value.slice(0, -1))).forEach(key => result.add(key));
            else throw new Error((globalThis.noctuneI18n?.t("addonPermissions.unknownPermission", {}) ?? "Неизвестное разрешение: ") + value);
        }
        return [...result].sort();
    }
    const namespaces = Object.freeze({ i18n: (globalThis.noctuneI18n?.t('language.title') ?? 'Язык / Language'), catalog: (globalThis.noctuneI18n?.t("addonPermissions.serviceCatalog") ?? "Каталог сервиса"), servicePlaylists: (globalThis.noctuneI18n?.t("addonPermissions.servicePlaylists") ?? "Плейлисты сервиса"), ui: (globalThis.noctuneI18n?.t("addonPermissions.interfacePanels") ?? "Панели интерфейса"), credentials: (globalThis.noctuneI18n?.t("addonPermissions.keysAndTokens") ?? "Ключи и токены"), appearance: (globalThis.noctuneI18n?.t("addonPermissions.colorScheme") ?? "Цветовая схема"), artwork: (globalThis.noctuneI18n?.t("addonPermissions.artwork") ?? "Обложки"), lyrics: (globalThis.noctuneI18n?.t("addonPermissions.lyrics") ?? "Тексты песен"), hotkeys: (globalThis.noctuneI18n?.t("player.interface.hotkeys") ?? "Горячие клавиши"), storage: (globalThis.noctuneI18n?.t("addonPermissions.extensionData") ?? "Данные расширения"), notifications: (globalThis.noctuneI18n?.t("addonPermissions.notifications") ?? "Уведомления"), settings: (globalThis.noctuneI18n?.t("addonPermissions.extensionSettings") ?? "Настройки расширения"), playback: (globalThis.noctuneI18n?.t("settings.player.playback") ?? "Воспроизведение"), events: (globalThis.noctuneI18n?.t("addonPermissions.playerEvents") ?? "События плеера"), queue: (globalThis.noctuneI18n?.t("addonPermissions.queue") ?? "Очередь"), playlists: (globalThis.noctuneI18n?.t("addonPermissions.playlists") ?? "Плейлисты"), themes: (globalThis.noctuneI18n?.t("addonPermissions.themes") ?? "Темы"), backgrounds: (globalThis.noctuneI18n?.t("addonPermissions.backgrounds") ?? "Фоны"), audio: (globalThis.noctuneI18n?.t("addonPermissions.audio") ?? "Аудио"), providers: (globalThis.noctuneI18n?.t("addonPermissions.musicProviders") ?? "Музыкальные провайдеры"), network: (globalThis.noctuneI18n?.t("addonPermissions.network") ?? "Сеть"), oauth: (globalThis.noctuneI18n?.t("addonPermissions.authorization") ?? "Авторизация"), secrets: (globalThis.noctuneI18n?.t("addonPermissions.secureSecrets") ?? "Защищённые секреты"), files: (globalThis.noctuneI18n?.t("addonPermissions.files") ?? "Файлы"), downloads: (globalThis.noctuneI18n?.t("downloads.title") ?? "Сохранение MP3"), clipboard: (globalThis.noctuneI18n?.t("addonPermissions.clipboard") ?? "Буфер обмена"), system: (globalThis.noctuneI18n?.t("addonPermissions.systemActions") ?? "Системные действия") });
    function grouped(values, approved) {
        const granted = approved || expand(values), result = [];
        for (const [namespace, title] of Object.entries(namespaces)) {
            const all = Object.keys(labels).filter(key => key.startsWith(namespace + '.'));
            const used = all.filter(key => granted.includes(key));
            if (used.length) result.push({ namespace, title, full: used.length === all.length, used, total: all.length });
        }
        return result;
    }
    return { grouped, namespaces, labels: Object.freeze(labels), groups: Object.freeze(groups), expand };
});
