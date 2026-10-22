// Trust anchors are shipped with Noctune, never read from extension manifests.
// Fingerprints are SHA-256 of the verified Ed25519 SPKI public key.
const publishers = Object.freeze({
    '4ed77323f320fad874abed6718d6ee5d7c332409fad3c798b6e76a830522b465': 'Noctune',
});
module.exports = fingerprint => typeof fingerprint === 'string' && Object.hasOwn(publishers, fingerprint) ? publishers[fingerprint] : null;
