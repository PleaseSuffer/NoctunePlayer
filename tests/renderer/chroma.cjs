const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const manifest = require('../../addons/official/noctune-chroma/manifest.json');
const defaults = Object.fromEntries(Object.entries(manifest.settings).map(([key, field]) => [key, field.default]));
const source = fs.readFileSync('addons/official/noctune-chroma/main.js', 'utf8');
async function activate(values = {}, accent) {
    let now = 0, start;
    const scheduled = [], colors = [], notices = [], events = {}, commands = {};
    const api = {
        settings: { get: async () => ({ ...defaults, offset: 0, saturation: 100, duration: 12, easing: 'linear', ...values }) },
        themes: { accent: async ({ color }) => { colors.push(color); if (accent) await accent(color); } },
        on: (type, fn) => { events[type] = fn; }, onCommand: (id, fn) => { commands[id] = fn; },
        notify: async message => { notices.push(message); },
    };
    vm.runInNewContext(source, { NoctuneAddon: { define: fn => { start = fn(api); } }, performance: { now: () => now }, setTimeout: (fn, delay) => { scheduled.push({ fn, delay }); } });
    await start;
    return { colors, notices, commands, scheduled,
        async step(ms) { now += ms; assert(scheduled.length); await scheduled.shift().fn(); return colors.at(-1); },
        async change(values) { const original = await api.settings.get(); api.settings.get = async () => ({ ...original, ...values }); await events['settings.changed']({ values: await api.settings.get() }); },
    };
}
(async () => {
    const full = await activate();
    assert.equal(full.colors[0], '#ff0000'); assert.equal(full.scheduled[0].delay, 50);
    assert.equal(await full.step(2000), '#ffff00'); assert.equal(await full.step(2000), '#00ff00');
    await full.change({ duration: 24 });
    assert.equal(await full.step(4000), '#00ffff', 'speed change preserves phase');
    await full.change({ animated: false }); assert.equal(await full.step(100), null);
    await full.change({ animated: true }); assert.equal(await full.step(0), '#00ffff', 'pause keeps phase');
    const reverse = await activate({ direction: 'reverse' }); assert.equal(await reverse.step(2000), '#ff00ff');
    const custom = await activate({ mode: 'custom', colors: '#f00, #00f' });
    assert.equal(await custom.step(3000), '#800080'); assert.equal(await custom.step(3000), '#0000ff');
    await custom.change({ colors: '#broken' }); assert.equal(custom.notices.length, 1);
    assert.equal(await custom.step(6000), '#ff0000', 'invalid input retains the last valid palette');
    await custom.change({ colors: '#broken' }); assert.equal(custom.notices.length, 1, 'bad palette notifications are deduplicated');
    const bounce = await activate({ mode: 'custom', colors: '#000, #fff', direction: 'bounce' });
    assert.equal(await bounce.step(6000), '#ffffff'); assert.equal(await bounce.step(6000), '#000000');
    await bounce.commands['restart-cycle'](); assert.equal(await bounce.step(0), '#000000');
    const low = await activate({ quality: '10', brightness: 50 }); assert.equal(low.scheduled[0].delay, 100); assert.equal(low.colors[0], '#800000');
    // Slow SDK calls cannot build a backlog of animation requests.
    let finish, first = true;
    const blocking = await activate({}, () => { if (first) { first = false; return; } return new Promise(resolve => { finish = resolve; }); });
    const pending = blocking.step(1000); await Promise.resolve();
    assert.equal(blocking.scheduled.length, 0); finish(); await pending; assert.equal(blocking.scheduled.length, 1);
    for (const mode of ['aurora', 'sunset', 'ocean', 'neon']) {
        const preset = await activate({ mode }); assert.match(await preset.step(4567), /^#[\da-f]{6}$/);
    }
    console.log('PASS: Chroma real-time cycle, reverse/bounce, live speed/pause, palette validation, presets, brightness and SDK backpressure.');
})().catch(error => { console.error(error); process.exitCode = 1; });
