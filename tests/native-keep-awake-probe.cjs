const { app, powerSaveBlocker } = require('electron');
const assert = require('node:assert/strict');
const { createKeepAwake } = require('../src/main/keep-awake');
app.whenReady().then(() => {
    const ids = [];
    const controller = createKeepAwake({
        start(type) { const id = powerSaveBlocker.start(type); ids.push(id); return id; },
        isStarted: id => powerSaveBlocker.isStarted(id),
        stop: id => powerSaveBlocker.stop(id),
    });
    try {
        controller.setEnabled(false);
        assert.equal(ids.length, 0);
        controller.setEnabled(true);
        assert.equal(powerSaveBlocker.isStarted(ids[0]), true);
        controller.setEnabled(true);
        assert.equal(ids.length, 1);
        controller.setEnabled(false);
        assert.equal(powerSaveBlocker.isStarted(ids[0]), false);
        console.log('PASS: native Electron display-sleep blocker starts, deduplicates and releases on Windows.');
    } catch (error) { console.error(error); process.exitCode = 1; }
    finally { controller.setEnabled(false); app.exit(process.exitCode || 0); }
});
