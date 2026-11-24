        function showPlaylistTrackMenu(event, index) {
            const entry = fileEntries[index];
            if (!entry) return;
            document.dispatchEvent(new Event('playlist-context-menu-open'));
            selectedTrackIndexInMenu = index;
            updateTrackCoverMenu(index);
            const radio = entry.kind === 'radio';
            document.getElementById('menu-edit-radio').style.display = radio ? 'flex' : 'none';
            document.getElementById('menu-check-radio').style.display = radio ? 'flex' : 'none';
            document.getElementById('menu-play-next').style.display = radio ? 'none' : 'flex';
            contextMenu.style.display = 'block';
            contextMenu.style.left = Math.max(8, Math.min(event.clientX, innerWidth - contextMenu.offsetWidth - 8)) + 'px';
            contextMenu.style.top = Math.max(8, Math.min(event.clientY, innerHeight - contextMenu.offsetHeight - 8)) + 'px';
            for (const button of contextMenu.querySelectorAll('button')) button.setAttribute('role', 'menuitem');
            contextMenu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
        }

        let trackCoverMenuSerial = 0;
        let trackCoverMenuInfo = null;
        async function updateTrackCoverMenu(index) {
            const serial = ++trackCoverMenuSerial;
            const button = document.getElementById('menu-track-cover');
            const entry = fileEntries[index];
            window.updateTrackTagMenu?.(entry);
            trackCoverMenuInfo = null;
            button.style.display = entry && entry.kind !== 'radio' ? 'flex' : 'none';
            button.disabled = true;
            button.querySelector('span').textContent = (globalThis.noctuneI18n?.t("player.interface.refreshArtwork", {}) ?? "Обновить обложку");
            if (!entry || entry.kind === 'radio') return;
            try {
                const info = await window.getTrackCoverCacheInfo(index, entry);
                if (serial !== trackCoverMenuSerial || fileEntries[index] !== entry) return;
                trackCoverMenuInfo = info;
                button.querySelector('span').textContent = info.cached ? (globalThis.noctuneI18n?.t("library.playlists.deleteArtworkCache", {}) ?? "Удалить кэш обложки") : (globalThis.noctuneI18n?.t("player.interface.refreshArtwork", {}) ?? "Обновить обложку");
                button.disabled = false;
            } catch (_) {
                if (serial === trackCoverMenuSerial) button.querySelector('span').textContent = (globalThis.noctuneI18n?.t("library.playlists.artworkUnavailable", {}) ?? "Обложка недоступна");
            }
        }

        document.getElementById('menu-track-cover').addEventListener('click', async () => {
            const info = trackCoverMenuInfo;
            if (!info) return;
            trackCoverMenuInfo = null;
            try {
                await window.changeTrackCover(info.payload, info.cached);
                if (info.cached) showNotification((globalThis.noctuneI18n?.t("library.playlists.artworkCacheDeleted", {}) ?? "Кэш обложки удалён."), 'info', (globalThis.noctuneI18n?.t("miniPlayer.trackArtwork", {}) ?? "Обложка трека"));
            } catch (error) {
                showNotification((globalThis.noctuneI18n?.t("library.playlists.couldNotChangeArtwork", {}) ?? "Не удалось изменить обложку."), 'error', (globalThis.noctuneI18n?.t("miniPlayer.trackArtwork", {}) ?? "Обложка трека"), String(error && error.message || error));
            }
        });

        function savePlaylistsToStorage() {
            appStorage.setItem('noctune_playlists', JSON.stringify(userPlaylists.filter(pl => pl.type !== 'provider')));
            globalThis.addonEvents?.playlistsChanged?.();
        }

        function loadPlaylistsFromStorage() {
            const stored = appStorage.getItem('noctune_playlists');
            if (stored) {
                try { userPlaylists = JSON.parse(stored); } catch(e) { userPlaylists = []; }
            }
            renderPlaylistsDropdown();
        }

        btnCreatePlaylist.addEventListener('click', () => {
            document.getElementById('playlist-name-input').value = '';
            document.getElementById('playlist-modal').style.display = 'flex';
        });

        document.getElementById('btn-choose-folder').addEventListener('click', async () => {
            const name = document.getElementById('playlist-name-input').value.trim() || (globalThis.noctuneI18n?.t("library.openAudioFiles.newPlaylist", {}) ?? "Новый плейлист");
            document.getElementById('playlist-modal').style.display = 'none';
            
            const newPl = {
                id: 'pl_' + Date.now(),
                name: name,
                type: 'folder',
                path: null,
                files: [],
                stations: []
            };
            userPlaylists.push(newPl);
            savePlaylistsToStorage();
            renderPlaylistsDropdown();
            _updateDropdownSelected(newPl.id);
            selectPlaylist(newPl.id);
        });

        document.getElementById('btn-choose-radio').addEventListener('click', () => {
            const name = document.getElementById('playlist-name-input').value.trim() || (globalThis.noctuneI18n?.t("library.playlists.internetRadio", {}) ?? "Интернет Радио");
            document.getElementById('playlist-modal').style.display = 'none';
            
            const newPl = {
                id: 'pl_' + Date.now(),
                name: name,
                type: 'radio',
                path: null,
                stations: []
            };
            userPlaylists.push(newPl);
            savePlaylistsToStorage();
            renderPlaylistsDropdown();
            _updateDropdownSelected(newPl.id);
            selectPlaylist(newPl.id);
        });

        function renderPlaylistsDropdown() {
            playlistsDropdownMenu.innerHTML = '';
            if (userPlaylists.length === 0) {
                playlistsDropdownMenu.innerHTML = ("<div class=\"pd-menu-empty\">" + (globalThis.noctuneI18n?.t("player.interface.noPlaylists", {}) ?? "Нет плейлистов") + "</div>");
                pdSelectedLabel.textContent = (globalThis.noctuneI18n?.t("player.interface.noPlaylists", {}) ?? "Нет плейлистов");
                pdSelectedIcon.innerHTML = '<i data-lucide="list-music" style="width:15px;height:15px;"></i>';
                btnEditPlaylist.disabled = true;
                btnDeletePlaylist.disabled = true;
                lucide.createIcons();
                return;
            }

            btnEditPlaylist.disabled = false;
            btnDeletePlaylist.disabled = false;

            userPlaylists.forEach(pl => {
                const iconName = getPlaylistIcon(pl);
                const item = document.createElement('div');
                item.className = 'pd-menu-item' + (pl.id === currentPlaylistId ? ' active' : '');
                item.setAttribute('data-value', pl.id);
                item.setAttribute('role', 'option');
                item.innerHTML = `
                    <span class="pd-item-icon"><i data-lucide="${iconName}" style="width:15px;height:15px;"></i></span>
                    <span class="pd-item-label"></span>
                `;
                item.querySelector('.pd-item-label').textContent=pl.name;
                if(pl.type==='provider'){const badge=document.createElement('span');badge.className='pd-service-type';badge.textContent=pl.service?.continuous?(globalThis.noctuneI18n?.t("library.playlists.stream", {}) ?? "Поток"):(globalThis.noctuneI18n?.t("library.playlists.service", {}) ?? "Сервис");item.append(badge);item.title=(pl.serviceName||(globalThis.noctuneI18n?.t("addonInstall.app.integration", {}) ?? "Интеграция"))+' · '+pl.name;}
                item.addEventListener('click', () => {
                    selectPlaylist(pl.id);
                    playlistsDropdownMenu.classList.remove('open');
                    playlistsDropdown.classList.remove('open');
                });
                playlistsDropdownMenu.appendChild(item);
            });

            if (currentPlaylistId) {
                _updateDropdownSelected(currentPlaylistId);
            }
            lucide.createIcons();
        }

        function _updateDropdownSelected(id) {
            const pl = userPlaylists.find(p => p.id === id);
            if (!pl) return;
            const iconName = getPlaylistIcon(pl);
            pdSelectedLabel.textContent = pl.name;
            btnEditPlaylist.disabled=pl.type==='provider';btnDeletePlaylist.disabled=false;
            btnDeletePlaylist.title=pl.type==='provider'?(globalThis.noctuneI18n?.t("library.playlists.closeServicePlaylist", {}) ?? "Закрыть сервисный плейлист"):(globalThis.noctuneI18n?.t("player.interface.deletePlaylist", {}) ?? "Удалить плейлист");
            pdSelectedIcon.innerHTML = `<i data-lucide="${iconName}" style="width:15px;height:15px;"></i>`;
            // Update active state in menu
            playlistsDropdownMenu.querySelectorAll('.pd-menu-item').forEach(item => {
                item.classList.toggle('active', item.getAttribute('data-value') === id);
            });
            lucide.createIcons();
        }

        let renamePlaylistId = null, deletePlaylistId = null;
        function openPlaylistRename(id = currentPlaylistId) {
            const pl = userPlaylists.find(p => p.id === id);
            if (!pl || pl.type === 'provider') return;
            renamePlaylistId = id;

            document.getElementById('playlist-rename-input').value = pl.name;
            document.getElementById('rename-modal').style.display = 'flex';
            document.getElementById('playlist-rename-input').focus();
        }
        window.openPlaylistRename = openPlaylistRename;
        btnEditPlaylist.addEventListener('click', () => openPlaylistRename());

        document.getElementById('btn-save-rename').addEventListener('click', () => {
            const newName = document.getElementById('playlist-rename-input').value.trim();
            if (!newName || !renamePlaylistId) return;

            const pl = userPlaylists.find(p => p.id === renamePlaylistId);
            if (pl) {
                pl.name = newName;
                savePlaylistsToStorage();
                renderPlaylistsDropdown();
                window.renderPlEditor?.();
            }
            document.getElementById('rename-modal').style.display = 'none';
        });

        function openPlaylistDelete(id = currentPlaylistId) {
            const pl = userPlaylists.find(p => p.id === id);
            if (!pl) return;
            if(pl.type==='provider'){window.addonProviders.closeCollection(pl.id);window.renderPlEditor?.();return;}
            deletePlaylistId = id;
            const prefix = pl.type === 'folder' ? '📁' : '📻';
            document.getElementById('delete-playlist-modal-msg').textContent =
                (globalThis.noctuneI18n?.t("library.playlists.areYouSureYouWantToDeleteThePlaylistThisCannotBeUndone", {p0: (prefix), p1: (pl.name)}) ?? "Вы уверены, что хотите удалить плейлист {p0} «{p1}»? Это действие нельзя отменить.".replace(/\{(p\d+)\}/g, (_, k) => ({p0: (prefix), p1: (pl.name)})[k] ?? "{"+k+"}"));
            document.getElementById('delete-playlist-modal').style.display = 'flex';
            lucide.createIcons();
        }
        window.openPlaylistDelete = openPlaylistDelete;
        btnDeletePlaylist.addEventListener('click', () => openPlaylistDelete());

        function closeDeleteModal() {
            document.getElementById('delete-playlist-modal').style.display = 'none';
        }

        document.getElementById('btn-delete-modal-close').addEventListener('click', closeDeleteModal);
        document.getElementById('btn-delete-modal-cancel').addEventListener('click', closeDeleteModal);

        document.getElementById('btn-delete-modal-confirm').addEventListener('click', () => {
            closeDeleteModal();
            const deletedId = deletePlaylistId;
            deletePlaylistId = null;
            if (!userPlaylists.some(pl => pl.id === deletedId)) return;
            const wasSelected = deletedId === currentPlaylistId;
            const wasActivePlaying = (deletedId === activePlaylistId);

            userPlaylists = userPlaylists.filter(p => p.id !== deletedId);
            savePlaylistsToStorage();

            if (wasActivePlaying) {
                stopTrack();
                fileEntries = [];
                playlistOrder = [];
                activePlaylistId = null;
            }

            window.renderPlEditor?.();
            if (!wasSelected) {
                renderPlaylistsDropdown();
                if (wasActivePlaying && currentPlaylistId) selectPlaylist(currentPlaylistId);
                return;
            }
            if (userPlaylists.length > 0) {
                currentPlaylistId = userPlaylists[0].id;
                renderPlaylistsDropdown();
                selectPlaylist(currentPlaylistId);
            } else {
                currentPlaylistId = null;
                renderPlaylistsDropdown();
                playlistElem.innerHTML = ("<li style=\"color: gray; font-style: italic; pointer-events: none;\">" + (globalThis.noctuneI18n?.t("library.playlists.createAPlaylist", {}) ?? "Создайте плейлист") + "</li>");
                statusText.textContent = (globalThis.noctuneI18n?.t("library.playlists.noPlaylists", {}) ?? "Нет списков воспроизведения");
            }
        });

        async function selectPlaylist(id) {
            currentPlaylistId = id;
            const pl = userPlaylists.find(p => p.id === id);
            if (!pl) return;

            _updateDropdownSelected(id);
            updatePlaylistActionsBar();
            
            if (pl.type === 'folder') {
                if (!pl.path && (!pl.files || pl.files.length === 0)) {
                    // Empty playlist — show placeholder
                    fileEntries = [];
                    playlistOrder = [];
                    parsedMetadataCache = {};
                    playlistElem.innerHTML = ("<li style=\"color:var(--text-muted);font-style:italic;pointer-events:none;\">" + (globalThis.noctuneI18n?.t("library.playlists.addFilesOrAFolderUsingTheButtonsAbove", {}) ?? "Добавьте файлы или папку через кнопки выше") + "</li>");
                    statusText.textContent = (globalThis.noctuneI18n?.t("library.playlists.playlistIsEmpty", {}) ?? "Плейлист пуст");
                } else if (!pl.path && pl.files && pl.files.length > 0) {
                    // Playlist has individually added files — restore them
                    await loadMusicFromFiles(pl.files);
                } else {
                    await loadMusicFromDirectory(pl.path);
                    if (pl.files?.length) await addFilesToPlaylist(pl.files, pl.id);
                }
            } else if (pl.type === 'provider') {
                window.addonProviders.render(pl);
            } else if (pl.type === 'radio') {
                loadRadioStations(pl);
            }
        }

        function loadRadioStations(playlistObj) {
            fileEntries = [];
            playlistOrder = [];
            parsedMetadataCache = {};
            playlistElem.innerHTML = '';
            currentIndex = -1;
            shuffleList = []; currentShufflePos = -1;

            // Pin "Add station" button at TOP
            const addLi = document.createElement('li');
            addLi.className = 'add-station-item';
            addLi.style.position = 'sticky';
            addLi.style.top = '0';
            addLi.style.zIndex = '2';
            addLi.innerHTML = ("\n                <i data-lucide=\"plus-circle\" style=\"width: 16px; height: 16px; margin-right: 8px; flex-shrink:0;\"></i>\n                <span>" + (globalThis.noctuneI18n?.legacyHtml("library.playlists.addRadioStation", {}) ?? "Добавить радиостанцию...".replace(/\{p(\d+)\}/g, (_, i) => Object.values({})[i])) + "</span>\n            ");
            addLi.addEventListener('click', () => {
                editingRadioIndex = -1;
                document.querySelector('#radio-modal h3').textContent = (globalThis.noctuneI18n?.t("player.interface.addRadioStation", {}) ?? "Добавить Радиостанцию");
                document.getElementById('btn-save-radio').textContent = (globalThis.noctuneI18n?.t("player.interface.add", {}) ?? "Добавить");
                document.getElementById('radio-name-input').value = '';
                document.getElementById('radio-url-input').value = '';
                document.querySelectorAll('.radio-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.radio-tab-content').forEach(c => c.classList.remove('active'));
                document.querySelector('[data-target="tab-manual"]').classList.add('active');
                document.getElementById('tab-manual').classList.add('active');
                document.getElementById('radio-tabs-container').style.display = 'flex';
                document.getElementById('radio-modal').style.display = 'flex';
            });
            playlistElem.appendChild(addLi);

            if (playlistObj.stations && playlistObj.stations.length > 0) {
                playlistObj.stations.forEach((station, index) => {
                    fileEntries.push({
                        name: station.name,
                        path: station.url,
                        kind: 'radio'
                    });
                    playlistOrder.push(index);

                    const li = document.createElement('li');
                    li.setAttribute('data-id', index);
                    li.innerHTML = ("\n                        <div class=\"track-name-block\">\n                            <div class=\"track-title-item\">" + (station.name) + "</div>\n                            <div class=\"track-artist-item\">" + (globalThis.noctuneI18n?.legacyHtml("player.interface.radioStream", {p0: (station.name), p1: (index), p2: (index)}) ?? "Поток Радио".replace(/\{p(\d+)\}/g, (_, i) => Object.values({p0: (station.name), p1: (index), p2: (index)})[i])) + "</div>\n                        </div>\n                        <span class=\"radio-status-badge checking\" id=\"radio-status-" + (index) + "\" title=\"" + (globalThis.noctuneI18n?.legacyHtml("library.playlists.clickToCheckAgain", {p0: (station.name), p1: (index), p2: (index)}) ?? "Нажмите, чтобы проверить ещё раз".replace(/\{p(\d+)\}/g, (_, i) => Object.values({p0: (station.name), p1: (index), p2: (index)})[i])) + "\">...</span>\n                        <button class=\"actions-btn radio-item-action\" data-id=\"" + (index) + "\"><i data-lucide=\"more-vertical\"></i></button>\n                    ");

                    li.addEventListener('click', (e) => {
                        if (e.target.closest('.actions-btn')) return;
                        if (e.target.closest('.radio-status-badge')) return;
                        playTrack(playlistOrder.indexOf(index));
                    });

                    playlistElem.appendChild(li);
                });
            }

            lucide.createIcons();

            // Клик по самому бейджу — быстрая ручная перепроверка станции,
            // без похода в контекстное меню.
            playlistElem.querySelectorAll('.radio-status-badge').forEach((badge) => {
                badge.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const idx = parseInt(badge.id.replace('radio-status-', ''));
                    const entry = fileEntries[idx];
                    if (entry) checkOneRadioStation(entry.path, badge);
                });
            });

            document.querySelectorAll('.radio-item-action').forEach(b => {
                b.addEventListener('click', (e) => {
                    e.stopPropagation();
                    showPlaylistTrackMenu(e, parseInt(e.currentTarget.getAttribute('data-id')));
                });
            });

            statusText.textContent = (globalThis.noctuneI18n?.t("library.playlists.availableStations", {p0: (fileEntries.length)}) ?? "Доступно станций: {p0}".replace(/\{(p\d+)\}/g, (_, k) => ({p0: (fileEntries.length)})[k] ?? "{"+k+"}"));

            // Start pinging stations in background (batch of 3)
            checkRadioStations(playlistObj.stations);
        }

        // Автоматическая (при загрузке плейлиста) и ручная (клик по бейджу
        // или пункт контекстного меню) проверка доступности станции идут
        // через noctune.checkRadioStation — это запрос из Node в preload,
        // а не fetch() из рендерера, поэтому CORS не мешает: раньше у
        // большинства радио-серверов не было нужных CORS-заголовков, и
        // проверка либо ошибочно показывала "Offline", либо вовсе падала
        // ещё до отправки запроса.
        async function checkOneRadioStation(url, badgeEl) {
            if (!badgeEl) return;
            badgeEl.textContent = '...';
            badgeEl.className = 'radio-status-badge checking';
            try {
                const { online } = await noctune.checkRadioStation(url);
                badgeEl.textContent = online ? 'Online' : 'Offline';
                badgeEl.className = 'radio-status-badge ' + (online ? 'online' : 'offline');
            } catch (e) {
                badgeEl.textContent = 'Offline';
                badgeEl.className = 'radio-status-badge offline';
            }
        }

        async function checkRadioStations(stations) {
            if (!stations || stations.length === 0) return;
            const BATCH = 3;
            for (let i = 0; i < stations.length; i += BATCH) {
                const batch = stations.slice(i, i + BATCH);
                await Promise.all(batch.map((station, batchIdx) => {
                    const idx = i + batchIdx;
                    const badge = document.getElementById(`radio-status-${idx}`);
                    return checkOneRadioStation(station.url, badge);
                }));
                // Небольшая пауза между партиями, чтобы не заваливать сеть/CPU
                await new Promise(r => setTimeout(r, 300));
            }
        }

        let editingRadioIndex = -1;

        document.getElementById('btn-save-radio').addEventListener('click', () => {
            const name = document.getElementById('radio-name-input').value.trim();
            const url = document.getElementById('radio-url-input').value.trim();

            if (!name || !url) return;

            const pl = userPlaylists.find(p => p.id === currentPlaylistId);

            if (pl && pl.type === 'radio') {

                if (editingRadioIndex !== -1) {
                    pl.stations[editingRadioIndex] = { name, url };
                }
                else {
                    pl.stations.push({ name, url });
                }

                savePlaylistsToStorage();
                loadRadioStations(pl);
            }

            editingRadioIndex = -1;

            document.querySelector('#radio-modal h3').textContent = (globalThis.noctuneI18n?.t("player.interface.addRadioStation", {}) ?? "Добавить Радиостанцию");
            document.getElementById('btn-save-radio').textContent = (globalThis.noctuneI18n?.t("player.interface.add", {}) ?? "Добавить");

            document.getElementById('radio-modal').style.display = 'none';
        });

        // Show/hide actions bar based on current playlist type
        function updatePlaylistActionsBar() {
            const pl = userPlaylists.find(p => p.id === currentPlaylistId);
            const isFolder = pl && pl.type === 'folder';
            document.getElementById('btn-add-files').style.display = isFolder ? '' : 'none';
            document.getElementById('btn-add-folder').style.display = isFolder ? '' : 'none';
            document.getElementById('btn-refresh-playlist').style.display = isFolder ? '' : 'none';
        }

        // Append only new tracks (by path) without reloading whole playlist
        async function appendNewTracksFromDirectory(dirPath, isManual = false) {
            const pl = userPlaylists.find(p => p.id === currentPlaylistId);
            const targetDir = dirPath || (pl && pl.path);
            if (!targetDir) return;
            try {
                if (!(await noctune.fs.exists(targetDir))) throw new Error('dir-not-found');
                const files = await noctune.fs.readDir(targetDir);
                const existingPaths = new Set(fileEntries.map(e => e.path));
                const newFiles = files.filter(f => isAudioFile(f) && !existingPaths.has(noctune.fs.joinPath(targetDir, f)));
                if (newFiles.length === 0) { if (isManual) statusText.textContent = (globalThis.noctuneI18n?.t("library.playlists.noNewFilesFound", {}) ?? "Новых файлов не найдено"); return; }

                for (const fileName of newFiles) {
                    const fullPath = noctune.fs.joinPath(targetDir, fileName);
                    const trackIndex = fileEntries.length;
                    fileEntries.push({ name: fileName, path: fullPath, kind: 'file' });
                    playlistOrder.push(trackIndex);

                    const fallbackName = fileName.replace(/\.[^/.]+$/, '');
                    const li = document.createElement('li');
                    li.setAttribute('data-id', trackIndex);
                    li.innerHTML = ("\n                        <img class=\"track-cover-thumb\" id=\"cover-" + (trackIndex) + "\" alt=\"\">\n                        <div class=\"track-cover-placeholder\" id=\"cover-ph-" + (trackIndex) + "\">\n                            <i data-lucide=\"music\" style=\"width:16px;height:16px;\"></i>\n                        </div>\n                        <div class=\"track-name-block\">\n                            <div class=\"track-title-item\" id=\"title-" + (trackIndex) + "\">" + (fallbackName) + "</div>\n                            <div class=\"track-artist-item\" id=\"artist-" + (trackIndex) + "\">" + (globalThis.noctuneI18n?.legacyHtml("library.playlists.loading", {p0: (trackIndex), p1: (trackIndex), p2: (trackIndex), p3: (fallbackName), p4: (trackIndex), p5: (trackIndex), p6: (trackIndex)}) ?? "Загрузка...".replace(/\{p(\d+)\}/g, (_, i) => Object.values({p0: (trackIndex), p1: (trackIndex), p2: (trackIndex), p3: (fallbackName), p4: (trackIndex), p5: (trackIndex), p6: (trackIndex)})[i])) + "</div>\n                        </div>\n                        <div class=\"track-meta\" id=\"meta-" + (trackIndex) + "\">--:--</div>\n                        <button class=\"actions-btn track-item-action\" data-id=\"" + (trackIndex) + "\"><i data-lucide=\"more-vertical\"></i></button>\n                    ");
                    li.addEventListener('click', (e) => {
                        if (e.target.closest('.actions-btn')) return;
                        playTrack(playlistOrder.indexOf(trackIndex));
                    });
                    li.querySelector('.track-item-action').addEventListener('click', (e) => {
                        e.stopPropagation();
                        showPlaylistTrackMenu(e, trackIndex);
                    });
                    playlistElem.appendChild(li);
                }

                lucide.createIcons();
                statusText.textContent = (globalThis.noctuneI18n?.t("library.playlists.tracksLoaded", {p0: (fileEntries.length)}) ?? "Загружено треков: {p0}".replace(/\{(p\d+)\}/g, (_, k) => ({p0: (fileEntries.length)})[k] ?? "{"+k+"}"));

                // Обработка метаданных только для новых треков
                const startIdx = fileEntries.length - newFiles.length;
                const BATCH_SIZE = 5;

                for (let i = startIdx; i < fileEntries.length; i += BATCH_SIZE) {
                    const batch = fileEntries.slice(i, Math.min(i + BATCH_SIZE, fileEntries.length));
                    
                    await Promise.all(batch.map(async (entry, bIdx) => {
                        const trackIndex = i + bIdx;
                        try {
                            const filePath = entry.path;
                            // Единый вызов вместо fs.stat + fs.readFile + самописного
                            // ID3-парсера + отдельного зонда длительности через <audio> —
                            // music-metadata (в preload) отдаёт всё сразу и для любых
                            // форматов (MP3/FLAC/OGG/WAV/M4A), а не только MP3.
                            const meta = await readFileMetadata(filePath, entry.name);
                            entry._fileSize = meta.fileSize;

                            const duration = meta.duration;
                            const kbps = meta.kbps;

                            // Сохраняем в кэш полный объект
                            parsedMetadataCache[trackIndex] = meta;

                            // 3. Обновляем UI
                            const titleElem = document.getElementById(`title-${trackIndex}`);
                            const artistElem = document.getElementById(`artist-${trackIndex}`);
                            const metaElem = document.getElementById(`meta-${trackIndex}`);

                            if (titleElem && meta.title) titleElem.textContent = meta.title;
                            if (artistElem && meta.artist) artistElem.textContent = meta.artist;
                            if (metaElem) metaElem.textContent = duration > 0 ? `${formatTime(duration)} | ${kbps}kbps` : '--:--';

                            window.updateTrackArtwork(trackIndex, meta, filePath);

                        } catch(e) {
                            console.warn((globalThis.noctuneI18n?.t("library.playlists.errorParsingFile", {p0: (entry.name)}) ?? "Ошибка парсинга файла {p0}:".replace(/\{(p\d+)\}/g, (_, k) => ({p0: (entry.name)})[k] ?? "{"+k+"}")), e);
                            const artistElem = document.getElementById(`artist-${trackIndex}`);
                            if (artistElem) artistElem.textContent = (globalThis.noctuneI18n?.t("player.interface.unknownArtist", {}) ?? "Неизвестный исполнитель");
                        }
                    }));
                }
            } catch(e) {
                console.error('Auto-refresh error:', e);
            }
        }

        async function validatedAudioPaths(paths) {
            if (!Array.isArray(paths)) return [];
            const candidates = [...new Set(paths.filter(value => typeof value === 'string' && noctune.fs.isAudioExt(value)))];
            const valid = await Promise.all(candidates.map(async filename => {
                try { return (await noctune.fs.stat(filename)).isFile ? filename : null; }
                catch (_) { return null; }
            }));
            return valid.filter(Boolean);
        }

        // Shared by the file dialog, Explorer commands and drag & drop.
        async function addFilesToPlaylist(filePaths, playlistId = currentPlaylistId, { validated = false } = {}) {
            const pl = userPlaylists.find(p => p.id === playlistId);
            if (!pl || pl.type !== 'folder') return [];
            try {
                if (!validated) filePaths = await validatedAudioPaths(filePaths);
                if (!filePaths.length) {
                    statusText.textContent = (globalThis.noctuneI18n?.t("library.playlists.noAvailableMp3WavOggM4aOrFlacAudioFiles", {}) ?? "Нет доступных аудиофайлов MP3, WAV, OGG, M4A или FLAC");
                    return [];
                }
                if (!userPlaylists.includes(pl)) return [];
                pl.files = [...new Set([...(pl.files || []), ...filePaths])];
                savePlaylistsToStorage();
                if (currentPlaylistId !== playlistId) return filePaths;

                const existingPaths = new Set(fileEntries.map(e => e.path));
                const newPaths = filePaths.filter(p => !existingPaths.has(p));
                if (newPaths.length === 0) {
                    statusText.textContent = (globalThis.noctuneI18n?.t("library.playlists.filesAreAlreadyInThePlaylist", {}) ?? "Файлы уже в плейлисте");
                    return [];
                }

                // Remove placeholder if present
                const placeholder = playlistElem.querySelector('li[style*="italic"]');
                if (placeholder) placeholder.remove();

                for (const fullPath of newPaths) {
                    const fileName = fullPath.split(/[/\\]/).pop();
                    const trackIndex = fileEntries.length;
                    fileEntries.push({ name: fileName, path: fullPath, kind: 'file' });
                    playlistOrder.push(trackIndex);

                    const fallbackName = fileName.replace(/\.[^/.]+$/, '');
                    const li = document.createElement('li');
                    li.setAttribute('data-id', trackIndex);
                    li.innerHTML = ("\n                        <img class=\"track-cover-thumb\" id=\"cover-" + (trackIndex) + "\" alt=\"\">\n                        <div class=\"track-cover-placeholder\" id=\"cover-ph-" + (trackIndex) + "\">\n                            <i data-lucide=\"music\" style=\"width:16px;height:16px;\"></i>\n                        </div>\n                        <div class=\"track-name-block\">\n                            <div class=\"track-title-item\" id=\"title-" + (trackIndex) + "\"></div>\n                            <div class=\"track-artist-item\" id=\"artist-" + (trackIndex) + "\">" + (globalThis.noctuneI18n?.legacyHtml("library.playlists.loading", {p0: (trackIndex), p1: (trackIndex), p2: (trackIndex), p3: (trackIndex), p4: (trackIndex), p5: (trackIndex)}) ?? "Загрузка...".replace(/\{p(\d+)\}/g, (_, i) => Object.values({p0: (trackIndex), p1: (trackIndex), p2: (trackIndex), p3: (trackIndex), p4: (trackIndex), p5: (trackIndex)})[i])) + "</div>\n                        </div>\n                        <div class=\"track-meta\" id=\"meta-" + (trackIndex) + "\">--:--</div>\n                        <button class=\"actions-btn track-item-action\" data-id=\"" + (trackIndex) + "\"><i data-lucide=\"more-vertical\"></i></button>\n                    ");
                    li.querySelector('.track-title-item').textContent = fallbackName;
                    li.addEventListener('click', (e) => {
                        if (e.target.closest('.actions-btn')) return;
                        playTrack(playlistOrder.indexOf(trackIndex));
                    });
                    li.querySelector('.track-item-action').addEventListener('click', (e) => {
                        e.stopPropagation();
                        showPlaylistTrackMenu(e, trackIndex);
                    });
                    playlistElem.appendChild(li);
                }

                lucide.createIcons();
                statusText.textContent = (globalThis.noctuneI18n?.t("library.playlists.tracksLoaded", {p0: (fileEntries.length)}) ?? "Загружено треков: {p0}".replace(/\{(p\d+)\}/g, (_, k) => ({p0: (fileEntries.length)})[k] ?? "{"+k+"}"));
                if (isShuffle) buildShuffleList();

                // Process metadata for added files
                const targetEntries = fileEntries;
                const startIdx = fileEntries.length - newPaths.length;
                const BATCH_SIZE = 5;
                for (let i = startIdx; i < targetEntries.length; i += BATCH_SIZE) {
                    if (fileEntries !== targetEntries) return newPaths;
                    const batch = fileEntries.slice(i, Math.min(i + BATCH_SIZE, fileEntries.length));
                    await Promise.all(batch.map(async (entry, bIdx) => {
                        const trackIndex = i + bIdx;
                        try {
                            const filePath = entry.path;
                            const meta = await readFileMetadata(filePath, entry.name);
                            if (fileEntries !== targetEntries) return;
                            entry._fileSize = meta.fileSize;
                            const titleElem = document.getElementById(`title-${trackIndex}`);
                            const artistElem = document.getElementById(`artist-${trackIndex}`);
                            if (titleElem) titleElem.textContent = meta.title;
                            if (artistElem) artistElem.textContent = meta.artist;
                            window.updateTrackArtwork(trackIndex, meta, filePath);
                            const duration = meta.duration;
                            const kbps = meta.kbps;
                            parsedMetadataCache[trackIndex] = meta;
                            const metaElem = document.getElementById(`meta-${trackIndex}`);
                            if (metaElem) metaElem.textContent = duration > 0 ? `${formatTime(duration)} | ${kbps}kbps` : '--:--';
                        } catch(e) {
                            if (fileEntries !== targetEntries) return;
                            const artistElem = document.getElementById(`artist-${i + bIdx}`);
                            if (artistElem) artistElem.textContent = (globalThis.noctuneI18n?.t("player.interface.unknownArtist", {}) ?? "Неизвестный исполнитель");
                        }
                    }));
                }
                return newPaths;
            } catch(e) {
                console.error('Add files error:', e);
                statusText.textContent = (globalThis.noctuneI18n?.t("library.playlists.couldNotAddFiles", {}) ?? "Ошибка добавления файлов");
                return [];
            }
        }

        document.getElementById('btn-add-files').addEventListener('click', async () => {
            const playlistId = currentPlaylistId;
            if (userPlaylists.find(pl => pl.id === playlistId)?.type !== 'folder') return;
            try {
                const files = await noctune.dialogOpenFiles();
                if (files?.length) await addFilesToPlaylist(files, playlistId);
            } catch (error) {
                console.error('Open files dialog:', error);
                statusText.textContent = (globalThis.noctuneI18n?.t("library.playlists.couldNotOpenFileDialog", {}) ?? "Ошибка открытия диалога файлов");
            }
        });

        document.getElementById('btn-add-folder').addEventListener('click', async () => {
            const pl = userPlaylists.find(p => p.id === currentPlaylistId);
            if (!pl || pl.type !== 'folder') return;
            try {
                const dirPath = await noctune.dialogOpenDirectory();
                if (!dirPath) return;
                // Save folder path to playlist so it survives playlist switching
                if (!pl.path) {
                    pl.path = dirPath;
                    savePlaylistsToStorage();
                }
                // Remove placeholder if present
                const placeholder = playlistElem.querySelector('li[style*="italic"]');
                if (placeholder) placeholder.remove();
                await appendNewTracksFromDirectory(dirPath, true);
            } catch(e) {
                console.error('Add folder error:', e);
                statusText.textContent = (globalThis.noctuneI18n?.t("library.playlists.couldNotAddFolder", {}) ?? "Ошибка добавления папки");
            }
        });

        document.getElementById('btn-refresh-playlist').addEventListener('click', () => {
            const pl = userPlaylists.find(p => p.id === currentPlaylistId);
            if (pl && pl.type === 'folder') appendNewTracksFromDirectory(pl.path);
        });

        async function loadMusicFromDirectory(dirPath) {
            try {
                if (!(await noctune.fs.exists(dirPath))) {
                    statusText.textContent = (globalThis.noctuneI18n?.t("library.playlists.folderAccessDenied", {}) ?? "Нет доступа к папке");
                    return;
                }

                fileEntries = [];
                playlistOrder = [];
                parsedMetadataCache = {};
                shuffleList = []; currentShufflePos = -1;
                playlistElem.innerHTML = '';
                statusText.textContent = (globalThis.noctuneI18n?.t("library.playlists.importingTracks", {}) ?? "Импорт треков...");

                const files = await noctune.fs.readDir(dirPath);
                let count = 0;

                for (const fileName of files) {
                    if (isAudioFile(fileName)) {
                        const fullPath = noctune.fs.joinPath(dirPath, fileName);
                        fileEntries.push({ name: fileName, path: fullPath, kind: 'file' });
                        playlistOrder.push(count);

                        const currentCount = count;
                        const fallbackName = fileName.replace(/\.[^/.]+$/, "");

                        const li = document.createElement('li');
                        li.setAttribute('data-id', currentCount);
                        li.innerHTML = ("\n                            <img class=\"track-cover-thumb\" id=\"cover-" + (currentCount) + "\" alt=\"\">\n                            <div class=\"track-cover-placeholder\" id=\"cover-ph-" + (currentCount) + "\">\n                                <i data-lucide=\"music\" style=\"width:16px;height:16px;\"></i>\n                            </div>\n                            <div class=\"track-name-block\">\n                                <div class=\"track-title-item\" id=\"title-" + (currentCount) + "\">" + (fallbackName) + "</div>\n                                <div class=\"track-artist-item\" id=\"artist-" + (currentCount) + "\">" + (globalThis.noctuneI18n?.legacyHtml("library.playlists.loading", {p0: (currentCount), p1: (currentCount), p2: (currentCount), p3: (fallbackName), p4: (currentCount), p5: (currentCount), p6: (currentCount)}) ?? "Загрузка...".replace(/\{p(\d+)\}/g, (_, i) => Object.values({p0: (currentCount), p1: (currentCount), p2: (currentCount), p3: (fallbackName), p4: (currentCount), p5: (currentCount), p6: (currentCount)})[i])) + "</div>\n                            </div>\n                            <div class=\"track-meta\" id=\"meta-" + (currentCount) + "\">--:--</div>\n                            <button class=\"actions-btn track-item-action\" data-id=\"" + (currentCount) + "\"><i data-lucide=\"more-vertical\"></i></button>\n                        ");

                        li.addEventListener('click', (e) => {
                            if (e.target.closest('.actions-btn')) return;
                            playTrack(playlistOrder.indexOf(currentCount));
                        });

                        playlistElem.appendChild(li);
                        count++;
                    }
                }

                lucide.createIcons();

                document.querySelectorAll('.track-item-action').forEach(b => {
                    b.addEventListener('click', (e) => {
                        e.stopPropagation();

                        showPlaylistTrackMenu(e, parseInt(e.currentTarget.getAttribute('data-id')));
                    });
                });

                if (fileEntries.length === 0) {
                    playlistElem.innerHTML = ("<li>" + (globalThis.noctuneI18n?.t("library.playlists.audioFilesNotFound", {}) ?? "Аудиофайлы не найдены") + "</li>");
                    statusText.textContent = (globalThis.noctuneI18n?.t("library.playlists.empty", {}) ?? "Пусто");
                    return;
                }

                statusText.textContent = (globalThis.noctuneI18n?.t("library.playlists.tracksLoaded", {p0: (fileEntries.length)}) ?? "Загружено треков: {p0}".replace(/\{(p\d+)\}/g, (_, k) => ({p0: (fileEntries.length)})[k] ?? "{"+k+"}"));
                if (isShuffle) buildShuffleList();
                processMetadataSequentially();
            } catch (err) {
                statusText.textContent = (globalThis.noctuneI18n?.t("library.playlists.importError", {}) ?? "Ошибка импорта");
            }
        }

        async function processMetadataSequentially() {
            const targetEntries = fileEntries;
            const BATCH_SIZE = 5;
            for (let i = 0; i < targetEntries.length; i += BATCH_SIZE) {
                if (fileEntries !== targetEntries) return;
                const batch = targetEntries.slice(i, i + BATCH_SIZE);
                await Promise.all(batch.map(async (entry, batchIdx) => {
                    const trackIndex = i + batchIdx;
                    try {
                        if (entry.kind === 'radio') return;
                        const filePath = entry.path;
                        const meta = await readFileMetadata(filePath, entry.name);
                        if (fileEntries !== targetEntries) return;
                        entry._fileSize = meta.fileSize;

                        const titleElem = document.getElementById(`title-${trackIndex}`);
                        const artistElem = document.getElementById(`artist-${trackIndex}`);
                        if (titleElem) titleElem.textContent = meta.title || entry.name.replace(/\.[^/.]+$/, "");
                        if (artistElem) artistElem.textContent = meta.artist || (globalThis.noctuneI18n?.t("player.interface.unknownArtist", {}) ?? "Неизвестный исполнитель");

                        window.updateTrackArtwork(trackIndex, meta, filePath);

                        const duration = meta.duration;
                        const kbps = meta.kbps;
                        parsedMetadataCache[trackIndex] = meta;

                        const metaElem = document.getElementById(`meta-${trackIndex}`);
                        if (metaElem) metaElem.textContent = `${formatTime(duration)} | ${kbps}kbps`;
                    } catch (e) {}
                }));
                if (i === 0 || (i + BATCH_SIZE) % 100 === 0 || i + BATCH_SIZE >= targetEntries.length) {
                    window.addonEvents?.emit('queue.metadata');
                }
            }
        }

        async function loadMusicFromFiles(filePaths) {
            fileEntries = [];
            playlistOrder = [];
            parsedMetadataCache = {};
            shuffleList = []; currentShufflePos = -1;
            playlistElem.innerHTML = '';
            statusText.textContent = (globalThis.noctuneI18n?.t("library.playlists.loadingTracks", {}) ?? "Загрузка треков...");

            let count = 0;
            for (const fullPath of filePaths) {
                const fileName = fullPath.split(/[/\\]/).pop();
                fileEntries.push({ name: fileName, path: fullPath, kind: 'file' });
                playlistOrder.push(count);

                const fallbackName = fileName.replace(/\.[^/.]+$/, '');
                const li = document.createElement('li');
                li.setAttribute('data-id', count);
                li.innerHTML = ("\n                    <img class=\"track-cover-thumb\" id=\"cover-" + (count) + "\" alt=\"\">\n                    <div class=\"track-cover-placeholder\" id=\"cover-ph-" + (count) + "\">\n                        <i data-lucide=\"music\" style=\"width:16px;height:16px;\"></i>\n                    </div>\n                    <div class=\"track-name-block\">\n                        <div class=\"track-title-item\" id=\"title-" + (count) + "\"></div>\n                        <div class=\"track-artist-item\" id=\"artist-" + (count) + "\">" + (globalThis.noctuneI18n?.legacyHtml("library.playlists.loading", {p0: (count), p1: (count), p2: (count), p3: (count), p4: (count), p5: (count)}) ?? "Загрузка...".replace(/\{p(\d+)\}/g, (_, i) => Object.values({p0: (count), p1: (count), p2: (count), p3: (count), p4: (count), p5: (count)})[i])) + "</div>\n                    </div>\n                    <div class=\"track-meta\" id=\"meta-" + (count) + "\">--:--</div>\n                    <button class=\"actions-btn track-item-action\" data-id=\"" + (count) + "\"><i data-lucide=\"more-vertical\"></i></button>\n                ");
                li.querySelector('.track-title-item').textContent = fallbackName;
                const idx = count;
                li.addEventListener('click', (e) => {
                    if (e.target.closest('.actions-btn')) return;
                    playTrack(playlistOrder.indexOf(idx));
                });
                playlistElem.appendChild(li);
                count++;
            }

            lucide.createIcons();

            document.querySelectorAll('.track-item-action').forEach(b => {
                b.addEventListener('click', (e) => {
                    e.stopPropagation();
                    showPlaylistTrackMenu(e, parseInt(e.currentTarget.getAttribute('data-id')));
                });
            });

            if (fileEntries.length === 0) {
                playlistElem.innerHTML = ("<li style=\"color:var(--text-muted);font-style:italic;pointer-events:none;\">" + (globalThis.noctuneI18n?.t("library.playlists.addFilesOrAFolderUsingTheButtonsAbove", {}) ?? "Добавьте файлы или папку через кнопки выше") + "</li>");
                statusText.textContent = (globalThis.noctuneI18n?.t("library.playlists.playlistIsEmpty", {}) ?? "Плейлист пуст");
                return;
            }

            statusText.textContent = (globalThis.noctuneI18n?.t("library.playlists.tracksLoaded", {p0: (fileEntries.length)}) ?? "Загружено треков: {p0}".replace(/\{(p\d+)\}/g, (_, k) => ({p0: (fileEntries.length)})[k] ?? "{"+k+"}"));
            if (isShuffle) buildShuffleList();
            processMetadataSequentially();
        }

        document.addEventListener('click', () => { contextMenu.style.display = 'none'; });
        document.addEventListener('playlist-context-menu-open', () => { contextMenu.style.display = 'none'; });
        document.addEventListener('scroll', event => { if (!event.target.closest?.('.context-menu')) contextMenu.style.display = 'none'; }, true);
        document.addEventListener('keydown', event => { if (event.key === 'Escape') contextMenu.style.display = 'none'; });

        document.getElementById('menu-play').addEventListener('click', () => {
            const position = playlistOrder.indexOf(selectedTrackIndexInMenu);
            if (position >= 0) playTrack(position);
        });

        document.getElementById('menu-play-next').addEventListener('click', () => {
            if (selectedTrackIndexInMenu !== -1) {
                enqueuePlaylistTrack(selectedTrackIndexInMenu, true);
                statusText.textContent = (globalThis.noctuneI18n?.t("library.playlists.nextTrackSet", {}) ?? "Следующий трек назначен");
            }
        });

        document.getElementById('menu-add-queue').addEventListener('click', () => {
            if (enqueuePlaylistTrack(selectedTrackIndexInMenu)) {
                statusText.textContent = globalThis.noctuneI18n.t('queue.added');
            }
        });

        // Ручная проверка доступности радиостанции из контекстного меню —
        // тот же путь (без CORS), что и авто-проверка при загрузке плейлиста.
        document.getElementById('menu-check-radio').addEventListener('click', () => {
            if (selectedTrackIndexInMenu === -1) return;
            const badge = document.getElementById(`radio-status-${selectedTrackIndexInMenu}`);
            const entry = fileEntries[selectedTrackIndexInMenu];
            if (entry && entry.kind === 'radio') {
                checkOneRadioStation(entry.path, badge);
            }
        });

        document.getElementById('menu-edit-radio').addEventListener('click', () => {
            if (selectedTrackIndexInMenu === -1) return;

            const pl = userPlaylists.find(p => p.id === currentPlaylistId);

            if (!pl || pl.type !== 'radio') return;

            const station = pl.stations[selectedTrackIndexInMenu];

            if (!station) return;

            editingRadioIndex = selectedTrackIndexInMenu;

            document.getElementById('radio-name-input').value = station.name;
            document.getElementById('radio-url-input').value = station.url;

            document.querySelector('#radio-modal h3').textContent = (globalThis.noctuneI18n?.t("library.playlists.editRadioStation", {}) ?? "Редактировать Радиостанцию");
            document.getElementById('btn-save-radio').textContent = (globalThis.noctuneI18n?.t("player.interface.save", {}) ?? "Сохранить");

            document.querySelectorAll('.radio-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.radio-tab-content').forEach(c => c.classList.remove('active'));
            document.querySelector('[data-target="tab-manual"]').classList.add('active');
            document.getElementById('tab-manual').classList.add('active');
            
            document.getElementById('radio-tabs-container').style.display = 'none';

            document.getElementById('radio-modal').style.display = 'flex';
        });

        document.getElementById('menu-remove').addEventListener('click', () => {
            if (selectedTrackIndexInMenu !== -1) {
                const orderIdx = playlistOrder.indexOf(selectedTrackIndexInMenu);
                if (orderIdx !== -1) {
                    playlistOrder.splice(orderIdx, 1);
                    const item = playlistElem.querySelector(`li[data-id="${selectedTrackIndexInMenu}"]`);
                    if (item) item.remove();
                    
                    const pl = userPlaylists.find(p => p.id === currentPlaylistId);
                    if (pl && pl.type === 'radio') {
                        pl.stations.splice(selectedTrackIndexInMenu, 1);
                        savePlaylistsToStorage();
                        loadRadioStations(pl);
                    }

                    if (currentIndex === orderIdx) {
                        stopTrack();
                        currentIndex = -1;
                        isRadioMode = false;
                        updatePlayIcons(false);
                        trackTitle.textContent = (globalThis.noctuneI18n?.t("library.playlists.deleted", {}) ?? "Удалено");
                        trackArtist.textContent = '';
                        miniTrackTitle.textContent = (globalThis.noctuneI18n?.t("library.playlists.deleted", {}) ?? "Удалено");
                        triggerMiniMarquee();
                        if (window.discordRPCEnabled) noctune.discordRpcClearActivity();
                    } else if (currentIndex > orderIdx) {
                        // Трек выше удалённого — сдвигаем индекс
                        currentIndex--;
                    }
                }
            }
        });
