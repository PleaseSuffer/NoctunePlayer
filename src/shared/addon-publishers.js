// Trust anchors are shipped with Noctune, never read from extension manifests.
// Fingerprints are SHA-256 of the verified Ed25519 SPKI public key.
const CURRENT = 'e7decb7e580a1603a04789bb86784e7b53da36f617a861454e1c7a943c2f536c';
const LEGACY = '4ed77323f320fad874abed6718d6ee5d7c332409fad3c798b6e76a830522b465';
const ROTATABLE = new Set(['noctune-chroma','noctune-dusk','noctune-shades','noctune-sleep']);
const publishers = Object.freeze({
    '4ed77323f320fad874abed6718d6ee5d7c332409fad3c798b6e76a830522b465': 'Noctune',
    'e7decb7e580a1603a04789bb86784e7b53da36f617a861454e1c7a943c2f536c': 'Noctune',
});
module.exports = fingerprint => typeof fingerprint === 'string' && Object.hasOwn(publishers, fingerprint) ? publishers[fingerprint] : null;

module.exports.canRotate = (id, from, to) => ROTATABLE.has(id) && from === LEGACY && to === CURRENT;
