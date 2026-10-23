const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function harness() {
    let now = 1000;
    const events = [];
    const context = { Date: { now: () => now }, Event: class {}, CustomEvent: class { constructor(type, args) { this.type=type;this.detail=args.detail; } }, document: { dispatchEvent(event) { events.push(event); } }, userPlaylists: [], fileEntries: [], playlistOrder: [], currentIndex: -1,
        externalAudioQueue: [], renderPlaylistsDropdown() {}, addonEvents: { emit() {} } };
    context.window = context;
    vm.runInNewContext(fs.readFileSync('src/renderer/addons/providers.js', 'utf8'), context);
    return { api: context.addonProviders, events, time: value => { now = value; } };
}
(async () => {
    const { api, time, events } = harness(), entry = { addonId: 'test-addon', providerId: 'test-provider', trackId: 'clicked-track' }, calls = [];
    let response = [{ id: 'like', title: 'Нравится', icon: 'Heart' }], blocked, release;
    api.register(entry.addonId, 'hash', { id: entry.providerId, name: 'Test', trackActions: true, inlineActions: true }, async (action, args) => {
        calls.push({ action, args });
        if (action === 'trackActions') return response;
        if (blocked) await new Promise(resolve => { release = resolve; });
    });
    await assert.rejects(api.action(entry, 'like'), /устарело/);
    assert.equal((await api.actions(entry))[0].title, 'Нравится');
    assert.equal(calls[0].action, 'trackActions');assert.equal(calls[0].args.trackId, 'clicked-track');
    await assert.rejects(api.action({ ...entry, trackId: 'other-track' }, 'like'), /устарело/);
    await assert.rejects(api.action(entry, 'delete-everything'), /устарело/);
    blocked = true; const pending = api.action(entry, 'like');
    await assert.rejects(api.action(entry, 'like'), /уже выполняется/);release();await pending;blocked = false;
    assert.equal(calls.at(-1).args.trackId, 'clicked-track');
    await assert.rejects(api.action(entry, 'like'), /устарело/, 'an offered action can only be used once');
    await api.actions(entry);time(62000);await assert.rejects(api.action(entry, 'like'), /устарело/);
    response = [{ id: 'like', title: 'Нравится' }, { id: 'like', title: 'Duplicate' }];
    await assert.rejects(api.actions(entry), /Некорректное/);
    response = Array.from({ length: 17 }, () => ({ id: 'like', title: 'Too many' }));
    await assert.rejects(api.actions(entry), /16/);
    response = [{ id: 'like', title: '<img src=x onerror=alert(1)>', icon: '<svg>' }];
    const [safe] = await api.actions(entry);assert.equal(safe.title, response[0].title);assert.equal(safe.icon, 'Circle');
    response = [{id:'unlike',title:'Не нравится',icon:'Heart',inline:true,active:true}];
    const [inline] = await api.actions(entry, 'row');assert.equal(inline.inline,true);assert.equal(inline.active,true);assert.equal(calls.at(-1).args.surface,'row');
    assert.equal(api.hasInline(entry),true);
    api.invalidate(entry.addonId,{provider:entry.providerId,trackIds:[entry.trackId]});
    assert.equal(events.at(-1).detail.trackIds[0],entry.trackId);
    await assert.rejects(api.action(entry,'unlike'),/устарело/);
    assert.throws(()=>api.invalidate('foreign-addon',{provider:entry.providerId}),/выключен/);
    assert.throws(()=>api.invalidate(entry.addonId,{provider:entry.providerId,trackIds:Array(101).fill('x')}),/100/);
    await assert.rejects(api.actions({ ...entry, addonId: 'foreign-addon' }), /выключен/);
    api.cleanup(entry.addonId);await assert.rejects(api.action(entry, 'like'), /выключен/);
    const legacy = harness().api;
    legacy.register('legacy-addon', 'hash', { id: 'legacy-provider', name: 'Legacy' }, () => { throw new Error('Unexpected callback'); });
    assert.equal((await legacy.actions({ addonId: 'legacy-addon', providerId: 'legacy-provider', trackId: 'one' })).length, 0);
    const stale = harness().api;let finish;
    stale.register('stale-addon', 'hash', { id: 'stale-provider', name: 'Stale', trackActions: true }, () => new Promise(resolve => { finish = resolve; }));
    const old = stale.actions({ addonId: 'stale-addon', providerId: 'stale-provider', trackId: 'one' });
    stale.cleanup('stale-addon');finish([{ id: 'like', title: 'Нравится' }]);await assert.rejects(old, /выключен|обновлён/);
    console.log('PASS: provider menu actions target the clicked track, validate descriptors, reject forged/stale/duplicate actions, serialize mutations, clean up on disable and retain legacy providers.');
})().catch(error => { console.error(error); process.exitCode = 1; });
