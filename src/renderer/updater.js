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
            const autoDownloadToggle = document.getElementById('setting-auto-download-updates');

            if (!btnCheck || !statusMsg || !autoCheckToggle || !intervalSlider || !autoDownloadToggle) return;

            let _scheduleTimer = null;
            let _pendingVersion = null;   // предложена, но ещё не скачана/отклонена — не дублируем toast
            let _downloadedVersion = null;

            // ── восстановление настроек ──
            const savedAutoCheck = appStorage.getItem('setting_auto_check_updates');
            autoCheckToggle.checked = savedAutoCheck === null ? true : savedAutoCheck === '1';

            const savedInterval = parseInt(appStorage.getItem('setting_update_check_interval_hours') || '6', 10);
            intervalSlider.value = isNaN(savedInterval) ? 6 : Math.min(24, Math.max(1, savedInterval));
            intervalLabel.textContent = `${intervalSlider.value} ч`;

            autoDownloadToggle.checked = appStorage.getItem('setting_auto_download_updates') === '1';

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
            });

            noctune.updater.onError((message) => {
                statusMsg.textContent = `Ошибка проверки обновлений: ${message}`;
                statusMsg.style.color = '#ff6b6b';
            });

            noctune.updater.onAvailable((info) => {
                const version = (info && info.version) || '?';
                statusMsg.innerHTML = `Доступна новая версия <span style="color:var(--accent-color);font-weight:bold;">v${version}</span>.`;
                statusMsg.style.color = '';

                // Не показываем повторный toast за ту же версию, если она уже
                // предложена или уже скачана (например, автопроверка сработала
                // повторно, пока пользователь ещё не отреагировал на первый toast).
                if (_pendingVersion === version || _downloadedVersion === version) return;
                _pendingVersion = version;

                if (autoDownloadToggle.checked) {
                    // Настройка "скачивать автоматически" — без клика в toast,
                    // но установка всё равно только по ручному подтверждению
                    // (см. onDownloaded ниже).
                    noctune.updater.download();
                    showNotification(`Скачивается версия v${version}...`, 'info', 'Обновление найдено');
                    return;
                }

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
            });

            noctune.updater.onDownloaded((info) => {
                const version = (info && info.version) || _pendingVersion || '?';
                _downloadedVersion = version;
                _pendingVersion = null;
                statusMsg.innerHTML = `Версия <span style="color:#2ecc71;font-weight:bold;">v${version}</span> скачана и готова к установке.`;
                statusMsg.style.color = '';

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
            if (autoCheckToggle.checked) {
                // Небольшая задержка, чтобы не мешать первому старту приложения.
                setTimeout(() => { noctune.updater.check(true); }, 8000);
            }
        })();
