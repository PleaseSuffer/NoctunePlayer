'use strict';
const fs = require('node:fs');
const KEY = 'setting_hardware_acceleration';
function readHardwareAcceleration(configPath) {
    try { return JSON.parse(fs.readFileSync(configPath, 'utf8'))?.[KEY] !== '0'; }
    catch (_) { return true; }
}
function hardwareAccelerationState(enabled, startupEnabled) {
    return { enabled, restartRequired: enabled !== startupEnabled };
}
module.exports = { KEY, readHardwareAcceleration, hardwareAccelerationState };
