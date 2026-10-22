const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
function createVault({ directory, safeStorage }) {
  let queue = Promise.resolve();
  const root = () => typeof directory === 'function' ? directory() : directory;
  function available() {
    return !!safeStorage?.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
  }
  function file(id) {
    if (!/^[a-z0-9][a-z0-9.-]{1,63}$/.test(id)) throw new Error('Некорректный ID');
    return path.join(root(), 'secrets', id + '.enc');
  }
  async function read(id) {
    if (!available()) throw new Error('Защищённое хранилище ОС недоступно. Включите Secret Service/KWallet и перезапустите Noctune.');
    try { return JSON.parse(safeStorage.decryptString(await fs.readFile(file(id)))); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw new Error('Не удалось расшифровать секреты расширения'); }
  }
  return {
    available,
    async get(id, key) { const data = await read(id); return Object.hasOwn(data, key) ? data[key] : null; },
    set(id, key, value) {
      const task = queue.then(async () => {
        const data = await read(id);
        if (value === null) delete data[key]; else data[key] = value;
        const text = JSON.stringify(data);
        if (Buffer.byteLength(text) > 128 * 1024) throw new Error('Секреты превышают 128 КБ');
        const target = file(id), temp = target + '.' + crypto.randomUUID();
        await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        try { await fs.writeFile(temp, safeStorage.encryptString(text), { mode: 0o600 }); await fs.rename(temp, target); }
        finally { await fs.rm(temp, { force: true }); }
      });
      queue = task.catch(() => {}); return task;
    },
    async remove(id) { await queue; await fs.rm(file(id), { force: true }); },
  };
}
module.exports = { createVault };
