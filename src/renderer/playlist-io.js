        // ══════════════════════════════════════════════════════════════════
        // ИМПОРТ / ЭКСПОРТ ПЛЕЙЛИСТОВ В .M3U
        // ══════════════════════════════════════════════════════════════════
        // Экспорт вызывается кнопкой у каждого плейлиста в Настройки →
        // Основные → Плейлисты (см. renderPlEditor в settings.js).
        // Импорт создаёт новый плейлист (или два — если в файле вперемешку
        // локальные пути и URL радиостанций сразу).

        function isM3uUrlTarget(target) {
            return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(target || '');
        }

        window.exportPlaylistToM3U = async function exportPlaylistToM3U(pl) {
            if (!pl) return;
            try {
                let items = [];

                if (pl.type === 'radio') {
                    items = (pl.stations || []).map(s => ({
                        isRadio: true,
                        name: s.name || 'Радиостанция',
                        target: s.url,
                    }));
                } else {
                    let filePaths = [];
                    if (pl.path) {
                        try {
                            const files = await noctune.fs.readDir(pl.path);
                            filePaths = files.filter(f => isAudioFile(f)).map(f => noctune.fs.joinPath(pl.path, f));
                        } catch (e) {
                            showNotification('Не удалось прочитать папку плейлиста для экспорта', 'error');
                            return;
                        }
                    } else if (Array.isArray(pl.files)) {
                        filePaths = pl.files.slice();
                    }
                    items = filePaths.map((fp) => ({
                        isRadio: false,
                        name: noctune.fs.basename(fp).replace(/\.[^/.]+$/, ''),
                        target: fp,
                        duration: 0, // длительность не читаем заново при экспорте — плееры сами перечитают теги
                    }));
                }

                if (items.length === 0) {
                    showNotification('Плейлист пуст — нечего экспортировать', 'warning');
                    return;
                }

                const savePath = await noctune.dialogSaveM3U(pl.name || 'playlist');
                if (!savePath) return;

                const m3uText = await noctune.m3u.build(pl.name || 'Playlist', items);
                await noctune.fs.writeTextFile(savePath, m3uText);
                showNotification(`Плейлист «${pl.name}» экспортирован в .m3u`, 'info', 'Экспорт завершён');
            } catch (e) {
                console.error('Ошибка экспорта плейлиста в .m3u:', e);
                showNotification('Не удалось экспортировать плейлист', 'error');
            }
        };

        const btnImportM3U = document.getElementById('btn-import-m3u');
        if (btnImportM3U) {
            btnImportM3U.addEventListener('click', async () => {
                try {
                    const filePath = await noctune.dialogOpenM3U();
                    if (!filePath) return;

                    const text = await noctune.fs.readTextFile(filePath);
                    const { playlistName, entries } = await noctune.m3u.parse(text);

                    if (!entries || entries.length === 0) {
                        showNotification('В файле не найдено ни одного трека или станции', 'warning');
                        return;
                    }

                    const radioEntries = entries.filter(e => isM3uUrlTarget(e.target));
                    const localEntries = entries.filter(e => !isM3uUrlTarget(e.target));
                    const baseName = playlistName || noctune.fs.basename(filePath).replace(/\.[^/.]+$/, '');

                    let createdAny = false;

                    if (radioEntries.length > 0) {
                        const pl = {
                            id: 'pl_' + Date.now() + '_r',
                            name: localEntries.length > 0 ? `${baseName} (радио)` : baseName,
                            type: 'radio',
                            path: null,
                            stations: radioEntries.map(e => ({ name: e.title || 'Радиостанция', url: e.target })),
                        };
                        userPlaylists.push(pl);
                        createdAny = true;
                    }

                    if (localEntries.length > 0) {
                        // .m3u из другого компьютера может ссылаться на пути,
                        // которых на этом диске просто нет — отсеиваем их,
                        // а не роняем плейлист целиком.
                        const existing = [];
                        for (const e of localEntries) {
                            try {
                                if (await noctune.fs.exists(e.target)) existing.push(e.target);
                            } catch (err) { /* пропускаем недоступный путь */ }
                        }

                        if (existing.length === 0) {
                            showNotification('Ни один из локальных файлов плейлиста не найден на этом компьютере', 'error');
                        } else {
                            const pl = {
                                id: 'pl_' + Date.now() + '_f',
                                name: radioEntries.length > 0 ? `${baseName} (файлы)` : baseName,
                                type: 'folder',
                                path: null,
                                files: existing,
                                stations: [],
                            };
                            userPlaylists.push(pl);
                            createdAny = true;
                            if (existing.length < localEntries.length) {
                                showNotification(
                                    `Импортировано ${existing.length} из ${localEntries.length} файлов — остальные не найдены на диске`,
                                    'warning'
                                );
                            }
                        }
                    }

                    if (!createdAny) {
                        showNotification('Не удалось импортировать плейлист', 'error');
                        return;
                    }

                    savePlaylistsToStorage();
                    renderPlaylistsDropdown();
                    if (typeof window.renderPlEditor === 'function') window.renderPlEditor();
                    showNotification(`Плейлист «${baseName}» импортирован`, 'info', 'Импорт завершён');
                } catch (e) {
                    console.error('Ошибка импорта .m3u:', e);
                    showNotification('Не удалось импортировать .m3u файл', 'error');
                }
            });
        }
