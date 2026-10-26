const path = require('node:path');
const { createEdgeSnap } = require('./window-edge-snap');

const DEFAULTS = Object.freeze({
    enabled: true, onMinimize: true, onTrayHover: true, onMainClose: 'playing',
    hideOnRestore: true, onClose: 'hide',
    onTop: 'always', hoverControls: true, cover: true, progress: true,
    width: 440, height: 96, opacity: 100, fontSize: 13,
    colorMode: 'theme', customColor: '#4a90e2',
    rememberPosition: true, locked: false, snap: true,
});
function normalizeSettings(value = {}) {
    if (!value || typeof value !== 'object') value = {};
    const result = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS)) {
        if (typeof DEFAULTS[key] === 'boolean' && typeof value[key] === 'boolean') result[key] = value[key];
    }
    for (const [key, choices] of Object.entries({ onMainClose: ['playing', 'always', 'default'], onClose: ['restore', 'quit', 'hide'], onTop: ['always', 'playing', 'never'], colorMode: ['custom', 'accent', 'theme'] })) {
        if (choices.includes(value[key])) result[key] = value[key];
    }
    if (typeof value.customColor === 'string' && /^#[\da-f]{6}$/i.test(value.customColor)) result.customColor = value.customColor;
    for (const [key, min, max] of [['width', 300, 900], ['height', 64, 220], ['opacity', 30, 100], ['fontSize', 10, 20]]) {
        if (typeof value[key] === 'number' && Number.isFinite(value[key])) result[key] = Math.round(Math.max(min, Math.min(max, value[key])));
    }
    if (Number.isFinite(value.x) && Number.isFinite(value.y)) { result.x = Math.round(value.x); result.y = Math.round(value.y); }
    return result;
}

function createMiniPlayer({ app, BrowserWindow, ipcMain, screen, getMainWindow, getStore, icon, quit }) {
    let mini = null, settings = { ...DEFAULTS }, state = { playing: false }, storage;
    let automatic = false, dismissed = false, applyingBounds = false, saveTimer, destroyed = false;
    let applied = {};
    let hovered = false, hoverTimer = null;
    let applyingTop = false;
    const edgeSnap = createEdgeSnap();
    let dragOrigin = null;
    const ready = Promise.resolve().then(getStore).then(value => {
        storage = value; settings = normalizeSettings(storage.get('mini-player')); return settings;
    });
    const alive = window => window && !window.isDestroyed();
    const sendMain = (channel, payload) => { const main = getMainWindow(); if (alive(main)) main.webContents.send(channel, payload); };
    const isMain = event => { const main = getMainWindow(); return alive(main) && event.sender === main.webContents && event.senderFrame === main.webContents.mainFrame; };
    const isMini = event => alive(mini) && event.sender === mini.webContents && event.senderFrame === mini.webContents.mainFrame;
    function persist() { storage?.set('mini-player', settings); }
    function wantsOnTop() { return settings.onTop === 'always' || settings.onTop === 'playing' && state.playing; }
    function publishState() {
        if (alive(mini)) mini.webContents.send('mini-player:state', { ...state,
            onTopMode: settings.onTop, alwaysOnTop: mini.isAlwaysOnTop(), visible: mini.isVisible() });
    }
    function notifySettings() {
        sendMain('mini-player:settings', settings);
        if (alive(mini)) mini.webContents.send('mini-player:settings', settings);
        publishState();
    }
    function visibility() { sendMain('mini-player:visibility', !!(alive(mini) && mini.isVisible())); }
    function workBounds(bounds) {
        const area = screen.getDisplayMatching(bounds).workArea;
        const width = Math.min(settings.width, area.width), height = Math.min(settings.height, area.height);
        return { width, height,
            x: Math.round(Math.max(area.x, Math.min(area.x + area.width - width, bounds.x))),
            y: Math.round(Math.max(area.y, Math.min(area.y + area.height - height, bounds.y))) };
    }
    function apply(resize = false) {
        if (!alive(mini)) return;
        const opacity = hovered ? 100 : settings.opacity;
        if (applied.opacity !== opacity) { mini.setOpacity(opacity / 100); applied.opacity = opacity; }
        if (applied.locked !== settings.locked) {
            mini.setMovable(!settings.locked); mini.setResizable(!settings.locked); applied.locked = settings.locked;
        }
        const onTop = wantsOnTop();
        // Windows can clear the native flag on hide/show or style changes.
        if (!applyingTop && (applied.onTop !== onTop || mini.isAlwaysOnTop() !== onTop)) {
            applyingTop = true;
            try { mini.setAlwaysOnTop(onTop, 'floating'); applied.onTop = mini.isAlwaysOnTop(); }
            finally { applyingTop = false; }
        }
        if (resize) {
            applyingBounds = true;
            const bounds = mini.getBounds();
            const next = workBounds({ ...bounds, width: settings.width, height: settings.height });
            if (Object.keys(next).some(key => next[key] !== bounds[key])) mini.setBounds(next);
            applyingBounds = false;
        }
    }
    function watchHover() {
        clearInterval(hoverTimer); hoverTimer = null;
        if (!alive(mini) || !mini.isVisible() || settings.opacity === 100) {
            hovered = false; apply(); return;
        }
        // Native cursor bounds also cover the draggable parts of the frameless window.
        const check = () => {
            const point = screen.getCursorScreenPoint(), bounds = mini.getBounds();
            const inside = point.x >= bounds.x && point.x < bounds.x + bounds.width && point.y >= bounds.y && point.y < bounds.y + bounds.height;
            if (inside !== hovered) { hovered = inside; apply(); }
        };
        check(); hoverTimer = setInterval(check, 80);
    }
    function rememberBounds() {
        if (applyingBounds || !alive(mini)) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            if (!alive(mini)) return;
            const bounds = mini.getBounds();
            settings = normalizeSettings({ ...settings, ...bounds });
            // Persistence must never move the window again after a drag ends.
            persist(); notifySettings();
        }, 180);
    }
    function moveWindow(event, bounds) {
        if (applyingBounds || !alive(mini)) return;
        if (!settings.snap || settings.locked) { edgeSnap.reset(); dragOrigin = null; return; }
        let freeBounds = bounds;
        if (process.platform === 'win32') {
            const point = screen.getCursorScreenPoint();
            if (!dragOrigin) dragOrigin = { point, bounds: { ...bounds } };
            // WM_MOVING can keep reporting the snapped rectangle. Use cursor travel
            // from the start of the drag so it can always detach from that edge.
            freeBounds = { ...bounds,
                x: Math.round(dragOrigin.bounds.x + point.x - dragOrigin.point.x),
                y: Math.round(dragOrigin.bounds.y + point.y - dragOrigin.point.y) };
        }
        const snapped = edgeSnap.move(freeBounds, screen.getDisplayMatching(freeBounds).workArea);
        if (snapped.x === bounds.x && snapped.y === bounds.y) return;
        event.preventDefault();
        const current = mini.getBounds();
        if (current.x !== snapped.x || current.y !== snapped.y) {
            applyingBounds = true;
            try { mini.setBounds({ x: snapped.x, y: snapped.y }, false); }
            finally { applyingBounds = false; }
        }
        rememberBounds();
    }
    function create() {
        if (alive(mini) || destroyed) return;
        applied = {};
        const area = screen.getPrimaryDisplay().workArea;
        const bounds = workBounds({ x: settings.rememberPosition && Number.isFinite(settings.x) ? settings.x : area.x + area.width - settings.width - 24,
            y: settings.rememberPosition && Number.isFinite(settings.y) ? settings.y : area.y + area.height - settings.height - 24,
            width: settings.width, height: settings.height });
        mini = new BrowserWindow({ ...bounds, minWidth: 300, minHeight: 64, maxWidth: 900, maxHeight: 220,
            show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
            skipTaskbar: true, maximizable: false, fullscreenable: false, autoHideMenuBar: true,
            alwaysOnTop: settings.onTop === 'always' || settings.onTop === 'playing' && state.playing,
            title: 'Noctune — Мини-плеер', icon,
            webPreferences: { preload: path.join(__dirname, '../preload/mini-player.js'), sandbox: true, contextIsolation: true, nodeIntegration: false },
        });
        mini.setMenu(null);
        mini.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        mini.webContents.on('will-navigate', event => event.preventDefault());
        mini.webContents.on('will-attach-webview', event => event.preventDefault());
        mini.webContents.on('did-finish-load', () => {
            mini.webContents.send('mini-player:settings', settings);
            publishState();
        });
        mini.on('close', event => { if (destroyed) return; event.preventDefault(); closeMini(); });
        mini.on('minimize', () => minimizeMini());
        mini.on('will-move', moveWindow);
        mini.on('moved', () => {
            if (process.platform === 'win32') { dragOrigin = null; edgeSnap.reset(); rememberBounds(); }
        });
        mini.on('move', () => {
            // Linux has no will-move event; adjust the position immediately there.
            if (process.platform === 'linux') moveWindow({ preventDefault() {} }, mini.getBounds());
            rememberBounds();
        });
        mini.on('resize', rememberBounds);
        mini.on('show', () => {
            applied.onTop = undefined; watchHover(); apply();
            if (wantsOnTop()) mini.moveTop();
            publishState(); visibility();
        });
        mini.on('hide', () => { watchHover(); publishState(); visibility(); });
        mini.on('focus', () => { apply(); publishState(); });
        mini.on('always-on-top-changed', (_event, value) => {
            applied.onTop = value;
            if (!applyingTop && mini.isVisible() && value !== wantsOnTop()) apply();
            publishState();
        });
        mini.on('closed', () => { mini = null; visibility(); });
        apply(true);
        mini.loadFile(path.join(__dirname, '../renderer/mini-player/index.html'));
    }
    function hide() { if (alive(mini) && mini.isVisible()) mini.hide(); }
    function show() {
        if (!settings.enabled || destroyed) return false;
        create();
        if (mini.isMinimized()) mini.restore();
        if (!mini.isVisible()) { apply(true); mini.showInactive(); }
        return true;
    }
    function open(replace = true) {
        automatic = false; dismissed = false;
        if (show() && replace) getMainWindow().hide();
    }
    function showFromTray() {
        const main = getMainWindow();
        if (!settings.enabled || !settings.onTrayHover || !alive(main) || main.isVisible() && !main.isMinimized()) return;
        automatic = true; dismissed = false; reconcile();
    }
    function restoreMain() {
        automatic = false; dismissed = false;
        const main = getMainWindow();
        if (alive(main)) { if (main.isMinimized()) main.restore(); main.show(); main.focus(); }
        sendMain('mini-player:command', { action: 'expand' });
        if (settings.hideOnRestore) hide();
    }
    function closeMini() {
        if (settings.onClose === 'quit') { quit(); return; }
        if (settings.onClose === 'restore') { minimizeMini(); restoreMain(); }
        else minimizeMini();
    }
    function minimizeMini() {
        dismissed = true;
        hide();
    }
    function reconcile() {
        apply();
        if (!settings.enabled) { hide(); return; }
        if (automatic && !dismissed) show();
    }
    function attach(main) {
        main.on('minimize', () => {
            sendMain('window-tray-visibility', false);
            automatic = settings.onMinimize; dismissed = false;
            if (settings.onMinimize) reconcile();
        });
        const restored = () => {
            automatic = false; dismissed = false;
            sendMain('window-tray-visibility', true);
            if (settings.hideOnRestore) hide();
        };
        main.on('restore', restored); main.on('show', restored);
        main.on('closed', destroy);
        screen.on('display-removed', apply); screen.on('display-metrics-changed', apply);
    }
    function handleMainClose(playing) {
        if (!settings.enabled || settings.onMainClose === 'default' || settings.onMainClose === 'playing' && !playing) return false;
        state.playing = playing;
        automatic = true; dismissed = false;
        getMainWindow().hide(); reconcile(); return true;
    }
    function destroy() {
        destroyed = true; clearTimeout(saveTimer); clearInterval(hoverTimer);
        screen.removeListener('display-removed', apply); screen.removeListener('display-metrics-changed', apply);
        if (alive(mini)) mini.destroy(); mini = null;
    }
    app.on('before-quit', destroy);
    ipcMain.handle('mini-player:get-settings', async event => {
        if (!isMain(event) && !isMini(event)) throw Error('Недоступно для этого окна');
        await ready; return settings;
    });
    ipcMain.handle('mini-player:set-settings', async (event, value) => {
        if (!isMain(event)) throw Error('Недоступно для этого окна');
        await ready;
        const previousTop = settings.onTop;
        settings = normalizeSettings({ ...settings, ...value }); edgeSnap.reset(); dragOrigin = null; persist(); apply(true); reconcile(); watchHover();
        if (settings.enabled && previousTop !== settings.onTop && wantsOnTop()) open(false);
        notifySettings();
        return settings;
    });
    ipcMain.on('mini-player:state', (event, value) => {
        if (!isMain(event) || !value || typeof value !== 'object') return;
        const finite = (number, min, max) => typeof number === 'number' && Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : 0;
        const colors = {};
        for (const key of ['--bg-color', '--container-bg', '--text-color', '--text-muted', '--accent-color', '--accent-fg', '--border-color', '--track-hover']) {
            const color = value.colors?.[key];
            if (typeof color === 'string' && /^(#[\da-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(color)) colors[key] = color;
        }
        state = { playing: value.playing === true, radio: value.radio === true, title: String(value.title || '').slice(0, 500),
            artist: String(value.artist || '').slice(0, 500), duration: finite(value.duration, 0, 864000),
            position: finite(value.position, 0, 864000), volume: finite(value.volume, 0, 1), muted: value.muted === true,
            shuffle: value.shuffle === true, repeat: finite(value.repeat, 0, 2), theme: value.theme === 'light' ? 'light' : 'dark', colors,
            hotkeyCombos: Array.isArray(value.hotkeyCombos) ? value.hotkeyCombos.filter(combo => typeof combo === 'string' && combo.length <= 100).slice(0, 200) : [],
            artwork: typeof value.artwork === 'string' && value.artwork.length < 2 * 1024 * 1024 && /^data:image\/(png|jpeg|webp);base64,[a-z\d+/=]+$/i.test(value.artwork) ? value.artwork : '',
        };
        reconcile();
        if (alive(mini) && mini.isVisible()) publishState();
    });
    ipcMain.on('mini-player:command', async (event, command) => {
        if (!isMain(event) && !isMini(event) || !command || typeof command !== 'object') return;
        await ready;
        const { action } = command;
        if (action === 'open' && isMain(event)) {
            open(command.replace !== false);
        } else if (action === 'expand') restoreMain();
        else if (action === 'lyrics' && isMini(event)) { restoreMain(); sendMain('mini-player:command', { action: 'lyrics' }); }
        else if (action === 'settings') { restoreMain(); sendMain('mini-player:command', { action: 'settings' }); }
        else if (action === 'close') closeMini();
        else if (action === 'minimize') minimizeMini();
        else if (action === 'pin' && isMini(event)) {
            settings.onTop = wantsOnTop() ? 'never' : 'always'; persist(); apply();
            if (wantsOnTop()) { open(false); mini.moveTop(); }
            notifySettings();
        } else if (action === 'hotkey' && isMini(event)) {
            const input = command.value;
            if (!input || typeof input.code !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(input.code)) return;
            const value = { code: input.code };
            for (const key of ['ctrlKey', 'altKey', 'shiftKey', 'metaKey']) value[key] = input[key] === true;
            sendMain('mini-player:command', { action, value });
        } else if (isMini(event) && ['playpause', 'prev', 'next', 'mute', 'shuffle', 'repeat', 'seek', 'volume'].includes(action)) {
            const payload = { action };
            if (action === 'seek' || action === 'volume') {
                if (typeof command.value !== 'number' || !Number.isFinite(command.value)) return;
                payload.value = Math.max(0, Math.min(1, command.value));
            }
            sendMain('mini-player:command', payload);
        }
    });
    return { attach, ready, handleMainClose, destroy, open, showFromTray, getWindow: () => mini, getSettings: () => settings };
}
module.exports = { DEFAULTS, normalizeSettings, createMiniPlayer };
