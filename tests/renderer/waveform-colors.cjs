const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let accent = '#ab1234', theme = 'dark';
const context = {
    window: { waveformColorMode: 'accent', waveformCustomColor: '#123456' },
    document: { body: { getAttribute: () => theme } },
    getComputedStyle: () => ({ getPropertyValue: () => accent }),
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('src/renderer/effects/waveform.js', 'utf8'), context);
for (const hasBackground of [false, true]) {
    context.window.bgImageEnabled = hasBackground;
    context.window.bgImagePath = hasBackground ? 'background.jpg' : '';
    for (theme of ['dark', 'light']) {
        context.window.waveformColorMode = 'accent';
        assert.equal(context.getWaveformColor(), accent, 'accent mode works with or without a background in both themes');
        context.window.waveformColorMode = 'theme';
        assert.equal(context.getWaveformColor(), theme === 'dark' ? '#e8e8e8' : '#2b2b2b');
        context.window.waveformColorMode = 'adaptive';
        assert.equal(context.getWaveformColor(), hasBackground ? accent : theme === 'dark' ? '#e8e8e8' : '#2b2b2b');
        context.window.waveformColorMode = 'custom';
        assert.equal(context.getWaveformColor(), '#123456');
    }
}
context.window.waveformColorMode = 'accent';
context.window._waveformCurrentFilePath = 'track.mp3';
const peaks = new Uint8Array([1, 127, 255]);
context.window._waveformCache.set('track.mp3', peaks);
context.window._waveformLastFraction = 0.42;
let renderedColor;
context.renderWaveform = cached => {
    assert.equal(cached, peaks, 'color changes reuse decoded peaks');
    renderedColor = context.getWaveformColor();
};
accent = '#fedcba';
context.refreshWaveformColorIfNeeded();
assert.equal(renderedColor, accent);
assert.equal(context.window._waveformLastFraction, 0.42, 'recoloring retains playback progress');

const settings = fs.readFileSync('src/renderer/ui/settings.js', 'utf8');
const definitions = settings.slice(settings.indexOf('const WAVEFORM_COLOR_MODES ='), settings.indexOf('function reloadWaveformForCurrentTrack()'));
const selector = settings.slice(settings.indexOf('function selectWaveformColorMode(mode)'), settings.indexOf("waveformColorModeBtn.addEventListener('click'"));
const storage = new Map();
const items = ['custom', 'adaptive', 'accent', 'theme'].map(mode => ({
    dataset: { waveformColorMode: mode }, classList: { toggle(_name, active) { this.active = active; } },
}));
const label = {}, description = {}, colorRow = {};
vm.runInNewContext(definitions + selector + `
    for (const mode of ['accent', 'theme']) {
        selectWaveformColorMode(mode);
        verify(mode, window.waveformColorMode, waveformColorModeLabel.textContent);
    }
    selectWaveformColorMode('unknown');
    verify('custom', window.waveformColorMode, waveformColorModeLabel.textContent);
`, {
    window: {}, waveformColorModeLabel: label, waveformColorModeDesc: description,
    waveformColorModeBtn: { querySelector: () => ({}) },
    waveformColorModeMenu: { querySelectorAll: () => items }, waveformColorRow: colorRow,
    appStorage: { setItem: (key, value) => storage.set(key, value) },
    lucide: { createIcons() {} }, reloadWaveformForCurrentTrack() {},
    setSettingsBlockVisible: (row, visible) => { row.visible = visible; },
    verify(mode, selected, text) {
        assert.equal(selected, mode);
        assert.equal(storage.get('setting_waveform_color_mode'), mode);
        assert.equal(colorRow.visible, mode === 'custom');
        assert.equal(items.find(item => item.classList.active).dataset.waveformColorMode, mode);
        assert.equal(text, { accent: 'От акцента', theme: 'От темы', custom: 'Свой цвет' }[mode]);
    },
});
console.log('PASS: waveform accent/theme modes, existing modes, cached recoloring, progress, selection and persistence.');
