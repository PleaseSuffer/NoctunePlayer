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
                        name: s.name || (globalThis.noctuneI18n?.t("index.radioStation", {}) ?? "Радиостанция"),
                        target: s.url,
                    }));
                } else {
                    let filePaths = [];
                    if (pl.path) {
                        try {
                            const files = await noctune.fs.readDir(pl.path);
                            filePaths = files.filter(f => isAudioFile(f)).map(f => noctune.fs.joinPath(pl.path, f));
                        } catch (e) {
                            showNotification((globalThis.noctuneI18n?.t("library.playlistIo.couldNotReadPlaylistFolderForExport", {}) ?? "Не удалось прочитать папку плейлиста для экспорта"), 'error');
                            return;
                        }
                    }
                    filePaths = [...new Set([...filePaths, ...(Array.isArray(pl.files) ? pl.files : [])])];
                    items = filePaths.map((fp) => ({
                        isRadio: false,
                        name: noctune.fs.basename(fp).replace(/\.[^/.]+$/, ''),
                        target: fp,
                        duration: 0, // длительность не читаем заново при экспорте — плееры сами перечитают теги
                    }));
                }

                if (items.length === 0) {
                    showNotification((globalThis.noctuneI18n?.t("library.playlistIo.playlistIsEmptyNothingToExport", {}) ?? "Плейлист пуст — нечего экспортировать"), 'warning');
                    return;
                }

                const savePath = await noctune.dialogSaveM3U(pl.name || 'playlist');
                if (!savePath) return;

                const m3uText = await noctune.m3u.build(pl.name || 'Playlist', items);
                await noctune.fs.writeTextFile(savePath, m3uText);
                showNotification((globalThis.noctuneI18n?.t("library.playlistIo.playlistExportedToM3u", {p0: (pl.name)}) ?? "Плейлист «{p0}» экспортирован в .m3u".replace(/\{(p\d+)\}/g, (_, k) => ({p0: (pl.name)})[k] ?? "{"+k+"}")), 'info', (globalThis.noctuneI18n?.t("library.playlistIo.exportCompleted", {}) ?? "Экспорт завершён"), null, {
                    cornerAction: {
                        icon: 'folder-open',
                        title: (globalThis.noctuneI18n?.t("library.playlistIo.showFileInFolder", {}) ?? "Показать файл в папке"),
                        onClick: () => noctune.showItemInFolder(savePath),
                    }
                });
            } catch (e) {
                console.error((globalThis.noctuneI18n?.t("library.playlistIo.playlistM3uExportError", {}) ?? "Ошибка экспорта плейлиста в .m3u:"), e);
                showNotification((globalThis.noctuneI18n?.t("library.playlistIo.couldNotExportPlaylist", {}) ?? "Не удалось экспортировать плейлист"), 'error');
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
                        showNotification((globalThis.noctuneI18n?.t("library.playlistIo.noTracksOrStationsFoundInTheFile", {}) ?? "В файле не найдено ни одного трека или станции"), 'warning');
                        return;
                    }

                    const radioEntries = entries.filter(e => isM3uUrlTarget(e.target));
                    const localEntries = entries.filter(e => !isM3uUrlTarget(e.target));
                    const baseName = playlistName || noctune.fs.basename(filePath).replace(/\.[^/.]+$/, '');

                    let createdAny = false;

                    if (radioEntries.length > 0) {
                        const pl = {
                            id: 'pl_' + Date.now() + '_r',
                            name: localEntries.length > 0 ? (globalThis.noctuneI18n?.t("library.playlistIo.radio", {p0: (baseName)}) ?? "{p0} (радио)".replace(/\{(p\d+)\}/g, (_, k) => ({p0: (baseName)})[k] ?? "{"+k+"}")) : baseName,
                            type: 'radio',
                            path: null,
                            stations: radioEntries.map(e => ({ name: e.title || (globalThis.noctuneI18n?.t("index.radioStation", {}) ?? "Радиостанция"), url: e.target })),
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
                            showNotification((globalThis.noctuneI18n?.t("library.playlistIo.noneOfThePlaylistSLocalFilesWereFoundOnThisComputer", {}) ?? "Ни один из локальных файлов плейлиста не найден на этом компьютере"), 'error');
                        } else {
                            const pl = {
                                id: 'pl_' + Date.now() + '_f',
                                name: radioEntries.length > 0 ? (globalThis.noctuneI18n?.t("library.playlistIo.files", {p0: (baseName)}) ?? "{p0} (файлы)".replace(/\{(p\d+)\}/g, (_, k) => ({p0: (baseName)})[k] ?? "{"+k+"}")) : baseName,
                                type: 'folder',
                                path: null,
                                files: existing,
                                stations: [],
                            };
                            userPlaylists.push(pl);
                            createdAny = true;
                            if (existing.length < localEntries.length) {
                                showNotification(
                                    (globalThis.noctuneI18n?.t("library.playlistIo.importedOfFilesTheRestWereNotFoundOnDisk", {p0: (existing.length), p1: (localEntries.length)}) ?? "Импортировано {p0} из {p1} файлов — остальные не найдены на диске".replace(/\{(p\d+)\}/g, (_, k) => ({p0: (existing.length), p1: (localEntries.length)})[k] ?? "{"+k+"}")),
                                    'warning'
                                );
                            }
                        }
                    }

                    if (!createdAny) {
                        showNotification((globalThis.noctuneI18n?.t("library.playlistIo.couldNotImportPlaylist", {}) ?? "Не удалось импортировать плейлист"), 'error');
                        return;
                    }

                    savePlaylistsToStorage();
                    renderPlaylistsDropdown();
                    if (typeof window.renderPlEditor === 'function') window.renderPlEditor();
                    showNotification((globalThis.noctuneI18n?.t("library.playlistIo.playlistImported", {p0: (baseName)}) ?? "Плейлист «{p0}» импортирован".replace(/\{(p\d+)\}/g, (_, k) => ({p0: (baseName)})[k] ?? "{"+k+"}")), 'info', (globalThis.noctuneI18n?.t("library.playlistIo.importCompleted", {}) ?? "Импорт завершён"));
                } catch (e) {
                    console.error((globalThis.noctuneI18n?.t("library.playlistIo.m3uImportError", {}) ?? "Ошибка импорта .m3u:"), e);
                    showNotification((globalThis.noctuneI18n?.t("library.playlistIo.couldNotImportM3uFile", {}) ?? "Не удалось импортировать .m3u файл"), 'error');
                }
            });
        }
