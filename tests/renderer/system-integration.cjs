const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/renderer/ui/system-integration.js', 'utf8');

(async () => {
    for (const platform of ['win32', 'linux', 'darwin']) {
        const elements = new Map();
        for (const id of ['system-integration-settings', 'btn-register-file-handler', 'btn-default-file-handler', 'system-integration-message']) {
            elements.set(id, { hidden: false, style: {}, listeners: {}, addEventListener(event, cb) { this.listeners[event] = cb; } });
        }
        const actions = [];
        const context = {
            document: { getElementById: id => elements.get(id) },
            noctune: { platform, systemIntegration: { apply: async action => { actions.push(action); return { ok: true, message: 'Done' }; } } },
        };
        vm.runInNewContext(source, context);
        const register = elements.get('btn-register-file-handler');
        const defaults = elements.get('btn-default-file-handler');
        const message = elements.get('system-integration-message');
        if (platform === 'darwin') { assert(elements.get('system-integration-settings').hidden); continue; }
        assert.equal(register.hidden, platform === 'win32');
        if (platform === 'linux') await register.listeners.click();
        await defaults.listeners.click();
        assert.deepEqual(actions, platform === 'linux' ? ['register', 'default'] : ['default']);
        assert.equal(message.textContent, 'Done');
        assert.equal(defaults.disabled, false);
        context.noctune.systemIntegration.apply = async () => ({ ok: false, message: 'Missing xdg-utils' });
        await defaults.listeners.click();
        assert.equal(message.textContent, 'Missing xdg-utils');
        context.noctune.systemIntegration.apply = async () => { throw new Error('IPC failure'); };
        await defaults.listeners.click();
        assert.match(message.textContent, /Не удалось/);
        assert.equal(defaults.disabled, false);
    }
    console.log('PASS: system-integration platform controls, actions, status messages and failure recovery.');
})().catch(error => { console.error(error); process.exitCode = 1; });
