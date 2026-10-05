const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { KEY, readHardwareAcceleration, hardwareAccelerationState } = require('../../src/main/hardware-acceleration');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noctune-hardware-'));
const config = path.join(root, 'config.json');
try {
    assert.equal(readHardwareAcceleration(config), true);
    fs.writeFileSync(config, JSON.stringify({ [KEY]: '0' }));
    assert.equal(readHardwareAcceleration(config), false);
    fs.writeFileSync(config, JSON.stringify({ [KEY]: '1' }));
    assert.equal(readHardwareAcceleration(config), true);
    fs.writeFileSync(config, 'broken'); assert.equal(readHardwareAcceleration(config), true);
    assert.equal(hardwareAccelerationState(false, true).restartRequired, true);
    assert.equal(hardwareAccelerationState(true, true).restartRequired, false);
    assert.equal(hardwareAccelerationState(true, false).restartRequired, true);
    assert.equal(hardwareAccelerationState(false, false).restartRequired, false);
    console.log('PASS: early persisted hardware preference, default/corrupt config and restart necessity in both directions.');
} finally { fs.unlinkSync(config); fs.rmdirSync(root); }
