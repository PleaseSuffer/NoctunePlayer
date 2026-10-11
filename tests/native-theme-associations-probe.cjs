// Compile install/uninstall associations without running an installer or touching the registry.
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { getMakeNsisPath } = require('app-builder-lib/out/toolsets/windows');
const run = promisify(execFile);
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
    console.log('PASS: production Windows audio/theme registration and uninstall macros compile with NSIS. No registry changes made.');
})().catch(error => {console.error(error); process.exitCode=1;});
