// Execute the production NSIS initialization with isolated registry/CLI inputs.
// This probe installs nothing and does not read or modify the Windows registry.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { getMakeNsisPath } = require('app-builder-lib/out/toolsets/windows');
const run = promisify(execFile);
const root = path.resolve(__dirname, '..');
const quote = value => value.replace(/\$/g, '$$$$').replace(/"/g, '$\\"');

(async () => {
    if (process.platform !== 'win32') throw new Error('This probe requires Windows.');
    const compiler = await getMakeNsisPath();
    const temp = await fs.mkdtemp(path.join(root, '.tmp-installer-policy-'));
    try {
        const installed = path.join(temp, 'Existing installation');
        const stale = path.join(temp, 'Removed installation');
        await fs.mkdir(installed);
        await fs.writeFile(path.join(installed, 'Noctune.exe'), 'fixture');
        const source = await fs.readFile(path.join(root, 'resources', 'installer.nsh'), 'utf8');
        const policy = source.split('; Register handlers')[0].replace(
            'ReadRegStr $noctuneInstalledDirectory SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "InstallLocation"',
            'StrCpy $noctuneInstalledDirectory "${TEST_LOCATION}"'
        );
        assert(!policy.includes('ReadRegStr'), 'replace the registry input before executing a fixture');
        const cases = [
            { name: 'fresh', location: '', silent: false, updated: false, force: false, expectSilent: false, expectUpdate: false, expectRun: false },
            { name: 'stale', location: stale, silent: false, updated: false, force: false, expectSilent: false, expectUpdate: false, expectRun: false },
            { name: 'manual-update', location: installed, silent: false, updated: false, force: false, expectSilent: true, expectUpdate: true, expectRun: true },
            { name: 'explicit-silent', location: installed, silent: true, updated: false, force: false, expectSilent: true, expectUpdate: true, expectRun: false },
            { name: 'updater', location: installed, silent: true, updated: true, force: true, expectSilent: true, expectUpdate: true, expectRun: true },
            { name: 'updater-no-relaunch', location: installed, silent: true, updated: true, force: false, expectSilent: true, expectUpdate: true, expectRun: false },
        ];
        for (const scenario of cases) {
            const filename = path.join(temp, scenario.name + '.nsi');
            const executable = path.join(temp, scenario.name + '.exe');
            const result = path.join(temp, scenario.name + '.txt');
            const freshDirectory = path.join(temp, 'First install target');
            const script = `Unicode true
RequestExecutionLevel user
SilentInstall silent
OutFile "${quote(executable)}"
!include LogicLib.nsh
!define APP_EXECUTABLE_FILENAME "Noctune.exe"
!define TEST_LOCATION "${quote(scenario.location)}"
!define isUpdated '"" originalUpdated ""'
!define isForceRun '"" originalForceRun ""'
!macro TestParameter output name
  !if "\$\{name\}" == "updated"
    StrCpy \$\{output\} "${scenario.updated}"
  !else
    StrCpy \$\{output\} "${scenario.force}"
  !endif
!macroend
!define StdUtils.TestParameter '!insertmacro TestParameter'
${policy}
Function .onInit
  StrCpy $INSTDIR "${quote(freshDirectory)}"
  SetSilent ${scenario.silent ? 'silent' : 'normal'}
  !insertmacro customInit
  FileOpen $0 "${quote(result)}" w
  FileWrite $0 "$INSTDIR$\\r$\\n"
  \$\{If\} \$\{Silent\}
    FileWrite $0 "silent$\\r$\\n"
  \$\{Else\}
    FileWrite $0 "normal$\\r$\\n"
  \$\{EndIf\}
  \$\{If\} \$\{isUpdated\}
    FileWrite $0 "updated$\\r$\\n"
  \$\{Else\}
    FileWrite $0 "fresh$\\r$\\n"
  \$\{EndIf\}
  \$\{If\} \$\{isForceRun\}
    FileWrite $0 "run$\\r$\\n"
  \$\{Else\}
    FileWrite $0 "no-run$\\r$\\n"
  \$\{EndIf\}
  FileClose $0
  SetErrorLevel 0
  Quit
FunctionEnd
Section
SectionEnd
`;
            await fs.writeFile(filename, script);
            await run(compiler.path, ['/V2', filename], { env: { ...process.env, ...compiler.env }, timeout: 30000 });
            await run(executable, [], { timeout: 10000 });
            const lines = (await fs.readFile(result, 'utf8')).trim().split(/\r?\n/);
            assert.deepEqual(lines, [scenario.location === installed ? installed : freshDirectory,
                scenario.expectSilent ? 'silent' : 'normal', scenario.expectUpdate ? 'updated' : 'fresh', scenario.expectRun ? 'run' : 'no-run'], scenario.name);
        }
        console.log('PASS: compiled NSIS policy: fresh/stale installs, manual updates, saved paths, silent installs and updater relaunch flags.');
    } finally {
        const resolved = path.resolve(temp);
        assert.equal(path.dirname(resolved), root);
        assert(path.basename(resolved).startsWith('.tmp-installer-policy-'));
        await fs.rm(resolved, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
