        // ══════════════════════════════════════════════════════════════════
        // АВТООБНОВЛЕНИЯ (electron-updater)
        // ══════════════════════════════════════════════════════════════════
        // Заменяет прежний ручной опрос GitHub API. Проверка идёт в main
        // процессе (см. src/main.js), сюда долетают только события через
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
                btnAction.textContent = mode === 'download' ? 'Скачать обновление' : 'Установить и перезапустить';
                btnAction.onclick = onClick;
            }
            setActionButton('hidden');

            // ── восстановление настроек ──
            const savedAutoCheck = appStorage.getItem('setting_auto_check_updates');
            autoCheckToggle.checked = savedAutoCheck === null ? true : savedAutoCheck === '1';

            const savedInterval = parseInt(appStorage.getItem('setting_update_check_interval_hours') || '6', 10);
            intervalSlider.value = isNaN(savedInterval) ? 6 : Math.min(24, Math.max(1, savedInterval));
            intervalLabel.textContent = `${intervalSlider.value} ч`;

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
                intervalLabel.textContent = `${intervalSlider.value} ч`;
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
                statusMsg.textContent = 'Проверка наличия обновлений...';
                statusMsg.style.color = '';
                try {
                    const res = await noctune.updater.check(false);
                    if (res && res.ok === false) {
                        statusMsg.textContent = `Ошибка: ${res.error || 'не удалось проверить обновления'}`;
                        statusMsg.style.color = '#ff6b6b';
                    }
                    // Результат (найдено/не найдено/скачано) придёт отдельно
                    // через события updater:* ниже.
                } finally {
                    if (icon) icon.classList.remove('lucide-spin');
                    btnCheck.disabled = false;
                }
            });

            // ── события из main-процесса ──
            noctune.updater.onChecking(() => {
                statusMsg.textContent = 'Проверка наличия обновлений...';
                statusMsg.style.color = '';
            });

            noctune.updater.onNotAvailable(() => {
                statusMsg.textContent = 'У вас установлена самая свежая версия.';
                statusMsg.style.color = '#2ecc71';
                setActionButton('hidden');
            });

            noctune.updater.onError((message) => {
                statusMsg.textContent = `Ошибка проверки обновлений: ${message}`;
                statusMsg.style.color = '#ff6b6b';
            });

            noctune.updater.onAvailable((info) => {
                const version = (info && info.version) || '?';
                statusMsg.innerHTML = `Доступна новая версия <span style="color:var(--accent-color);font-weight:bold;">v${version}</span>.`;
                statusMsg.style.color = '';

                if (autoDownloadToggle.checked) {
                    // Настройка "скачивать автоматически" — без подтверждения,
                    // но установка всё равно только вручную (см. onDownloaded).
                    // Кнопку тут не показываем — скачивание уже пошло само.
                    if (_pendingVersion !== version && _downloadedVersion !== version) {
                        noctune.updater.download();
                        showNotification(`Скачивается версия v${version}...`, 'info', 'Обновление найдено');
                    }
                    _pendingVersion = version;
                    return;
                }

                setActionButton('download', () => {
                    noctune.updater.download();
                    setActionButton('hidden');
                    showNotification(`Скачивается версия v${version}...`, 'info', 'Загрузка обновления');
                });

                // Toast — по-прежнему показываем (удобно, если окно свёрнуто в
                // трей), но теперь это не единственный способ скачать: кнопка
                // выше остаётся, даже если toast закрыли или он потерялся среди
                // остальных уведомлений.
                if (_pendingVersion === version || _downloadedVersion === version) return;
                _pendingVersion = version;

                showNotification(
                    `Доступна новая версия Noctune v${version}.`,
                    'info',
                    'Обновление найдено',
                    null,
                    {
                        actions: [
                            {
                                label: 'Скачать',
                                primary: true,
                                onClick: () => {
                                    noctune.updater.download();
                                    setActionButton('hidden');
                                    showNotification(`Скачивается версия v${version}...`, 'info', 'Загрузка обновления');
                                }
                            },
                            { label: 'Позже', onClick: () => {} }
                        ]
                    }
                );
            });

            noctune.updater.onProgress((progress) => {
                const pct = Math.round((progress && progress.percent) || 0);
                statusMsg.textContent = `Загрузка обновления: ${pct}%`;
                statusMsg.style.color = '';
                btnAction.style.display = 'flex';
                btnAction.disabled = true;
                btnAction.textContent = `Загрузка... ${pct}%`;
            });

            noctune.updater.onDownloaded((info) => {
                const version = (info && info.version) || _pendingVersion || '?';
                _downloadedVersion = version;
                _pendingVersion = null;
                statusMsg.innerHTML = `Версия <span style="color:#2ecc71;font-weight:bold;">v${version}</span> скачана и готова к установке.`;
                statusMsg.style.color = '';

                setActionButton('install', () => { noctune.updater.install(); });

                showNotification(
                    `Версия v${version} скачана и готова к установке.`,
                    'info',
                    'Обновление готово',
                    null,
                    {
                        actions: [
                            {
                                label: 'Установить и перезапустить',
                                primary: true,
                                onClick: () => { noctune.updater.install(); }
                            },
                            { label: 'Позже', onClick: () => {} }
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
