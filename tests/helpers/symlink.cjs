const fs = require('node:fs/promises');

// Developer Mode or elevation is required for file symlinks on Windows.
// Skip only that capability, never unrelated file-substitution assertions.
async function trySymlink(target, link) {
    try { await fs.symlink(target, link); return true; }
    catch (error) {
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) throw error;
        console.log('SKIP: file symlink checks require Windows Developer Mode or elevation.');
        return false;
    }
}
module.exports = { trySymlink };
