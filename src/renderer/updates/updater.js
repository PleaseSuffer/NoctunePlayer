        // ══════════════════════════════════════════════════════════════════
        // АВТООБНОВЛЕНИЯ (electron-updater)
        // ══════════════════════════════════════════════════════════════════
        // Заменяет прежний ручной опрос GitHub API. Проверка идёт в main
        // процессе (см. src/main/index.js), сюда долетают только события через
        // window.noctune.updater.on*. Логика полностью самодостаточна и не
        // завязана на огромный settings.js — читает/пишет свои собственные
        // ключи в appStorage напрямую.
        (function initUpdater() {
            const btnCheck = document.getElementById('btn-check-updates');
            const statusMsg = document.getElementById('update-status-msg');
            const autoCheckToggle = document.getElementById('setting-auto-check-updates');
            const intervalSlider = document.getElementById('setting-update-check-interval');
            const intervalLabel = document.getElementById('setting-update-check-interval-label');
            const intervalRow = document.getElementById('update-interval-row-wrap');
            const checkOnStartupToggle = document.getElementById('setting-check-on-startup');
            const autoDownloadToggle = document.getElementById('setting-auto-download-updates');
            const notifyToggle = document.getElementById('setting-update-notify');
            const btnAction = document.getElementById('btn-update-action');

            if (!btnCheck || !statusMsg || !autoCheckToggle || !intervalSlider || !autoDownloadToggle || !notifyToggle || !btnAction || !checkOnStartupToggle) return;

            let _scheduleTimer = null;
            let _pendingVersion = null;   // предложена, но ещё не скачана/отклонена — не дублируем toast
            let _downloadedVersion = null;
            let _manualCheck = false;
            let _lastErrorToast = null;

            const updateNotificationKey = 'player-update';
            function startDownload(version) {
                showNotification(
                    (globalThis.noctuneI18n?.t('updates.updater.downloadingVersionV', {p0: version}) ?? `Скачивается версия v${version}...`),
                    'info', globalThis.noctuneI18n?.t('updates.updater.downloadingUpdate') ?? 'Загрузка обновления', null,
                    { replaceKey: updateNotificationKey, important: true, pinned: true, progress: null }
                );
                setActionButton('hidden');
                Promise.resolve(noctune.updater.download()).catch(showUpdateError);
            }

            function skippedVersions() {
                try {
                    const versions = JSON.parse(appStorage.getItem('setting_skipped_update_versions') || '[]');
                    return Array.isArray(versions) ? versions.filter(version => typeof version === 'string') : [];
                } catch {
                    return [];
                }
            }

            function skipVersion(version) {
                if (version === '?') return;
                appStorage.setItem('setting_skipped_update_versions', JSON.stringify([...new Set([...skippedVersions(), version])]));
                _pendingVersion = null;
                const id = globalThis.notificationCenter?.find(updateNotificationKey);
                if (id) { globalThis.notificationCenter.update(id, { important: false, pinned: false, progress: undefined, actions: [] }); globalThis.notificationCenter.dismiss(id); }
                statusMsg.textContent = (globalThis.noctuneI18n?.t("updates.updater.versionVSkippedYouCanInstallItUsingAManualUpdateCheck", {p0: (version)}) ?? "Версия v{p0} пропущена. Её можно установить через ручную проверку обновлений.".replace(/\{(p\d+)\}/g, (_, k) => ({p0: (version)})[k] ?? "{"+k+"}"));
                statusMsg.style.color = '';
                setActionButton('hidden');
            }

            function showUpdaterUnavailable(info) {
                statusMsg.textContent = info?.reason === 'development'
                    ? (globalThis.noctuneI18n?.t("updates.updater.automaticUpdatesUnavailableWhenRunningFromSource", {}) ?? "Автообновление недоступно при запуске из исходников.")
                    : (globalThis.noctuneI18n?.t("updates.updater.automaticUpdatesUnavailableForThisInstallationMethod", {}) ?? "Автообновление недоступно для этого способа установки.");
                statusMsg.style.color = '';
                setActionButton('hidden');
            }

            function showUpdateError(error) {
                const details = String(error && error.message || error || (globalThis.noctuneI18n?.t("updates.updater.unknownError", {}) ?? "Неизвестная ошибка"));
                const missingMetadata = /Cannot find latest[^\s/]*\.ya?ml\b/i.test(details);
                const message = missingMetadata
                    ? (globalThis.noctuneI18n?.t("updates.updater.automaticUpdatesAreNotYetAvailableForThisPlatform", {}) ?? "Автообновление для этой платформы пока недоступно.")
                    : (globalThis.noctuneI18n?.t("updates.updater.couldNotUpdateTryAgainLater", {}) ?? "Не удалось выполнить обновление. Попробуйте позже.");
                const id = globalThis.notificationCenter?.find(updateNotificationKey);
                if (id) globalThis.notificationCenter.update(id, { message, type: 'error', pinned: false, progress: undefined, actions: [], copyText: details });
                statusMsg.textContent = message;
                statusMsg.style.color = '#ff6b6b';
                // Фоновая проверка не отвлекает toast'ом. При ручной проверке
                // подробности доступны через существующую кнопку копирования.
                // Одна ошибка может прийти и событием, и результатом IPC.
                if (_manualCheck && _lastErrorToast !== details) {
                    _lastErrorToast = details;
                    showNotification(message, 'error', (globalThis.noctuneI18n?.t("updates.updater.updateUnavailable", {}) ?? "Обновление недоступно"), details);
                }
            }

            // Постоянная кнопка рядом с "Проверить" — раньше скачать/установить
            // можно было только из toast'а, а если его закрыли ("Позже"/крестик)
            // или он потерялся среди других уведомлений — пользователь оставался
            // без способа вернуться к обновлению, не запуская проверку заново.
            // Теперь состояние апдейта отражено прямо тут, независимо от toast'ов.
            function setActionButton(mode, onClick) {
                if (mode === 'hidden') {
                    btnAction.style.display = 'none';
                    btnAction.onclick = null;
                    return;
                }
                btnAction.style.display = 'flex';
                btnAction.disabled = false;
                btnAction.textContent = mode === 'download' ? (globalThis.noctuneI18n?.t("settings.about.downloadUpdate", {}) ?? "Скачать обновление") : (globalThis.noctuneI18n?.t("updates.updater.installAndRestart", {}) ?? "Установить и перезапустить");
                btnAction.onclick = onClick;
            }
            setActionButton('hidden');

            // ── восстановление настроек ──
            const savedAutoCheck = appStorage.getItem('setting_auto_check_updates');
            autoCheckToggle.checked = savedAutoCheck === null ? true : savedAutoCheck === '1';

            const savedInterval = parseInt(appStorage.getItem('setting_update_check_interval_hours') || '6', 10);
            intervalSlider.value = isNaN(savedInterval) ? 6 : Math.min(24, Math.max(1, savedInterval));
            intervalLabel.textContent = (globalThis.noctuneI18n?.t("updates.updater.h", {p0: (intervalSlider.value)}) ?? "{p0} ч".replace(/\{(p\d+)\}/g, (_, k) => ({p0: (intervalSlider.value)})[k] ?? "{"+k+"}"));

            autoDownloadToggle.checked = appStorage.getItem('setting_auto_download_updates') === '1';

            const savedNotify = appStorage.getItem('setting_update_notify');
            notifyToggle.checked = savedNotify === null ? true : savedNotify === '1';

            const savedCheckOnStartup = appStorage.getItem('setting_check_on_startup');
            checkOnStartupToggle.checked = savedCheckOnStartup === null ? true : savedCheckOnStartup === '1';
            checkOnStartupToggle.addEventListener('change', () => {
                appStorage.setItem('setting_check_on_startup', checkOnStartupToggle.checked ? '1' : '0');
            });

            if (intervalRow) intervalRow.style.display = autoCheckToggle.checked ? '' : 'none';

            function scheduleAutoCheck() {
                if (_scheduleTimer) { clearInterval(_scheduleTimer); _scheduleTimer = null; }
                if (!autoCheckToggle.checked) return;
                const hours = parseFloat(intervalSlider.value) || 6;
                _scheduleTimer = setInterval(() => { noctune.updater.check(true); }, hours * 60 * 60 * 1000);
            }

            autoCheckToggle.addEventListener('change', () => {
                appStorage.setItem('setting_auto_check_updates', autoCheckToggle.checked ? '1' : '0');
                if (intervalRow) intervalRow.style.display = autoCheckToggle.checked ? '' : 'none';
                scheduleAutoCheck();
            });

            intervalSlider.addEventListener('input', () => {
                intervalLabel.textContent = (globalThis.noctuneI18n?.t("updates.updater.h", {p0: (intervalSlider.value)}) ?? "{p0} ч".replace(/\{(p\d+)\}/g, (_, k) => ({p0: (intervalSlider.value)})[k] ?? "{"+k+"}"));
                appStorage.setItem('setting_update_check_interval_hours', intervalSlider.value);
                scheduleAutoCheck();
            });

            autoDownloadToggle.addEventListener('change', () => {
                appStorage.setItem('setting_auto_download_updates', autoDownloadToggle.checked ? '1' : '0');
            });

            notifyToggle.addEventListener('change', () => {
                appStorage.setItem('setting_update_notify', notifyToggle.checked ? '1' : '0');
            });

            // ── кнопка "Проверить" в О программе ──
            btnCheck.addEventListener('click', async () => {
                const icon = btnCheck.querySelector('i[data-lucide="refresh-cw"]');
                if (icon) icon.classList.add('lucide-spin');
                btnCheck.disabled = true;
                statusMsg.textContent = (globalThis.noctuneI18n?.t("updates.updater.checkingForUpdates", {}) ?? "Проверка наличия обновлений...");
                statusMsg.style.color = '';
                _manualCheck = true;
                _lastErrorToast = null;
                try {
                    const res = await noctune.updater.check(false);
                    if (res && res.ok === false) {
                        showUpdateError(res.error);
                    } else if (res?.status === 'unavailable') {
                        showUpdaterUnavailable(res);
                    }
                    // Результат (найдено/не найдено/скачано) придёт отдельно
                    // через события updater:* ниже.
                } catch (error) {
                    showUpdateError(error);
                } finally {
                    _manualCheck = false;
                    if (icon) icon.classList.remove('lucide-spin');
                    btnCheck.disabled = false;
                }
            });

            // ── события из main-процесса ──
            noctune.updater.onChecking(() => {
                statusMsg.textContent = (globalThis.noctuneI18n?.t("updates.updater.checkingForUpdates", {}) ?? "Проверка наличия обновлений...");
                statusMsg.style.color = '';
            });

            noctune.updater.onNotAvailable(() => {
                const id = globalThis.notificationCenter?.find(updateNotificationKey);
                if (id) { globalThis.notificationCenter.update(id, { important: false, pinned: false, progress: undefined, actions: [] }); globalThis.notificationCenter.dismiss(id); }
                statusMsg.textContent = (globalThis.noctuneI18n?.t("updates.updater.youAreRunningTheLatestVersion", {}) ?? "У вас установлена самая свежая версия.");
                statusMsg.style.color = '#2ecc71';
                setActionButton('hidden');
            });

            noctune.updater.onUnavailable(showUpdaterUnavailable);

            noctune.updater.onError((message) => {
                showUpdateError(message);
            });

            noctune.updater.onAvailable((info) => {
                const version = (info && info.version) || '?';
                const manual = info?.silent === false || _manualCheck;
                if (!manual && (info?.skipped || skippedVersions().includes(version))) {
                    statusMsg.textContent = (globalThis.noctuneI18n?.t("ui.addonSettings.noNewUpdates", {}) ?? "Новых обновлений нет.");
                    statusMsg.style.color = '';
                    setActionButton('hidden');
                    return;
                }
                statusMsg.innerHTML = `Доступна новая версия <span style="color:var(--accent-color);font-weight:bold;">v${version}</span>.`;
                statusMsg.style.color = '';

                if (_downloadedVersion === version) {
                    statusMsg.textContent = (globalThis.noctuneI18n?.t("updates.updater.versionVDownloadedAndReadyToInstall", {p0: (version)}) ?? "Версия v{p0} скачана и готова к установке.".replace(/\{(p\d+)\}/g, (_, k) => ({p0: (version)})[k] ?? "{"+k+"}"));
                    setActionButton('install', () => { noctune.updater.install(); });
                    return;
                }

                if (autoDownloadToggle.checked) {
                    // Настройка "скачивать автоматически" — без подтверждения,
                    // но установка всё равно только вручную (см. onDownloaded).
                    // Кнопку тут не показываем — скачивание уже пошло само.
                    if (_pendingVersion !== version && _downloadedVersion !== version) {
                        startDownload(version);
                    }
                    _pendingVersion = version;
                    return;
                }

                setActionButton('download', () => {
                    startDownload(version);
                });

                // Toast — по-прежнему показываем (удобно, если окно свёрнуто в
                // трей), но теперь это не единственный способ скачать: кнопка
                // выше остаётся, даже если toast закрыли или он потерялся среди
                // остальных уведомлений.
                if (!manual && (_pendingVersion === version || _downloadedVersion === version)) return;
                _pendingVersion = version;

                showNotification(
                    (globalThis.noctuneI18n?.t("updates.updater.aNewNoctuneVersionVIsAvailable", {p0: (version)}) ?? "Доступна новая версия Noctune v{p0}.".replace(/\{(p\d+)\}/g, (_, k) => ({p0: (version)})[k] ?? "{"+k+"}")),
                    'info',
                    (globalThis.noctuneI18n?.t("updates.updater.updateFound", {}) ?? "Обновление найдено"),
                    null,
                    {
                        replaceKey: updateNotificationKey, important: true,
                        actions: [
                            {
                                label: (globalThis.noctuneI18n?.t("updates.updater.download", {}) ?? "Скачать"),
                                primary: true,
                                onClick: () => {
                                    startDownload(version);
                                }
                            },
                            { label: (globalThis.noctuneI18n?.t("updates.updater.later", {}) ?? "Позже"), onClick: () => {} },
                            { label: (globalThis.noctuneI18n?.t("updates.updater.skipVersion", {}) ?? "Пропустить версию"), onClick: () => skipVersion(version) }
                        ]
                    }
                );
            });

            noctune.updater.onProgress((progress) => {
                const pct = Math.max(0, Math.min(100, Math.round(Number(progress?.percent) || 0)));
                const id = globalThis.notificationCenter?.find(updateNotificationKey);
                if (id) {
                    const speed = Number(progress?.bytesPerSecond) || 0;
                    globalThis.notificationCenter.update(id, {
                        progress: pct / 100,
                        progressLabel: `${pct}% · ${(speed / 1024 / 1024).toFixed(1)} MB/s`,
                    });
                }
                statusMsg.textContent = (globalThis.noctuneI18n?.t("updates.download.progressNotification", {p0: (pct)}) ?? "Загрузка обновления: {p0}%".replace(/\{(p\d+)\}/g, (_, k) => ({p0: (pct)})[k] ?? "{"+k+"}"));
                statusMsg.style.color = '';
                btnAction.style.display = 'flex';
                btnAction.disabled = true;
                btnAction.textContent = (globalThis.noctuneI18n?.t("updates.updater.downloading", {p0: (pct)}) ?? "Загрузка... {p0}%".replace(/\{(p\d+)\}/g, (_, k) => ({p0: (pct)})[k] ?? "{"+k+"}"));
            });

            noctune.updater.onDownloaded((info) => {
                const version = (info && info.version) || _pendingVersion || '?';
                _downloadedVersion = version;
                _pendingVersion = null;
                statusMsg.innerHTML = `Версия <span style="color:#2ecc71;font-weight:bold;">v${version}</span> скачана и готова к установке.`;
                statusMsg.style.color = '';

                setActionButton('install', () => { noctune.updater.install(); });

                showNotification(
                    (globalThis.noctuneI18n?.t("updates.updater.versionVDownloadedAndReadyToInstall", {p0: (version)}) ?? "Версия v{p0} скачана и готова к установке.".replace(/\{(p\d+)\}/g, (_, k) => ({p0: (version)})[k] ?? "{"+k+"}")),
                    'info',
                    (globalThis.noctuneI18n?.t("updates.updater.updateReady", {}) ?? "Обновление готово"),
                    null,
                    {
                        replaceKey: updateNotificationKey, important: true,
                        actions: [
                            {
                                label: (globalThis.noctuneI18n?.t("updates.updater.installAndRestart", {}) ?? "Установить и перезапустить"),
                                primary: true,
                                onClick: () => { noctune.updater.install(); }
                            },
                            { label: (globalThis.noctuneI18n?.t("updates.updater.later", {}) ?? "Позже"), onClick: () => {} },
                            { label: (globalThis.noctuneI18n?.t("updates.updater.skipVersion", {}) ?? "Пропустить версию"), onClick: () => skipVersion(version) }
                        ]
                    }
                );
            });

            // ── запуск: расписание + отложенная первая проверка ──
            scheduleAutoCheck();
            // Независимо от периодической фоновой автопроверки — отдельный
            // тумблер "Проверять при запуске" отвечает только за разовую
            // проверку сразу после старта.
            if (checkOnStartupToggle.checked) {
                // Небольшая задержка, чтобы не мешать первому старту приложения.
                setTimeout(() => { noctune.updater.check(true); }, 8000);
            }
        })();
