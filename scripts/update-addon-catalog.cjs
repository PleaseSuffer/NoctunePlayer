const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const p = require('../src/main/addons/package');
const { mime } = require('../src/shared/addon-assets');
const { CATALOG_FIELDS, validateCatalog } = require('../src/main/addons/catalog');
(async () => {
    const [output, packageFile, keyFile, packageUrl, ...extra] = process.argv.slice(2);
    if (!output || !packageFile || !keyFile || extra.length) throw new Error('Usage: node scripts/update-addon-catalog.cjs <catalog.json> <package.noctaddon> <private.pem> [https-package-url]');
    const bytes = await fs.readFile(packageFile), pkg = p.validatePackage(JSON.parse(bytes));
    const publisher = p.signingIdentity(pkg, true);
    let previous = { revision: 0, entries: [] };
    try { previous = validateCatalog(JSON.parse(await fs.readFile(output, 'utf8'))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const entry = Object.fromEntries(CATALOG_FIELDS.filter(field => pkg.manifest[field] !== undefined).map(field => [field, pkg.manifest[field]]));
    Object.assign(entry, { publisher, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), published: !!packageUrl, artwork: {} });
    if (packageUrl) entry.packageUrl = packageUrl;
    for (const kind of ['icon','banner']) if (pkg.manifest[kind]) {
        const file = pkg.manifest[kind];
        entry.artwork[kind] = { mime: mime(file), data: pkg.files[file].data };
    }
    const entries = previous.entries.filter(candidate => candidate.id !== entry.id).concat(entry).sort((a,b) => a.id.localeCompare(b.id));
    const next = p.sign({ format: 'noctune-addon-catalog', formatVersion: 1, channel: 'official', revision: previous.revision + 1, generatedAt: new Date().toISOString(), entries }, await fs.readFile(keyFile, 'utf8'));
    validateCatalog(next);
    await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
    await fs.writeFile(output, p.canonical(next) + '\n');
    console.log(`Catalog revision ${next.revision}: ${entry.id} (${entry.published ? 'published' : 'awaiting publication'})`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
