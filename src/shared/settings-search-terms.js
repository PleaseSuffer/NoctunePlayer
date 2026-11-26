(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.noctuneSettingsSearchTerms = api;
})(globalThis, function () {
    // Keep examples in docs/settings-search.md aligned with these phrases.
    const aliases = [
        [/setting-normalize$/, 'нормализация громкость треков одинаковая выровнять громкость тихие треки normalization volume leveling normalize audio equal loudness quiet tracks'],
        [/setting-replaygain$/, 'replaygain теги громкости нормализация loudness tags volume metadata'],
        [/setting-crossfade/, 'кроссфейд плавный переход затухание плавная смена песен переход между треками фейд crossfade smooth transition between songs fade in out'],
        [/mini-player|mini-/, 'мини плеер миниплеер маленький плеер плавающее окно поверх окон mini player compact floating window always on top'],
        [/glass-opacity|opacity/, 'прозрачность прозрачный opacity transparency transparent'],
        [/cover-cache/, 'кэш кеш обложки cache artwork album covers clear cached images'],
        [/auto-check-updates|check-on-startup/, 'обновления проверка update startup automatic updates check for new version'],
        [/setting-keep-awake$/, 'не выключать экран не уходить в сон запрет сна keep screen awake prevent sleep stay awake'],
        [/setting-minimize-to-tray$/, 'закрывать в трей свернуть к часам значок в трее minimize close to system tray notification area'],
        [/setting-remember-track$/, 'запомнить песню последний трек remember last song track'],
        [/setting-restore-playback$/, 'сохранить позицию продолжить слушать восстановить воспроизведение resume playback save restore position continue listening'],
        [/setting-lyrics-/, 'слова песни лирика lyrics song words text'],
        [/setting-show-visualizer$/, 'полоски спектр реакция на музыку визуализатор visualizer visualiser spectrum audio reactive music bars'],
        [/setting-waveform-enabled$/, 'форма волны волна трека waveform audio wave seek preview'],
        [/setting-effects-fps$/, 'фпс плавность эффектов ограничить кадры частота кадров fps frame rate limit effects performance'],
        [/setting-hardware-acceleration$/, 'видеокарта ускорение графики аппаратное ускорение gpu graphics hardware acceleration'],
        [/notification-history/, 'журнал уведомлений история прошлые ошибки последние уведомления notification history previous errors recent notifications log'],
        [/setting-dark-theme$/, 'тема светлая темная ночной режим theme light dark night mode'],
        [/setting-language$/, 'язык перевод language locale translation русский английский russian english'],
    ];
    const normalize = value => String(value).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
    const tokenize = value => normalize(value).match(/[\p{L}\p{N}]+/gu) || [];
    // Convert before tokenizing: punctuation keys can represent Russian letters.
    const latin = "`qwertyuiop[]asdfghjkl;'zxcvbnm,./";
    const russian = 'ёйцукенгшщзхъфывапролджэячсмитьбю.';
    function alternateLayout(value) {
        const query = String(value).toLowerCase();
        const ru = (query.match(/[а-яё]/g) || []).length;
        const en = (query.match(/[a-z]/g) || []).length;
        if (!ru && !en) return '';
        const from = ru > en ? russian : latin, to = ru > en ? latin : russian;
        return [...query].map(char => { const index = from.indexOf(char); return index < 0 ? char : to[index]; }).join('');
    }
    function wordsFor(id) { return aliases.filter(([pattern]) => pattern.test(id)).map(([, words]) => words).join(' '); }
    return { normalize, tokenize, alternateLayout, wordsFor };
});
