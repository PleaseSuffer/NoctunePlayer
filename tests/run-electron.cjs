const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const script = process.argv[2];
if (!script || !fs.existsSync(script)) throw new Error('Usage: node tests/run-electron.cjs tests/native-…-probe.cjs');
const executable = process.env.NOCTUNE_ELECTRON || require('electron');
const output = path.resolve('tests/.artifacts/native-logs');
fs.mkdirSync(output, { recursive: true });
const filename = path.join(output, path.basename(script) + '.log');
const fd = fs.openSync(filename, 'w');
const cleanupFile = path.join(output, `${path.basename(script)}.${process.pid}.cleanup.json`);
// GUI Electron can outlive a shell pipeline on Windows. Use regular files for
// its output so logging can never write into a closed pipe and open an EPIPE dialog.
const child = spawn(executable, [path.resolve(script), ...process.argv.slice(3)], { stdio: ['ignore', fd, fd], windowsHide: true,
    env: { ...process.env, NOCTUNE_TEST_CLEANUP: cleanupFile } });
fs.closeSync(fd);
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', (code, signal) => {
    let cleanupFailed = false;
    if (fs.existsSync(cleanupFile)) {
        try {
            for (const target of JSON.parse(fs.readFileSync(cleanupFile, 'utf8'))) {
                const resolved = path.resolve(target), temp = path.resolve(require('node:os').tmpdir());
                if (!resolved.startsWith(temp + path.sep) || !path.basename(resolved).startsWith('noctune-')) throw new Error('Unexpected test cleanup path: ' + resolved);
                fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
            }
            fs.unlinkSync(cleanupFile);
        } catch (error) { console.error(error); cleanupFailed = true; }
    }
    const log = fs.readFileSync(filename, 'utf8');
    if (log) process.stdout.write(log);
    console.log(`${path.basename(script)}: ${code === 0 ? 'PASS' : 'FAIL'}; log: ${filename}`);
    process.exitCode = cleanupFailed ? 1 : code ?? (signal ? 1 : 0);
});
