'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const MAX_IMAGE = 2 * 1024 * 1024;
const MAX_CACHE = 30 * 1024 * 1024;
const CACHE_FILE = /^[a-f0-9]{64}\.json$/;
function coverUrl(images) {
    const sizes = ['mega', 'extralarge', 'large', 'medium', 'small'];
    if (!Array.isArray(images)) return null;
    for (const size of sizes) for (const image of images) {
        if (image.size !== size || typeof image['#text'] !== 'string') continue;
        try {
            const url = new URL(image['#text']);
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) continue;
            if (!['lastfm-img.freetls.fastly.net', 'lastfm.freetls.fastly.net', 'lastfm-img2.akamaized.net'].includes(url.hostname)) continue;
            if (url.pathname.includes('2a96cbd8b46e442fc41c2b86b821562f')) continue;
            url.protocol = 'https:';
            return url.href;
        } catch (_) {}
    }
    return null;
}
function imageMime(data) {
    if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
    if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg';
    if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    return null;
}
function createLastfmCoverClient({ request, settings, cacheDirectory, fetchImpl = fetch, now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    const memory = new Map(), pending = new Map();
    let radioController = null;
    const cancelRadio = () => { radioController?.abort(); radioController = null; };
    let generation = 0, diskQueue = Promise.resolve();
    const diskTask = action => { const task = diskQueue.then(action); diskQueue = task.catch(() => {}); return task; };
    const enabled = () => settings().enabled;
    const caching = () => settings().cache;
    const limit = () => Math.max(10, Math.min(300, Number(settings().limitMB) || 30)) * 1024 * 1024;
    function remember(key, record) {
        memory.delete(key); memory.set(key, record);
        let bytes = [...memory.values()].reduce((sum, item) => sum + (item.result?.dataUrl?.length || 64), 0);
        for (const [id, item] of memory) {
            if (memory.size <= 50 && bytes <= Math.min(limit(), MAX_CACHE)) break;
            memory.delete(id); bytes -= item.result?.dataUrl?.length || 64;
        }
    }
    async function files(directory) {
        let names;
        try { names = await fs.readdir(directory); } catch (_) { return []; }
        const entries = await Promise.all(names.filter(name => CACHE_FILE.test(name)).map(async name => {
            const file = path.join(directory, name);
            try { const stat = await fs.lstat(file); return stat.isFile() ? { file, size: stat.size, time: stat.mtimeMs } : null; } catch (_) { return null; }
        }));
        return entries.filter(Boolean).sort((a, b) => a.time - b.time);
    }
    async function prune(directory) {
        const entries = await files(directory);
        let bytes = entries.reduce((sum, file) => sum + file.size, 0), count = entries.length;
        for (const entry of entries) {
            if (bytes <= limit() && count <= 1000) break;
            await fs.unlink(entry.file); bytes -= entry.size; count--;
        }
    }
    async function save(directory, hash, record, jobGeneration) {
        if (!caching() || jobGeneration !== generation) return;
        remember(directory + ':' + hash, record);
        await diskTask(async () => {
            if (!caching() || jobGeneration !== generation) return;
            await fs.mkdir(directory, { recursive: true });
            await fs.writeFile(path.join(directory, hash + '.json'), JSON.stringify(record));
            await prune(directory);
        }).catch(() => {});
    }
    async function retry(action, active) {
        for (let attempt = 0; attempt < 3; attempt++) {
            if (!active()) throw Object.assign(new Error('cancelled'), { retryable: false });
            try { return await action(); }
            catch (error) {
                if (!active() || attempt === 2 || error.retryable === false || [2, 3, 4, 5, 6, 7, 9, 10, 13, 26, 29].includes(error.code)) throw error;
                await wait(attempt === 0 ? 500 : 1200);
            }
        }
    }
    async function metadata(params, active, signal) {
        return retry(async () => {
            try { return await request(params, signal); }
            catch (error) { if ([6, 7].includes(error.code)) return null; throw error; }
        }, active);
    }
    async function download(url, report, active, signal) {
        return retry(async () => {
            report({ phase: 'downloading', progress: 0 });
            const response = await fetchImpl(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000), redirect: 'error' });
            const total = Number(response.headers.get('content-length'));
            if (!response.ok) throw Object.assign(new Error('image-http'), { retryable: response.status >= 500 || response.status === 408 });
            if (total > MAX_IMAGE) throw Object.assign(new Error('size'), { retryable: false });
            const chunks = []; let size = 0;
            for await (const chunk of response.body) {
                if (!active()) throw Object.assign(new Error('cancelled'), { retryable: false });
                size += chunk.length;
                if (size > MAX_IMAGE) throw Object.assign(new Error('size'), { retryable: false });
                chunks.push(Buffer.from(chunk));
                report({ phase: 'downloading', progress: total > 0 ? Math.min(0.99, size / total) : null });
            }
            const data = Buffer.concat(chunks), mime = imageMime(data);
            if (!mime) throw Object.assign(new Error('format'), { retryable: false });
            return { status: 'found', dataUrl: 'data:' + mime + ';base64,' + data.toString('base64') };
        }, active);
    }
    async function stats(payload) {
        const directory = await cacheDirectory(payload);
        await diskQueue;
        const entries = await files(directory);
        return { bytes: entries.reduce((sum, entry) => sum + entry.size, 0), count: entries.length, limitMB: limit() / 1024 / 1024, directory };
    }
    return {
        cancelRadio,
        async get(payload, onProgress = () => {}) {
            if (!enabled()) return { status: 'disabled' };
            const transient = payload?.transient === true;
            let artist = typeof payload?.artist === 'string' ? payload.artist.trim().slice(0, 300) : '';
            const title = typeof payload?.title === 'string' ? payload.title.trim().slice(0, 300) : '';
            const album = typeof payload?.album === 'string' ? payload.album.trim().slice(0, 300) : '';
            if ((!artist && !(transient && title)) || artist === 'Неизвестный исполнитель' || (!album && !title)) return { status: 'invalid' };
            const controller = transient ? new AbortController() : null;
            if (transient) { cancelRadio(); radioController = controller; }
            const jobGeneration = generation;
            const active = () => enabled() && jobGeneration === generation && !controller?.signal.aborted;
            const directory = transient ? '' : await cacheDirectory(payload);
            const hash = createHash('sha256').update(JSON.stringify([artist.toLowerCase(), album.toLowerCase(), album ? '' : title.toLowerCase()])).digest('hex');
            const cacheKey = directory + ':' + hash;
            const pendingKey = transient ? controller : cacheKey + ':' + jobGeneration;
            if (pending.has(pendingKey)) {
                const existing = pending.get(pendingKey);
                existing.listeners.add(onProgress);
                if (existing.last) try { onProgress(existing.last); } catch (_) {}
                return existing.job;
            }
            const entry = { listeners: new Set([onProgress]), last: null, job: null };
            const report = state => {
                entry.last = state;
                for (const callback of entry.listeners) try { callback(state); } catch (_) {}
            };
            const job = (async () => {
                try {
                    report({ phase: 'searching' });
                    if (!active()) return { status: 'disabled' };
                    if (!transient && caching()) {
                        let record = memory.get(cacheKey);
                        if (!record) try {
                            const file = path.join(directory, hash + '.json');
                            const stat = await fs.lstat(file);
                            if (stat.isFile() && stat.size <= 3 * 1024 * 1024) record = JSON.parse(await fs.readFile(file, 'utf8'));
                        } catch (_) {}
                        const validMissing = record?.result?.status === 'missing' && record.version === 2 && record.lookupTitle === title.toLowerCase();
                        if (record?.expires > now() && (validMissing || (record.result?.status === 'found' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(record.result?.dataUrl || '')))) {
                            remember(cacheKey, record);
                            report({ phase: record.result.status, cached: true });
                            return enabled() && jobGeneration === generation ? record.result : { status: 'disabled' };
                        }
                    }
                    if (transient && !artist) {
                        const search = await metadata({ method: 'track.search', track: title, limit: '1' }, active, controller.signal);
                        const matches = search?.results?.trackmatches?.track;
                        const candidate = Array.isArray(matches) ? matches[0] : matches;
                        artist = typeof candidate?.artist === 'string' ? candidate.artist.trim().slice(0, 300) : '';
                        if (!active()) return { status: 'disabled' };
                        if (!artist) return { status: 'missing' };
                    }
                    let url = null;
                    if (album) url = coverUrl((await metadata({ method: 'album.getInfo', artist, album, autocorrect: '1' }, active, controller?.signal))?.album?.image);
                    if (!url && title) url = coverUrl((await metadata({ method: 'track.getInfo', artist, track: title, autocorrect: '1' }, active, controller?.signal))?.track?.album?.image);
                    let result = { status: 'missing' };
                    if (url) {
                        if (!active()) return { status: 'disabled' };
                        result = await download(url, report, active, controller?.signal);
                    }
                    if (!active()) return { status: 'disabled' };
                    if (!transient) await save(directory, hash, { version: 2, lookupTitle: title.toLowerCase(), expires: now() + (url ? 30 * 86400000 : 15 * 60000), result }, jobGeneration);
                    report({ phase: result.status, progress: 1 });
                    return result;
                } catch (_) { if (!active()) return { status: 'disabled' }; report({ phase: 'error' }); return { status: 'error' }; }
            })();
            entry.job = job; pending.set(pendingKey, entry);
            try { return await job; } finally { pending.delete(pendingKey); if (controller && radioController === controller) radioController = null; }
        },
        stats,
        async configure(payload) {
            generation++; memory.clear(); cancelRadio();
            const directory = await cacheDirectory(payload);
            await diskTask(() => prune(directory));
            return stats(payload);
        },
        async clear(payload) {
            generation++; memory.clear();
            const directory = await cacheDirectory(payload);
            await diskTask(async () => { for (const entry of await files(directory)) await fs.unlink(entry.file); });
            return { ok: true, ...await stats(payload) };
        },
    };
}
module.exports = { createLastfmCoverClient, coverUrl, imageMime };
