        // ========================
        // NOTIFICATION SYSTEM
        // ========================
        const notifStack = document.getElementById('notification-stack');
        let notifCount = 0;
        const MAX_NOTIFS = 3;

        function showNotification(msg, type = 'error', title = null, stackTrace = null) {
            // Check if notifications enabled
            const notifToggle = document.getElementById('setting-notifications');
            if (notifToggle && !notifToggle.checked) return;

            // Max 3 toasts
            const existing = notifStack.querySelectorAll('.notification-toast');
            if (existing.length >= MAX_NOTIFS) {
                const oldest = notifStack.querySelector('.notification-toast');
                if (oldest) oldest.remove();
            }

            const icons  = { error: 'alert-circle', warning: 'alert-triangle', info: 'info' };
            const titles = { error: 'Ошибка', warning: 'Предупреждение', info: 'Информация' };
            const iconName  = icons[type]  || 'info';
            const titleText = title || titles[type] || 'Уведомление';

            // Кнопка копирования стека — только для ошибок с доступным стеком
            const copyBtnHtml = (stackTrace && type === 'error') ? `
                <button class="notification-toast-copy-stack" title="Скопировать полный stack trace">
                    <i data-lucide="clipboard" style="width:11px;height:11px;"></i>
                    Скопировать stack trace
                </button>` : '';

            const toast = document.createElement('div');
            toast.className = 'notification-toast';
            toast.innerHTML = `
                <div class="notification-toast-icon ${type}">
                    <i data-lucide="${iconName}" style="width:16px;height:16px;"></i>
                </div>
                <div class="notification-toast-body">
                    <div class="notification-toast-title">${titleText}</div>
                    <div class="notification-toast-msg">${msg}</div>
                    ${copyBtnHtml}
                </div>
                <button class="notification-toast-close" title="Закрыть">
                    <i data-lucide="x" style="width:13px;height:13px;"></i>
                </button>
            `;

            const closeBtn = toast.querySelector('.notification-toast-close');
            closeBtn.addEventListener('click', () => dismissToast(toast));

            // Обработчик копирования stack trace
            const copyBtn = toast.querySelector('.notification-toast-copy-stack');
            if (copyBtn && stackTrace) {
                copyBtn.addEventListener('click', () => {
                    navigator.clipboard.writeText(stackTrace).then(() => {
                        copyBtn.classList.add('copied');
                        copyBtn.innerHTML = '<i data-lucide="check" style="width:11px;height:11px;"></i> Скопировано';
                        lucide.createIcons({ nodes: [copyBtn] });
                        setTimeout(() => {
                            copyBtn.classList.remove('copied');
                            copyBtn.innerHTML = '<i data-lucide="clipboard" style="width:11px;height:11px;"></i> Скопировать stack trace';
                            lucide.createIcons({ nodes: [copyBtn] });
                        }, 2000);
                    }).catch(() => {
                        // Fallback для старых браузеров
                        const ta = document.createElement('textarea');
                        ta.value = stackTrace;
                        ta.style.position = 'fixed';
                        ta.style.opacity = '0';
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand('copy');
                        document.body.removeChild(ta);
                        copyBtn.classList.add('copied');
                        copyBtn.innerHTML = '<i data-lucide="check" style="width:11px;height:11px;"></i> Скопировано';
                        lucide.createIcons({ nodes: [copyBtn] });
                        setTimeout(() => {
                            copyBtn.classList.remove('copied');
                            copyBtn.innerHTML = '<i data-lucide="clipboard" style="width:11px;height:11px;"></i> Скопировать stack trace';
                            lucide.createIcons({ nodes: [copyBtn] });
                        }, 2000);
                    });
                });
            }

            notifStack.appendChild(toast);
            lucide.createIcons();

            const timer = setTimeout(() => dismissToast(toast), 6000);
            toast._dismissTimer = timer;
        }

        document.addEventListener('DOMContentLoaded', async () => {
            const currentVersionEl = document.getElementById('update-current-version');
            const updateStatusMsg = document.getElementById('update-status-msg');
            const btnCheckUpdates = document.getElementById('btn-check-updates');
            
            let downloadUrl = 'https://github.com/PleaseSuffer/NoctunePlayer/releases';
            let localVersion = '0.0.0'; // Будем хранить чистую локальную версию для сравнения

            let ipc = null;
            if (typeof require !== 'undefined') {
                try {
                    ipc = require('electron').ipcRenderer;
                } catch (e) {
                    console.error("Не удалось импортировать electron через require:", e);
                }
            }

            // Функция для корректного сравнения SemVer (1.1.2 > 1.1.1)
            function isNewerVersion(local, remote) {
                const clean = (v) => v.replace(/^v/, '').split('.').map(Number);
                const [lMajor, lMinor, lPatch] = clean(local);
                const [rMajor, rMinor, rPatch] = clean(remote);

                if (rMajor !== lMajor) return rMajor > lMajor;
                if (rMinor !== lMinor) return rMinor > lMinor;
                return rPatch > lPatch;
            }

            // 1. Отображаем реальную версию приложения при запуске
            try {
                if (ipc) {
                    const actualVersion = await ipc.invoke('get-app-version');
                    localVersion = actualVersion.replace(/^v/, ''); // Сохраняем чистую версию
                    if (currentVersionEl) currentVersionEl.textContent = `v${localVersion}`;
                }
                if (updateStatusMsg) {
                    updateStatusMsg.textContent = 'Нажмите «Проверить» для поиска новых версий на GitHub';
                }
            } catch (e) {
                console.error('Не удалось получить версию приложения:', e);
            }

            // 2. Логика проверки при нажатии на кнопку
            if (btnCheckUpdates) {
                btnCheckUpdates.addEventListener('click', async () => {
                    if (!ipc) {
                        updateStatusMsg.textContent = 'Ошибка: среда Electron недоступна';
                        return;
                    }

                    const icon = btnCheckUpdates.querySelector('i[data-lucide="refresh-cw"]');
                    if (icon) icon.classList.add('lucide-spin');
                    btnCheckUpdates.disabled = true;
                    updateStatusMsg.textContent = 'Проверка наличия обновлений...';

                    try {
                        const result = await ipc.invoke('check-for-updates');

                        if (!result.success) {
                            updateStatusMsg.textContent = `Ошибка: ${result.error}`;
                            updateStatusMsg.style.color = '#ff6b6b';
                            return;
                        }

                        const hasRealUpdate = result.hasUpdate && isNewerVersion(localVersion, result.latestVersion);

                        if (hasRealUpdate) {
                            const cleanLatest = result.latestVersion.replace(/^v/, '');
                            updateStatusMsg.innerHTML = `Доступна новая версия <span style="color:var(--accent-color); font-weight:bold;">v${cleanLatest}</span>. <span id="link-download" style="color:var(--accent-color); cursor:pointer; text-decoration:underline; margin-left:5px;">Скачать</span>`;
                            updateStatusMsg.style.color = '';
                            downloadUrl = result.updateUrl;

                            const linkDownload = document.getElementById('link-download');
                            if (linkDownload) {
                                linkDownload.addEventListener('click', () => {
                                    ipc.send('open-external-url', downloadUrl);
                                });
                            }
                        } else {
                            updateStatusMsg.textContent = 'У вас установлена самая свежая версия.';
                            updateStatusMsg.style.color = '#2ecc71';
                        }

                    } catch (err) {
                        updateStatusMsg.textContent = 'Произошла ошибка при проверке.';
                        updateStatusMsg.style.color = '#ff6b6b';
                    } finally {
                        if (icon) icon.classList.remove('lucide-spin');
                        btnCheckUpdates.disabled = false;
                    }
                });
            }
        });

        function dismissToast(toast) {
            if (!toast.isConnected) return;
            clearTimeout(toast._dismissTimer);
            toast.classList.add('hiding');
            setTimeout(() => { if (toast.isConnected) toast.remove(); }, 320);
        }

        // ── Кольцевой буфер последних логов (50 записей) ─────────────────
        const LOG_BUFFER_SIZE = 50;
        window._appLogBuffer = [];
        function _pushLog(level, args) {
            const entry = {
                time:  new Date().toISOString(),
                level,
                msg:   args.map(a => {
                    if (a instanceof Error) return `[${a.name}] ${a.message}`;
                    if (a && typeof a === 'object') { try { return JSON.stringify(a); } catch { return String(a); } }
                    return String(a);
                }).join(' ')
            };
            window._appLogBuffer.push(entry);
            if (window._appLogBuffer.length > LOG_BUFFER_SIZE) window._appLogBuffer.shift();
        }

        // Перехватываем console.log тоже (тихо, без UI)
        const _origConsoleLog = console.log.bind(console);
        console.log = function(...args) { _origConsoleLog(...args); _pushLog('LOG', args); };

        // Строит полную строку для копирования по объекту ошибки + контексту
        function buildFullTrace(errObj, allArgs) {
            const lines = [];
            const sep   = '─'.repeat(60);

            // 1. Временная метка и окружение
            lines.push('╔ REPORT ' + new Date().toISOString());
            try {
                lines.push('  UA       : ' + navigator.userAgent);
                lines.push('  Platform : ' + navigator.platform);
                if (typeof process !== 'undefined') {
                    lines.push('  Electron : ' + (process.versions?.electron || 'n/a'));
                    lines.push('  Node     : ' + (process.versions?.node     || 'n/a'));
                    lines.push('  Chrome   : ' + (process.versions?.chrome   || 'n/a'));
                    lines.push('  OS       : ' + (process.platform || 'n/a'));
                }
            } catch {}
            lines.push(sep);

            // 2. Основная информация об ошибке
            if (errObj) {
                lines.push('ERROR');
                // Стандартные поля
                const knownFields = ['name','message','stack','code','type',
                                     'fileName','lineNumber','columnNumber','cause'];
                knownFields.forEach(k => {
                    if (errObj[k] !== undefined && errObj[k] !== null && errObj[k] !== '') {
                        lines.push(`  ${k.padEnd(14)}: ${errObj[k]}`);
                    }
                });
                // Все остальные enumerable свойства
                const extra = Object.keys(errObj).filter(k => !knownFields.includes(k));
                if (extra.length) {
                    lines.push('  — дополнительные свойства:');
                    extra.forEach(k => { try { lines.push(`  ${k.padEnd(14)}: ${JSON.stringify(errObj[k])}`); } catch {} });
                }
            }
            lines.push(sep);

            // 3. Полный stack (отдельно для удобства)
            if (errObj?.stack && errObj.stack.trim()) {
                lines.push('STACK TRACE');
                lines.push(errObj.stack.trim());
            } else {
                lines.push('STACK TRACE');
                lines.push('(недоступен для данного типа ошибки)');
            }
            lines.push(sep);

            // 4. Все аргументы console.error
            lines.push('CONSOLE.ERROR ARGUMENTS (' + allArgs.length + ')');
            allArgs.forEach((a, i) => {
                let repr;
                if (a instanceof Error) {
                    repr = `[Error] ${a.name}: ${a.message}`;
                } else if (a && typeof a === 'object') {
                    try { repr = JSON.stringify(a, null, 2); } catch { repr = String(a); }
                } else {
                    repr = String(a);
                }
                lines.push(`  [${i}] ${repr}`);
            });
            lines.push(sep);

            // 5. Последние логи из буфера
            lines.push('RECENT LOGS (last ' + window._appLogBuffer.length + ')');
            if (window._appLogBuffer.length === 0) {
                lines.push('  (пусто)');
            } else {
                window._appLogBuffer.forEach(e => {
                    lines.push(`  [${e.time}] [${e.level.padEnd(5)}] ${e.msg}`);
                });
            }
            lines.push(sep);
            lines.push('╚ END REPORT');

            return lines.join('\n');
        }

        // Override console.error to show notifications for player errors
        const _origConsoleError = console.error.bind(console);
        console.error = function(...args) {
            _origConsoleError(...args);
            _pushLog('ERROR', args);

            // Ищем объект ошибки среди всех аргументов (не только первый)
            const errObj = args.find(a => a instanceof Error)
                        || args.find(a => a && typeof a === 'object' && ('stack' in a || 'message' in a));

            const msg = args.map(a =>
                a instanceof Error ? a.message :
                (typeof a === 'object' && a !== null) ? (a.message || JSON.stringify(a)) :
                String(a)
            ).join(' ');

            const stack = errObj ? buildFullTrace(errObj, args) : null;

            if (msg && !msg.includes('ResizeObserver') && !msg.includes('favicon') && !msg.includes('AbortError')) {
                showNotification(msg.substring(0, 200), 'error', null, stack);
            }
        };
        const _origConsoleWarn = console.warn.bind(console);
        console.warn = function(...args) {
            _origConsoleWarn(...args);
            _pushLog('WARN', args);
            const msg = args.map(a => (typeof a === 'object' ? (a?.message || JSON.stringify(a)) : String(a))).join(' ');
            if (msg && !msg.includes('ResizeObserver')) {
                showNotification(msg.substring(0, 200), 'warning');
            }
        };

