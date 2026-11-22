const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const dns = require('node:dns').promises;
const originalGet = https.get, originalLookup = dns.lookup;
const { fetchText } = require('../../src/main/addons/network');
(async () => {
    try {
        let address = '1.1.1.1', calls = 0;
        dns.lookup = async () => [{ address, family: 4 }];
        const routes = new Map([
            ['/ok', { status: 200, text: '{"ok":true}' }],
            ['/unreachable', { error: 'ENETUNREACH' }],
            ['/stream-error', { status: 200 }],
            ['/private', { status: 302, location: 'https://127.0.0.1/ok' }],
            ['/other', { status: 302, location: 'https://other.example/ok' }],
            ['/redirect', { status: 302, location: '/ok' }],
            ['/loop', { status: 302, location: '/loop' }],
            ['/large', { status: 200, text: 'x'.repeat(100) }],
            ['/missing', { status: 404, text: 'missing' }],
            ['/compressed', { status: 200, encoding: 'gzip', text: 'compressed' }],
        ]);
        https.get = (url, options, callback) => {
            calls++;
            assert.equal(options.headers['Accept-Encoding'], 'identity');
            assert.equal(options.headers.Authorization, undefined);
            assert.equal(options.headers.Cookie, undefined);
            const request = new EventEmitter();
            request.destroy = error => { if (error) request.emit('error', error); request.emit('close'); };
            let constructing = true;
            options.lookup(url.hostname, {}, (error, pinned, family) => {
                assert.equal(constructing, false, 'DNS completion must wait for socket/request error handlers');
                assert.equal(error, null); assert.equal(pinned, address); assert.equal(family, 4);
                if (url.pathname === '/unreachable') request.destroy(Object.assign(new Error('connect ENETUNREACH'), { code: 'ENETUNREACH' }));
            });
            constructing = false;
            queueMicrotask(() => {
                if (url.pathname === '/unreachable') return;
                const route = routes.get(url.pathname), response = new EventEmitter();
                response.statusCode = route.status; response.headers = { location: route.location, 'content-encoding': route.encoding };
                response.resume = () => {}; response.setTimeout = () => {}; response.destroy = () => queueMicrotask(() => response.emit('error', new Error('response disconnected')));
                callback(response);
                if (url.pathname === '/stream-error') { response.emit('error', new Error('early stream error')); request.emit('close'); return; }
                if (route.text) response.emit('data', Buffer.from(route.text));
                response.emit('end'); request.emit('close');
            });
            return request;
        };
        assert.equal(await fetchText('https://publisher.example/ok'), '{"ok":true}');
        await assert.rejects(fetchText('https://publisher.example/unreachable'), error => error.code === 'ENETUNREACH');
        assert((await fetchText('https://publisher.example/stream-error', { stream: true, detailed: true })).listenerCount('error') > 0);
        assert.equal(await fetchText('https://publisher.example/redirect'), '{"ok":true}');
        await assert.rejects(fetchText('https://publisher.example/redirect', { validateUrl: value => { if (new URL(value).pathname !== '/redirect') throw new Error('Route denied'); } }), /Route denied/, 'redirects cannot bypass operation routes');
        await assert.rejects(fetchText('https://publisher.example/private'), /адреса/);
        await assert.rejects(fetchText('https://publisher.example/other', { origins: ['https://publisher.example'] }), /Домен/);
        await assert.rejects(fetchText('https://publisher.example/loop'), /перенаправлений/);
        await assert.rejects(fetchText('https://publisher.example/large', { limit: 20 }), /размер/);
        await assert.rejects(fetchText('https://publisher.example/missing'), /404/);
        await assert.rejects(fetchText('https://publisher.example/compressed'), /Сжатый/);
        address = '169.254.169.254'; const before = calls;
        await assert.rejects(fetchText('https://publisher.example/ok'), /адреса/);
        assert.equal(calls, before, 'private DNS result never opens a socket');
        const controller = new AbortController(); controller.abort(); address = '1.1.1.1';
        await assert.rejects(fetchText('https://publisher.example/ok', { signal: controller.signal }), /отменён/);
        dns.lookup = () => new Promise(() => {});
        await assert.rejects(fetchText('https://publisher.example/ok', { deadline: Date.now() + 20 }), /отведённое время/);
        console.log('PASS: addon network pins validated DNS, blocks private redirects and cross-origin escapes, bounds redirects/body and rejects HTTP/compression/aborted requests without credentials.');
    } finally { https.get = originalGet; dns.lookup = originalLookup; }
})().catch(error => { console.error(error); process.exitCode = 1; });
