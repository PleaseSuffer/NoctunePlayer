const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/renderer/ui/scene-settings.js', 'utf8');
const block = source.slice(source.indexOf('    let externalImportTask'), source.indexOf('    refresh().then(async list'));
(async () => {
    let receive, refreshes = 0;
    const errors = [], status = {textContent:''};
    const context = {
        noctune: {sceneThemes: {onImported: cb => {receive=cb;}}},
        refresh: async () => {refreshes++;}, status,
        announceThemeInstall: theme => {status.textContent=theme.name;},
        notifyError: error => errors.push(error.message),
        select: () => {throw new Error('OS import must not select a theme');},
        appStorage: {setItem: () => {throw new Error('OS import must not change preferences');}},
    };
    vm.createContext(context); vm.runInContext(block, context);
    receive({theme:{name:'New theme'}}); await vm.runInContext('externalImportTask', context);
    assert.equal(refreshes, 1); assert.match(status.textContent, /New theme/);
    receive({error:'Broken theme'}); await vm.runInContext('externalImportTask', context);
    assert.deepEqual(errors, ['Broken theme']); assert.equal(refreshes, 1);
    receive({theme:{name:'Second theme'}}); await vm.runInContext('externalImportTask', context);
    assert.equal(refreshes, 2);
    console.log('PASS: external theme imports refresh the gallery without selecting or changing preferences; errors allow subsequent imports.');
})().catch(error => {console.error(error); process.exitCode=1;});
