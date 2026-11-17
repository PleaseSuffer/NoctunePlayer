// Run with Node: the supervisor also waits for Electron's automatically relaunched process.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(__dirname, '.artifacts/mini-player-position');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function supervise() {
    if (process.platform !== 'linux' || !process.env.DISPLAY) {
        console.log('SKIP: native position probe needs Linux with an X11/XWayland display.'); return;
    }
    fs.mkdirSync(output, { recursive: true });
    const profile = fs.mkdtempSync(path.join(output, 'profile-'));
    const { spawn } = require('node:child_process');
    for (const phase of ['initial', 'restart']) {
        const result = path.join(profile, phase + '.json');
        const args = [__filename, '--worker', '--profile=' + profile, '--result=' + result,
            '--disable-gpu', ...process.argv.slice(2), ...(phase === 'restart' ? ['--restore'] : [])];
        const child = spawn(require('electron'), args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
        let logs = '', failure;
        const append = chunk => { logs = (logs + chunk.toString()).slice(-32000); };
        child.stdout.on('data', append); child.stderr.on('data', append);
        child.on('error', error => { failure = error; });
        child.on('exit', code => { if (code !== 0) failure = new Error('Electron exited with ' + code); });
        for (let i = 0; i < 600 && !fs.existsSync(result) && !failure; i++) await delay(50);
        if (failure || !fs.existsSync(result)) throw new Error((failure?.message || 'Position probe timeout') + '\n' + logs);
        const report = JSON.parse(fs.readFileSync(result, 'utf8'));
        assert(report.ok, report.error + '\n' + logs);
        assert.equal(report.initial.x, phase === 'initial' ? 120 : 280);
        assert.equal(report.initial.y, phase === 'initial' ? 180 : 340);
        for (let i = 0; i < 100; i++) {
            try { fs.lstatSync(path.join(profile, 'SingletonLock')); } catch (error) { if (error.code === 'ENOENT') break; throw error; }
            await delay(50);
        }
        console.log('PASS: ' + phase + ' — real X11 mini-player, two minimize/restore cycles, final position flushed to disk.');
    }
}

function worker() {
    const { app, BrowserWindow } = require('electron');
    const argument = name => process.argv.find(value => value.startsWith('--' + name + '='))?.slice(name.length + 3);
    const profile = argument('profile'), result = argument('result'), restore = process.argv.includes('--restore');
    const archive = argument('app-asar'), source = archive ? path.resolve(archive) : root;
    let finished = false;
    function finish(report) {
        if (finished) return; finished = true;
        fs.writeFileSync(result + '.tmp', JSON.stringify(report)); fs.renameSync(result + '.tmp', result);
        app.exit(report.ok ? 0 : 1);
    }
    if (!restore && !fs.existsSync(path.join(profile, 'config.json'))) fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify({
        'mini-player': { x: 120, y: 180, width: 440, height: 96, rememberPosition: true, locked: false, onMinimize: true },
        setting_notifications: '0',
    }));
    app.setPath('userData', profile);
    if (archive) { app.setAppPath(source); Object.defineProperty(app, 'isPackaged', { value: true }); }
    require('electron-updater').autoUpdater.checkForUpdates = async () => null;
    const wait = async (test, label) => {
        for (let i = 0; i < 100; i++) { if (await test()) return; await delay(50); }
        throw new Error(label);
    };
    app.on('browser-window-created', (_, main) => main.webContents.on('did-finish-load', async () => {
        if (!main.webContents.getURL().endsWith('/renderer/index.html')) return;
        try {
            assert.equal(app.commandLine.getSwitchValue('ozone-platform'), 'x11');
            await main.webContents.executeJavaScript('noctune.miniPlayer.open(false)');
            const find = () => BrowserWindow.getAllWindows().find(win => win.getTitle() === 'Noctune — Мини-плеер');
            await wait(() => find()?.isVisible(), 'mini-player visible');
            const mini = find(); await delay(500);
            // Wayland surface IDs (1,2,3…) are not real X11 resource handles.
            assert(mini.getNativeWindowHandle().readUInt32LE() > 255, 'actual native X11 window, not merely an overwritten command-line switch');
            const initial = mini.getBounds();
            assert.equal(initial.x, restore ? 280 : 120); assert.equal(initial.y, restore ? 340 : 180);
            const target = restore ? { x: 420, y: 380 } : { x: 280, y: 340 };
            mini.setPosition(target.x, target.y); await delay(300);
            for (let i = 0; i < 2; i++) {
                main.restore(); main.show();
                await wait(() => !main.isMinimized() && !mini.isVisible(), 'restore hides mini-player');
                await delay(200); main.minimize();
                await wait(() => mini.isVisible(), 'minimize reopens mini-player'); await delay(200);
                assert.equal(mini.getBounds().x, target.x); assert.equal(mini.getBounds().y, target.y);
            }
            const final = restore ? { x: 460, y: 410 } : target;
            mini.setPosition(final.x, final.y); await delay(40); app.emit('before-quit');
            const saved = JSON.parse(fs.readFileSync(path.join(profile, 'config.json'), 'utf8'))['mini-player'];
            assert.equal(saved.x, final.x); assert.equal(saved.y, final.y);
            finish({ ok: true, initial, final });
        } catch (error) { finish({ ok: false, error: error.stack }); }
    }));
    require(path.join(source, 'src/main/index.js'));
    setTimeout(() => finish({ ok: false, error: 'Worker timeout' }), 25000);
}

if (process.versions.electron) worker();
else supervise().catch(error => { console.error(error); process.exitCode = 1; });
