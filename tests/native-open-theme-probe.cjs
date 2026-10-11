const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { packDirectory } = require('../src/main/scene-themes');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'tests/.artifacts/open-theme');
BrowserWindow.prototype.show = function () {};
BrowserWindow.prototype.showInactive = function () {};
const pause = () => new Promise(resolve => setTimeout(resolve, 100));
let importPath;
const migrationMarker = path.join(root, 'themes/user/.legacy-migrated');
let markerExisted = true;
async function finish(code) {
    if (importPath) await fs.rm(importPath, {force:true});
    if (!markerExisted) await fs.rm(migrationMarker, {force:true});
    app.exit(code);
}
(async () => {
    await fs.mkdir(output, {recursive:true});
    markerExisted = await fs.stat(migrationMarker).then(() => true, () => false);
    app.setPath('userData', path.join(output, 'user-data'));
    const theme = await packDirectory(path.join(root, 'themes/builtin/03-rain-window'));
    theme.manifest.name = 'OS import probe ' + Date.now();
    theme.manifest.id = 'os-import-probe-' + Date.now();
    const content = JSON.stringify(theme), id = 'import-' + crypto.createHash('sha256').update(content).digest('hex').slice(0,24);
    importPath = path.join(root, 'themes/user', id + '.noctheme');
    const file = path.join(output, 'Новая тема.noctheme'); await fs.writeFile(file, content);
    process.argv.push(file);
    app.on('browser-window-created', (_event, win) => {
        win.webContents.on('did-finish-load', async () => {
            if (!win.webContents.getURL().endsWith('/src/renderer/index.html')) return;
            try {
                const state = () => win.webContents.executeJavaScript(`(() => ({count:document.querySelectorAll('[data-scene-id="${id}"]').length, selected:appStorage.getItem('setting_scene_theme'), enabled:appStorage.getItem('setting_scene_enabled'), active:sceneThemes.active}))()`);
                const installerWindow = async (label = 'Установить') => {
                    for (let i=0; i<100; i++) {
                        const candidate = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/theme-install/index.html'));
                        if (candidate && await candidate.webContents.executeJavaScript(`document.getElementById('install')?.textContent === ${JSON.stringify(label)} && document.getElementById('name')?.textContent === ${JSON.stringify(theme.manifest.name)} && document.getElementById('preview')?.naturalWidth > 0`)) return candidate;
                        await pause();
                    }
                    throw new Error('Separate installer window did not become ready');
                };
                let installer = await installerWindow();
                assert.notEqual(installer.id, win.id);
                assert.equal(installer.getParentWindow(), null, 'installer is a separate top-level window');
                const details = await installer.webContents.executeJavaScript(`({name:document.getElementById('name').textContent,description:document.getElementById('description').textContent,preview:document.getElementById('preview').naturalWidth})`);
                assert.equal(details.name, theme.manifest.name); assert.equal(details.description, theme.manifest.description); assert.ok(details.preview > 0);
                let initial = await state();
                assert.equal(initial.count, 0, 'opening previews without installing');
                assert.equal(initial.active, false, 'file-open does not activate a scene');
                await installer.webContents.executeJavaScript(`document.getElementById('cancel').click()`);
                await pause(); assert.equal((await state()).count, 0, 'cancel adds nothing');
                await assert.rejects(fs.stat(importPath), {code:'ENOENT'});
                await win.webContents.executeJavaScript(`document.querySelector('#appearance-themes-section [role="status"]').textContent = ''`);
                app.emit('second-instance', {}, ['electron', '.', file], root);
                installer = await installerWindow();
                // Capture the standalone UI without exposing test windows on the desktop.
                installer.webContents.setBackgroundThrottling(false);
                await pause();
                await fs.writeFile(path.join(output, 'theme-installer.png'), (await installer.webContents.capturePage()).toPNG());
                await installer.webContents.executeJavaScript(`document.getElementById('install').click()`);
                let reported = false;
                for (let i=0; i<100; i++) {
                    reported = await win.webContents.executeJavaScript(`document.querySelector('#appearance-themes-section [role="status"]').textContent.includes(${JSON.stringify(theme.manifest.name)})`);
                    if (reported) break;
                    await pause();
                }
                assert.ok(reported, 'warm file-open reports a fresh successful import');
                assert.ok(await win.webContents.executeJavaScript(`document.querySelector('#notification-stack').textContent.includes(${JSON.stringify(theme.manifest.name)})`), 'successful install shows a toast in the player');
                const reopened = await state();
                assert.equal(reopened.count, 1, 'warm file-open does not duplicate the gallery entry');
                assert.equal(reopened.selected, initial.selected); assert.equal(reopened.enabled, initial.enabled); assert.equal(reopened.active, false);
                app.emit('second-instance', {}, ['electron', '.', file], root);
                installer = await installerWindow('Установлено');
                const installedButton = await installer.webContents.executeJavaScript(`(()=>{const b=document.getElementById('install'),s=getComputedStyle(b);return {disabled:b.disabled,text:b.textContent,background:s.backgroundColor,border:s.borderColor};})()`);
                assert.equal(installedButton.disabled,true); assert.equal(installedButton.background,'rgba(0, 0, 0, 0)'); assert.equal(installedButton.border,'rgb(99, 197, 138)');
                installer.close(); await pause();
                assert.equal((await state()).count, 1, 'closing a repeated preview preserves the installed theme');
                theme.manifest.version='1.1.0';await fs.writeFile(file,JSON.stringify(theme));
                app.emit('second-instance', {}, ['electron', '.', file], root);
                installer=await installerWindow('Обновить');
                const updateButton=await installer.webContents.executeJavaScript(`(()=>{const b=document.getElementById('install'),s=getComputedStyle(b);return {disabled:b.disabled,background:s.backgroundColor,border:s.borderColor};})()`);
                assert.equal(updateButton.disabled,false);assert.equal(updateButton.background,'rgba(0, 0, 0, 0)');assert.equal(updateButton.border,'rgb(228, 194, 96)');
                await installer.webContents.executeJavaScript(`document.getElementById('install').click()`);
                let updated=false;
                for(let i=0;i<100;i++){
                    updated=await win.webContents.executeJavaScript(`noctune.sceneThemes.list().then(list=>list.themes.some(t=>t.id==='${id}'&&t.version==='1.1.0'))`);
                    if(updated)break;await pause();
                }
                assert.ok(updated,'update replaces the original entry');await pause();
                assert.ok(await win.webContents.executeJavaScript(`document.querySelector('#notification-stack').textContent.includes('Тема обновлена')`),'update shows a toast');
                assert.equal((await state()).count,1);
                console.log('PASS: separate theme installer, metadata/preview, cold/warm file-open, cancellation without writes, install, window close and unchanged active theme.');
                await finish(0);
            } catch (error) {console.error(error); await finish(1);}
        });
    });
    require('../src/main/index.js');
})().catch(async error => {console.error(error); await finish(1);});
