(function initLyrics() {
    const modal = document.getElementById('lyrics-modal');
    const openButtons = [document.getElementById('btn-lyrics'), document.getElementById('mini-btn-lyrics')];
    const closeButton = document.getElementById('lyrics-close');
    const toggle = document.getElementById('setting-lyrics-enabled');
    const status = document.getElementById('lyrics-status');
    const content = document.getElementById('lyrics-content');
    const trackLabel = document.getElementById('lyrics-track');
    const retry = document.getElementById('lyrics-retry');
    const followButton = document.getElementById('lyrics-follow');
    const viewToggle = document.getElementById('lyrics-view-toggle');
    const autoScrollToggle = document.getElementById('setting-lyrics-autoscroll');
    const settingsBody = document.getElementById('lyrics-settings-body');
    const cover = document.getElementById('lyrics-cover-image');
    const coverPlaceholder = document.getElementById('lyrics-cover-placeholder');
    const seek = document.getElementById('lyrics-seek');
    const playButton = document.getElementById('lyrics-play');
    const shuffleButton = document.getElementById('lyrics-shuffle');
    const repeatButton = document.getElementById('lyrics-repeat');
    const lyricsVolume = document.getElementById('lyrics-volume');
    let expanded = appStorage.getItem('setting_lyrics_expanded') === '1';
    let lastRepeat = null;
    let lastVolumeIcon = null;
    let autoFollow = appStorage.getItem('setting_lyrics_autoscroll') !== '0';
    let lastPlaying = null;
    const mainCover = document.getElementById('player-cover-img');
    const mainPlaceholder = document.getElementById('player-cover-placeholder');
    const mainCoverWrap = document.getElementById('player-cover-wrap');
    const expandedCoverWrap = document.getElementById('lyrics-cover-wrap');
    let artworkRequestId = null;
    function setArtworkState(phase, progress = null) {
        const labels = { searching: 'Поиск обложки…', downloading: 'Обложка найдена · загрузка…', decoding: 'Обложка загружена…', ready: 'Обложка загружена', missing: 'Обложка не найдена', error: 'Не удалось загрузить обложку', idle: '' };
        for (const wrapper of [mainCoverWrap, expandedCoverWrap]) {
            wrapper.setAttribute('data-artwork-state', phase);
            wrapper.style.setProperty('--cover-progress', Number.isFinite(progress) ? progress : 0);
            wrapper.classList.toggle('artwork-indeterminate', !Number.isFinite(progress));
        }
        mainPlaceholder.setAttribute('aria-label', labels[phase] || 'Нет обложки');
    }
    function displayArtwork(image) {
        for (const element of [cover, mainCover]) {
            if (image && element.getAttribute('src') !== image) {
                element.classList.toggle('loaded', false);
                element.src = image;
            } else if (!image) {
                element.classList.toggle('loaded', false);
                element.removeAttribute('src');
            }
        }
        cover.hidden = !image;
        coverPlaceholder.hidden = cover.classList.contains('loaded');
        mainPlaceholder.style.display = '';
    }
    for (const [element, placeholder] of [[cover, coverPlaceholder], [mainCover, mainPlaceholder]]) {
        element.addEventListener('load', () => {
            if (!element.getAttribute('src')) return;
            element.classList.toggle('loaded', true);
            if (element === cover) placeholder.hidden = true;
            setArtworkState('ready', 1);
        });
        element.addEventListener('error', () => {
            if (!element.getAttribute('src')) return;
            if (track?.radio) { remoteCover = ''; displayArtwork(''); }
            element.classList.toggle('loaded', false);
            if (element === cover) element.hidden = true;
            placeholder.hidden = false; setArtworkState('error');
        });
    }
    let artworkSerial = 0, artworkKey = '', remoteCover = '';
    const trackArtwork = new Map();
    const artworkIdentity = metadata => JSON.stringify([metadata?.artist, metadata?.title, metadata?.album || '']);
    const coverIdentity = metadata => {
        const value = key => String(metadata?.[key] || '').trim().slice(0, 300).toLowerCase();
        const filePath = String(metadata?.filePath || '').replace(/\\/g, '/');
        const directory = cacheLocation === 'music' ? filePath.slice(0, filePath.lastIndexOf('/')) : '';
        return JSON.stringify([directory, value('artist'), value('album'), value('album') ? '' : value('title')]);
    };
    function rememberArtwork(filePath, metadata, image) {
        trackArtwork.delete(filePath);
        trackArtwork.set(filePath, { identity: artworkIdentity(metadata), image });
        let bytes = [...trackArtwork.values()].reduce((sum, item) => sum + item.image.length, 0);
        for (const [path, item] of trackArtwork) {
            if (trackArtwork.size <= 100 && bytes <= 30 * 1024 * 1024) break;
            trackArtwork.delete(path); bytes -= item.image.length;
        }
    }
    window.getTrackCoverCacheInfo = async (index, entry) => {
        const metadata = parsedMetadataCache[index] || await noctune.metadata.parseFile(entry.path, entry.name);
        const payload = { artist: metadata.artist, title: metadata.title, album: metadata.album, filePath: entry.path };
        const result = await noctune.lastfm.trackCoverCacheStatus(payload);
        if (!result.ok) throw new Error('Не удалось проверить кэш обложки');
        return { payload, cached: result.cached };
    };
    let coverActionSerial = 0;
    window.changeTrackCover = async (payload, remove) => {
        const actionSerial = ++coverActionSerial;
        const identity = coverIdentity(payload);
        if (!track?.radio && coverIdentity(track) === identity) artworkSerial++;
        const cleared = await noctune.lastfm.removeTrackCoverCache(payload);
        if (!cleared.ok) throw new Error('Не удалось удалить кэш обложки');
        for (const [path, saved] of trackArtwork) {
            const [artist, title, album] = JSON.parse(saved.identity);
            if (coverIdentity({ artist, title, album, filePath: path }) === identity) trackArtwork.delete(path);
        }
        if (!track?.radio && coverIdentity(track) === identity) {
            artworkSerial++; remoteCover = ''; artworkRequestId = null;
            // Удалённая обложка не загружается снова до смены трека
            // или явного действия «Обновить обложку».
            artworkKey = JSON.stringify([track.token, track.artist, track.title, track.album]);
            setArtworkState('idle'); updateNowPlaying();
        }
        updatePlaylistArtwork(); updateCacheStats();
        if (remove) return;
        const result = await noctune.lastfm.cover(payload);
        if (actionSerial !== coverActionSerial) return;
        if (result.status !== 'found') {
            const message = result.status === 'disabled' ? 'Включите загрузку обложек Last.fm в настройках.'
                : result.status === 'missing' || result.status === 'invalid' ? 'Обложка не найдена.' : 'Не удалось обновить обложку.';
            showNotification(message, 'info', 'Обложка трека');
            return;
        }
        const thumbnail = noctune.metadata?.thumbnail ? await noctune.metadata.thumbnail(result.dataUrl) : result.dataUrl;
        if (actionSerial !== coverActionSerial) return;
        if (fileEntries.some(entry => entry.path === payload.filePath)) rememberArtwork(payload.filePath, payload, thumbnail || '');
        if (!track?.radio && coverIdentity(track) === identity) {
            artworkSerial++; remoteCover = result.dataUrl;
            artworkKey = JSON.stringify([track.token, track.artist, track.title, track.album]);
            updateNowPlaying();
        }
        updatePlaylistArtwork(); updateCacheStats();
    };
    window.updateTrackArtwork = (index, metadata, expectedPath) => {
        const entry = typeof fileEntries !== 'undefined' ? fileEntries[index] : null;
        if (!entry || entry.kind === 'radio' || (expectedPath && entry.path !== expectedPath)) return;
        const element = document.getElementById('cover-' + index);
        const placeholder = document.getElementById('cover-ph-' + index);
        if (!element) return;
        element.loading = 'lazy'; element.decoding = 'async';
        const saved = trackArtwork.get(entry.path);
        const image = metadata?.coverThumbnailDataUrl || metadata?.coverDataUrl || (window.lastfmEnabled && coversToggle.checked && saved?.identity === artworkIdentity(metadata) ? saved.image : '') || '';
        if (placeholder) placeholder.style.display = '';
        if (!image) { element.classList.toggle('loaded', false); element.removeAttribute('src'); return; }
        if (element.getAttribute('src') === image && element.classList.contains('loaded')) return;
        element.classList.toggle('loaded', false);
        const stillCurrent = () => fileEntries[index]?.path === entry.path && document.getElementById('cover-' + index) === element && element.getAttribute('src') === image;
        element.onload = () => { if (stillCurrent()) element.classList.toggle('loaded', true); };
        element.onerror = () => {
            if (!stillCurrent()) return;
            element.classList.toggle('loaded', false); element.removeAttribute('src');
        };
        element.src = image;
        if (element.complete && element.naturalWidth > 0) element.onload();
    };
    function updatePlaylistArtwork() {
        if (typeof fileEntries === 'undefined') return;
        fileEntries.forEach((entry, index) => {
            const metadata = typeof parsedMetadataCache !== 'undefined' ? parsedMetadataCache[index] : null;
            window.updateTrackArtwork(index, metadata || (entry.path === track?.filePath ? track : null));
        });
    }
    const coversToggle = document.getElementById('setting-lastfm-covers');
    const coverCacheToggle = document.getElementById('setting-lastfm-cover-cache');
    const coverCacheSettings = document.getElementById('lastfm-cover-cache-settings');
    const cacheOptions = document.getElementById('lastfm-cover-cache-options');
    const cacheLimit = document.getElementById('lastfm-cover-cache-limit');
    const locationButton = document.getElementById('cover-cache-location-button');
    const locationMenu = document.getElementById('cover-cache-location-menu');
    const locationDropdown = document.getElementById('cover-cache-location-dropdown');
    const locationOptions = [...locationMenu.querySelectorAll('.cover-cache-location-option')];
    let cacheLocation = ['music', 'custom'].includes(appStorage.getItem('setting_lastfm_cover_cache_location')) ? appStorage.getItem('setting_lastfm_cover_cache_location') : 'app';
    let customCachePath = appStorage.getItem('setting_lastfm_cover_cache_custom_path') || '';
    const chooseCacheFolderButton = document.getElementById('cover-cache-choose-folder');
    let cacheStatsSerial = 0;
    cacheLimit.value = Math.max(10, Math.min(300, Number(appStorage.getItem('setting_lastfm_cover_cache_limit')) || 30));
    function updateCacheControls() {
        cacheOptions.style.display = coverCacheToggle.checked ? 'block' : 'none';
        document.getElementById('lastfm-cover-cache-limit-label').textContent = cacheLimit.value + ' МБ';
        document.getElementById('cover-cache-location-label').textContent = { music: 'В папке с музыкой', custom: 'Своя папка', app: 'Кэш приложения' }[cacheLocation];
        document.getElementById('cover-cache-custom-row').style.display = cacheLocation === 'custom' ? 'flex' : 'none';
        document.getElementById('cover-cache-custom-path').textContent = customCachePath || 'Папка не выбрана';
        document.getElementById('cover-cache-location-hint').textContent = {
            music: 'В каждой папке с музыкой создаётся свой кэш .noctune-cache/covers. Размер и очистка относятся к папке текущего трека. Лимит действует отдельно для каждой папки.',
            custom: 'Обложки всех плейлистов сохраняются в выбранной папке. При заполнении кэша старые обложки удаляются.',
            app: 'Обложки сохраняются в локальном кэше приложения. При заполнении кэша старые обложки удаляются.',
        }[cacheLocation];
        locationOptions.forEach(option => {
            const selected = option.getAttribute('data-location') === cacheLocation;
            option.classList.toggle('active', selected); option.setAttribute('aria-selected', String(selected));
        });
    }
    function cachePayload() { return { filePath: track?.filePath }; }
    async function updateCacheStats(configure = false) {
        const serial = ++cacheStatsSerial;
        try {
            const result = await (configure ? noctune.lastfm.configureCoverCache(cachePayload()) : noctune.lastfm.coverCacheStats(cachePayload()));
            if (serial !== cacheStatsSerial) return;
            document.getElementById('lastfm-cover-cache-usage').textContent = result.ok ? 'Занято: ' + (result.bytes / 1024 / 1024).toFixed(1) + ' МБ из ' + result.limitMB + ' МБ' : 'Не удалось определить размер кэша.';
            document.getElementById('lastfm-cover-cache-path').textContent = result.ok ? result.directory : '';
        } catch (_) {}
    }
    function setLocationMenu(open) {
        locationMenu.classList.toggle('open', open); locationButton.classList.toggle('open', open);
        locationButton.setAttribute('aria-expanded', String(open));
    }
    locationButton.addEventListener('click', () => setLocationMenu(!locationMenu.classList.contains('open')));
    async function applyCacheLocation(location) {
        cacheLocation = location;
        appStorage.setItem('setting_lastfm_cover_cache_location', cacheLocation);
        artworkSerial++; artworkRequestId = null; artworkKey = '';
        setLocationMenu(false); updateCacheControls(); setArtworkState('idle');
        await updateCacheStats(true); artworkSerial++; artworkKey = ''; refreshArtwork();
    }
    async function chooseCacheFolder() {
        chooseCacheFolderButton.disabled = true;
        const message = document.getElementById('lastfm-cover-cache-status');
        try {
            const result = await noctune.lastfm.chooseCoverCacheFolder();
            if (result.canceled) return;
            if (!result.ok) { message.textContent = 'Не удалось выбрать папку.'; return; }
            customCachePath = result.directory;
            appStorage.setItem('setting_lastfm_cover_cache_custom_path', customCachePath);
            message.textContent = ''; await applyCacheLocation('custom');
        } catch (_) { message.textContent = 'Не удалось выбрать папку.'; }
        finally { chooseCacheFolderButton.disabled = false; }
    }
    locationOptions.forEach(option => option.addEventListener('click', async () => {
        const location = option.getAttribute('data-location');
        setLocationMenu(false);
        if (location === 'custom' && !customCachePath) await chooseCacheFolder();
        else await applyCacheLocation(location);
    }));
    chooseCacheFolderButton.addEventListener('click', chooseCacheFolder);
    document.getElementById('cover-cache-open-folder').addEventListener('click', async () => {
        const message = document.getElementById('lastfm-cover-cache-status');
        try {
            const result = await noctune.lastfm.openCoverCacheFolder(cachePayload());
            message.textContent = result.ok ? '' : 'Не удалось открыть папку обложек.';
        } catch (_) { message.textContent = 'Не удалось открыть папку обложек.'; }
    });
    document.addEventListener('click', event => { if (!locationDropdown.contains(event.target)) setLocationMenu(false); });
    locationMenu.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); setLocationMenu(false); locationButton.focus(); } });
    cacheLimit.addEventListener('input', () => {
        appStorage.setItem('setting_lastfm_cover_cache_limit', cacheLimit.value);
        updateCacheControls();
    });
    cacheLimit.addEventListener('change', async () => {
        artworkSerial++; artworkRequestId = null; artworkKey = '';
        await updateCacheStats(true); artworkSerial++; artworkKey = ''; refreshArtwork();
    });
    document.getElementById('settings-fab').addEventListener('click', () => updateCacheStats());
    const clearCacheButton = document.getElementById('lastfm-cover-cache-clear');
    coversToggle.checked = appStorage.getItem('setting_lastfm_covers') !== '0';
    coverCacheToggle.checked = appStorage.getItem('setting_lastfm_cover_cache') !== '0';
    coverCacheSettings.style.display = coversToggle.checked ? 'block' : 'none';
    async function refreshArtwork() {
        if (!track || (track.radio && !track.title?.trim()) || track.coverDataUrl || !window.lastfmEnabled || !coversToggle.checked) return;
        const key = JSON.stringify([track.token, track.artist, track.title, track.album]);
        if (key === artworkKey) return;
        artworkKey = key;
        const requestSerial = ++artworkSerial;
        artworkRequestId = 'cover-' + requestSerial + '-' + Date.now();
        setArtworkState('searching');
        let result;
        try { result = await noctune.lastfm.cover({ artist: track.artist, title: track.title, album: track.album, filePath: track.filePath, transient: Boolean(track.radio), requestId: artworkRequestId }); } catch (_) { if (requestSerial === artworkSerial) setArtworkState('error'); return; }
        if (requestSerial !== artworkSerial || !window.lastfmEnabled || !coversToggle.checked) return;
        if (result.status === 'found') {
            setArtworkState('decoding', 1); remoteCover = result.dataUrl;
            if (!track.radio && track.filePath) {
                let thumbnail = null;
                try { thumbnail = noctune.metadata?.thumbnail ? await noctune.metadata.thumbnail(remoteCover) : remoteCover; } catch (_) {}
                if (requestSerial !== artworkSerial || !window.lastfmEnabled || !coversToggle.checked) return;
                rememberArtwork(track.filePath, track, thumbnail || '');
            }
            updatePlaylistArtwork(); updateNowPlaying();
        }
        else setArtworkState(result.status === 'missing' ? 'missing' : result.status === 'disabled' ? 'idle' : 'error');
        updateCacheStats();
    }
    function cancelRadioArtwork() {
        if (noctune.lastfm?.cancelRadioCover) noctune.lastfm.cancelRadioCover().catch(() => {});
    }
    window.clearRadioArtwork = () => {
        if (!track?.radio) return;
        cancelRadioArtwork();
        artworkSerial++; artworkKey = ''; remoteCover = ''; artworkRequestId = null;
        track = null; setArtworkState('idle'); updateNowPlaying();
    };
    window.addEventListener?.('online', () => { if (track?.radio && !remoteCover) { artworkKey = ''; refreshArtwork(); } });
    window.refreshLyricsArtwork = () => {
        if (track?.radio) cancelRadioArtwork();
        artworkSerial++; artworkKey = ''; remoteCover = ''; artworkRequestId = null; setArtworkState('idle');
        updateNowPlaying();
        updatePlaylistArtwork();
    };
    coversToggle.addEventListener('change', () => {
        appStorage.setItem('setting_lastfm_covers', coversToggle.checked ? '1' : '0');
        coverCacheSettings.style.display = coversToggle.checked ? 'block' : 'none';
        window.refreshLyricsArtwork();
    });
    coverCacheToggle.addEventListener('change', () => {
        appStorage.setItem('setting_lastfm_cover_cache', coverCacheToggle.checked ? '1' : '0');
        updateCacheControls(); updateCacheStats();
    });
    clearCacheButton.addEventListener('click', async () => {
        clearCacheButton.disabled = true;
        const message = document.getElementById('lastfm-cover-cache-status');
        message.textContent = '';
        try {
            const result = await noctune.lastfm.clearCoverCache(cachePayload());
            message.textContent = result.ok ? 'Кэш обложек очищен.' : 'Не удалось очистить кэш.';
            if (result.ok) {
                artworkSerial++; artworkKey = ''; artworkRequestId = null;
                setArtworkState(mainCover.classList.contains('loaded') ? 'ready' : 'idle'); updateCacheStats();
            }
        } catch (_) { message.textContent = 'Не удалось очистить кэш.'; }
        finally { clearCacheButton.disabled = false; }
    });
    if (noctune.lastfm?.onCoverProgress) noctune.lastfm.onCoverProgress(progress => {
        if (progress.requestId !== artworkRequestId) return;
        if (['searching', 'downloading'].includes(progress.phase)) setArtworkState(progress.phase, progress.progress);
    });
    autoScrollToggle.checked = autoFollow;
    function setExpanded(value) {
        expanded = value;
        modal.classList.toggle('lyrics-expanded', value);
        document.body.classList.toggle('lyrics-expanded', opened && value);
        viewToggle.setAttribute('aria-pressed', String(value));
        viewToggle.title = value ? 'Обычное окно' : 'Большой вид';
        viewToggle.setAttribute('aria-label', viewToggle.title);
        viewToggle.innerHTML = '<i data-lucide="' + (value ? 'shrink' : 'expand') + '"></i>';
        lucide.createIcons();
        activeIndex = -1;
        requestAnimationFrame(sync);
        if (value) refreshArtwork();
    }
    function updateNowPlaying() {
        const radio = Boolean(track?.radio);
        document.getElementById('lyrics-seek-row').hidden = radio;
        const station = document.getElementById('lyrics-radio-station');
        station.hidden = !radio;
        station.textContent = radio ? track.stationName || 'Радиостанция' : '';
        document.getElementById('lyrics-song-title').textContent = track?.title || (radio ? 'Прямой эфир' : 'Музыка не выбрана');
        document.getElementById('lyrics-song-artist').textContent = track?.artist || '';
        const image = track?.coverDataUrl || (window.lastfmEnabled && coversToggle.checked ? remoteCover : '') || '';
        displayArtwork(image);
        refreshArtwork();
    }
    function updatePlayback() {
        shuffleButton.classList.toggle('active', isShuffle);
        shuffleButton.setAttribute('aria-pressed', String(isShuffle));
        if (lastRepeat !== repeatMode) {
            lastRepeat = repeatMode;
            const title = ['Повтор выключен', 'Повторять этот трек', 'Повторять плейлист'][repeatMode];
            repeatButton.innerHTML = '<i data-lucide="' + ['repeat-off', 'repeat-1', 'repeat'][repeatMode] + '"></i>';
            repeatButton.classList.toggle('active', repeatMode > 0);
            repeatButton.title = title;
            repeatButton.setAttribute('aria-label', title);
            lucide.createIcons();
        }
        const volume = Number(volumeSlider.value);
        if (document.activeElement !== lyricsVolume) lyricsVolume.value = volume;
        const volumeLevel = isMuted ? 0 : Math.max(0, Math.min(1, volume));
        document.getElementById('lyrics-volume-popover').style.setProperty('--volume-level', volumeLevel);
        const volumeIcon = isMuted || volume <= 0 ? 'volume-x' : volume < 0.4 ? 'volume' : volume < 0.7 ? 'volume-1' : 'volume-2';
        if (lastVolumeIcon !== volumeIcon) {
            lastVolumeIcon = volumeIcon;
            document.getElementById('lyrics-volume-icon').setAttribute('data-lucide', volumeIcon);
            document.getElementById('lyrics-volume-button').setAttribute('aria-label', isMuted || volume <= 0 ? 'Включить звук' : 'Выключить звук');
            lucide.createIcons();
        }
        const duration = isRadioMode ? 0 : (currentTrackDuration || localAudioElement?.duration || 0);
        const position = localAudioElement?.getAttribute('src') && !isRadioMode ? localAudioElement.currentTime || 0 : 0;
        seek.disabled = !Number.isFinite(duration) || duration <= 0 || _trackLoading;
        if (document.activeElement !== seek) seek.value = seek.disabled ? 0 : position / duration * 100;
        document.getElementById('lyrics-time-current').textContent = formatTime(position);
        document.getElementById('lyrics-time-total').textContent = formatTime(Number.isFinite(duration) ? duration : 0);
        if (lastPlaying !== isPlaying) {
            lastPlaying = isPlaying;
            playButton.setAttribute('aria-label', isPlaying ? 'Пауза' : 'Воспроизвести');
            playButton.innerHTML = '<i data-lucide="' + (isPlaying ? 'pause' : 'play') + '"></i>';
            lucide.createIcons();
        }
    }
    const appearanceSection = document.getElementById('lyrics-appearance-settings');
    const appearanceControls = {
        mode: document.getElementById('setting-lyrics-color-mode'), color: document.getElementById('setting-lyrics-color'),
        dim: document.getElementById('setting-lyrics-dim'), blur: document.getElementById('setting-lyrics-blur'),
        size: document.getElementById('setting-lyrics-size'), inactive: document.getElementById('setting-lyrics-inactive'),
        shadow: document.getElementById('setting-lyrics-shadow'),
    };
    const colorDropdown = document.getElementById('lyrics-color-dropdown');
    const colorMenu = document.getElementById('lyrics-color-menu');
    const colorOptions = [...colorMenu.querySelectorAll('.lyrics-color-option')];
    const colorModes = {
        adaptive: { label: 'Адаптивный', icon: 'wand-2' }, accent: { label: 'Из акцента', icon: 'pipette' },
        custom: { label: 'Свой цвет', icon: 'palette' }, light: { label: 'Светлый', icon: 'sun' }, dark: { label: 'Тёмный', icon: 'moon' },
    };
    function setColorMenuOpen(open) {
        colorMenu.classList.toggle('open', open);
        appearanceControls.mode.classList.toggle('open', open);
        appearanceControls.mode.setAttribute('aria-expanded', String(open));
    }
    appearanceControls.mode.addEventListener('click', () => setColorMenuOpen(!colorMenu.classList.contains('open')));
    colorOptions.forEach(option => option.addEventListener('click', () => {
        applyAppearance({ mode: option.getAttribute('data-mode') }, true);
        setColorMenuOpen(false);
        appearanceControls.mode.focus();
    }));
    document.addEventListener('click', event => { if (!colorDropdown.contains(event.target)) setColorMenuOpen(false); });
    appearanceControls.mode.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); setColorMenuOpen(true);
            (colorOptions.find(option => option.getAttribute('data-mode') === appearance.mode) || colorOptions[0]).focus();
        }
    });
    colorMenu.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault(); event.stopPropagation(); setColorMenuOpen(false); appearanceControls.mode.focus();
        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const current = colorOptions.indexOf(document.activeElement);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? colorOptions.length - 1 : (current + (event.key === 'ArrowUp' ? -1 : 1) + colorOptions.length) % colorOptions.length;
            colorOptions[next].focus();
        } else if (event.key === 'Tab') setColorMenuOpen(false);
    });
    const appearanceDefaults = { mode: 'adaptive', color: '#ffffff', dim: 0, blur: 0, size: 100, inactive: 35, shadow: true };
    const modes = ['adaptive', 'accent', 'custom', 'light', 'dark'];
    const clampAppearance = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
    let appearance = { ...appearanceDefaults };
    function applyAppearance(values, save = false) {
        if (!values || typeof values !== 'object') return;
        const next = { ...appearance, ...values };
        appearance = {
            mode: modes.includes(next.mode) ? next.mode : appearanceDefaults.mode,
            color: /^#[0-9a-f]{6}$/i.test(next.color) ? next.color : appearanceDefaults.color,
            dim: clampAppearance(next.dim, 0, 80, 0), blur: clampAppearance(next.blur, 0, 12, 0),
            size: clampAppearance(next.size, 75, 150, 100), inactive: clampAppearance(next.inactive, 15, 80, 35),
            shadow: typeof next.shadow === 'boolean' ? next.shadow : true,
        };
        for (const [key, control] of Object.entries(appearanceControls)) {
            if (key === 'shadow') control.checked = appearance[key]; else control.value = appearance[key];
        }
        const selectedMode = colorModes[appearance.mode];
        document.getElementById('lyrics-color-label').textContent = selectedMode.label;
        document.getElementById('lyrics-color-icon').innerHTML = '<i data-lucide="' + selectedMode.icon + '" style="width:14px;height:14px;"></i>';
        colorOptions.forEach(option => {
            const selected = option.getAttribute('data-mode') === appearance.mode;
            option.classList.toggle('active', selected);
            option.setAttribute('aria-selected', String(selected));
        });
        lucide.createIcons();
        document.getElementById('lyrics-custom-color-row').style.display = appearance.mode === 'custom' ? 'flex' : 'none';
        for (const [key, unit] of Object.entries({ dim: '%', blur: ' px', size: '%', inactive: '%' })) {
            document.getElementById('setting-lyrics-' + key + '-label').textContent = appearance[key] + unit;
        }
        modal.setAttribute('data-lyrics-color', appearance.mode);
        const color = { custom: appearance.color, accent: 'var(--accent-color)', light: '#ffffff', dark: '#171717', adaptive: 'var(--text-color)' }[appearance.mode];
        modal.style.setProperty('--lyrics-color', color);
        modal.style.setProperty('--lyrics-dim', appearance.dim / 100);
        modal.style.setProperty('--lyrics-blur', appearance.blur + 'px');
        modal.style.setProperty('--lyrics-scale', appearance.size / 100);
        modal.style.setProperty('--lyrics-inactive', appearance.inactive / 100);
        modal.style.setProperty('--lyrics-shadow', appearance.shadow ? '0 2px 12px rgba(0,0,0,0.6)' : 'none');
        if (save) appStorage.setItem('setting_lyrics_appearance', JSON.stringify(appearance));
        activeIndex = -1;
        requestAnimationFrame(sync);
    }
    window.getLyricsAppearance = () => ({ ...appearance });
    window.applyLyricsAppearanceTheme = values => applyAppearance(values, true);
    for (const [key, control] of Object.entries(appearanceControls)) {
        control.addEventListener(key === 'mode' || key === 'shadow' ? 'change' : 'input', () => {
            applyAppearance({ [key]: key === 'shadow' ? control.checked : control.value }, true);
        });
    }
    let enabled = appStorage.getItem('setting_lyrics_enabled') !== '0';
    let track = null, serial = 0, rows = [], activeIndex = -1, follow = true, frame = null;
    let opened = false, previousFocus = null;
    let savedAppearance = {};
    try { savedAppearance = JSON.parse(appStorage.getItem('setting_lyrics_appearance') || '{}'); } catch (_) {}
    applyAppearance(savedAppearance && typeof savedAppearance === 'object' ? savedAppearance : {});
    appearanceSection.style.display = enabled ? 'flex' : 'none';
    updateCacheControls();
    updateCacheStats();
    toggle.checked = enabled;
    settingsBody.style.display = enabled ? 'block' : 'none';
    openButtons.forEach(button => { button.hidden = !enabled; });

    function setLyricsAvailability(noText) {
        if (modal.classList.contains('lyrics-no-text') === noText) return;
        const left = document.querySelector('.lyrics-now-playing');
        const before = left.getBoundingClientRect();
        modal.classList.toggle('lyrics-no-text', noText);
        if (!expanded || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const after = left.getBoundingClientRect();
        left.getAnimations().forEach(animation => animation.cancel());
        left.animate([{ transform: 'translate(' + (before.left - after.left) + 'px,' + (before.top - after.top) + 'px)' }, { transform: 'translate(0,0)' }], { duration: 380, easing: 'cubic-bezier(.22,1,.36,1)' });
        if (!noText) document.querySelector('.lyrics-text-column').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280, easing: 'ease-out' });
        activeIndex = -1; requestAnimationFrame(sync);
    }
    function cancelLyricsSearch() {
        if (noctune.lyrics?.cancel) noctune.lyrics.cancel().catch(() => {});
    }
    function clear() {
        cancelLyricsSearch();
        serial++;
        rows = []; activeIndex = -1; follow = autoFollow;
        content.replaceChildren();
        content.scrollTop = 0;
        retry.hidden = true; followButton.hidden = true;
        status.classList.toggle('lyrics-synced-hint', false);

        trackLabel.textContent = track ? [track.artist, track.title].filter(Boolean).join(' — ') : '';
        updateNowPlaying();
    }
    async function load() {
        clear();
        if (!enabled || !opened) return;
        if (!track || track.radio) {
            status.textContent = track?.radio ? 'Текст для радиопотока недоступен.' : 'Выберите песню для поиска текста.';
            return;
        }
        const requestSerial = serial;
        status.textContent = 'Ищем текст песни…';
        let result;
        try { result = await noctune.lyrics.get(track); } catch (_) { result = { status: 'error' }; }
        if (requestSerial !== serial || !opened || !enabled || result.status === 'cancelled') return;
        const messages = {
            missing: 'Текст этой песни не найден.', instrumental: 'Инструментальная композиция — без текста.',
            invalid: 'Для поиска нужны название песни и исполнитель. Проверьте теги файла.',
            error: 'Текст временно недоступен.',
            'rate-limit': 'Сервис временно ограничил запросы. Попробуйте позже.',
        };
        if (result.status !== 'found') {
            status.textContent = messages[result.status] || messages.error;
            setLyricsAvailability(['missing', 'instrumental'].includes(result.status));
            retry.hidden = !['error', 'rate-limit'].includes(result.status);
            return;
        }
        setLyricsAvailability(false);
        if (result.lines.length) {
            status.textContent = 'Синхронизированный текст · нажмите строку для перемотки';
            status.classList.toggle('lyrics-synced-hint', true);
            rows = result.lines.map(line => {
                const element = document.createElement('button');
                element.type = 'button'; element.className = 'lyrics-line';
                element.textContent = line.text || '♪';
                element.addEventListener('click', () => {
                    if (isRadioMode || !localAudioElement?.getAttribute('src') || _trackLoading) return;
                    const duration = currentTrackDuration || localAudioElement.duration;
                    const position = Math.max(0, Math.min(line.time, Number.isFinite(duration) ? duration : line.time));
                    if (isPlaying) startSourceAt(position, false);
                    else { pausedAt = position; localAudioElement.currentTime = position; updateSMTCPosition(position); }
                    follow = true;
                    activeIndex = -1;
                    sync();
                });
                content.appendChild(element);
                return { ...line, element };
            });
            followButton.hidden = false;
            sync();
        } else {
            status.textContent = 'Текст без синхронизации';
            const plain = document.createElement('div');
            plain.className = 'lyrics-plain'; plain.textContent = result.plain;
            content.appendChild(plain);
        }
    }
    function sync() {
        if (!opened || !rows.length || isRadioMode || !localAudioElement?.getAttribute('src')) return;
        const position = localAudioElement.currentTime || 0;
        let index = -1;
        for (let i = 0; i < rows.length && rows[i].time <= position; i++) index = i;
        if (index === activeIndex) return;
        activeIndex = index;
        rows.forEach((row, i) => {
            row.element.classList.toggle('active', i === index);
            if (i === index) row.element.setAttribute('aria-current', 'true');
            else row.element.removeAttribute('aria-current');
        });
        if (follow && index >= 0) {
            const row = rows[index].element;
            const top = row.getBoundingClientRect().top - content.getBoundingClientRect().top + content.scrollTop;
            content.scrollTo({ top: Math.max(0, top - content.clientHeight / 2 + row.offsetHeight / 2),
                behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
        }
    }
    function tick() { if (!opened) return; updatePlayback(); sync(); frame = requestAnimationFrame(tick); }
    function close() {
        cancelLyricsSearch();
        opened = false; serial++; cancelAnimationFrame(frame); frame = null;
        modal.style.display = 'none'; document.body.classList.toggle('lyrics-expanded', false); previousFocus?.focus();
    }
    openButtons.forEach(button => button.addEventListener('click', () => {
        if (!enabled) return;
        previousFocus = document.activeElement; opened = true;
        setExpanded(expanded);
        modal.style.display = 'flex'; closeButton.focus(); load(); tick();
    }));
    viewToggle.addEventListener('click', () => { setExpanded(!expanded); appStorage.setItem('setting_lyrics_expanded', expanded ? '1' : '0'); updatePlayback(); });
    shuffleButton.addEventListener('click', () => { toggleShuffle(); updatePlayback(); });
    repeatButton.addEventListener('click', () => { toggleRepeat(); updatePlayback(); });
    lyricsVolume.addEventListener('input', () => { updateVolumeThrottled(lyricsVolume.value); updatePlayback(); });
    lyricsVolume.addEventListener('wheel', event => { handleVolumeWheel(event); updatePlayback(); }, { passive: false });
    document.getElementById('lyrics-volume-button').addEventListener('click', () => { toggleMute(); updatePlayback(); });
    document.getElementById('lyrics-prev').addEventListener('click', () => playPrev());
    document.getElementById('lyrics-next').addEventListener('click', () => playNext());
    playButton.addEventListener('click', () => { togglePlayback(); updatePlayback(); });
    seek.addEventListener('input', () => {
        if (seek.disabled || !localAudioElement?.getAttribute('src') || isRadioMode) return;
        const position = Number(seek.value) / 100 * (currentTrackDuration || localAudioElement.duration);
        if (isPlaying) startSourceAt(position, false);
        else { pausedAt = position; localAudioElement.currentTime = position; updateSMTCPosition(position); }
        activeIndex = -1; sync();
    });
    autoScrollToggle.addEventListener('change', () => {
        autoFollow = autoScrollToggle.checked; follow = autoFollow;
        appStorage.setItem('setting_lyrics_autoscroll', autoFollow ? '1' : '0');
        activeIndex = -1; sync();
    });
    closeButton.addEventListener('click', close);
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    modal.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
        if (event.key === 'Tab') {
            const buttons = [...modal.querySelectorAll('button:not([hidden]):not(:disabled), input:not([hidden]):not(:disabled)')];
            const first = buttons[0], last = buttons.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
    });
    const stopFollowing = () => { follow = false; };
    content.addEventListener('wheel', stopFollowing, { passive: true });
    content.addEventListener('touchstart', stopFollowing, { passive: true });
    content.addEventListener('pointerdown', stopFollowing);
    followButton.addEventListener('click', () => { follow = true; activeIndex = -1; sync(); });
    retry.addEventListener('click', load);
    toggle.addEventListener('change', () => {
        enabled = toggle.checked; appStorage.setItem('setting_lyrics_enabled', enabled ? '1' : '0');
        openButtons.forEach(button => { button.hidden = !enabled; });
        settingsBody.style.display = enabled ? 'block' : 'none';
        appearanceSection.style.display = enabled ? 'flex' : 'none';
        if (!enabled && opened) close();
        clear();
    });
    window.setLyricsTrack = (metadata, token) => {
        if (track && metadata && track.token === token && Boolean(track.radio) === Boolean(metadata.radio) && track.stationName === metadata.stationName && track.title === metadata.title && track.artist === metadata.artist) {
            const gainedDuration = !track.duration && metadata.duration > 0;
            track.duration = metadata.duration || track.duration;
            if (gainedDuration && opened) load();
            return;
        }
        if (track?.radio) cancelRadioArtwork();
        artworkSerial++; artworkKey = ''; remoteCover = ''; artworkRequestId = null; setArtworkState('idle');
        const wasRadio = Boolean(track?.radio);
        track = metadata ? { ...metadata, token } : null;
        if (track?.radio) setLyricsAvailability(true);
        else if (wasRadio) setLyricsAvailability(false);
        if (opened) load(); else clear();
        if (metadata) updateCacheStats();
    };
})();
