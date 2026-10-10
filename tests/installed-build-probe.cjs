// Run explicitly after installation, with Noctune closed. Uses a temporary
// local debugging connection; restores changed settings and closes its process.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const expectedVersion = require('../package.json').version;
const executable = path.resolve(process.argv[2] || '');
assert.equal(path.basename(executable).toLowerCase(), 'noctune.exe');
assert(fs.existsSync(executable));
const port = 9232;
const child = spawn(executable, [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '', socket, saved;
child.stdout.on('data', data => { output = (output + data).slice(-12000); });
child.stderr.on('data', data => { output = (output + data).slice(-12000); });
const pending = new Map(), errors = [];
let sequence = 0;
async function send(method, params = {}) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
    });
}
async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
}
(async () => {
    let target;
    for (let attempt = 0; attempt < 100; attempt++) {
        if (child.exitCode !== null) throw new Error('Installed app exited before testing: ' + output);
        try {
            const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
            target = targets.find(item => item.type === 'page' && item.url.includes('renderer/index.html'));
            if (target) break;
        } catch {}
        await delay(200);
    }
    assert(target, 'installed renderer becomes available');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
        if (pending.has(message.id)) {
            const task = pending.get(message.id); pending.delete(message.id); clearTimeout(task.timer);
            if (message.error) task.reject(new Error(message.error.message)); else task.resolve(message.result);
        }
    };
    await send('Runtime.enable');
    for (let attempt = 0; attempt < 100; attempt++) {
        if (await evaluate(`document.readyState === 'complete' && document.getElementById('update-current-version')?.textContent === 'v${expectedVersion}'`)) break;
        await delay(100);
    }
    assert.equal(await evaluate('noctune.getAppVersion()'), expectedVersion);
    saved = await evaluate(`({values:Object.fromEntries(['setting_keep_awake','setting_waveform_color_mode','setting_image_effects'].map(key=>[key,appStorage.getItem(key)])),effects:window.imageEffects.appearance(),settingsOpen:document.getElementById('settings-overlay').classList.contains('open')})`);
    await evaluate(`document.getElementById('settings-fab').click()`);
    assert.equal(await evaluate(`document.getElementById('settings-overlay').classList.contains('open')`), true);
    for (const mode of ['accent', 'theme']) {
        const selected = await evaluate(`(() => {document.querySelector('#waveform-color-dropdown-menu [data-waveform-color-mode="${mode}"]').click();return {mode:window.waveformColorMode,saved:appStorage.getItem('setting_waveform_color_mode'),color:getWaveformColor()};})()`);
        assert.equal(selected.mode, mode); assert.equal(selected.saved, mode); assert(/^#[0-9a-f]{6}$/i.test(selected.color));
    }
    for (const enabled of [true, false]) {
        assert.equal(await evaluate(`(() => {const toggle=document.getElementById('setting-keep-awake');toggle.checked=${enabled};toggle.dispatchEvent(new Event('change'));return appStorage.getItem('setting_keep_awake');})()`), enabled ? '1' : '0');
    }
    const strengths = await evaluate(`(() => {
        const effects=['contours','waves','highlights','sparks','ripple','chromatic'];
        for (const key of effects) {const slider=document.getElementById('image-effects-'+key+'Strength');slider.value=.7;slider.dispatchEvent(new Event('input'));}
        const global=document.getElementById('image-effects-strength');global.value=1.4;global.dispatchEvent(new Event('input'));
        return {individual:effects.map(key=>imageEffects.appearance().parameters[key+'Strength']),global:imageEffects.appearance().strength};
    })()`);
    assert.deepEqual(strengths.individual, [.7,.7,.7,.7,.7,.7]); assert.equal(strengths.global, 1.4);
    assert.equal(await evaluate(`document.querySelector('#image-effects-strength').closest('.settings-row').textContent.includes('Глобальная интенсивность')`), true);
    assert.deepEqual(errors, [], 'packaged renderer has no uncaught exceptions during the smoke test');
    console.log(`PASS: installed Noctune ${expectedVersion} launches, opens settings, applies waveform colors, keep-awake and six individual/global intensities through its real preload.`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
    try {
        if (saved && socket?.readyState === WebSocket.OPEN) {
            await evaluate(`(() => {
                const saved=${JSON.stringify(saved)};
                window.imageEffects.applyAppearance(saved.effects);
                const mode=saved.values.setting_waveform_color_mode || 'custom';document.querySelector('#waveform-color-dropdown-menu [data-waveform-color-mode="'+mode+'"]').click();
                const toggle=document.getElementById('setting-keep-awake');toggle.checked=saved.values.setting_keep_awake==='1';toggle.dispatchEvent(new Event('change'));
                for (const [key,value] of Object.entries(saved.values)) {if(value===null)appStorage.removeItem(key);else appStorage.setItem(key,value);}
                if(!saved.settingsOpen)document.getElementById('settings-close-btn').click();
            })()`);
            await delay(500);
            console.log('PASS: user settings restored after testing.');
        }
    } catch(error) { console.error('Settings restoration failed:', error); process.exitCode = 1; }
    socket?.close();
    if (child.exitCode === null) child.kill();
});
