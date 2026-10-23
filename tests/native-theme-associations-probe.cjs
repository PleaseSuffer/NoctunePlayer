// Compile install/uninstall associations without running an installer or touching the registry.
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { getMakeNsisPath } = require('app-builder-lib/out/toolsets/windows');
const run = promisify(execFile);
const assert = require('node:assert/strict');
(async () => {
    const root = path.resolve(__dirname, '..');
    const output = path.join(root, 'tests/.artifacts/theme-associations');
    await fs.mkdir(output, {recursive:true});
    const compiler = await getMakeNsisPath();
    const script = `Unicode true
RequestExecutionLevel user
OutFile "${path.join(output, 'compile-only.exe')}"
!include LogicLib.nsh
!define SHELL_CONTEXT HKCU
!define APP_EXECUTABLE_FILENAME "Noctune.exe"
!define isUpdated '"" originalUpdated ""'
!define isForceRun '"" originalForceRun ""'
!include "${path.join(root, 'resources/installer.nsh')}"
Section
  !insertmacro customInstall
  WriteUninstaller "$INSTDIR\\Uninstall.exe"
SectionEnd
Section "Uninstall"
  !insertmacro customUnInstall
SectionEnd
`;
    const file = path.join(output, 'associations.nsi');
    await fs.writeFile(file, script);
    await run(compiler.path, ['/V2', file], {env:{...process.env, ...compiler.env}, timeout:30000});
    // Execute the actual production branches with registry instructions replaced
    // by a log. Fixtures cannot read/change the real registry or notify Explorer.
    const source = await fs.readFile(path.join(root,'resources/installer.nsh'),'utf8');
    const isolated = source.split(/\r?\n/).map(line => {
        const read=line.match(/^\s*ReadReg(?:Str|DWORD)\s+(\$\w+)\s+(.+)$/);
        if(read){
            const input=read[2].includes('AudioFileAssociationsEnabled')?'TEST_AUDIO_OPT_IN'
                :read[2].includes('UserChoice')?'TEST_USER_CHOICE'
                :read[2].includes('".${EXT}"')?'TEST_LEGACY_DEFAULT'
                :read[2].includes('".noctheme"')?'TEST_THEME_DEFAULT'
                :read[2].includes('".noctaddon"')?'TEST_ADDON_DEFAULT':null;
            return `  StrCpy ${read[1]} "${input?'${'+input+'}':''}"`;
        }
        const write=line.match(/^\s*(WriteRegStr|WriteRegDWORD|WriteRegNone|DeleteRegKey|DeleteRegValue)\s+(?:\/ifempty\s+)?(\S+)\s+"([^"]*)"(?:\s+"([^"]*)")?/);
        if(write)return `  FileWrite $0 "${write[1]}|${write[2]}|${write[3]}|${write[4]||''}$\\r$\\n"`;
        if(line.trim().startsWith('System::Call'))return '  ; No OS notification in fixture';
        return line;
    }).join('\n');
    assert(!/^\s*(ReadReg|WriteReg|DeleteReg|System::Call)/m.test(isolated),'all registry/OS instructions must be replaced');
    const include = path.join(output,'isolated.nsh');await fs.writeFile(include,isolated);
    for(const scenario of [
        {name:'fresh',optIn:0,choice:'',legacy:'',theme:'',addon:''},
        {name:'legacy',optIn:0,choice:'Other.Player',legacy:'',theme:'Other.Theme',addon:'Other.Addon'},
        {name:'chosen-default',optIn:0,choice:'Noctune.Audio.mp3',legacy:'Noctune.Audio.flac',theme:'',addon:''},
        {name:'explicit-opt-in',optIn:1,choice:'',legacy:'',theme:'',addon:''},
    ]){
        const log=path.join(output,scenario.name+'.txt'), exe=path.join(output,scenario.name+'.exe');
        const fixture=`Unicode true
RequestExecutionLevel user
SilentInstall silent
OutFile "${exe}"
!include LogicLib.nsh
!define SHELL_CONTEXT HKCU
!define APP_EXECUTABLE_FILENAME "Noctune.exe"
!define isUpdated '"" originalUpdated ""'
!define isForceRun '"" originalForceRun ""'
!define TEST_AUDIO_OPT_IN "${scenario.optIn}"
!define TEST_USER_CHOICE "${scenario.choice}"
!define TEST_LEGACY_DEFAULT "${scenario.legacy}"
!define TEST_THEME_DEFAULT "${scenario.theme}"
!define TEST_ADDON_DEFAULT "${scenario.addon}"
!include "${include}"
Function .onInit
  StrCpy $INSTDIR "C:\\Fixture\\Noctune"
  StrCpy $noctuneAudioOptIn "${scenario.optIn}"
  FileOpen $0 "${log}" w
  !insertmacro customInstall
  FileClose $0
  SetErrorLevel 0
  Quit
FunctionEnd
Section
SectionEnd
`;
        const nsi=path.join(output,scenario.name+'.nsi');await fs.writeFile(nsi,fixture);
        await run(compiler.path,['/V2',nsi],{env:{...process.env,...compiler.env},timeout:30000,windowsHide:true});
        await run(exe,[],{timeout:10000,windowsHide:true});
        const operations=(await fs.readFile(log,'utf8')).trim().split(/\r?\n/);
        const writes=operations.filter(line=>line.startsWith('Write'));
        const audioWrites=writes.filter(line=>/Noctune\.Audio|Noctune\.Commands|\|\.(mp3|wav|ogg|m4a|flac)$/.test(line));
        assert(writes.some(line=>line.includes('Software\\Classes\\Noctune.Theme|')),scenario.name+': themes always registered');
        assert(writes.some(line=>line.includes('Software\\Classes\\Noctune.Addon|')),scenario.name+': addon packages always registered');
        assert(writes.some(line=>line.includes('Software\\Classes\\Noctune.Addon\\shell\\open\\command|')),scenario.name+': addon open handler');
        assert.equal(audioWrites.length>0,scenario.optIn===1||scenario.name==='chosen-default',scenario.name+': audio registration requires explicit consent or a previously chosen default');
        if(scenario.name==='chosen-default')assert(audioWrites.every(line=>/\|HKCU\|Software\\Classes\\Noctune\.Audio\.(mp3|flac)(\\|\|)/.test(line)),'restore only previously selected handlers, no menus or other formats');
        assert(!operations.some(line=>line.includes('UserChoice')),'UserChoice is only read, never changed');
        if(scenario.theme)assert(!writes.includes('WriteRegStr|HKCU|Software\\Classes\\.noctheme|'),'keep another theme default');
        if(scenario.addon)assert(!writes.includes('WriteRegStr|HKCU|Software\\Classes\\.noctaddon|'),'keep another addon default');
        if(scenario.optIn===0){
            for(const ext of ['mp3','wav','ogg','m4a','flac'])assert(operations.includes(`DeleteRegValue|HKCU|Software\\Classes\\.${ext}\\OpenWithProgids|Noctune.Audio.${ext}`));
            if(scenario.choice==='Noctune.Audio.mp3'){
                assert(!operations.includes('DeleteRegKey|HKCU|Software\\Classes\\Noctune.Audio.mp3|'),'keep explicitly chosen MP3 default');
                assert(!operations.includes('DeleteRegKey|HKCU|Software\\Classes\\Noctune.Audio.flac|'),'keep classic FLAC default');
            }
        }else assert(audioWrites.every(line=>line.includes('|HKCU|')),'consent only affects current user');
    }
    console.log('PASS: NSIS compile and isolated execution: themes only by default, legacy cleanup, explicit audio opt-in, existing defaults preserved. No registry changes made.');
})().catch(error => {console.error(error); process.exitCode=1;});
