'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const BARS = 200;
function createWaveformCache({ directory, maxEntries = 1000 }) {
    let writes = Promise.resolve();
    async function fingerprint(filePath) {
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) throw new Error('not-file');
        return createHash('sha256').update(JSON.stringify(['waveform-v1-8000', path.resolve(filePath), stat.size, stat.mtimeMs])).digest('hex');
    }
    return {
        async get(filePath) {
            try {
                const key = await fingerprint(filePath);
                const bytes = await fs.readFile(path.join(directory(), key + '.bin'));
                return { key, peaks: bytes.length === BARS ? Array.from(bytes) : null };
            } catch (_) {
                try { return { key: await fingerprint(filePath), peaks: null }; } catch (_) { return null; }
            }
        },
        async set(filePath, key, peaks) {
            if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key) || !Array.isArray(peaks) || peaks.length !== BARS || peaks.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
            const job = writes.then(async () => {
                try {
                    if (key !== await fingerprint(filePath)) return false;
                    const dir = directory();
                    await fs.mkdir(dir, { recursive: true });
                    await fs.writeFile(path.join(dir, key + '.bin'), Buffer.from(peaks));
                    const names = (await fs.readdir(dir)).filter(n => /^[a-f0-9]{64}\.bin$/.test(n));
                    if (names.length > maxEntries) {
                        const files = await Promise.all(names.map(async name => ({ name, time: (await fs.stat(path.join(dir, name))).mtimeMs })));
                        files.sort((a,b) => a.time - b.time);
                        for (const file of files.slice(0, files.length - maxEntries)) await fs.unlink(path.join(dir, file.name));
                    }
                    return true;
                } catch (_) { return false; }
            });
            writes = job.catch(() => false);
            return job;
        },
    };
}
module.exports = { createWaveformCache };
