const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const manifest = require('../../package.json');
assert(fs.existsSync(path.join(root, manifest.main)), 'Electron entry point exists');
const rendererRoot = path.join(root, 'src/renderer');
const html = fs.readFileSync(path.join(rendererRoot, 'index.html'), 'utf8');
for (const match of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)) {
    if (/^(https?:|data:)/.test(match[1])) continue;
    assert(fs.existsSync(path.resolve(rendererRoot, match[1])), 'HTML asset exists: ' + match[1]);
}
for (const relative of fs.readdirSync(path.join(root, 'src'), { recursive: true }).filter(name => name.endsWith('.js'))) {
    const filename = path.join(root, 'src', relative);
    const source = fs.readFileSync(filename, 'utf8');
    assert.doesNotThrow(() => new vm.Script(source, { filename }), 'JavaScript syntax: ' + relative);
    for (const match of source.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
        assert.doesNotThrow(() => require.resolve(path.resolve(path.dirname(filename), match[1])), 'Local import resolves: ' + relative + ': ' + match[1]);
    }
}
console.log('PASS: Electron entry point, HTML assets and local module paths.');
