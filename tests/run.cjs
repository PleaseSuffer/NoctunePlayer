const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
for (const group of ['main', 'renderer', 'structure']) {
    for (const name of fs.readdirSync(path.join(__dirname, group)).filter(name => name.endsWith('.cjs')).sort()) {
        const result = spawnSync(process.execPath, [path.join(__dirname, group, name)], { cwd: root, stdio: 'inherit' });
        if (result.error) throw result.error;
        if (result.status !== 0) process.exit(result.status || 1);
    }
}
