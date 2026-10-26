// Validate the built archive, including resources loaded dynamically at runtime.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const asar = require('@electron/asar');
const archive = path.resolve(process.argv[2] || 'dist/linux-unpacked/resources/app.asar');
const nativeName = name => name.split('/').join(path.sep);
const files = asar.listPackage(archive).map(name => name.replace(/\\/g, '/').replace(/^\//, '')).filter(name => !asar.statFile(archive, nativeName(name)).files);
const present = new Set(files);
const legal = name => /^(license|licence|copying|notice|third[_-]?party[_-]?license|thirdpartynotices)/i.test(path.posix.basename(name));
const read = name => asar.extractFile(archive, nativeName(name)).toString('utf8');
const exists = name => assert(present.has(name), 'Missing runtime file: ' + name);
for (const name of files) {
    assert(!/\.(map|ts|tsx|mts|cts|tsbuildinfo)$/i.test(name), 'Development file in archive: ' + name);
    assert(!/\.(md|markdown)$/i.test(name) || legal(name), 'Documentation in archive: ' + name);
    assert(name === 'addons/catalog/official.json' || !/^(docs|tests|scripts|addons|\.local|\.artifacts|\.development)\//.test(name), 'Development directory in archive: ' + name);
    assert(!/^themes\/(examples|packages|user|custom)\//.test(name), 'Development theme in archive: ' + name);
    assert(!/^src\/web\//.test(name), 'Website file in archive: ' + name);
    assert(!/^node_modules\/(electron-builder|app-builder-lib|@electron\/asar|typescript)\//.test(name), 'Build tool in archive: ' + name);
    if (/^src\/.*\.html$/.test(name)) {
        for (const match of read(name).matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)) {
            if (/^(https?:|data:)/.test(match[1])) continue;
            exists(path.posix.normalize(path.posix.join(path.posix.dirname(name), match[1])));
        }
    }
    if (/^src\/.*\.js$/.test(name)) {
        for (const match of read(name).matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
            const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), match[1]));
            assert([target, target + '.js', target + '.json', target + '/index.js'].some(file => present.has(file)), 'Missing relative import: ' + name + ': ' + match[1]);
        }
    }
    if (/^themes\/builtin\/[^/]+\/manifest\.json$/.test(name)) {
        const manifest = JSON.parse(read(name)), directory = path.posix.dirname(name);
        exists(directory + '/' + manifest.script);
        for (const asset of Object.values(manifest.assets)) exists(directory + '/' + asset);
    }
}
const pkg = JSON.parse(read('package.json'));
exists(pkg.main);
exists('LICENSE');
exists('src/renderer/effects/scene-sdk.js');
for (const dependency of Object.keys(pkg.dependencies)) exists('node_modules/' + dependency + '/package.json');
for (const preset of JSON.parse(read('themes/backgrounds/presets.json'))) exists('themes/backgrounds/' + preset.file);
const icons = files.filter(name => /^node_modules\/lucide\/dist\//.test(name));
assert.deepEqual(icons, ['node_modules/lucide/dist/umd/lucide.min.js'], 'Only the browser icon bundle belongs in the application');
const bytes = files.reduce((sum, name) => sum + (asar.statFile(archive, nativeName(name)).size || 0), 0);
console.log(`PASS: Noctune ${pkg.version}, ${files.length} runtime/legal files, ${(bytes / 1024 / 1024).toFixed(2)} MiB. Assets, imports and dependency manifests resolve; development files are absent.`);
