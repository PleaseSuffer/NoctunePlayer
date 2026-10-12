const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/renderer/ui/scene-settings.js', 'utf8');
const block = source.slice(source.indexOf('    async function installedTheme'), source.indexOf('    refresh().then(async list'));
(async () => {
    let receive, refreshes = 0;
    const errors = [], activations = [], status = {textContent:''};
    const installed={id:'import-new',packageId:'test-theme',name:'Updated theme',version:'2.0.0'};
    const context = {
        noctune: {sceneThemes: {onImported: cb => {receive=cb;}}},
        refresh: async () => {refreshes++;}, status,
        themes:[installed],
        window:{sceneThemes:{metadata:null,activate:async theme=>{activations.push(theme);}}},
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
    context.window.sceneThemes.metadata={id:'user-old',packageId:'test-theme',version:'1.0.0'};
    receive({theme:{...installed,action:'update'}});await vm.runInContext('externalImportTask',context);
    assert.equal(activations.length,1);assert.equal(activations[0].id,'import-new','active source theme follows updated package ID');
    receive({theme:{id:'other',packageId:'other',action:'update'}});await vm.runInContext('externalImportTask',context);
    assert.equal(activations.length,1,'unrelated updates do not switch the active theme');
    context.window.sceneThemes.metadata=null;
    receive({theme:{...installed,action:'update'}});await vm.runInContext('externalImportTask',context);
    assert.equal(activations.length,1,'updating a disabled theme does not enable it');
    console.log('PASS: external imports, active update reload by package ID, unchanged unrelated/disabled themes and serial error recovery.');
})().catch(error => {console.error(error); process.exitCode=1;});
