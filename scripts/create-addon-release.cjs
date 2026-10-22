const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { validatePackage, signingIdentity, sign, canonical } = require('../src/main/addons/package');
const { httpsUrl } = require('../src/main/addons/network');
(async () => {
    const [file, packageUrl, keyFile, output] = process.argv.slice(2);
    if (!file || !packageUrl || !keyFile || !output) throw new Error('Usage: node scripts/create-addon-release.cjs <package.noctaddon> <https-package-url> <private.pem> <release.json>');
    httpsUrl(packageUrl);
    const bytes = await fs.readFile(file), pkg = validatePackage(JSON.parse(bytes.toString('utf8')));
    const release = sign({ format: 'noctune-addon-release', formatVersion: 1, id: pkg.manifest.id, version: pkg.manifest.version, revision: pkg.manifest.revision, channel: 'stable', packageUrl, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }, await fs.readFile(keyFile, 'utf8'));
    if (signingIdentity(pkg, true) !== signingIdentity(release, true)) throw new Error('Пакет и release должны быть подписаны одним ключом');
    await fs.writeFile(output, canonical(release));
    console.log('Created signed release manifest:', output);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
