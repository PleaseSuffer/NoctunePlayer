const fs = require('node:fs/promises');
const path = require('node:path');
const { packDirectory, sign, validatePackage, canonical } = require('../src/main/addons/package');
(async () => {
    const [directory, output, flag, keyFile] = process.argv.slice(2);
    if (!directory || !output || (flag !== undefined && (flag !== '--key' || !keyFile))) throw new Error('Usage: node scripts/pack-addon.cjs <directory> <output.noctaddon> [--key private.pem]');
    let pkg = await packDirectory(path.resolve(directory));
    if (keyFile) pkg = sign(pkg, await fs.readFile(keyFile, 'utf8'));
    validatePackage(pkg);
    await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
    await fs.writeFile(output, canonical(pkg));
    console.log(`${pkg.manifest.name} ${pkg.manifest.version} (revision ${pkg.manifest.revision}) → ${output}`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
