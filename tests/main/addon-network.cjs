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
            options.lookup(url.hostname, {}, (error, pinned, family) => { assert.equal(error, null); assert.equal(pinned, address); assert.equal(family, 4); });
            const request = new EventEmitter();
            request.destroy = error => { if (error) request.emit('error', error); request.emit('close'); };
            queueMicrotask(() => {
                const route = routes.get(url.pathname), response = new EventEmitter();
                response.statusCode = route.status; response.headers = { location: route.location, 'content-encoding': route.encoding };
                response.resume = () => {}; response.destroy = () => {};
                callback(response);
                if (route.text) response.emit('data', Buffer.from(route.text));
                response.emit('end'); request.emit('close');
            });
            return request;
        };
        assert.equal(await fetchText('https://publisher.example/ok'), '{"ok":true}');
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
        await assert.rejects(fetchText('https://publisher.example/ok', { deadline: Date.now() + 20 }), /15 секунд/);
        console.log('PASS: addon network pins validated DNS, blocks private redirects and cross-origin escapes, bounds redirects/body and rejects HTTP/compression/aborted requests without credentials.');
    } finally { https.get = originalGet; dns.lookup = originalLookup; }
})().catch(error => { console.error(error); process.exitCode = 1; });
