'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { promisify } = require('node:util');
const { deflate, inflate } = require('node:zlib');
const compress = promisify(deflate), decompress = promisify(inflate);
const MAX_PIXELS = 960 * 540;
const idFor = file => createHash('sha256').update(path.resolve(file)).digest('hex');

function createBackgroundMaskCache({ directory, retainedPaths }) {
  let queue = Promise.resolve();
  const revisions = new Map();
  const retained = () => new Set(retainedPaths().slice(0, 5).filter(p => typeof p === 'string').map(p => path.resolve(p)));
  const revision = file => { const id = idFor(file); if (!revisions.has(id)) revisions.set(id, 0); return revisions.get(id); };
  function serialize(job) {
    const result = queue.then(job);
    queue = result.catch(() => {});
    return result;
  }
  async function identity(file) {
    if (typeof file !== 'string' || !path.isAbsolute(file) || !/\.(png|jpe?g|webp|bmp|gif)$/i.test(file)) return null;
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 50 * 1024 * 1024) return null;
    const handle = await fs.open(file, 'r');
    let header;
    try {
      header = Buffer.alloc(Math.min(stat.size, 65536));
      await handle.read(header, 0, header.length, 0);
    } finally { await handle.close(); }
    if (/\.gif$/i.test(file)) {
      const bytes = stat.size <= header.length ? header : await fs.readFile(file);
      if (!/^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6)) || bytes.length < 13) return null;
      let offset = 13 + (bytes[10] & 128 ? 3 * (1 << ((bytes[10] & 7) + 1)) : 0), frames = 0;
      const skipBlocks = () => { while (offset < bytes.length) { const size = bytes[offset++]; if (!size) break; offset += size; } };
      while (offset < bytes.length) {
        const marker = bytes[offset++];
        if (marker === 0x3b) break;
        if (marker === 0x21) { offset++; skipBlocks(); }
        else if (marker === 0x2c) {
          if (++frames > 1) return null;
          if (offset + 9 > bytes.length) return null;
          const packed = bytes[offset + 8]; offset += 9;
          if (packed & 128) offset += 3 * (1 << ((packed & 7) + 1));
          offset++; skipBlocks();
        } else return null;
      }
      if (frames !== 1) return null;
    }
    // Animated PNG/WebP remain backgrounds, but do not receive static-image effects.
    if (header.subarray(0, 4).equals(Buffer.from([137, 80, 78, 71])) && header.includes(Buffer.from('acTL'))) return null;
    if (header.toString('ascii', 0, 4) === 'RIFF' && header.includes(Buffer.from('ANIM'))) return null;
    return createHash('sha256').update(JSON.stringify(['background-mask-v1', path.resolve(file), stat.size, stat.mtimeMs, stat.ctimeMs])).digest('hex');
  }
  return {
    async get(file) {
      try {
        const key = await identity(file);
        if (!key) return { staticImage: false };
        const result = { staticImage: true, key, revision: revision(file), mask: null };
        try {
          const target = path.join(directory(), idFor(file) + '.bin');
          if ((await fs.stat(target)).size > MAX_PIXELS * 2 + 4096) return result;
          const bytes = await fs.readFile(target);
          const split = bytes.indexOf(10);
          if (split < 0 || split > 512) return result;
          const meta = JSON.parse(bytes.subarray(0, split).toString());
          if (meta.key !== key) { await this.remove(file); result.revision = revision(file); return result; }
          if (!Number.isInteger(meta.width) || !Number.isInteger(meta.height) || meta.width < 1 || meta.height < 1 || meta.width * meta.height > MAX_PIXELS) return result;
          const data = await decompress(bytes.subarray(split + 1), { maxOutputLength: MAX_PIXELS * 2 });
          if (data.length === meta.width * meta.height * 2) result.mask = { width: meta.width, height: meta.height, data: new Uint8Array(data) };
        } catch (_) {}
        return result;
      } catch (_) { return { staticImage: false }; }
    },
    set(payload) {
      return serialize(async () => {
        try {
          const { file, key, width, height, data, revision: expectedRevision } = payload || {};
          if (!retained().has(file) || expectedRevision !== revision(file) || key !== await identity(file)) return false;
          if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > MAX_PIXELS) return false;
          if (!(data instanceof Uint8Array) || data.length !== width * height * 2) return false;
          const dir = directory();
          await fs.mkdir(dir, { recursive: true });
          const bytes = await compress(data);
          // Recheck after asynchronous compression: deletion must win over an in-flight write.
          if (!retained().has(file) || expectedRevision !== revision(file) || key !== await identity(file)) return false;
          const target = path.join(dir, idFor(file) + '.bin');
          const temporary = target + '.tmp';
          await fs.writeFile(temporary, Buffer.concat([Buffer.from(JSON.stringify({ key, width, height }) + '\n'), bytes]));
          await fs.rename(temporary, target);
          return true;
        } catch (_) { return false; }
      });
    },
    remove(file) {
      if (typeof file !== 'string') return Promise.resolve();
      const id = idFor(file);
      revisions.set(id, revision(file) + 1);
      return serialize(() => fs.unlink(path.join(directory(), id + '.bin')).catch(() => {}));
    },
    prune() {
      const keep = new Set([...retained()].map(idFor));
      for (const id of revisions.keys()) if (!keep.has(id)) revisions.set(id, revisions.get(id) + 1);
      return serialize(async () => {
        try {
          for (const name of await fs.readdir(directory())) {
            if (/^[a-f0-9]{64}\.bin(?:\.tmp)?$/.test(name) && !keep.has(name.slice(0, 64))) await fs.unlink(path.join(directory(), name)).catch(() => {});
          }
        } catch (_) {}
      });
    },
  };
}
module.exports = { createBackgroundMaskCache, MAX_PIXELS };
