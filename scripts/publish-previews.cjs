// Separate optional index: never extend the v1 marketplace schema.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const p = require('../src/main/addons/package');
const { validateIndex, validateVideo, PREFIX } = require('../src/main/addons/previews');
async function publishPreviews({ root = path.resolve(__dirname,'..'), keyFile }) {
    const relative = path.relative(root, path.resolve(keyFile));
    if (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) throw new Error('Signing key must be outside the repository');
    const previous = JSON.parse(await fs.readFile(path.join(root,'addons/catalog/previews.json'),'utf8'));
    validateIndex(previous, true);
    const catalog = JSON.parse(await fs.readFile(path.join(root,'addons/catalog/marketplace.json'),'utf8'));
    const entries = [];
    for (const theme of catalog.entries.filter(entry => entry.kind === 'theme')) {
        const dir = path.join(root,'addons/previews',theme.id,theme.version);
        let metadata;
        try { metadata = JSON.parse(await fs.readFile(path.join(dir,'metadata.json'),'utf8')); }
        catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        const bytes = await fs.readFile(path.join(dir,'preview.webm'));
        const entry = { id: theme.id, version: theme.version, kind: 'theme', channel: theme.channel, url: `${PREFIX}${theme.id}/${theme.version}/preview.webm`, mime: 'video/webm', width: metadata.width, height: metadata.height, duration: metadata.duration, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
        validateVideo(bytes, entry);
        const old = previous.entries.find(item => item.id === entry.id && item.version === entry.version);
        if (old && p.canonical(old) !== p.canonical(entry)) throw new Error('Published previews are immutable; use a new theme version');
        entries.push(entry);
    }
    if (p.canonical(entries) === p.canonical(previous.entries) && previous.signature) return;
    const next = p.sign({ format:'noctune-previews', formatVersion:1, revision:previous.revision+1, entries }, await fs.readFile(keyFile));
    validateIndex(next);
    await fs.writeFile(path.join(root,'addons/catalog/previews.json'),p.canonical(next)+'\n');
    console.log(`Preview index: ${entries.length} videos, revision ${next.revision}`);
}
module.exports = { publishPreviews };
if (require.main === module) publishPreviews({ keyFile: process.argv[2] }).catch(error => { console.error(error.message); process.exitCode=1; });
