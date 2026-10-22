const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const verifiedPublisher = require('../../src/shared/addon-publishers');
const identity = require('../../addons/official/publisher.json');
assert.equal(crypto.createHash('sha256').update(Buffer.from(identity.publicKey, 'base64')).digest('hex'), identity.fingerprint);
assert.equal(verifiedPublisher(identity.fingerprint), 'Noctune');
for (const value of [null, undefined, 'Noctune', 'constructor', 'toString', {}, '0'.repeat(64)]) assert.equal(verifiedPublisher(value), null);
assert.equal(crypto.createPublicKey({ key: Buffer.from(identity.publicKey, 'base64'), type: 'spki', format: 'der' }).asymmetricKeyType, 'ed25519');
console.log('PASS: pinned official publisher matches the public Ed25519 identity; untrusted names and fingerprints cannot claim verification.');
