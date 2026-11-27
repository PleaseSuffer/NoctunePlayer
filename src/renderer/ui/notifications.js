// Notifications share one identity across toast, history and live updates.
const notifStack = document.getElementById('notification-stack');
const notificationCenter = (() => {
    const STORAGE_KEY = 'notification_history_v1';
    const records = new Map();
    const toasts = new Map();
    let saveTimer;
    let historyFilter = 'all';
    const filters = { all: 'bell', important: 'bell-ring', system: 'monitor', extensions: 'puzzle' };
    const text = key => { const catalogKey = 'notifications.' + key; return globalThis.noctuneI18n?.t(catalogKey) || key; };
    const el = (tag, className, value) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (value !== undefined) node.textContent = value;
        return node;
    };
    try {
        const saved = JSON.parse(appStorage.getItem(STORAGE_KEY) || '[]');
        if (Array.isArray(saved)) for (const row of saved.slice(-200)) {
            if (!row || typeof row.id !== 'string' || typeof row.message !== 'string' || !Number.isFinite(row.createdAt)) continue;
            records.set(row.id, { ...row, actions: [], cornerAction: null, active: false });
        }
    } catch { /* A damaged history must not prevent startup. */ }
    function flush() {
        clearTimeout(saveTimer); saveTimer = null;
        const rows = [...records.values()].map(({ actions, cornerAction, ...row }) => row);
        // Bound both record count and persisted diagnostics size.
        let serialized = JSON.stringify(rows);
        const encoder = new TextEncoder();
        while (rows.length && encoder.encode(serialized).byteLength > 2 * 1024 * 1024) { rows.shift(); serialized = JSON.stringify(rows); }
        appStorage.setItem(STORAGE_KEY, serialized);
    }
    window.addEventListener('beforeunload', flush);
    function visible() {
        return document.getElementById('settings-overlay')?.classList.contains('open') && document.getElementById('panel-notifications')?.classList.contains('active');
    }
    function changed(rebuild = true) {
        while (records.size > 200) {
            const candidate = [...records.values()].find(row => !row.pinned && !toasts.has(row.id)) || [...records.values()].find(row => !toasts.has(row.id));
            if (!candidate) break;
            records.delete(candidate.id);
        }
        if (visible()) for (const row of records.values()) row.read = true;
        if (!saveTimer) saveTimer = setTimeout(flush, 500);
        badges();
        if (rebuild && visible()) renderHistory();
    }
    function badges() {
        const unread = [...records.values()].filter(row => !row.read);
        const enabled = appStorage.getItem('notification_badges') !== '0';
        document.querySelector('[data-panel="panel-notifications"]')?.classList.toggle('has-new-notifications', enabled && unread.length > 0);
        document.getElementById('settings-fab')?.classList.toggle('has-new-notifications', enabled && unread.some(row => row.important));
        const status = document.getElementById('notification-history-count');
        if (status) status.textContent = historyFilter === 'all' ? String(records.size) : `${[...records.values()].filter(matchesHistoryFilter).length} / ${records.size}`;
    }
    function dismiss(id) {
        const toast = toasts.get(id);
        if (!toast) return false;
        const bounds = toast.getBoundingClientRect();
        const appearance = getComputedStyle(toast);
        const opacity = appearance.opacity, transform = appearance.transform;
        const countdown = toast.querySelector('.notification-toast-countdown');
        if (countdown) countdown.style.transform = getComputedStyle(countdown).transform;
        clearTimeout(toast._dismissTimer);
        toast._dismissAnimation?.cancel();
        toasts.delete(id);
        // Retire the live identity immediately; late SDK updates cannot revive it.
        delete toast.dataset.notificationId; delete toast.dataset.replaceKey;
        toast.inert = true; toast.setAttribute('aria-hidden', 'true');
        toast.classList.add('is-dismissing');
        Object.assign(toast.style, { position: 'fixed', left: bounds.left + 'px', top: bounds.top + 'px', width: bounds.width + 'px', margin: '0', animation: 'none', zIndex: '9999999' });
        // Outside the scrollable stack, the reverse slide is not clipped.
        document.body.append(toast);
        const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250;
        const exit = toast.animate([{ opacity, transform }, { opacity: 0, transform: 'translateX(30px)' }], { duration, easing: 'ease-in', fill: 'forwards' });
        const cleanup = setTimeout(() => toast.remove(), duration + 50);
        exit.finished.then(() => { clearTimeout(cleanup); toast.remove(); }, () => { clearTimeout(cleanup); toast.remove(); });
        const row = records.get(id);
        if (row) row.active = false;
        changed(); return true;
    }
    function remove(id) { dismiss(id); records.delete(id); changed(); }
    function button(label, callback, className = 'notification-toast-action') {
        const node = el('button', className, label); node.type = 'button';
        node.addEventListener('click', callback); return node;
    }
    function icon(name) {
        const node = el('i'); node.dataset.lucide = name; node.setAttribute('aria-hidden', 'true'); return node;
    }
    function iconButton(name, label, callback, extraClass = '') {
        const node = button('', callback, 'notification-tool ' + extraClass);
        node.title = label; node.setAttribute('aria-label', label); node.append(icon(name)); return node;
    }
    function headingText(row) {
        const titleKey = 'ui.notifications.' + ({ error: 'error', warning: 'warning' }[row.type] || 'information');
        return row.title || globalThis.noctuneI18n?.t(titleKey) || row.type;
    }
    function metadataText(row, history) {
        const normalize = value => String(value || '').trim().toLocaleLowerCase();
        const source = normalize(row.source) === normalize(headingText(row)) ? '' : row.source;
        return [source, row.pinned ? text('pinned') : '', row.important ? text('important') : '', history ? new Date(row.createdAt).toLocaleString() : ''].filter(Boolean).join(' · ');
    }
    function card(row, history = false) {
        const node = el('div', history ? 'notification-history-card' : 'notification-toast');
        node.dataset.notificationId = row.id;
        if (row.key) node.dataset.replaceKey = row.key;
        node.classList.toggle('is-important', !!row.important);
        const body = el('div', 'notification-toast-body');
        node.dataset.type = row.type;
        const heading = el('div', 'notification-toast-title', headingText(row));
        body.append(heading, el('div', 'notification-history-meta notification-source-meta', metadataText(row, history)), el('div', 'notification-toast-msg', row.message));
        if (row.progress !== undefined) {
            const progress = el('progress', 'notification-progress'); progress.max = 1;
            if (row.progress !== null) progress.value = row.progress;
            progress.setAttribute('aria-label', row.progressLabel || row.title || text('progress'));
            body.append(progress);
            if (row.progressLabel) body.append(el('div', 'notification-history-meta notification-progress-label', row.progressLabel));
        }
        const actions = el('div', 'notification-toast-actions');
        const copy = iconButton('copy', text('copy'), async () => {
            try { await navigator.clipboard.writeText(row.copyText || row.message); }
            catch { const area = el('textarea'); area.value = row.copyText || row.message; document.body.append(area); area.select(); document.execCommand('copy'); area.remove(); }
            copy.replaceChildren(icon('check')); copy.classList.add('copied');
            copy.title = globalThis.noctuneI18n?.t('ui.notifications.copied') || text('copy');
            globalThis.lucide?.createIcons({ root: copy });
            setTimeout(() => {
                copy.replaceChildren(icon('copy')); copy.classList.remove('copied'); copy.title = text('copy');
                globalThis.lucide?.createIcons({ root: copy });
            }, 1600);
        }, 'notification-toast-copy-stack');
        for (const action of row.actions || []) {
            const control = button(action.label, async () => {
                control.disabled = true;
                try {
                    await action.onClick?.();
                    // A command may have replaced this notification while running.
                    if (action.dismissOnClick !== false && records.get(row.id) === row) dismiss(row.id);
                } catch (error) { showNotification(String(error.message || error), 'error'); }
                finally { control.disabled = false; }
            }, 'notification-toast-action' + (action.primary ? ' primary' : ''));
            actions.append(control);
        }
        if (row.cornerAction) actions.append(button(row.cornerAction.title || text('open'), async () => {
            try { await row.cornerAction.onClick?.(); if (row.cornerAction.dismissOnClick) dismiss(row.id); }
            catch (error) { showNotification(String(error.message || error), 'error'); }
        }));
        body.append(actions);
        const statusIcon = el('div', 'notification-toast-icon ' + row.type);
        const glyph = el('i'); glyph.dataset.lucide = ({error: 'alert-circle', warning: 'alert-triangle', success: 'circle-check'}[row.type] || 'info');
        statusIcon.append(glyph); node.append(statusIcon, body);
        const tools = el('div', 'notification-tools');
        const pin = iconButton(row.pinned ? 'pin-off' : 'pin', row.pinned ? text('unpin') : text('pin'), () => update(row.id, { pinned: !row.pinned }));
        pin.setAttribute('aria-pressed', String(!!row.pinned));
        const close = iconButton('x', history ? text('delete') : (globalThis.noctuneI18n?.t('player.interface.close') || 'Close'), () => history ? remove(row.id) : dismiss(row.id), 'notification-remove');
        tools.append(copy, pin, close);
        node.append(tools); globalThis.lucide?.createIcons({ root: node }); return node;
    }
    function mount(row, existingOnly = false) {
        const previous = toasts.get(row.id);
        if (existingOnly && !previous) return;
        const enabled = document.getElementById('setting-notifications');
        if (enabled && !enabled.checked) return;
        if (!previous && toasts.size >= 3) {
            const candidate = [...toasts.keys()].find(id => !records.get(id)?.pinned);
            if (!candidate) return; // All slots pinned: retain overflow in history.
            dismiss(candidate);
        }
        const node = card(row);
        if (previous) { clearTimeout(previous._dismissTimer); previous._dismissAnimation?.cancel(); node.style.animation = 'none'; previous.replaceWith(node); }
        else notifStack.append(node);
        toasts.set(row.id, node); row.active = true;
        if (!row.pinned && row.duration !== 0) {
            const duration = row.duration || 8000;
            const countdown = el('span', 'notification-toast-countdown');
            countdown.setAttribute('aria-hidden', 'true'); node.append(countdown);
            const animation = countdown.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration, fill: 'forwards' });
            node._dismissAnimation = animation;
            let remaining = duration, started = null;
            let hovered = node.matches(':hover'), focused = node.contains(document.activeElement);
            const sync = () => {
                if (toasts.get(row.id) !== node) return;
                clearTimeout(node._dismissTimer);
                if (started !== null) remaining = Math.max(0, remaining - (performance.now() - started));
                started = null;
                if (hovered || focused) { animation.pause(); return; }
                started = performance.now(); animation.play();
                node._dismissTimer = setTimeout(() => dismiss(row.id), remaining);
            };
            node.addEventListener('mouseenter', () => { hovered = true; sync(); });
            node.addEventListener('mouseleave', () => { hovered = false; sync(); });
            node.addEventListener('focusin', () => { focused = true; sync(); });
            node.addEventListener('focusout', event => { focused = node.contains(event.relatedTarget); sync(); });
            sync();
        }
    }
    function show(message, type, title, stack, options = {}) {
        const key = options.replaceKey;
        const previous = key && [...records.values()].find(row => row.key === key);
        const id = previous?.id || crypto.randomUUID();
        const row = { id, key, message: String(message).slice(0, 16000), type, title: title ? String(title).slice(0, 200) : '',
            source: options.source || '', owner: options.owner || '', createdAt: previous?.createdAt || Date.now(), updatedAt: Date.now(),
            read: false, important: options.important === true, pinned: options.pinned === true,
            progress: options.progress, progressLabel: options.progressLabel, duration: options.duration,
            copyText: String(options.copyText || stack || '').slice(0, 65536), actions: options.actions || [], cornerAction: options.cornerAction || null };
        records.set(id, row); mount(row); changed();
        const toast = toasts.get(id);
        if (toast) { toast.notificationId = id; toast.update = patch => update(id, patch); toast.dismiss = () => dismiss(id); }
        return toast;
    }
    function refreshLiveCard(node, row) {
        node.querySelector('.notification-toast-msg').textContent = row.message;
        if (row.title) node.querySelector('.notification-toast-title').textContent = row.title;
        let progress = node.querySelector('progress');
        let label = node.querySelector('.notification-progress-label');
        if (row.progress === undefined) { progress?.remove(); label?.remove(); return; }
        if (!progress) {
            progress = el('progress', 'notification-progress'); progress.max = 1;
            node.querySelector('.notification-toast-actions').before(progress);
        }
        if (row.progress === null) progress.removeAttribute('value'); else progress.value = row.progress;
        progress.setAttribute('aria-label', row.progressLabel || row.title || text('progress'));
        if (row.progressLabel) {
            if (!label) { label = el('div', 'notification-history-meta notification-progress-label'); progress.after(label); }
            label.textContent = row.progressLabel;
        } else label?.remove();
    }
    function update(id, patch) {
        const row = records.get(id); if (!row) return false;
        const allowed = ['message', 'title', 'type', 'pinned', 'important', 'progress', 'progressLabel', 'actions', 'duration', 'copyText'];
        const next = { ...row, ...Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.includes(key))), updatedAt: Date.now() };
        // Progress ticks preserve read state and never resurrect a dismissed toast.
        const live = Object.keys(patch).every(key => ['message', 'progress', 'progressLabel', 'copyText'].includes(key));
        if (live) {
            // Preserve control focus and pointer targets while progress/speed changes.
            Object.assign(row, next);
            const toast = toasts.get(id); if (toast) refreshLiveCard(toast, row);
            const history = document.getElementById('notification-history-list');
            const card = history && [...history.children].find(node => node.dataset.notificationId === id);
            if (card) refreshLiveCard(card, row);
            changed(false);
        } else { records.set(id, next); mount(next, true); changed(); }
        return true;
    }
    function matchesHistoryFilter(row) {
        return historyFilter === 'important' ? row.important : historyFilter === 'system' ? !row.owner : historyFilter === 'extensions' ? !!row.owner : true;
    }
    function renderHistory() {
        const list = document.getElementById('notification-history-list'); if (!list) return;
        const rows = [...records.values()].filter(matchesHistoryFilter).sort((a, b) => Number(b.pinned) - Number(a.pinned) || Number(b.important) - Number(a.important) || b.createdAt - a.createdAt);
        list.replaceChildren();
        for (const row of rows) list.append(card(row, true));
        const count = document.getElementById('notification-history-count');
        if (count) count.textContent = historyFilter === 'all' ? String(records.size) : `${rows.length} / ${records.size}`;
        if (!rows.length) {
            const empty = el('div', 'notification-history-empty');
            const badge = el('div', 'notification-empty-icon'); badge.append(icon(records.size ? 'list-filter' : 'bell-check'));
            empty.append(badge, el('h3', '', text(records.size ? 'emptyFilter' : 'empty')), el('p', '', text(records.size ? 'emptyFilterDescription' : 'emptyDescription')));
            list.append(empty); globalThis.lucide?.createIcons({ root: empty });
        }
    }
    function updateFilter() {
        const trigger = document.getElementById('notification-history-filter');
        if (!trigger) return;
        const label = trigger.querySelector('.pd-label'); label.textContent = text(historyFilter);
        trigger.querySelector('.pd-icon').replaceChildren(icon(filters[historyFilter]));
        for (const option of document.querySelectorAll('#notification-filter-menu [data-filter]')) {
            const selected = option.dataset.filter === historyFilter;
            option.classList.toggle('active', selected); option.setAttribute('aria-selected', String(selected));
        }
        globalThis.lucide?.createIcons({ root: trigger });
    }
    function initFilter() {
        const wrapper = document.getElementById('notification-filter-dropdown');
        const trigger = document.getElementById('notification-history-filter');
        const menu = document.getElementById('notification-filter-menu');
        if (!wrapper || !trigger || !menu) return;
        const options = [...menu.querySelectorAll('[data-filter]')];
        function open(value, focus = false) {
            menu.classList.toggle('open', value); trigger.classList.toggle('open', value);
            trigger.setAttribute('aria-expanded', String(value));
            if (value && focus) (options.find(option => option.dataset.filter === historyFilter) || options[0]).focus();
        }
        trigger.addEventListener('click', () => open(!menu.classList.contains('open')));
        for (const option of options) option.addEventListener('click', () => {
            historyFilter = option.dataset.filter; updateFilter(); renderHistory(); open(false); trigger.focus();
        });
        document.addEventListener('click', event => { if (!wrapper.contains(event.target)) open(false); });
        wrapper.addEventListener('focusout', event => { if (!wrapper.contains(event.relatedTarget)) open(false); });
        wrapper.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); open(false); trigger.focus(); }
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                if (!menu.classList.contains('open')) { open(true, true); return; }
                const index = options.indexOf(document.activeElement);
                options[event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length].focus();
            }
        });
        updateFilter();
    }
    function visit() { if (visible()) { for (const row of records.values()) row.read = true; changed(); } }
    document.addEventListener('DOMContentLoaded', () => {
        const toggle = document.getElementById('notification-badges');
        if (toggle) { toggle.checked = appStorage.getItem('notification_badges') !== '0'; toggle.addEventListener('change', () => { appStorage.setItem('notification_badges', toggle.checked ? '1' : '0'); badges(); }); }
        document.getElementById('notification-history-clear')?.addEventListener('click', () => {
            for (const row of records.values()) if (!row.pinned && !row.active) records.delete(row.id);
            changed(); renderHistory();
        });
        document.getElementById('notification-history-read')?.addEventListener('click', () => { for (const row of records.values()) row.read = true; changed(); });
        initFilter();
        badges(); renderHistory();
    });
    globalThis.noctuneI18n?.onChange?.(() => { badges(); updateFilter(); if (visible()) renderHistory(); });
    return { show, update, dismiss, visit,
        find: key => [...records.values()].find(row => row.key === key)?.id,
        cleanup(owner) { for (const row of records.values()) if (row.owner === owner) { dismiss(row.id); row.actions = []; row.pinned = false; row.progress = undefined; } changed(); },
    };
})();
window.notificationCenter = notificationCenter;
function showNotification(msg, type = 'error', title = null, stackTrace = null, options = {}) {
    return notificationCenter.show(msg, type, title, stackTrace, options);
}
function dismissToast(toast) { notificationCenter.dismiss(toast?.dataset.notificationId); }

        document.addEventListener('DOMContentLoaded', async () => {
            const currentVersionEl = document.getElementById('update-current-version');
            const updateStatusMsg = document.getElementById('update-status-msg');

            // Отображаем реальную версию приложения при запуске. Сама проверка
            // обновлений (кнопка "Проверить", периодический автопросмотр,
            // toast-уведомления) теперь полностью в renderer/updates/updater.js —
            // через electron-updater, а не отдельный GitHub-опрос отсюда.
            try {
                const actualVersion = await noctune.getAppVersion();
                const localVersion = String(actualVersion || '0.0.0').replace(/^v/, '');
                if (currentVersionEl) currentVersionEl.textContent = `v${localVersion}`;
                if (updateStatusMsg) {
                    updateStatusMsg.textContent = (globalThis.noctuneI18n?.t("settings.about.clickCheckToLookForNewVersions", {}) ?? "Нажмите «Проверить» для поиска новых версий");
                }
            } catch (e) {
                console.error((globalThis.noctuneI18n?.t("ui.notifications.couldNotGetApplicationVersion", {}) ?? "Не удалось получить версию приложения:"), e);
            }
        });

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
                if (typeof noctune !== 'undefined' && noctune.versions) {
                    lines.push('  Electron : ' + (noctune.versions.electron || 'n/a'));
                    lines.push('  Node     : ' + (noctune.versions.node     || 'n/a'));
                    lines.push('  Chrome   : ' + (noctune.versions.chrome   || 'n/a'));
                    lines.push('  OS       : ' + (noctune.platform || 'n/a'));
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
                    lines.push((globalThis.noctuneI18n?.t("ui.notifications.additionalProperties", {}) ?? "  — дополнительные свойства:"));
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
                lines.push((globalThis.noctuneI18n?.t("ui.notifications.unavailableForThisErrorType", {}) ?? "(недоступен для данного типа ошибки)"));
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
                lines.push((globalThis.noctuneI18n?.t("ui.notifications.empty", {}) ?? "  (пусто)"));
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
                showNotification(msg.substring(0, 200), 'error', null, stack, { copyText: stack || msg });
            }
        };
        const _origConsoleWarn = console.warn.bind(console);
        console.warn = function(...args) {
            _origConsoleWarn(...args);
            _pushLog('WARN', args);
            const msg = args.map(a => (typeof a === 'object' ? (a?.message || JSON.stringify(a)) : String(a))).join(' ');
            if (msg && !msg.includes('ResizeObserver')) {
                showNotification(msg.substring(0, 200), 'warning', null, null, { copyText: msg });
            }
        };

        // Main-process errors use the same setting, toast and copyable report as player errors.
        if (window.noctune?.errors) {
            noctune.errors.onReport(error => console.error((globalThis.noctuneI18n?.t("errors.mainProcess.prefix") ?? "Основной процесс:"), error));
            if (document.readyState === 'complete') noctune.errors.ready();
            else window.addEventListener('load', () => noctune.errors.ready(), { once: true });
        }
