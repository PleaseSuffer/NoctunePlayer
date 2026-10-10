const KEY = 'setting_keep_awake';

function createKeepAwake(powerSaveBlocker) {
    let blockerId = null;
    function setEnabled(enabled) {
        if (enabled === true) {
            if (blockerId === null || !powerSaveBlocker.isStarted(blockerId)) {
                blockerId = powerSaveBlocker.start('prevent-display-sleep');
            }
        } else if (blockerId !== null) {
            powerSaveBlocker.stop(blockerId);
            blockerId = null;
        }
    }
    return { setEnabled };
}

module.exports = { KEY, createKeepAwake };
