const crypto = require('node:crypto');
const fs = require('node:fs/promises');
(async () => {
    const file = process.argv[2];
    if (!file) throw new Error('Usage: node scripts/create-addon-key.cjs <private.pem>');
    const keys = crypto.generateKeyPairSync('ed25519');
    await fs.writeFile(file, keys.privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600, flag: 'wx' });
    console.log('Created private signing key. Keep it outside the extension directory and repository.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
