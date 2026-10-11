// Run with Noctune closed. Exercises first-frame rendering without disabling
// Chromium throttling and restores the user's selected scene/background state.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const executable = path.resolve(process.argv[2]);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const child = spawn(executable, ['--remote-debugging-port=9233', '--remote-debugging-address=127.0.0.1'], { windowsHide: true, stdio: 'ignore' });
let socket, saved;
const pending = new Map(); let sequence = 0;
async function send(method, params = {}) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 25000);
        pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
    });
}
async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
}
(async () => {
    let target;
    for (let i = 0; i < 100; i++) {
        try { target = (await (await fetch('http://127.0.0.1:9233/json/list')).json()).find(t => t.type === 'page' && t.url.includes('renderer/index.html')); } catch {}
        if (target) break; await delay(200);
    }
    assert(target, 'installed renderer starts'); socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.method === 'Log.entryAdded') console.log('Browser:', message.params.entry.text);
        if (message.method === 'Runtime.exceptionThrown') console.log('Exception:', message.params.exceptionDetails.text);
        if (!pending.has(message.id)) return;
        const task = pending.get(message.id); pending.delete(message.id); clearTimeout(task.timer);
        message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result);
    };
    await send('Log.enable'); await send('Runtime.enable');
    await evaluate(`new Promise(resolve => { const check=()=>window.sceneThemes&&window.backgroundSettings?resolve():setTimeout(check,100);check(); })`);
    saved = await evaluate(`Object.fromEntries(['setting_scene_theme','setting_scene_enabled','setting_scene_preferences','setting_bg_image_enabled'].map(key=>[key,appStorage.getItem(key)]))`);
    if (process.argv.includes('--source')) {
        await evaluate('sceneThemes.deactivate(false)');
        await evaluate(require('node:fs').readFileSync(path.join(__dirname, '../src/renderer/effects/scene-host.js'), 'utf8'));
    }
    console.log('Startup:', await evaluate(`({hidden:document.hidden,suspended:window._rafSuspended,fps:effectsPerformance.fps})`));
    const ids = await evaluate(`noctune.sceneThemes.list().then(list=>list.themes.filter(t=>t.builtin).map(t=>t.id))`);
    const results=[];
    for (const id of ids) {
        const result = await evaluate(`(async()=>{const theme=(await noctune.sceneThemes.list()).themes.find(t=>t.id===${JSON.stringify(id)});try{await sceneThemes.activate(theme);return {id:theme.id,active:sceneThemes.active,runtime:sceneThemes.performance.runtime};}catch(error){return {id:theme.id,error:error.message,hidden:document.hidden,suspended:window._rafSuspended};}})()`);
        console.log('Scene:', result); results.push(result);
    }
    console.log('Scenes:', results);
    assert(results.length === 3 && results.every(r => r.active), 'all installed scenes render their first frame');
    assert(results.every(r => r.runtime === 'worker'), 'all installed scenes render in dedicated Workers');
    const controls=await evaluate(`(()=>{
        const id=sceneThemes.metadata.id,mix=document.getElementById('scene-frequencyMix'),glow=document.getElementById('scene-glowIntensity');
        mix.value=90;mix.dispatchEvent(new Event('input'));glow.value=1.8;glow.dispatchEvent(new Event('input'));
        return {parameters:sceneThemes.appearance()[id],builtinPlus:document.querySelectorAll('#scene-builtins-list .scene-add-tile').length,importPlus:document.querySelectorAll('#scene-imported-list .scene-add-tile').length};
    })()`);
    assert.equal(controls.parameters.frequencyMix,.9);assert.equal(controls.parameters.glowIntensity,1.8);assert.equal(controls.builtinPlus,0);assert.equal(controls.importPlus,1);
    console.log('PASS: installed frequency/glow editor and single import tile.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
    try { if (saved && socket?.readyState === WebSocket.OPEN) await evaluate(`(async()=>{sceneThemes.deactivate(); const saved=${JSON.stringify(saved)};window.backgroundSettings.enable(saved.setting_bg_image_enabled!=='0');for(const[key,value]of Object.entries(saved)){if(value===null)appStorage.removeItem(key);else appStorage.setItem(key,value);}if(saved.setting_scene_theme)await sceneThemes.resumeSaved();})()`); }
    catch(error) { console.error('Restore failed:', error); process.exitCode = 1; }
    socket?.close(); if(child.exitCode===null)child.kill();
});
