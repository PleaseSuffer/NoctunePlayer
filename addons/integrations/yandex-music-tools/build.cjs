// Build tooling runs in Node; it is never installed or executed by the player.
const fs = require('node:fs/promises');
const path = require('node:path');
const { packDirectory, validatePackage, canonical } = require('../../../src/main/addons/package');

async function build(output, origins = []) {
    const pkg = await packDirectory(path.join(__dirname, '../yandex-music'));
    for (const input of origins) {
        const url = new URL(input);
        if (url.origin !== input || url.protocol !== 'https:' || url.port ||
            !/(^|\.)(storage\.yandex\.net|storage\.mds\.yandex\.net|music\.yandex\.net)$/.test(url.hostname)) {
            throw new Error('Нужен точный HTTPS-origin CDN Яндекса без пути, порта и wildcard.');
        }
        if (!pkg.manifest.network.origins.includes(input)) {
            pkg.manifest.network.origins.push(input);
            pkg.manifest.network.routes.push({ origin: input, path: '/', prefix: true, methods: ['GET', 'HEAD'] });
        }
    }
    validatePackage(pkg); // Includes the SDK limit of eight origin declarations.
    await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
    await fs.writeFile(output, canonical(pkg));
    return pkg;
}
if (require.main === module) {
    const [output, ...origins] = process.argv.slice(2);
    if (!output || !output.endsWith('.noctaddon')) {
        console.error('Usage: node addons/integrations/yandex-music-tools/build.cjs output.noctaddon [https://exact-cdn-origin ...]');
        process.exitCode = 1;
    } else build(output, origins).then(pkg => console.log('Собрано: ' + output + ' (' + pkg.manifest.network.origins.length + ' origin)')).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { build };
