const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs'), path = require('node:path');
const { compileFunction } = require('node:vm'), { createRequire } = require('node:module');
const { DEFAULTS, normalizeSettings, createMiniPlayer } = require('../../src/main/mini-player');
// Mimic Electron's lazy screen proxy in a secondary process quitting before ready.
{
    const earlyApp = new EventEmitter(), earlyIpc = new EventEmitter();
    earlyIpc.handle = () => {};
    const unavailableScreen = new Proxy({}, { get() { throw Error('screen before ready'); } });
    const earlyController = createMiniPlayer({ app: earlyApp, ipcMain: earlyIpc, screen: unavailableScreen,
        BrowserWindow: null, getMainWindow: () => null, getStore: async () => ({ get: () => undefined }) });
    assert.doesNotThrow(() => earlyApp.emit('before-quit'));
    assert.doesNotThrow(() => earlyController.destroy(), 'cleanup remains idempotent');
}
assert.deepEqual(normalizeSettings(null), DEFAULTS);
assert.equal(normalizeSettings({ width: 10, height: Infinity, opacity: 200, onClose: 'bogus' }).width, 300);
assert.equal(normalizeSettings({ height: Infinity }).height, 96);
assert.equal(normalizeSettings({ onTop: 'untrusted' }).onTop, 'always');
assert.equal(normalizeSettings({ colorMode: 'custom', customColor: '#abcdef' }).customColor, '#abcdef');
assert.equal(normalizeSettings({ colorMode: 'invalid', customColor: 'url(file)' }).colorMode, 'theme');
assert.equal(normalizeSettings({ customColor: 'url(file)' }).customColor, DEFAULTS.customColor);
class Window extends EventEmitter {
    constructor(options = {}) {
        super(); this.options = options; this.bounds = { x: 0, y: 0, width: 1050, height: 800, ...options };
        this.visible = false; this.dead = false; this.minimized = false;
        this.webContents = new EventEmitter(); this.webContents.mainFrame = {};
        this.sent = []; this.webContents.send = (channel, payload) => this.sent.push({ channel, payload });
        this.webContents.setWindowOpenHandler = handler => { this.openHandler = handler; };
    }
    isDestroyed() { return this.dead; } isVisible() { return this.visible; } isMinimized() { return this.minimized; }
    show() { this.visible = true; this.emit('show'); } showInactive() { this.show(); }
    hide() { this.visible = false; this.emit('hide'); }
    restore() { this.minimized = false; this.emit('restore'); } focus() {}
    destroy() { this.dead = true; this.emit('closed'); }
    setMenu() {} loadFile(value) { this.file = value; }
    getBounds() { return { x: this.bounds.x, y: this.bounds.y, width: this.bounds.width, height: this.bounds.height }; }
    setBounds(value) { Object.assign(this.bounds, value); }
    setAlwaysOnTop(value) { this.onTop = value; }
    isAlwaysOnTop() { return this.onTop === true; }
    moveTop() { this.raised = (this.raised || 0) + 1; }
    setOpacity(value) { this.opacity = value; }
    setMovable(value) { this.movable = value; } setResizable(value) { this.resizable = value; }
}
// Compile only the controller with a local platform value. No global process
// mutation or host-specific skip: every npm test run exercises all three paths.
function controllerFor(platform) {
    const filename = require.resolve('../../src/main/mini-player');
    const target = { exports: {} };
    compileFunction(fs.readFileSync(filename, 'utf8'),
        ['require', 'module', 'exports', '__dirname', 'process'], { filename })(
        createRequire(filename), target, target.exports, path.dirname(filename), Object.freeze({ platform }));
    return target.exports.createMiniPlayer;
}
async function exercise(platform) {
    const createMiniPlayer = controllerFor(platform);
    const app = new EventEmitter(), ipcMain = new EventEmitter(), handlers = new Map(), screen = new EventEmitter();
    ipcMain.handle = (key, fn) => handlers.set(key, fn);
    screen.getPrimaryDisplay = screen.getDisplayMatching = () => ({ workArea: { x: 0, y: 0, width: 1280, height: 720 } });
    const stored = new Map([['mini-player', { ...DEFAULTS, x: 9000, y: -3000 }]]);
    const store = { get: key => stored.get(key), set: (key, value) => stored.set(key, structuredClone(value)) };
    let cursor = { x: -1000, y: -1000 }, cursorQueries = 0;
    screen.getCursorScreenPoint = () => { cursorQueries++; return cursor; };
    const main = new Window();
    let quits = 0;
    const controller = createMiniPlayer({ app, ipcMain, screen, BrowserWindow: Window, getMainWindow: () => main, getStore: async () => store, quit: () => quits++ });
    controller.attach(main);
    const sender = window => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
    const mainEvent = sender(main), foreign = sender(new Window());
    const invoke = (channel, event, value) => handlers.get(channel)(event, value);
    const set = value => invoke('mini-player:set-settings', mainEvent, value);
    const flush = () => new Promise(resolve => setImmediate(resolve));
    const effectiveOpacity = mini => platform === 'linux' ? mini.sent.filter(item => item.channel === 'mini-player:opacity').at(-1).payload : mini.opacity;
    try {
        await controller.ready;
        await assert.rejects(invoke('mini-player:get-settings', foreign));
        await assert.rejects(invoke('mini-player:set-settings', { sender: main.webContents, senderFrame: {} }, {}));
        main.minimized = true; main.emit('minimize');
        const mini = controller.getWindow();
        assert(mini.isVisible()); assert(mini.onTop);
        mini.onTop = false;
        mini.emit('always-on-top-changed', {}, false);
        assert(mini.onTop, 'native topmost flag is repaired when the OS clears it');
        assert.equal(mini.sent.filter(item => item.channel === 'mini-player:state').at(-1).payload.alwaysOnTop, true);
        assert.equal(mini.options.frame, false); assert.equal(mini.options.transparent, true); assert.equal(mini.options.skipTaskbar, true);
        assert.equal(mini.options.webPreferences.sandbox, true);
        assert.equal(mini.bounds.x, 840); assert.equal(mini.bounds.y, 0, 'offscreen positions return to an available display');
        // The OS supplies proposed bounds on Windows/macOS, but Linux's move event
        // arrives after the window has moved. The mock must model that distinction.
        function nativeMove(bounds, point) {
            cursor = point;
            let prevented = false;
            if (platform === 'linux') {
                mini.setBounds(bounds); mini.emit('move');
            } else {
                mini.emit('will-move', { preventDefault() { prevented = true; } }, bounds);
                if (!prevented) mini.setBounds(bounds);
            }
            return prevented;
        }
        let prevented = nativeMove({ x: 9, y: 200, width: 440, height: 96 }, { x: 100, y: 200 });
        if (platform !== 'linux') assert(prevented);
        assert.equal(mini.bounds.x, 0); assert.equal(mini.bounds.y, 200);
        nativeMove({ x: platform === 'win32' ? 9 : 17, y: 200, width: 440, height: 96 }, { x: 108, y: 200 });
        assert.equal(mini.bounds.x, 0, 'small movements retain the captured edge');
        prevented = nativeMove({ x: platform === 'win32' ? 9 : 60, y: 200, width: 440, height: 96 }, { x: 151, y: 200 });
        if (platform === 'win32') assert(prevented, 'Windows cursor travel overrides the stuck native rectangle');
        assert.equal(mini.bounds.x, 60, platform + ': deliberate dragging detaches from the edge');
        mini.emit('moved');
        mini.setBounds({ x: 60, y: 200 }); mini.emit('move');
        await new Promise(resolve => setTimeout(resolve, 220));
        assert.equal(mini.bounds.x, 60, 'saving the final position never moves the window again');
        assert.equal(stored.get('mini-player').x, 60);
        cursor = { x: -1000, y: -1000 };
        assert.deepEqual(mini.openHandler(), { action: 'deny' });
        let blocked = false;
        mini.webContents.emit('will-navigate', { preventDefault: () => { blocked = true; } }); assert(blocked);
        main.restore(); assert(!mini.isVisible(), 'restoring the app hides automatic mini');
        await set({ onMinimize: false }); main.emit('minimize');
        ipcMain.emit('mini-player:state', mainEvent, { playing: true, title: 'Song', volume: .5 });
        assert(!mini.isVisible(), 'disabled automatic show is respected on subsequent playback updates');
        await set({ onMinimize: true, onlyPlaying: true, onTop: 'playing' });
        ipcMain.emit('mini-player:state', mainEvent, { playing: false }); main.emit('minimize');
        assert(mini.isVisible(), 'legacy onlyPlaying=true no longer hides the mini-player on pause'); assert(!mini.onTop);
        ipcMain.emit('mini-player:state', mainEvent, { playing: true, title: 'Song', artwork: 'https://example.org/private.jpg', volume: 2, colors: { '--accent-color': '#aabbcc', '--bg-color': 'url(secret)' } });
        assert(mini.isVisible()); assert(mini.onTop);
        const state = mini.sent.filter(item => item.channel === 'mini-player:state').at(-1).payload;
        assert.equal(state.volume, 1); assert.equal(state.artwork, ''); assert.equal(state.colors['--bg-color'], undefined);
        const command = (action, value) => ipcMain.emit('mini-player:command', sender(mini), { action, value });
        const count = main.sent.length;
        ipcMain.emit('mini-player:command', foreign, { action: 'next' }); await flush(); assert.equal(main.sent.length, count);
        command('seek', Infinity); await flush(); assert.equal(main.sent.length, count);
        command('seek', .5); await flush(); assert.deepEqual(main.sent.at(-1), { channel: 'mini-player:command', payload: { action: 'seek', value: .5 } });
        command('hotkey', { code: 'KeyK', ctrlKey: true, target: 'untrusted', altKey: 'true' }); await flush();
        assert.deepEqual(main.sent.at(-1).payload, { action: 'hotkey', value: { code: 'KeyK', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false } });
        const beforeInvalidKey = main.sent.length;
        command('hotkey', { code: '<script>' }); await flush(); assert.equal(main.sent.length, beforeInvalidKey);
        await set({ onClose: 'hide' }); command('close'); await flush(); assert(!mini.isVisible());
        ipcMain.emit('mini-player:state', mainEvent, { playing: true }); assert(!mini.isVisible(), 'dismissed mini stays hidden until next minimize');
        main.hide(); controller.showFromTray(); assert(mini.isVisible(), 'hovering the tray recovers dismissed controls');
        command('close'); await flush(); await set({ onTrayHover: false }); controller.showFromTray(); assert(!mini.isVisible());
        controller.open(); assert(mini.isVisible());
        const commandsBeforeClose = main.sent.filter(item => item.channel === 'mini-player:command').length;
        await set({ onClose: 'pause' }); command('close'); await flush();
        assert.equal(main.sent.filter(item => item.channel === 'mini-player:command').length, commandsBeforeClose);
        assert(!mini.isVisible() && !main.isVisible(), 'close hides controls without pausing or restoring the main window');
        await set({ onMainClose: 'playing' }); assert.equal(controller.handleMainClose(false), false);
        assert.equal(controller.handleMainClose(true), true); assert(mini.isVisible()); assert(!main.isVisible());
        await set({ onMainClose: 'always', onlyPlaying: false }); assert(controller.handleMainClose(false));
        await set({ onMainClose: 'default' }); assert.equal(controller.handleMainClose(true), false);
        await set({ onClose: 'restore', hideOnRestore: false }); command('close'); await flush();
        assert(main.isVisible() && !mini.isVisible(), 'close can restore the main player when selected');
        await set({ hideOnRestore: true });
        controller.open(); command('minimize'); await flush(); assert(!main.isVisible() && !mini.isVisible());
        controller.open(); command('expand'); await flush(); assert(main.isVisible() && !mini.isVisible());
        await set({ locked: true, width: 600, height: 140, opacity: 65 });
        assert(!mini.movable); assert(!mini.resizable); assert.equal(mini.bounds.width, 600); assert.equal(effectiveOpacity(mini), .65);
        assert.equal(mini.sent.filter(item => item.channel === 'mini-player:state').at(-1).payload.contentOpacity, platform === 'linux' ? .65 : 1);
        if (platform === 'linux') assert.equal(mini.opacity, undefined, 'Linux does not rely on the unsupported native opacity method');
        controller.open(); await set({ onClose: 'quit' }); command('close'); await flush(); assert.equal(quits, 1);
        controller.open();
        cursor = { x: mini.bounds.x + 10, y: mini.bounds.y + 10 };
        await new Promise(resolve=>setTimeout(resolve,100)); assert.equal(effectiveOpacity(mini),platform === 'linux' ? .65 : 1,'Linux sends base opacity for renderer hover; native platforms handle hover in main');
        if (platform === 'linux') assert.equal(cursorQueries,0,'Linux hover never relies on cached global cursor coordinates');
        assert.equal(stored.get('mini-player').opacity,65,'hover never overwrites the preference');
        await set({ opacity: 50 }); assert.equal(effectiveOpacity(mini),platform === 'linux' ? .5 : 1,'renderer receives the new base opacity while native windows keep hover opacity');
        cursor = { x: -1000, y: -1000 };
        await new Promise(resolve=>setTimeout(resolve,100)); assert.equal(effectiveOpacity(mini),.5,'leaving restores the current preference');
        await set({ enabled: false }); controller.open(); assert(!mini.isVisible());
        app.emit('before-quit'); assert(mini.isDestroyed()); assert.equal(screen.listenerCount('display-removed'), 0);
    } finally { controller.destroy(); }
}
async function positionPersistence(platform, positioningSupported, hideFirst) {
    const app = new EventEmitter(), ipcMain = new EventEmitter(), screen = new EventEmitter();
    ipcMain.handle = () => {};
    screen.getPrimaryDisplay = screen.getDisplayMatching = () => ({ workArea: { x: 0, y: 0, width: 1280, height: 720 } });
    const main = new Window(); let saved = { ...DEFAULTS, x: 220, y: 180 };
    const controller = controllerFor(platform)({ app, ipcMain, screen, BrowserWindow: Window,
        getMainWindow: () => main, getStore: async () => ({ get: () => saved, set: (_key, value) => { saved = structuredClone(value); } }), positioningSupported });
    try {
        await controller.ready; controller.open(false);
        const mini = controller.getWindow();
        mini.setBounds({ x: positioningSupported ? 310 : 0, y: positioningSupported ? 260 : 0, width: 500, height: 120 });
        mini.emit('move');
        if (hideFirst) mini.hide(); else app.emit('before-quit');
        assert.equal(saved.x, positioningSupported ? 310 : 220, 'last position persists before the debounce; unsupported coordinates never overwrite it');
        assert.equal(saved.y, positioningSupported ? 260 : 180);
        assert.equal(saved.width, 500); assert.equal(saved.height, 120);
    } finally { controller.destroy(); }
}
(async () => {
    for (const platform of ['win32', 'linux', 'darwin']) {
        await exercise(platform);
        await positionPersistence(platform, true, true);
        await positionPersistence(platform, true, false);
    }
    await positionPersistence('linux', false, true);
    await positionPersistence('linux', false, false);
    console.log('PASS: mini-player lifecycle, platform-specific edge capture/release, position persistence, visibility, top mode, settings, hover, shutdown and IPC isolation on Windows, Linux and macOS.');
})().catch(error => { console.error(error); process.exitCode = 1; });
