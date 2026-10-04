'use strict';

function parseLrc(text) {
    const lines = [];
    const offset = Number(String(text).match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0) / 1000;
    for (const raw of String(text || '').split(/\r?\n/)) {
        const stamps = [...raw.matchAll(/\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
        const lyric = raw.replace(/\[[^\]]*\]/g, '').trim();
        for (const stamp of stamps) {
            if (Number(stamp[2]) >= 60) continue;
            const fraction = stamp[3] ? Number('0.' + stamp[3]) : 0;
            lines.push({ time: Math.max(0, Number(stamp[1]) * 60 + Number(stamp[2]) + fraction + offset), text: lyric });
        }
    }
    return lines.sort((a, b) => a.time - b.time);
}

function createLyricsClient({ fetchImpl = fetch, userAgent, now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    const cache = new Map();
    const pending = new Map();
    let retryAt = 0;
    const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
    async function request(endpoint, params) {
        // Холодный поиск может занять дольше обычного. Сетевой сбой или
        // временную ошибку сервера повторяем один раз в рамках того же запроса.
        for (let attempt = 0; attempt < 2; attempt++) {
            if (retryAt > now()) throw new Error('rate-limit');
            try {
                const response = await fetchImpl('https://lrclib.net/api/' + endpoint + '?' + new URLSearchParams(params), {
                    headers: { 'User-Agent': userAgent, Accept: 'application/json' }, signal: AbortSignal.timeout(15000),
                });
                if (response.status === 404) return null;
                if (response.status === 429) {
                    const delay = Number(response.headers.get('retry-after'));
                    retryAt = now() + Math.max(60, Number.isFinite(delay) ? delay : 60) * 1000;
                    throw new Error('rate-limit');
                }
                if (!response.ok) {
                    const error = new Error('http');
                    error.retryable = response.status >= 500 || response.status === 408;
                    throw error;
                }
                const text = await response.text();
                if (text.length > 512000) {
                    const error = new Error('size');
                    error.retryable = false;
                    throw error;
                }
                return JSON.parse(text);
            } catch (error) {
                if (attempt === 1 || error.message === 'rate-limit' || error.retryable === false) throw error;
                await wait(600);
            }
        }
    }

    return {
        async get(payload) {
            if (!payload || typeof payload !== 'object') return { status: 'invalid' };
            const artist = typeof payload.artist === 'string' ? payload.artist.trim().slice(0, 300) : '';
            const title = typeof payload.title === 'string' ? payload.title.trim().slice(0, 300) : '';
            const album = typeof payload.album === 'string' ? payload.album.trim().slice(0, 300) : '';
            const duration = Number(payload.duration);
            if (!artist || !title || artist === 'Неизвестный исполнитель' || title === 'Без названия') return { status: 'invalid' };
            const knownDuration = Number.isFinite(duration) && duration > 0;
            const key = JSON.stringify([artist, title, album, knownDuration ? Math.round(duration) : 0]);
            const saved = cache.get(key);
            if (saved && saved.expires > now()) return saved.result;
            if (pending.has(key)) return pending.get(key);
            if (retryAt > now()) return { status: 'rate-limit' };
            const job = (async () => {
                try {
                    let data = null;
                    if (knownDuration) data = await request('get', { artist_name: artist, track_name: title, album_name: album, duration: String(Math.round(duration)) });
                    if (!data) {
                        const results = await request('search', { artist_name: artist, track_name: title });
                        const matches = Array.isArray(results) ? results.filter(item =>
                            normalize(item.artistName) === normalize(artist) && normalize(item.trackName) === normalize(title) &&
                            (!knownDuration || Math.abs(Number(item.duration) - duration) <= 3)) : [];
                        matches.sort((a, b) => Number(normalize(b.albumName) === normalize(album)) - Number(normalize(a.albumName) === normalize(album)) ||
                            (knownDuration ? Math.abs(a.duration - duration) - Math.abs(b.duration - duration) : 0));
                        data = matches[0] || null;
                    }
                    const plain = typeof data?.plainLyrics === 'string' ? data.plainLyrics : '';
                    const lines = parseLrc(typeof data?.syncedLyrics === 'string' ? data.syncedLyrics : '');
                    const result = data?.instrumental ? { status: 'instrumental' } : plain || lines.length ? { status: 'found', plain, lines } : { status: 'missing' };
                    cache.set(key, { result, expires: now() + (result.status === 'missing' ? 3600000 : 86400000) });
                    if (cache.size > 200) cache.delete(cache.keys().next().value);
                    return result;
                } catch (error) {
                    return { status: error.message === 'rate-limit' ? 'rate-limit' : 'error' };
                }
            })();
            pending.set(key, job);
            try { return await job; } finally { pending.delete(key); }
        },
    };
}
module.exports = { createLyricsClient, parseLrc };
