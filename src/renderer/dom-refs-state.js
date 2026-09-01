        const mainPlayer = document.getElementById('main-player');
        const miniPlayer = document.getElementById('mini-player');
        const btnMinimize = document.getElementById('btn-minimize');
        const btnExpand = document.getElementById('btn-expand');
        
        const playlistElem = document.getElementById('playlist');
        const playlistsDropdown = document.getElementById('playlists-dropdown');
        const playlistsDropdownMenu = document.getElementById('playlists-dropdown-menu');
        const pdSelectedIcon = document.getElementById('pd-selected-icon');
        const pdSelectedLabel = document.getElementById('pd-selected-label');

        // Custom dropdown open/close
        playlistsDropdown.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = playlistsDropdownMenu.classList.toggle('open');
            playlistsDropdown.classList.toggle('open', isOpen);
        });
        document.addEventListener('click', () => {
            playlistsDropdownMenu.classList.remove('open');
            playlistsDropdown.classList.remove('open');
        });
        playlistsDropdownMenu.addEventListener('click', (e) => e.stopPropagation());

        function getPlaylistIcon(pl) {
            if (!pl) return 'list-music';
            if (pl.type === 'radio') return 'radio';
            return 'folder-open';
        }

        const btnCreatePlaylist = document.getElementById('btn-create-playlist');
        const btnEditPlaylist = document.getElementById('btn-edit-playlist');
        const btnDeletePlaylist = document.getElementById('btn-delete-playlist');
        
        const trackTitle = document.getElementById('track-title');
        const trackArtist = document.getElementById('track-artist');
        const miniTrackTitle = document.getElementById('mini-track-title');
        const miniMarqueeContainer = document.getElementById('mini-marquee-container');
        const statusText = document.getElementById('status-text');
        const themeToggle = document.getElementById('theme-toggle');
        const canvas = document.getElementById('visualizer');
        const ctx = canvas.getContext('2d');

        const btnPlayPause = document.getElementById('btn-play-pause');
        const btnPrev = document.getElementById('btn-prev');
        const btnNext = document.getElementById('btn-next');
        const btnShuffle = document.getElementById('btn-shuffle');
        const btnRepeat = document.getElementById('btn-repeat');
        const progressWrapper = document.getElementById('progress-wrapper');
        const progressFill = document.getElementById('progress-fill');
        const timeCurrent = document.getElementById('time-current');
        const timeTotal = document.getElementById('time-total');
        const volumeSlider = document.getElementById('volume-slider');

        const miniBtnPlayPause = document.getElementById('mini-btn-play-pause');
        const miniBtnPrev = document.getElementById('mini-btn-prev');
        const miniBtnNext = document.getElementById('mini-btn-next');
        const miniBtnShuffle = document.getElementById('mini-btn-shuffle');
        const miniBtnRepeat = document.getElementById('mini-btn-repeat');
        const miniVolumeSlider = document.getElementById('mini-volume-slider');

        const openEqBtn = document.getElementById('open-eq-btn');
        const closeEqBtn = document.getElementById('close-eq-btn');
        const eqModal = document.getElementById('eq-modal');
        const eqToggle = document.getElementById('eq-toggle');
        const slidersWrapper = document.getElementById('sliders-wrapper');
        const presetsContainer = document.getElementById('presets-container');
        const customPresetName = document.getElementById('custom-preset-name');
        const btnSavePreset = document.getElementById('btn-save-preset');
        const contextMenu = document.getElementById('context-menu');

        // ── Мост к main-процессу (после включения contextIsolation) ────────
        // Раньше рендерер напрямую делал require('electron')/require('fs') —
        // теперь единственная точка входа это window.noctune, опубликованный
        // preload-скриптом через contextBridge. Явную const-переменную здесь
        // НЕ объявляем: contextBridge.exposeInMainWorld создаёт свойство
        // window.noctune как non-configurable, а движок JS запрещает
        // объявлять const/let на верхнем уровне скрипта с именем, которое уже
        // занято таким non-configurable глобальным свойством — это кидает
        // "Identifier 'noctune' has already been declared" ещё до первой
        // строки. Просто используем window.noctune напрямую везде ниже;
        // бэйр-идентификатор noctune и так резолвится в window.noctune через
        // обычную цепочку области видимости.

        // ── Синхронный shim поверх electron-store (замена localStorage) ────
        // Повторяет API localStorage 1:1 (getItem/setItem/removeItem), чтобы
        // не переписывать десятки мест использования по всему рендереру —
        // но данные реально хранятся в electron-store (userData), а не в
        // движке страницы, и переживают очистку данных сайта/куки.
        const appStorage = (function () {
            let cache = {};
            try { cache = noctune.storage.getAll() || {}; } catch (e) { cache = {}; }
            return {
                getItem(key) {
                    return Object.prototype.hasOwnProperty.call(cache, key) ? cache[key] : null;
                },
                setItem(key, value) {
                    const strVal = String(value);
                    cache[key] = strVal;
                    try { noctune.storage.set(key, strVal); } catch (e) {}
                },
                removeItem(key) {
                    delete cache[key];
                    try { noctune.storage.remove(key); } catch (e) {}
                }
            };
        })();

        // ── Пауза requestAnimationFrame-циклов при сворачивании в трей ─────
        // Читается визуализатором/звёздами/конфетти/фоном (см. visualizer.js,
        // background-fx.js, confetti.js) — если true, эти циклы продолжают
        // "тикать" (дёшево), но пропускают тяжёлую отрисовку.
        window._rafSuspended = false;
        noctune.onWindowTrayVisibility((visible) => {
            window._rafSuspended = !visible;
        });

        // Команды из трея
        noctune.onTrayCmd((cmd) => {
            if (cmd === 'toggle' || cmd === 'playpause') togglePlayback();
            else if (cmd === 'play')  { if (!isPlaying) togglePlayback(); }
            else if (cmd === 'pause') { if (isPlaying)  togglePlayback(); }
            else if (cmd === 'prev') playPrev();
            else if (cmd === 'next') playNext();
            else if (cmd === 'check-updates') {
                // Открываем вкладку "О программе" — проверка уже идёт в main процессе
                const settingsModal = document.getElementById('settings-modal');
                if (settingsModal) {
                    settingsModal.style.display = 'flex';
                    document.querySelectorAll('.settings-nav-item').forEach(n => n.classList.remove('active'));
                    document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
                    const aboutNav = document.querySelector('[data-tab="about"]');
                    if (aboutNav) { aboutNav.classList.add('active'); document.getElementById('panel-about')?.classList.add('active'); }
                }
            }
        });

        // Отвечаем main.js на запрос о состоянии воспроизведения + настройке трея
        noctune.onQueryPlayingState(() => {
            const trayEl = document.getElementById('setting-minimize-to-tray');
            const minimizeToTray = !trayEl || trayEl.checked;
            noctune.sendPlayingStateResponse(isPlaying === true, minimizeToTray);
        });

        // ── Discord Rich Presence: кнопка «Слушать» у друга ────────────────
        // Друг кликнул кнопку на чьём-то статусе в Discord → main-процесс
        // распарсил noctune://radio?... и прислал название+URL станции сюда.
        // Создаём (или используем существующий) плейлист «Discord RPC» и
        // сразу запускаем эту радиостанцию у себя.
        noctune.onDeepLinkRadio(async (payload) => {
            try {
                const { name, url } = payload || {};
                if (!url) return;
                const PL_NAME = 'Discord RPC';
                let pl = userPlaylists.find(p => p.type === 'radio' && p.name === PL_NAME);
                if (!pl) {
                    pl = { id: 'pl_' + Date.now(), name: PL_NAME, type: 'radio', path: null, stations: [] };
                    userPlaylists.push(pl);
                }
                if (!pl.stations.some(s => s.url === url)) {
                    pl.stations.push({ name: name || 'Радиостанция', url });
                }
                savePlaylistsToStorage();
                renderPlaylistsDropdown();
                _updateDropdownSelected(pl.id);
                await selectPlaylist(pl.id);

                const absId = fileEntries.findIndex(en => en && en.kind === 'radio' && en.path === url);
                const orderIdx = absId !== -1 ? playlistOrder.indexOf(absId) : -1;
                if (orderIdx !== -1) playTrack(orderIdx);
                showNotification(`Друг поделился радиостанцией «${name || 'Радио'}» — запускаем`, 'success');
            } catch (e) {
                console.error('Не удалось обработать ссылку радиостанции:', e);
            }
        });

        // Глобальное состояние
        let userPlaylists = []; 
        let currentPlaylistId = null;   // currently viewed playlist
        let activePlaylistId = null;    // playlist currently playing from

        let fileEntries = [];
        let playlistOrder = []; 
        let parsedMetadataCache = {}; 
        let currentIndex = -1;
        let selectedTrackIndexInMenu = -1;
        let playNextIndex = -1;

        let isShuffle = false;
        let repeatMode = 0; // 0=выкл, 1=повтор трека, 2=повтор плейлиста

        // Виртуальный перемешанный плейлист.
        // shuffleList[i] = orderIndex (позиция в playlistOrder).
        // Создаётся один раз при включении shuffle или загрузке плейлиста.
        // currentShufflePos — текущая позиция курсора в shuffleList.
        let shuffleList = [];
        let currentShufflePos = -1;

        let audioCtx, analyzer, sourceNode, mediaElementSourceNode = null, eqFilters = [];
        let audioBufferSource = null; 
        let radioAudioElement = null; 
        let localAudioElement = null;      // HTMLAudioElement для локальных треков
        let localMediaSource = null;       // MediaElementSourceNode для localAudioElement
        let radioMetadataAbort = null;
        let currentRadioTrack = '';
        let isPlaying = false;
        let isRadioMode = false;
        let startTime = 0; 
        let pausedAt = 0;  

