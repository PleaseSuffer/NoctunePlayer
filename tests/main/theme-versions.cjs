const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { compareThemeVersions } = require('../../src/main/theme-versions');
const { packDirectory, createSceneThemeStore } = require('../../src/main/scene-themes');
for (const [a,b,expected] of [['1.10.0','1.9.0',1],['1.0','1.0.0',0],['1.0.0','1.0.0-beta.2',1],['1.0.0-beta.2','1.0.0-beta.10',-1],['1.0.0+build','1.0.0',0],['1.0','2.0',-1],['custom','other',null]]) assert.equal(compareThemeVersions(a,b),expected);
(async()=>{
    const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'noctune-theme-versions-'));
    try {
        const store=createSceneThemeStore({directory:()=>temporary,builtinDirectory:path.resolve('themes/builtin'),presetsDirectory:path.resolve('themes/backgrounds'),sdkFile:path.resolve('src/renderer/effects/scene-sdk.js')});
        const theme=await packDirectory(path.resolve('themes/builtin/03-rain-window'));
        assert.equal((await store.installationStatus(theme)).state,'installed','builtin themes participate in detection');
        theme.manifest.id='custom-version-test';theme.manifest.version='1.9.0';
        assert.equal((await store.installationStatus(theme)).state,'install');
        const first=await store.installPackage(theme);
        assert.equal((await store.installationStatus(theme)).state,'installed');
        assert.equal((await store.installPackage(theme)).unchanged,true);
        theme.manifest.version='1.10.0';
        assert.equal((await store.installationStatus(theme)).state,'update');
        const updated=await store.installPackage(theme);assert.equal(updated.id,first.id);assert.equal(updated.action,'update');
        const list=(await store.list()).themes.filter(t=>t.packageId==='custom-version-test');assert.equal(list.length,1);assert.equal(list[0].version,'1.10.0');
        theme.manifest.version='1.9.0';assert.equal((await store.installationStatus(theme)).state,'installed','older packages cannot downgrade');
        const other={...theme,manifest:{...theme.manifest,id:'concurrent-test'}};
        const results=await Promise.all([store.installPackage(other),store.installPackage(other)]);
        assert.equal(results.filter(t=>t.unchanged).length,1,'simultaneous installer windows cannot write duplicate installs');
        const builtin=await packDirectory(path.resolve('themes/builtin/03-rain-window'));builtin.manifest.version='2.0.0';
        const override=await store.installPackage(builtin);assert.equal(override.id,'builtin-rain-window');
        const builtinEntries=(await store.list()).themes.filter(t=>t.packageId===builtin.manifest.id);assert.equal(builtinEntries.length,1);assert.equal(builtinEntries[0].version,'2.0.0');
        assert.equal((await store.read('builtin-rain-window')).manifest.version,'2.0.0','updated builtin retains its ID and reads the new package');
        console.log('PASS: numeric/prerelease versions, builtins, repeat install, update in place, downgrade protection and concurrent installs.');
    } finally {await fs.rm(temporary,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
