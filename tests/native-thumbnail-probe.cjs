const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noctune-thumbnail-'));
app.setPath('userData', path.join(root, 'profile'));
app.whenReady().then(async () => {
    let win;
    try {
        const css = fs.readFileSync(path.join(__dirname, '../src/renderer/styles/app.css'), 'utf8');
        const rules = css.slice(css.indexOf('        .track-cover-thumb {'), css.indexOf('        /* Main player cover art */'));
        const page = path.join(root, 'test.html');
        fs.writeFileSync(page, '<html><head><style>' + rules + '</style></head><body class="show-covers"><img class="track-cover-thumb" loading="lazy" decoding="async"><div class="track-cover-placeholder">placeholder</div></body></html>');
        win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
        await win.loadFile(page);
        const image = nativeImage.createFromPath(path.join(__dirname, '../resources/app.png')).resize({ width: 96, height: 96 });
        await win.webContents.executeJavaScript('window.imageSource = ' + JSON.stringify('data:image/jpeg;base64,' + image.toJPEG(75).toString('base64')));
        const result = await win.webContents.executeJavaScript('(' + (async function() {
            const image = document.querySelector('img');
            const placeholder = document.querySelector('.track-cover-placeholder');
            image.onload = () => image.classList.add('loaded');
            image.src = window.imageSource;
            const deadline = Date.now() + 5000;
            while (!image.naturalWidth && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
            const loaded = { naturalWidth: image.naturalWidth, width: image.getBoundingClientRect().width, placeholder: getComputedStyle(placeholder).display };
            image.removeAttribute('src'); image.classList.remove('loaded');
            loaded.failurePlaceholder = getComputedStyle(placeholder).display;
            document.body.classList.remove('show-covers');
            loaded.disabled = getComputedStyle(placeholder).display;
            return loaded;
        }).toString() + ')()');
        assert.equal(result.naturalWidth, 96); assert.equal(result.width, 36); assert.equal(result.placeholder, 'none');
        assert.equal(result.failurePlaceholder, 'flex'); assert.equal(result.disabled, 'none');
        console.log(JSON.stringify({ status: 'PASS', ...result }));
    } catch (error) { console.error(error); process.exitCode = 1; }
    finally {
        win?.destroy();
        const relative = path.relative(os.tmpdir(), root);
        if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
        app.exit(process.exitCode || 0);
    }
});
