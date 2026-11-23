const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const p = require('./package');
const publisher = require('../../shared/addon-publishers');
const { fetchText } = require('./network');
const INDEX_URL = 'https://raw.githubusercontent.com/PleaseSuffer/NoctunePlayer/main/addons/catalog/previews.json';
const PREFIX = 'https://raw.githubusercontent.com/PleaseSuffer/NoctunePlayer/main/addons/previews/';
const MAX_VIDEO = 8 * 1024 * 1024, MAX_CACHE = 50_000_000;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function validateIndex(value, bundled = false, trusted = publisher) {
    p.keys(value, ['format','formatVersion','revision','entries','signature']);
    if (value.format !== 'noctune-previews' || value.formatVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 1 || !Array.isArray(value.entries) || value.entries.length > 128) throw new Error('Invalid preview index');
    const signer = p.signingIdentity(value, !bundled);
    if (signer && trusted(signer) !== 'Noctune') throw new Error('Untrusted preview index');
    const seen = new Set();
    for (const entry of value.entries) {
        p.keys(entry, ['id','version','channel','kind','url','mime','sha256','size','width','height','duration']);
        const key = `${entry.kind}:${entry.channel}:${entry.id}`;
        if (!p.id(entry.id) || !p.version(entry.version) || entry.kind !== 'theme' || !['official','community'].includes(entry.channel) || seen.has(key) || entry.url !== `${PREFIX}${entry.id}/${entry.version}/preview.webm` || entry.mime !== 'video/webm' || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.size) || entry.size < 4 || entry.size > MAX_VIDEO || !Number.isInteger(entry.width) || entry.width < 160 || entry.width > 1280 || !Number.isInteger(entry.height) || entry.height < 90 || entry.height > 720 || !Number.isFinite(entry.duration) || entry.duration < 1 || entry.duration > 6) throw new Error('Invalid preview metadata');
        seen.add(key);
    }
    return value;
}
function validateVideo(bytes, entry) {
    if (!Buffer.isBuffer(bytes) || bytes.length !== entry.size || hash(bytes) !== entry.sha256 || bytes.readUInt32BE(0) !== 0x1a45dfa3) throw new Error('Invalid preview video');
    return bytes;
}
function createPreviews({ directory, fetch = fetchText, builtin = require('../../../addons/catalog/previews.json'), trustedPublisher = publisher }) {
    let index = validateIndex(builtin, true, trustedPublisher), initialized, pending, cacheGeneration = 0;
    const root = () => path.join(typeof directory === 'function' ? directory() : directory, 'previews');
    const indexFile = () => path.join(root(), 'index.json');
    async function save(file, bytes) {
        await fs.mkdir(root(), { recursive: true });
        const temp = file + '.' + crypto.randomUUID() + '.tmp';
        try { await fs.writeFile(temp, bytes); await fs.rename(temp, file); } finally { await fs.rm(temp, { force: true }); }
    }
    function accept(next) {
        validateIndex(next, false, trustedPublisher);
        if (next.revision < index.revision || next.revision === index.revision && p.canonical(next) !== p.canonical(index)) throw new Error('Stale preview index');
        index = next;
    }
    async function initialize() {
        initialized ||= (async () => { try { if ((await fs.stat(indexFile())).size <= 128 * 1024) accept(JSON.parse(await fs.readFile(indexFile(), 'utf8'))); } catch (_) {} await trim(); })();
        await initialized;
    }
    async function cacheFiles() {
        const files = [];
        for (const name of await fs.readdir(root()).catch(() => [])) {
            if (!/^[a-f0-9]{64}\.webm$/.test(name)) continue;
            try { const stat = await fs.stat(path.join(root(), name)); if (stat.isFile()) files.push({ name, size: stat.size, time: stat.mtimeMs }); }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        return files;
    }
    async function trim() {
        const files = await cacheFiles();
        let total = files.reduce((sum, item) => sum + item.size, 0);
        for (const file of files.sort((a,b) => a.time-b.time)) {
            if (total <= MAX_CACHE) break;
            await fs.rm(path.join(root(), file.name), { force: true }); total -= file.size;
        }
    }
    return {
        async stats() {
            await initialize();
            return { bytes:(await cacheFiles()).reduce((sum,file)=>sum+file.size,0), limit:MAX_CACHE };
        },
        async list(entries, refresh = false, signal) {
            await initialize();
            if (refresh) {
                pending ||= (async () => { try {
                    const next = JSON.parse(await fetch(INDEX_URL, { limit: 128 * 1024, deadline: Date.now()+10000, signal }));
                    if (signal?.aborted) return;
                    accept(next); await save(indexFile(), p.canonical(next));
                } catch (_) { /* Optional media never breaks the store. */ } })().finally(() => { pending = null; });
                await pending;
            }
            return entries.map(entry => {
                const preview = index.entries.find(item => item.id === entry.id && item.version === entry.version && item.kind === entry.kind && item.channel === entry.channel);
                return preview ? { ...entry, animatedPreview: { width: preview.width, height: preview.height, duration: preview.duration } } : entry;
            });
        },
        async load(entry, signal) {
            await initialize();
            const generation = cacheGeneration;
            const item = index.entries.find(item => item.id === entry.id && item.version === entry.version && item.kind === entry.kind && item.channel === entry.channel);
            if (!item || signal?.aborted) throw new Error('Preview unavailable');
            const file = path.join(root(), item.sha256 + '.webm');
            let bytes;
            try {
                if ((await fs.stat(file)).size !== item.size) throw new Error('Invalid cached size');
                bytes = validateVideo(await fs.readFile(file), item);
                await fs.utimes(file, new Date(), new Date());
            } catch (_) {
                bytes = validateVideo(await fetch(item.url, { binary: true, limit: item.size, signal, deadline: Date.now()+15000, validateUrl: url => { if (url !== item.url) throw new Error('Preview redirect forbidden'); } }), item);
                if (signal?.aborted || generation !== cacheGeneration) throw new Error('Preview canceled');
                await save(file, bytes);
                if (generation !== cacheGeneration) { await fs.rm(file, { force:true }); throw new Error('Preview cache cleared'); }
                await trim();
            }
            if (signal?.aborted) throw new Error('Preview canceled');
            return { bytes: new Uint8Array(bytes), mime: item.mime, width: item.width, height: item.height, duration: item.duration };
        },
        async clear() {
            cacheGeneration++;
            for (const name of await fs.readdir(root()).catch(() => [])) if (/^[a-f0-9]{64}\.webm$/.test(name)) await fs.rm(path.join(root(), name), { force: true });
        },
    };
}
module.exports = { createPreviews, validateIndex, validateVideo, INDEX_URL, PREFIX, MAX_VIDEO, MAX_CACHE };
