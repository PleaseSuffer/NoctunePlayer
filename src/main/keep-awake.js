const KEY = 'setting_keep_awake';

function createKeepAwake(powerSaveBlocker) {
    let blockerId = null;
    let enabled = false;
    let playing = false;
    function sync() {
        if (enabled && playing) {
            if (blockerId === null || !powerSaveBlocker.isStarted(blockerId)) {
                blockerId = powerSaveBlocker.start('prevent-display-sleep');
            }
        } else if (blockerId !== null) {
            powerSaveBlocker.stop(blockerId);
            blockerId = null;
        }
    }
    return {
        setEnabled(value) { enabled = value === true; sync(); },
        setPlaying(value) { playing = value === true; sync(); },
    };
}

module.exports = { KEY, createKeepAwake };
