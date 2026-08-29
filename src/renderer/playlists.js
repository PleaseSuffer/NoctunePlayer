        function savePlaylistsToStorage() {
            localStorage.setItem('noctune_playlists', JSON.stringify(userPlaylists));
        }

        function loadPlaylistsFromStorage() {
            const stored = localStorage.getItem('noctune_playlists');
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
            const name = document.getElementById('playlist-name-input').value.trim() || "Новый плейлист";
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
            const name = document.getElementById('playlist-name-input').value.trim() || "Интернет Радио";
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
                playlistsDropdownMenu.innerHTML = '<div class="pd-menu-empty">Нет плейлистов</div>';
                pdSelectedLabel.textContent = 'Нет плейлистов';
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
                    <span class="pd-item-label">${pl.name}</span>
                `;
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
            pdSelectedIcon.innerHTML = `<i data-lucide="${iconName}" style="width:15px;height:15px;"></i>`;
            // Update active state in menu
            playlistsDropdownMenu.querySelectorAll('.pd-menu-item').forEach(item => {
                item.classList.toggle('active', item.getAttribute('data-value') === id);
            });
            lucide.createIcons();
        }

        btnEditPlaylist.addEventListener('click', () => {
            if (!currentPlaylistId) return;
            const pl = userPlaylists.find(p => p.id === currentPlaylistId);
            if (!pl) return;

            document.getElementById('playlist-rename-input').value = pl.name;
            document.getElementById('rename-modal').style.display = 'flex';
        });

        document.getElementById('btn-save-rename').addEventListener('click', () => {
            const newName = document.getElementById('playlist-rename-input').value.trim();
            if (!newName || !currentPlaylistId) return;

            const pl = userPlaylists.find(p => p.id === currentPlaylistId);
            if (pl) {
                pl.name = newName;
                savePlaylistsToStorage();
                renderPlaylistsDropdown();
            }
            document.getElementById('rename-modal').style.display = 'none';
        });

        btnDeletePlaylist.addEventListener('click', () => {
            if (!currentPlaylistId) return;
            const pl = userPlaylists.find(p => p.id === currentPlaylistId);
            if (!pl) return;
            const prefix = pl.type === 'folder' ? '📁' : '📻';
            document.getElementById('delete-playlist-modal-msg').textContent =
                `Вы уверены, что хотите удалить плейлист ${prefix} «${pl.name}»? Это действие нельзя отменить.`;
            document.getElementById('delete-playlist-modal').style.display = 'flex';
            lucide.createIcons();
        });

        function closeDeleteModal() {
            document.getElementById('delete-playlist-modal').style.display = 'none';
        }

        document.getElementById('btn-delete-modal-close').addEventListener('click', closeDeleteModal);
        document.getElementById('btn-delete-modal-cancel').addEventListener('click', closeDeleteModal);

        document.getElementById('btn-delete-modal-confirm').addEventListener('click', () => {
            closeDeleteModal();
            const deletedId = currentPlaylistId;
            const wasActivePlaying = (deletedId === activePlaylistId);

            userPlaylists = userPlaylists.filter(p => p.id !== deletedId);
            savePlaylistsToStorage();

            if (wasActivePlaying) {
                stopTrack();
                fileEntries = [];
                playlistOrder = [];
                activePlaylistId = null;
            }

            if (userPlaylists.length > 0) {
                currentPlaylistId = userPlaylists[0].id;
                renderPlaylistsDropdown();
                selectPlaylist(currentPlaylistId);
            } else {
                currentPlaylistId = null;
                renderPlaylistsDropdown();
                playlistElem.innerHTML = '<li style="color: gray; font-style: italic; pointer-events: none;">Создайте плейлист</li>';
                statusText.textContent = 'Нет списков воспроизведения';
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
                    playlistElem.innerHTML = '<li style="color:var(--text-muted);font-style:italic;pointer-events:none;">Добавьте файлы или папку через кнопки выше</li>';
                    statusText.textContent = 'Плейлист пуст';
                } else if (!pl.path && pl.files && pl.files.length > 0) {
                    // Playlist has individually added files — restore them
                    await loadMusicFromFiles(pl.files);
                } else {
                    await loadMusicFromDirectory(pl.path);
                }
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
            addLi.innerHTML = `
                <i data-lucide="plus-circle" style="width: 16px; height: 16px; margin-right: 8px; flex-shrink:0;"></i>
                <span>Добавить радиостанцию...</span>
            `;
            addLi.addEventListener('click', () => {
                editingRadioIndex = -1;
                document.querySelector('#radio-modal h3').textContent = 'Добавить Радиостанцию';
                document.getElementById('btn-save-radio').textContent = 'Добавить';
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
                    li.innerHTML = `
                        <div class="track-name-block">
                            <div class="track-title-item">${station.name}</div>
                            <div class="track-artist-item">Поток Радио</div>
                        </div>
                        <span class="radio-status-badge checking" id="radio-status-${index}">...</span>
                        <button class="actions-btn radio-item-action" data-id="${index}"><i data-lucide="more-vertical"></i></button>
                    `;

                    li.addEventListener('click', (e) => {
                        if (e.target.closest('.actions-btn')) return;
                        playTrack(playlistOrder.indexOf(index));
                    });

                    playlistElem.appendChild(li);
                });
            }

            lucide.createIcons();

            document.querySelectorAll('.radio-item-action').forEach(b => {
                b.addEventListener('click', (e) => {
                    e.stopPropagation();
                    selectedTrackIndexInMenu = parseInt(e.currentTarget.getAttribute('data-id'));
                    document.getElementById('menu-edit-radio').style.display = 'flex';
                    document.getElementById('menu-play-next').style.display = 'none';
                    contextMenu.style.top = `${e.clientY}px`;
                    contextMenu.style.left = `${e.clientX - 140}px`;
                    contextMenu.style.display = 'block';
                });
            });

            statusText.textContent = `Доступно станций: ${fileEntries.length}`;

            // Start pinging stations in background (batch of 3)
            checkRadioStations(playlistObj.stations);
        }

        async function checkRadioStations(stations) {
            if (!stations || stations.length === 0) return;
            const BATCH = 3;
            for (let i = 0; i < stations.length; i += BATCH) {
                const batch = stations.slice(i, i + BATCH);
                await Promise.all(batch.map(async (station, batchIdx) => {
                    const idx = i + batchIdx;
                    const badge = document.getElementById(`radio-status-${idx}`);
                    if (!badge) return;
                    try {
                        // Try to fetch a small amount from the stream
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 5000);
                        const resp = await fetch(station.url, { signal: controller.signal, method: 'GET', headers: { 'Range': 'bytes=0-1023' } });
                        clearTimeout(timeoutId);
                        const ct = resp.headers.get('content-type') || '';
                        const isAudio = ct.includes('audio') || ct.includes('ogg') || ct.includes('mpeg') || resp.status === 200 || resp.status === 206;
                        badge.textContent = isAudio ? 'Online' : 'Offline';
                        badge.className = 'radio-status-badge ' + (isAudio ? 'online' : 'offline');
                    } catch(e) {
                        badge.textContent = 'Offline';
                        badge.className = 'radio-status-badge offline';
                    }
                }));
                // Small delay between batches
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

            document.querySelector('#radio-modal h3').textContent = 'Добавить Радиостанцию';
            document.getElementById('btn-save-radio').textContent = 'Добавить';

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
                await fs.access(targetDir);
                const files = await fs.readdir(targetDir);
                const existingPaths = new Set(fileEntries.map(e => e.path));
                const newFiles = files.filter(f => isAudioFile(f) && !existingPaths.has(path.join(targetDir, f)));
                if (newFiles.length === 0) { if (isManual) statusText.textContent = 'Новых файлов не найдено'; return; }

                for (const fileName of newFiles) {
                    const fullPath = path.join(targetDir, fileName);
                    const trackIndex = fileEntries.length;
                    fileEntries.push({ name: fileName, path: fullPath, kind: 'file' });
                    playlistOrder.push(trackIndex);

                    const fallbackName = fileName.replace(/\.[^/.]+$/, '');
                    const li = document.createElement('li');
                    li.setAttribute('data-id', trackIndex);
                    li.innerHTML = `
                        <img class="track-cover-thumb" id="cover-${trackIndex}" alt="">
                        <div class="track-cover-placeholder" id="cover-ph-${trackIndex}">
                            <i data-lucide="music" style="width:16px;height:16px;"></i>
                        </div>
                        <div class="track-name-block">
                            <div class="track-title-item" id="title-${trackIndex}">${fallbackName}</div>
                            <div class="track-artist-item" id="artist-${trackIndex}">Загрузка...</div>
                        </div>
                        <div class="track-meta" id="meta-${trackIndex}">--:--</div>
                        <button class="actions-btn track-item-action" data-id="${trackIndex}"><i data-lucide="more-vertical"></i></button>
                    `;
                    li.addEventListener('click', (e) => {
                        if (e.target.closest('.actions-btn')) return;
                        playTrack(playlistOrder.indexOf(trackIndex));
                    });
                    li.querySelector('.track-item-action').addEventListener('click', (e) => {
                        e.stopPropagation();
                        selectedTrackIndexInMenu = trackIndex;
                        document.getElementById('menu-edit-radio').style.display = 'none';
                        document.getElementById('menu-play-next').style.display = 'flex';
                        contextMenu.style.top = `${e.clientY}px`;
                        contextMenu.style.left = `${e.clientX - 140}px`;
                        contextMenu.style.display = 'block';
                    });
                    playlistElem.appendChild(li);
                }

                lucide.createIcons();
                statusText.textContent = `Загружено треков: ${fileEntries.length}`;

                // Обработка метаданных только для новых треков
                const startIdx = fileEntries.length - newFiles.length;
                const BATCH_SIZE = 5;

                for (let i = startIdx; i < fileEntries.length; i += BATCH_SIZE) {
                    const batch = fileEntries.slice(i, Math.min(i + BATCH_SIZE, fileEntries.length));
                    
                    await Promise.all(batch.map(async (entry, bIdx) => {
                        const trackIndex = i + bIdx;
                        try {
                            const filePath = entry.path;
                            const stats = await fs.stat(filePath);
                            
                            // 1. Увеличиваем буфер или читаем файл полностью (для Node.js/Electron)
                            // 512 КБ хватает для 99% файлов с обложками. Если обложки гигантские, лучше зачитать весь buffer через fs.readFile
                            const fileBuffer = await fs.readFile(filePath);
                            const tagBlob = new Blob([fileBuffer], { type: 'audio/mpeg' });
                            
                            const meta = await parseAudioTags(tagBlob, entry.name);
                            entry._fileSize = stats.size;

                            // 2. Рассчитываем длительность с экранированием пути
                            const duration = await new Promise((resolve) => {
                                const tmpAudio = new Audio();
                                tmpAudio.preload = 'metadata';
                                tmpAudio.onloadedmetadata = () => resolve(tmpAudio.duration);
                                tmpAudio.onerror = () => resolve(0);
                                
                                // Кодируем URI, чтобы избежать проблем со спецсимволами (#, ?, пробелы)
                                const safePath = entry.path.replace(/\\/g, '/');
                                tmpAudio.src = `file://${encodeURI(safePath).replace(/#/g, '%23').replace(/\?/g, '%3F')}`;
                            });

                            const kbps = duration > 0 ? Math.round((stats.size * 8) / duration / 1000) : 0;
                            meta.duration = duration;
                            meta.kbps = kbps;

                            // Сохраняем в кэш полный объект
                            parsedMetadataCache[trackIndex] = meta;

                            // 3. Обновляем UI
                            const titleElem = document.getElementById(`title-${trackIndex}`);
                            const artistElem = document.getElementById(`artist-${trackIndex}`);
                            const metaElem = document.getElementById(`meta-${trackIndex}`);
                            const coverImg = document.getElementById(`cover-${trackIndex}`);
                            const coverPh = document.getElementById(`cover-ph-${trackIndex}`);

                            if (titleElem && meta.title) titleElem.textContent = meta.title;
                            if (artistElem && meta.artist) artistElem.textContent = meta.artist;
                            if (metaElem) metaElem.textContent = duration > 0 ? `${formatTime(duration)} | ${kbps}kbps` : '--:--';

                            if (meta.coverDataUrl) {
                                if (coverImg) { 
                                    coverImg.src = meta.coverDataUrl; 
                                    coverImg.classList.add('loaded'); 
                                }
                                if (coverPh) coverPh.style.display = 'none';
                            } else {
                                if (coverImg) coverImg.classList.remove('loaded');
                            }

                        } catch(e) {
                            console.warn(`Ошибка парсинга файла ${entry.name}:`, e);
                            const artistElem = document.getElementById(`artist-${trackIndex}`);
                            if (artistElem) artistElem.textContent = 'Неизвестный исполнитель';
                        }
                    }));
                }
            } catch(e) {
                console.error('Auto-refresh error:', e);
            }
        }

        // Add individual files to current folder playlist
        document.getElementById('btn-add-files').addEventListener('click', async () => {
            const pl = userPlaylists.find(p => p.id === currentPlaylistId);
            if (!pl || pl.type !== 'folder') return;
            try {
                let filePaths;
                try {
                    // main.js returns filePaths array directly (or null if canceled)
                    const result = await ipcRenderer.invoke('dialog:openFiles');
                    if (!result || result.length === 0) return;
                    filePaths = result;
                } catch(ipcErr) {
                    statusText.textContent = 'Ошибка открытия диалога файлов';
                    console.warn('dialog:openFiles IPC error:', ipcErr);
                    return;
                }

                const existingPaths = new Set(fileEntries.map(e => e.path));
                const newPaths = filePaths.filter(p => !existingPaths.has(p));
                if (newPaths.length === 0) {
                    statusText.textContent = 'Файлы уже в плейлисте';
                    return;
                }

                // Remove placeholder if present
                const placeholder = playlistElem.querySelector('li[style*="italic"]');
                if (placeholder) placeholder.remove();

                // Save new paths to the playlist object
                if (!pl.files) pl.files = [];
                for (const p of newPaths) {
                    if (!pl.files.includes(p)) pl.files.push(p);
                }
                savePlaylistsToStorage();

                for (const fullPath of newPaths) {
                    const fileName = fullPath.split(/[/\\]/).pop();
                    const trackIndex = fileEntries.length;
                    fileEntries.push({ name: fileName, path: fullPath, kind: 'file' });
                    playlistOrder.push(trackIndex);

                    const fallbackName = fileName.replace(/\.[^/.]+$/, '');
                    const li = document.createElement('li');
                    li.setAttribute('data-id', trackIndex);
                    li.innerHTML = `
                        <img class="track-cover-thumb" id="cover-${trackIndex}" alt="">
                        <div class="track-cover-placeholder" id="cover-ph-${trackIndex}">
                            <i data-lucide="music" style="width:16px;height:16px;"></i>
                        </div>
                        <div class="track-name-block">
                            <div class="track-title-item" id="title-${trackIndex}">${fallbackName}</div>
                            <div class="track-artist-item" id="artist-${trackIndex}">Загрузка...</div>
                        </div>
                        <div class="track-meta" id="meta-${trackIndex}">--:--</div>
                        <button class="actions-btn track-item-action" data-id="${trackIndex}"><i data-lucide="more-vertical"></i></button>
                    `;
                    li.addEventListener('click', (e) => {
                        if (e.target.closest('.actions-btn')) return;
                        playTrack(playlistOrder.indexOf(trackIndex));
                    });
                    li.querySelector('.track-item-action').addEventListener('click', (e) => {
                        e.stopPropagation();
                        selectedTrackIndexInMenu = trackIndex;
                        document.getElementById('menu-edit-radio').style.display = 'none';
                        document.getElementById('menu-play-next').style.display = 'flex';
                        contextMenu.style.top = `${e.clientY}px`;
                        contextMenu.style.left = `${e.clientX - 140}px`;
                        contextMenu.style.display = 'block';
                    });
                    playlistElem.appendChild(li);
                }

                lucide.createIcons();
                statusText.textContent = `Загружено треков: ${fileEntries.length}`;

                // Process metadata for added files
                const startIdx = fileEntries.length - newPaths.length;
                const BATCH_SIZE = 5;
                for (let i = startIdx; i < fileEntries.length; i += BATCH_SIZE) {
                    const batch = fileEntries.slice(i, Math.min(i + BATCH_SIZE, fileEntries.length));
                    await Promise.all(batch.map(async (entry, bIdx) => {
                        const trackIndex = i + bIdx;
                        try {
                            const filePath = entry.path;
                            const stats = await fs.stat(filePath);
                            const fileHandle = await fs.open(filePath, 'r');
                            const startBuffer = Buffer.alloc(131072);
                            await fileHandle.read(startBuffer, 0, 131072, 0);
                            const endBuffer = Buffer.alloc(128);
                            const endPos = stats.size > 128 ? stats.size - 128 : 0;
                            await fileHandle.read(endBuffer, 0, 128, endPos);
                            await fileHandle.close();
                            const tagBlob = new Blob([startBuffer, endBuffer], { type: 'audio/mpeg' });
                            const meta = await parseAudioTags(tagBlob, entry.name);
                            entry._fileSize = stats.size;
                            const titleElem = document.getElementById(`title-${trackIndex}`);
                            const artistElem = document.getElementById(`artist-${trackIndex}`);
                            if (titleElem) titleElem.textContent = meta.title;
                            if (artistElem) artistElem.textContent = meta.artist;
                            const coverImg = document.getElementById(`cover-${trackIndex}`);
                            const coverPh = document.getElementById(`cover-ph-${trackIndex}`);
                            if (meta.coverDataUrl) {
                                if (coverImg) { coverImg.src = meta.coverDataUrl; coverImg.classList.add('loaded'); }
                                if (coverPh) coverPh.style.display = 'none';
                            }
                            if (parsedMetadataCache[trackIndex]) parsedMetadataCache[trackIndex].coverDataUrl = meta.coverDataUrl;

                            // Load duration and compute bitrate
                            const duration = await new Promise((resolve) => {
                                const tmpAudio = new Audio();
                                tmpAudio.preload = 'metadata';
                                tmpAudio.onloadedmetadata = () => resolve(tmpAudio.duration);
                                tmpAudio.onerror = () => resolve(0);
                                tmpAudio.src = `file://${entry.path.replace(/\\/g, '/')}`;
                            });
                            const kbps = duration > 0 ? Math.round((stats.size * 8) / duration / 1000) : 0;
                            meta.duration = duration;
                            meta.kbps = kbps;
                            parsedMetadataCache[trackIndex] = meta;
                            const metaElem = document.getElementById(`meta-${trackIndex}`);
                            if (metaElem) metaElem.textContent = duration > 0 ? `${formatTime(duration)} | ${kbps}kbps` : '--:--';
                        } catch(e) {
                            const artistElem = document.getElementById(`artist-${i + bIdx}`);
                            if (artistElem) artistElem.textContent = 'Неизвестный исполнитель';
                        }
                    }));
                }
            } catch(e) {
                console.error('Add files error:', e);
                statusText.textContent = 'Ошибка добавления файлов';
            }
        });

        document.getElementById('btn-add-folder').addEventListener('click', async () => {
            const pl = userPlaylists.find(p => p.id === currentPlaylistId);
            if (!pl || pl.type !== 'folder') return;
            try {
                const dirPath = await ipcRenderer.invoke('dialog:openDirectory');
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
                statusText.textContent = 'Ошибка добавления папки';
            }
        });

        document.getElementById('btn-refresh-playlist').addEventListener('click', () => {
            const pl = userPlaylists.find(p => p.id === currentPlaylistId);
            if (pl && pl.type === 'folder') appendNewTracksFromDirectory(pl.path);
        });

        async function loadMusicFromDirectory(dirPath) {
            try {
                try { await fs.access(dirPath); } catch (err) {
                    statusText.textContent = `Нет доступа к папке`;
                    return;
                }

                fileEntries = [];
                playlistOrder = [];
                parsedMetadataCache = {};
                shuffleList = []; currentShufflePos = -1;
                playlistElem.innerHTML = '';
                statusText.textContent = 'Импорт треков...';

                const files = await fs.readdir(dirPath);
                let count = 0;

                for (const fileName of files) {
                    if (isAudioFile(fileName)) {
                        const fullPath = path.join(dirPath, fileName);
                        fileEntries.push({ name: fileName, path: fullPath, kind: 'file' });
                        playlistOrder.push(count);

                        const currentCount = count;
                        const fallbackName = fileName.replace(/\.[^/.]+$/, "");

                        const li = document.createElement('li');
                        li.setAttribute('data-id', currentCount);
                        li.innerHTML = `
                            <img class="track-cover-thumb" id="cover-${currentCount}" alt="">
                            <div class="track-cover-placeholder" id="cover-ph-${currentCount}">
                                <i data-lucide="music" style="width:16px;height:16px;"></i>
                            </div>
                            <div class="track-name-block">
                                <div class="track-title-item" id="title-${currentCount}">${fallbackName}</div>
                                <div class="track-artist-item" id="artist-${currentCount}">Загрузка...</div>
                            </div>
                            <div class="track-meta" id="meta-${currentCount}">--:--</div>
                            <button class="actions-btn track-item-action" data-id="${currentCount}"><i data-lucide="more-vertical"></i></button>
                        `;

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

                        selectedTrackIndexInMenu = parseInt(
                            e.currentTarget.getAttribute('data-id')
                        );

                        document.getElementById('menu-edit-radio').style.display = 'none';
                        document.getElementById('menu-play-next').style.display = 'flex';

                        contextMenu.style.top = `${e.clientY}px`;
                        contextMenu.style.left = `${e.clientX - 140}px`;
                        contextMenu.style.display = 'block';
                    });
                });

                if (fileEntries.length === 0) {
                    playlistElem.innerHTML = '<li>Аудиофайлы не найдены</li>';
                    statusText.textContent = 'Пусто';
                    return;
                }

                statusText.textContent = `Загружено треков: ${fileEntries.length}`;
                if (isShuffle) buildShuffleList();
                processMetadataSequentially();
            } catch (err) {
                statusText.textContent = 'Ошибка импорта';
            }
        }

        async function processMetadataSequentially() {
            const BATCH_SIZE = 5;
            for (let i = 0; i < fileEntries.length; i += BATCH_SIZE) {
                const batch = fileEntries.slice(i, i + BATCH_SIZE);
                await Promise.all(batch.map(async (entry, batchIdx) => {
                    const trackIndex = i + batchIdx;
                    try {
                        if (entry.kind === 'radio') return;
                        const filePath = entry.path;
                        const stats = await fs.stat(filePath);
                        const fileSize = stats.size;

                        const fileHandle = await fs.open(filePath, 'r');
                        const startBuffer = Buffer.alloc(131072);
                        await fileHandle.read(startBuffer, 0, 131072, 0);
                        const endBuffer = Buffer.alloc(128);
                        const endPosition = fileSize > 128 ? fileSize - 128 : 0;
                        await fileHandle.read(endBuffer, 0, 128, endPosition);
                        await fileHandle.close();

                        const tagBlob = new Blob([startBuffer, endBuffer], { type: 'audio/mpeg' });
                        const meta = await parseAudioTags(tagBlob, entry.name);

                        const titleElem = document.getElementById(`title-${trackIndex}`);
                        const artistElem = document.getElementById(`artist-${trackIndex}`);
                        if (titleElem) titleElem.textContent = meta.title || entry.name.replace(/\.[^/.]+$/, "");
                        if (artistElem) artistElem.textContent = meta.artist || "Неизвестный исполнитель";

                        const coverImg = document.getElementById(`cover-${trackIndex}`);
                        const coverPh = document.getElementById(`cover-ph-${trackIndex}`);
                        if (meta.coverDataUrl) {
                            if (coverImg) { coverImg.src = meta.coverDataUrl; coverImg.classList.add('loaded'); }
                            if (coverPh) coverPh.style.display = 'none';
                        } else {
                            if (coverImg) coverImg.classList.remove('loaded');
                        }
                        if (parsedMetadataCache[trackIndex]) parsedMetadataCache[trackIndex].coverDataUrl = meta.coverDataUrl;

                        const duration = await new Promise((resolve) => {
                            const tempAudio = new Audio();
                            tempAudio.preload = 'metadata';
                            tempAudio.onloadedmetadata = () => resolve(tempAudio.duration);
                            tempAudio.onerror = () => resolve(0);
                            tempAudio.src = `file://${filePath.replace(/\\/g, '/')}`;
                        });

                        const kbps = duration > 0 ? Math.round((fileSize * 8) / duration / 1000) : 0;
                        meta.duration = duration;
                        meta.kbps = kbps;
                        parsedMetadataCache[trackIndex] = meta;

                        const metaElem = document.getElementById(`meta-${trackIndex}`);
                        if (metaElem) metaElem.textContent = `${formatTime(duration)} | ${kbps}kbps`;
                    } catch (e) {}
                }));
            }
        }

        async function loadMusicFromFiles(filePaths) {
            fileEntries = [];
            playlistOrder = [];
            parsedMetadataCache = {};
            shuffleList = []; currentShufflePos = -1;
            playlistElem.innerHTML = '';
            statusText.textContent = 'Загрузка треков...';

            let count = 0;
            for (const fullPath of filePaths) {
                const fileName = fullPath.split(/[/\\]/).pop();
                fileEntries.push({ name: fileName, path: fullPath, kind: 'file' });
                playlistOrder.push(count);

                const fallbackName = fileName.replace(/\.[^/.]+$/, '');
                const li = document.createElement('li');
                li.setAttribute('data-id', count);
                li.innerHTML = `
                    <img class="track-cover-thumb" id="cover-${count}" alt="">
                    <div class="track-cover-placeholder" id="cover-ph-${count}">
                        <i data-lucide="music" style="width:16px;height:16px;"></i>
                    </div>
                    <div class="track-name-block">
                        <div class="track-title-item" id="title-${count}">${fallbackName}</div>
                        <div class="track-artist-item" id="artist-${count}">Загрузка...</div>
                    </div>
                    <div class="track-meta" id="meta-${count}">--:--</div>
                    <button class="actions-btn track-item-action" data-id="${count}"><i data-lucide="more-vertical"></i></button>
                `;
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
                    selectedTrackIndexInMenu = parseInt(e.currentTarget.getAttribute('data-id'));
                    document.getElementById('menu-edit-radio').style.display = 'none';
                    document.getElementById('menu-play-next').style.display = 'flex';
                    contextMenu.style.top = `${e.clientY}px`;
                    contextMenu.style.left = `${e.clientX - 140}px`;
                    contextMenu.style.display = 'block';
                });
            });

            if (fileEntries.length === 0) {
                playlistElem.innerHTML = '<li style="color:var(--text-muted);font-style:italic;pointer-events:none;">Добавьте файлы или папку через кнопки выше</li>';
                statusText.textContent = 'Плейлист пуст';
                return;
            }

            statusText.textContent = `Загружено треков: ${fileEntries.length}`;
            if (isShuffle) buildShuffleList();
            processMetadataSequentially();
        }

        document.addEventListener('click', () => {
            contextMenu.style.display = 'none';
        });

        document.getElementById('menu-play-next').addEventListener('click', () => {
            if (selectedTrackIndexInMenu !== -1) {
                playNextIndex = selectedTrackIndexInMenu;
                statusText.textContent = 'Следующий трек назначен';
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

            document.querySelector('#radio-modal h3').textContent = 'Редактировать Радиостанцию';
            document.getElementById('btn-save-radio').textContent = 'Сохранить';

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
                        trackTitle.textContent = 'Удалено';
                        trackArtist.textContent = '';
                        miniTrackTitle.textContent = 'Удалено';
                        triggerMiniMarquee();
                        if (window.discordRPCEnabled) ipcRenderer.send('discord-rpc-clear-activity');
                    } else if (currentIndex > orderIdx) {
                        // Трек выше удалённого — сдвигаем индекс
                        currentIndex--;
                    }
                }
            }
        });

