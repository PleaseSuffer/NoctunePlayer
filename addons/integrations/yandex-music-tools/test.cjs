const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const manifest = require(path.join(root, 'addons/integrations/yandex-music/manifest.json'));
const code = fs.readFileSync(path.join(root, 'addons/integrations/yandex-music/main.js'), 'utf8');
const { validatePackage, packDirectory } = require(path.join(root, 'src/main/addons/package'));
const { route, allowsOrigin } = require(path.join(root, 'src/shared/addon-contributions'));
const song = id => ({ id: String(id), title: 'Song ' + id, artists: [{ name: 'Artist' }], albums: [{ id: 7, title: 'Album' }],durationMs:180000,coverUri:'avatars.yandex.net/get-music-content/album/%%' });
const plain = value => JSON.parse(JSON.stringify(value));
async function harness() {
    let activate;
    const commands = new Map(), events = new Map(), calls = [], notices = [], catalogs = [], providers = [];
    const state = { uid: 42, configured: true, custom: null, stops: [], current: { sessionId: 'local-session' } };
    const api = { manifest: plain(manifest),
        storage:{get:async()=>({uid:'42'}),set:async()=>{}},
        settings: { get: async () => ({ bitrate: '192', query: 'artist', feedback: false }) },
        credentials: { status: async () => ({ configured: state.configured, secureStorage: true }), configure: async () => ({ configured: true }), disconnect: async () => { state.configured = false; } },
        onCommand: (id, fn) => commands.set(id, fn), on: (type, fn) => events.set(type, fn),
        notify: async message => notices.push(message), system: { openExternal: async () => {} },
        player: { current: async () => state.current, stop: async args => state.stops.push(args) },
        catalog: { register: async catalog => catalogs.push(catalog),unregister:async()=>{} },
        providers: { register: async provider => providers.push(provider) },
        network: { request: async input => {
            assert.ok(input.url.length <= 2048, 'request must respect the real SDK URL limit');
            assert.ok(allowsOrigin(api.manifest.network.origins, new URL(input.url).origin));
            route(api.manifest, api.manifest.permissions, input.url, input.method);
            if (input.credential) assert.equal(new URL(input.url).origin, 'https://api.music.yandex.net');
            calls.push(input);
            const url = new URL(input.url), pathname = url.pathname;
            const respond = result => ({ status: 200, headers: {}, body: JSON.stringify({ result }) });
            if (state.custom) { const result = await state.custom(input); if (result) return result; }
            if (pathname === '/account/status') return respond({ account: { uid: state.uid, displayName: 'Test' } });
            if (pathname === '/users/42/playlists/list') return respond(Array.from({ length: 105 }, (_, i) => ({ owner: { uid: 42 }, kind: i + 1, title: 'Playlist ' + i, revision: 8 })));
            if (pathname === '/users/42/likes/playlists') return respond([{ playlist: { owner: { uid: 50 }, kind: 90, title: 'Saved' } }]);
            if (pathname === '/feed') return respond({ generatedPlaylists: [{ data: { owner: { uid: 99 }, kind: 2, title: 'Playlist of the day' } }] });
            if (pathname === '/users/42/likes/tracks') return respond({ library: { revision: 123, tracks: Array.from({ length: 205 }, (_, i) => ({ id: String(i + 1), albumId: '7' })) } });
            if (pathname === '/tracks') {
                assert.equal(input.method, 'POST');
                assert.equal(input.headers['Content-Type'], 'application/x-www-form-urlencoded');
                return respond(new URLSearchParams(input.body).get('track-ids').split(',').map(id => song(id.split(':')[0])));
            }
            if (pathname === '/users/42/playlists/1') return respond({ revision: 5, title: 'Duplicates', tracks: [{ id: '1', track: song(1) }, { id: '1', track: song(1) }] });
            if (pathname === '/search') return respond({ tracks: { results: [song(Number(url.searchParams.get('page')||0)+1)],perPage:1,total:2 } });
            if (pathname.endsWith('/download-info')) return respond([
                { codec: 'mp3', bitrateInKbps: 320, preview: true, downloadInfoUrl: 'https://storage.mds.yandex.net/preview' },
                { codec: 'mp3', bitrateInKbps: 192, preview: false, downloadInfoUrl: 'https://storage.mds.yandex.net/info' },
            ]);
            if (pathname === '/info') return { status: 200, headers: {}, body: '<download-info><host>storage.mds.yandex.net</host><path>/music/a.mp3</path><ts>00062af0</ts><s>abcdef</s></download-info>' };
            if (pathname.endsWith('/tracks') && pathname.includes('/rotor/')) return respond({ batchId: 'batch:1', sequence: [{ track: song(1) }, { track: song(2) }] });
            if (pathname.endsWith('/feedback')) return respond('ok');
            throw new Error('Unexpected request: ' + pathname);
        } },
    };
    vm.runInNewContext(code, { NoctuneAddon: { define: fn => { activate = fn; } }, URL, TextEncoder, Uint8Array, DataView, setTimeout, clearTimeout });
    await activate(api);
    return { api, state, commands, events, calls, notices, catalogs, providers };
}
(async () => {
    validatePackage(await packDirectory(path.join(root, 'addons/integrations/yandex-music')));
    const h = await harness();
    assert.equal(h.calls.length, 0, 'startup never waits for music API');
    assert.deepEqual([...h.commands.keys()].sort(), manifest.commands.map(item => item.id).sort());
    await Promise.all([h.commands.get('check')(), h.commands.get('check')()]);
    assert.equal(h.calls.filter(call => call.url.endsWith('/account/status')).length, 1);
    assert.equal(h.catalogs.length, 1, 'concurrent commands register once');
    const catalog = h.catalogs[0], provider = h.providers[0];
    assert.equal(catalog.accountId, '42');
    const rootPage = await catalog.browse({});
    assert.deepEqual(plain(rootPage.items.map(item => item.id)), ['likes','wave','group/mine','group/saved','group/recommendations']);
    const lists = await catalog.read({});
    assert.equal(lists.items.length, 100);
    assert.equal((await catalog.read({ cursor: lists.cursor })).items.length, 5);
    for (const [group, name] of [['saved','Saved'],['recommendations','Playlist of the day']]) {
        const page = await catalog.browse({ parent: { id: 'group/' + group, type: 'album' } });
        assert.equal(page.items[0].title, name);
    }
    const searched=await catalog.search({query:'artist'});assert.equal(searched.items[0].title,'Song 1');
    assert.equal((await catalog.search({query:'artist',cursor:searched.cursor})).items[0].title,'Song 2');
    await assert.rejects(catalog.search({query:'other',cursor:searched.cursor}),/устарела/);
    const first = await catalog.read({ id: 'likes' });
    assert.equal(first.tracks.length, 100);
    assert.equal(first.tracks[0].title, 'Song 1');
    assert.equal(first.tracks[0].duration,180);assert.equal(first.tracks[0].artwork,'https://avatars.yandex.net/get-music-content/album/200x200');
    const second = await catalog.read({ id: 'likes', cursor: first.cursor });
    assert.equal(second.revision, first.revision);
    assert.equal(second.tracks[0].title, 'Song 101');
    const third = await catalog.read({ id: 'likes', cursor: second.cursor });
    assert.equal(third.tracks.length, 5); assert.equal(third.cursor, null);
    const large = await harness();
    await large.commands.get('check')();
    large.state.custom = async input => input.url.includes('/likes/tracks') ? { status: 200, headers: {}, body: JSON.stringify({ result: { library: {
        revision: 1, tracks: Array.from({ length: 100 }, (_, i) => ({ id: String(100000000 + i), albumId: '10000000' })),
    } } }) } : null;
    assert.equal((await large.catalogs[0].read({ id: 'likes' })).tracks.length, 100);
    const batchRequest = large.calls.find(call => new URL(call.url).pathname === '/tracks');
    assert.ok(batchRequest.body.length > 2048, 'realistic IDs reproduce a batch too long for a GET URL');
    assert.equal(batchRequest.url, 'https://api.music.yandex.net/tracks');
    await assert.rejects(catalog.read({ id: 'playlist/42/1', cursor: first.cursor }), /устарела/);
    const duplicate = await catalog.read({ id: 'playlist/42/1' });
    assert.equal(duplicate.tracks[0].id, duplicate.tracks[1].id);
    assert.notEqual(duplicate.tracks[0].entryId, duplicate.tracks[1].entryId);
    const stream = await provider.resolve({ trackId: first.tracks[0].id, sessionId: 'our-session', reason: 'play' });
    const digest = crypto.createHash('md5').update('XGRlBW9FXlekgbPrRHuSiAmusic/a.mp3abcdef').digest('hex');
    assert.equal(stream.url, 'https://storage.mds.yandex.net/get-mp3/' + digest + '/00062af0/music/a.mp3');
    assert.equal(stream.credential, undefined);
    const again = await provider.resolve({ trackId: first.tracks[0].id, sessionId: 'our-session', reason: 'refresh' });
    assert.equal(again.url, stream.url);
    assert.equal(h.calls.filter(call => call.url.endsWith('/download-info')).length, 2, 'refresh obtains a fresh source');
    const wave = await catalog.read({ id: 'wave' });
    assert.equal(wave.tracks.length, 2);
    assert.equal(wave.continuous,true);assert.ok(wave.cursor);
    const continued=await catalog.read({id:'wave',cursor:wave.cursor,after:wave.tracks[0].id});
    assert.equal(continued.tracks[0].canonicalId,wave.tracks[0].canonicalId);
    assert.ok(h.calls.some(call=>call.url.includes('settings2=true&queue=1')));
    assert.equal(h.calls.some(call => call.url.includes('/feedback')), false, 'browse sends no listening feedback');
    await provider.resolve({ trackId: wave.tracks[0].id, sessionId: 'wave-session' });
    await h.events.get('settings.changed')({ values: { feedback: true } });
    const playback = h.events.get('playback.*'), progress = h.events.get('progress.*');
    await playback({ type: 'playback.play', sessionId: 'wave-session' });
    await playback({ type: 'playback.play', sessionId: 'wave-session' });
    await progress({ type: 'progress.updated', sessionId: 'wave-session', timestamp: 1000, position: 1, playing: true, speed: 1 });
    await progress({ type: 'progress.updated', sessionId: 'wave-session', timestamp: 2000, position: 2, playing: true, speed: 1 });
    await progress({ type: 'progress.seek', sessionId: 'wave-session' });
    await progress({ type: 'progress.updated', sessionId: 'wave-session', timestamp: 3000, position: 90, playing: true });
    await playback({ type: 'playback.ended', sessionId: 'wave-session' });
    await playback({ type: 'playback.ended', sessionId: 'wave-session' });
    await new Promise(resolve => setImmediate(resolve));
    const feedback = h.calls.filter(call => call.url.includes('/feedback')).map(call => JSON.parse(call.body));
    assert.deepEqual(feedback.map(item => item.type), ['radioStarted','trackStarted','trackFinished']);
    assert.equal(feedback[2].totalPlayedSeconds, 1, 'seek does not count as listening');
    h.api.manifest.network.origins = ['https://api.music.yandex.net'];
    const blocked = await provider.resolve({ trackId: first.tracks[0].id, sessionId: 'blocked' });
    assert.equal(blocked.error.code, 'UNSUPPORTED_TRANSPORT');
    assert.match(blocked.error.message, /CDN/);
    assert.throws(() => h.commands.get('last-error')(), /CDN/, 'inline error command also works when toasts are unavailable');
    const errorNotice = await harness();
    errorNotice.api.manifest.network.origins = ['https://api.music.yandex.net'];
    await errorNotice.providers[0].resolve({ trackId: '42/t/1:7', sessionId: 'error-toast' });
    assert.ok(errorNotice.notices.some(message => message.includes('CDN')), 'resolver reports errors beyond the generic player label');
    h.api.manifest.network.origins = plain(manifest.network.origins);
    h.state.custom = async input => input.url.endsWith('/download-info') ? { status: 200, headers: {}, body: JSON.stringify({ result: [{ codec: 'mp3', preview: true, downloadInfoUrl: 'https://storage.mds.yandex.net/info' }] }) } : null;
    assert.equal((await provider.resolve({ trackId: first.tracks[0].id, sessionId: 'preview' })).error.code, 'UNSUPPORTED_TRANSPORT');
    h.state.custom = null;
    await h.events.get('settings.credentials')({profile:'yandex-token',configured:true});
    await assert.rejects(catalog.read({ id: 'likes', cursor: first.cursor }), /устарела/);
    await provider.resolve({trackId:first.tracks[0].id,sessionId:'reconnected-session'});
    h.state.uid = 777;
    await assert.rejects(h.commands.get('check')(), /Аккаунт изменился/);
    h.state.uid = 42;
    await h.commands.get('check')();
    h.state.custom = async () => ({ status: 429, headers: { 'retry-after': '60' }, body: '{}' });
    await assert.rejects(catalog.read({ id: 'likes' }), /ограничил/);
    const count = h.calls.length;
    await assert.rejects(catalog.read({ id: 'likes' }), /ограничил/);
    assert.equal(h.calls.length, count, 'cooldown prevents more network requests');
    h.state.current = { sessionId: 'reconnected-session' };
    h.state.configured=false;await h.events.get('settings.credentials')({profile:'yandex-token',configured:false});
    assert.equal(h.state.configured, false);
    assert.deepEqual(h.state.stops.map(plain), [{ sessionId: 'reconnected-session' }]);
    assert.equal((await provider.resolve({ trackId: first.tracks[0].id, sessionId: 'logout' })).error.code, 'AUTH_REQUIRED');
    const denied = await harness();
    await denied.commands.get('check')();
    denied.state.custom = async input => input.url.endsWith('/download-info') ? { status: 403, headers: {}, body: '{}' } : null;
    assert.equal((await denied.providers[0].resolve({ trackId: '42/t/1:7', sessionId: 'forbidden' })).error.code, 'NETWORK', '403 is not guessed to be a region restriction');
    denied.state.custom = async () => ({ status: 401, headers: {}, body: '{}' });
    assert.equal((await denied.providers[0].resolve({ trackId: '42/t/1:7', sessionId: 'unauthorized' })).error.code, 'AUTH_REQUIRED');
    const race = await harness();
    await race.commands.get('check')();
    let finish, entered;
    const enteredPromise = new Promise(resolve => { entered = resolve; });
    race.state.custom = async input => {
        if (!input.url.endsWith('/download-info')) return null;
        entered();
        return new Promise(resolve => { finish = resolve; });
    };
    const pending = race.providers[0].resolve({ trackId: '42/t/1:7', sessionId: 'old' });
    await enteredPromise;
    race.state.configured=false;await race.events.get('settings.credentials')({profile:'yandex-token',configured:false});
    finish({ status: 200, headers: {}, body: JSON.stringify({ result: [] }) });
    assert.equal((await pending).error.code, 'AUTH_REQUIRED', 'late resolve after logout is discarded');
    const os = require('node:os');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'noctune-yandex-build-'));
    try {
        const { build } = require(path.join(root, 'addons/integrations/yandex-music-tools/build.cjs'));
        const output = path.join(directory, 'test.noctaddon');
        const built = await build(output, ['https://test.storage.yandex.net']);
        assert.ok(built.manifest.network.origins.includes('https://test.storage.yandex.net'));
        assert.deepEqual(built.manifest.credentials['yandex-token'].origins, ['https://api.music.yandex.net']);
        for (const origin of ['https://evil.example', 'https://storage.yandex.net.evil.example', 'http://test.storage.yandex.net', 'https://test.storage.yandex.net/path']) {
            await assert.rejects(build(output, [origin]));
        }
        await assert.rejects(build(output, Array.from({ length: 7 }, (_, i) => 'https://test' + i + '.storage.yandex.net')), /восьми/);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    console.log('PASS: Yandex addon package, startup, account isolation, catalog, pagination, metadata, duplicate entries, MP3 signature/refresh, Wave feedback, seek accounting, CDN/preview rejection, cooldown and logout.');
})().catch(error => { console.error(error); process.exitCode = 1; });
