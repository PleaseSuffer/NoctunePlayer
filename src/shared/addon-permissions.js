(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.AddonPermissions = api;
})(globalThis, function () {
    const labels = {
        'playlists.addTracks': 'Добавление треков в локальный плейлист',
        'playlists.removeTracks': 'Удаление вхождений треков из локального плейлиста',
        'playlists.reorder': 'Изменение порядка треков локального плейлиста',
        'catalog.register': 'Регистрация собственного каталога сервиса',
        'servicePlaylists.read': 'Чтение плейлистов сервиса',
        'servicePlaylists.create': 'Создание плейлиста на сервере',
        'servicePlaylists.rename': 'Переименование плейлиста на сервере',
        'servicePlaylists.delete': 'Удаление плейлиста на сервере',
        'servicePlaylists.addTracks': 'Добавление треков на сервере',
        'servicePlaylists.removeTracks': 'Удаление вхождений на сервере',
        'servicePlaylists.reorder': 'Порядок треков на сервере',
        'ui.integrations': 'Карточка во вкладке интеграций',
        'credentials.configure': 'Защищённый ввод ключа или токена',
        'credentials.status': 'Статус собственного профиля авторизации',
        'credentials.use': 'Использование ключа в сетевом брокере',
        'credentials.disconnect': 'Удаление собственного профиля авторизации',
        'appearance.read': 'Чтение режима и цветов интерфейса',
        'appearance.list': 'Список доступных цветовых схем',
        'appearance.select': 'Выбор встроенной схемы или схемы другого расширения',
        'appearance.mode': 'Временный светлый, тёмный или системный режим',
        'appearance.palette': 'Временные цвета интерфейса',
        'appearance.register': 'Регистрация собственных цветовых схем',
        'appearance.switch': 'Выбор своей цветовой схемы',
        'appearance.persist': 'Сохранение оформления в настройках пользователя',
        'appearance.events': 'События изменения оформления',
        'playback.shuffle': 'Перемешивание треков',
        'playback.repeat': 'Режим повтора',
        'artwork.read': 'Миниатюра текущей обложки',
        'lyrics.read': 'Чтение текущего текста песни',
        'lyrics.provide': 'Регистрация собственного источника текста',
        'hotkeys.register': 'Регистрация действий для горячих клавиш',
        'storage.read': 'Чтение собственных данных', 'storage.write': 'Изменение собственных данных',
        'notifications.show': 'Показ уведомлений', 'settings.read': 'Чтение настроек расширения', 'settings.events': 'События изменения настроек',
        'playback.read': 'Информация о текущем треке', 'playback.play': 'Начало воспроизведения', 'playback.pause': 'Пауза',
        'playback.stop': 'Остановка', 'playback.seek': 'Перемотка', 'playback.next': 'Следующий трек', 'playback.previous': 'Предыдущий трек',
        'playback.volume': 'Громкость и отключение звука', 'playback.speed': 'Скорость воспроизведения',
        'events.track': 'Смена трека и метаданных', 'events.playback': 'Состояние и ошибки воспроизведения', 'events.progress': 'Прогресс и перемотка',
        'events.queue': 'Изменения очереди', 'events.playlists': 'Изменения плейлистов',
        'queue.read': 'Чтение очереди', 'queue.add': 'Добавление в очередь', 'queue.remove': 'Удаление из очереди', 'queue.reorder': 'Порядок очереди',
        'playlists.read': 'Чтение плейлистов и треков', 'playlists.create': 'Создание плейлистов', 'playlists.rename': 'Переименование плейлистов',
        'playlists.delete': 'Удаление плейлистов', 'playlists.edit': 'Редактирование треков плейлиста', 'playlists.select': 'Выбор плейлиста',
        'themes.list': 'Список установленных тем', 'themes.switch': 'Включение и переключение темы', 'themes.apply': 'Параметры и палитра темы', 'themes.events': 'События изменения темы', 'themes.accent': 'Временная замена цвета акцента; восстановление при отключении',
        'backgrounds.list': 'Список сохранённых фонов', 'backgrounds.switch': 'Переключение фона', 'backgrounds.apply': 'Настройки фона', 'backgrounds.events': 'События изменения фона',
        'backgrounds.override': 'Временная замена обоев с восстановлением при отключении',
        'audio.gain': 'Собственный временный уровень усиления и плавное затихание',
        'audio.analyse': 'Спектр аудио', 'audio.pcm': 'Сэмплы текущего аудио', 'audio.equalizer': 'Управление эквалайзером', 'audio.effects': 'Собственная цепочка аудиоэффектов',
        'providers.register': 'Регистрация музыкального провайдера', 'providers.play': 'Воспроизведение потока провайдера',
        'network.request': 'HTTPS-запросы к заявленным доменам', 'network.headers': 'Дополнительные заголовки запросов',
        'oauth.authorize': 'Вход в заявленные сервисы', 'oauth.status': 'Статус авторизации', 'oauth.disconnect': 'Выход из сервиса',
        'secrets.read': 'Чтение собственных секретов', 'secrets.write': 'Сохранение собственных секретов', 'secrets.delete': 'Удаление собственных секретов',
        'files.select': 'Выбор файлов пользователем', 'files.read': 'Чтение разрешённых файлов', 'files.write': 'Запись выбранных файлов',
        'files.library': 'Получение файлов треков медиатеки', 'files.reveal': 'Показ разрешённого файла в файловом менеджере',
        'clipboard.read': 'Чтение буфера обмена', 'clipboard.write': 'Запись в буфер обмена',
        'system.openExternal': 'Открытие HTTPS-ссылок в браузере', 'system.openFile': 'Открытие выбранного файла системным приложением',
    };
    const groups = [...new Set(Object.keys(labels).filter(key => key.includes('.')).map(key => key.split('.')[0]))].map(group => group + '.*');
    function expand(values) {
        const result = new Set();
        for (const value of values || []) {
            if (Object.hasOwn(labels, value)) result.add(value);
            else if (groups.includes(value)) Object.keys(labels).filter(key => key.startsWith(value.slice(0, -1))).forEach(key => result.add(key));
            else throw new Error('Неизвестное разрешение: ' + value);
        }
        return [...result].sort();
    }
    const namespaces = Object.freeze({ catalog: 'Каталог сервиса', servicePlaylists: 'Плейлисты сервиса', ui: 'Панели интерфейса', credentials: 'Ключи и токены', appearance: 'Цветовая схема', artwork: 'Обложки', lyrics: 'Тексты песен', hotkeys: 'Горячие клавиши', storage: 'Данные расширения', notifications: 'Уведомления', settings: 'Настройки расширения', playback: 'Воспроизведение', events: 'События плеера', queue: 'Очередь', playlists: 'Плейлисты', themes: 'Темы', backgrounds: 'Фоны', audio: 'Аудио', providers: 'Музыкальные провайдеры', network: 'Сеть', oauth: 'Авторизация', secrets: 'Защищённые секреты', files: 'Файлы', clipboard: 'Буфер обмена', system: 'Системные действия' });
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
