const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const i18n = require('../../src/shared/i18n');
const catalogs = require('../../src/shared/locales');
const localization = require('../../src/shared/addon-localization');
const packages = require('../../src/main/addons/package');

for (const key of Object.keys(catalogs.ru)) { assert(!/^(m\.|addon\.[a-f0-9]{12}|i18n\.error\.[a-f0-9]{10})/.test(key), 'semantic key: '+key); assert(key.length <= 120, 'bounded semantic key: '+key); }
assert.deepEqual(Object.keys(catalogs.ru).sort(), Object.keys(catalogs.en).sort(), 'both bundled languages are complete');
const placeholders = value => [...value.matchAll(/\{\w+\}/g)].map(m => m[0]).sort();
for (const key of Object.keys(catalogs.ru)) assert.deepEqual(placeholders(catalogs.ru[key]), placeholders(catalogs.en[key]), key);
for (const file of fs.readdirSync('src', { recursive: true }).filter(f => /\.(js|html)$/.test(f) && !f.includes('locales'))) {
    const source = fs.readFileSync(path.join('src', file), 'utf8');
    for (const match of source.matchAll(/(?:noctuneI18n\?\.(?:t|legacyHtml)\(["']|data-i18n(?:-[\w-]+)?=")([a-zA-Z][a-zA-Z0-9_.-]+)["']/g)) assert(Object.hasOwn(catalogs.ru, match[1]), "catalog entry for " + file + ":" + match[1]);
}
for (const key of ['constructor', 'prototype', '__proto__']) assert.throws(() => i18n.validateMessages(Object.fromEntries([[key, 'blocked']])));
i18n.setLocale('en');
assert.equal(i18n.t('language.select'), 'Interface language');
assert.equal(i18n.t('updates.available.notification', { p0: '2.0' }), 'Version 2.0 is available. Click to open Noctune and download it.');
assert.equal(i18n.t('unknown'), 'unknown');
assert.equal(i18n.legacyHtml('updates.available.notification', { p0: '&lt;test&gt;' }), 'Version &lt;test&gt; is available. Click to open Noctune and download it.', 'legacy HTML parameters are not double escaped');
assert.throws(() => i18n.setLocale('../en'));
assert.throws(() => i18n.register('one', { locale: 'en', name: 'Override', messages: {} }));
assert.throws(() => i18n.register('one', { locale: 'be', name: 'Test', messages: { 'updates.available.notification': 'Missing placeholder' } }));
i18n.register('one', { locale: 'be', name: 'Беларуская', messages: { 'language.select': '<img src=x onerror=alert(1)>' } });
assert.throws(() => i18n.register('two', { locale: 'be', name: 'Conflict', messages: {} }));
i18n.setLocale('be');
assert.equal(i18n.html('language.select'), '&lt;img src=x onerror=alert(1)&gt;');
assert.equal(i18n.t('language.help'), catalogs.en['language.help'], 'partial packs fall back to English');
i18n.unregister('two'); assert.equal(i18n.locale, 'be');
i18n.unregister('one'); assert.equal(i18n.locale, 'en');
const bundle = { defaultLocale: 'en', messages: { en: { name: 'Name', description: 'Description', hello: 'Hello {name}' }, ru: { name: 'Имя', hello: 'Привет {name}' } } };
localization.validate(bundle);
assert.throws(() => localization.validate({ ...bundle, messages: { ...bundle.messages, ru: { hello: 'Missing placeholder' } } }));
const manifest = { name: 'name', description: 'description', localization: bundle, settings: { mode: { label: 'name', default: 'name' } }, commands: [{ id: 'name', title: 'name' }] };
const view = localization.manifest(manifest, 'ru');
assert.equal(view.name, 'Имя'); assert.equal(view.description, 'Description');
assert.equal(view.settings.mode.label, 'Имя'); assert.equal(view.settings.mode.default, 'name');
assert.equal(view.commands[0].id, 'name'); assert.equal(view.commands[0].title, 'Имя');
assert.equal(manifest.name, 'name', 'signed manifest stays unchanged');
(async () => {
    const pkg = await packages.packDirectory('addons/examples/track-info');
    pkg.manifest.apiVersion = 2; pkg.manifest.localization = bundle;
    assert.equal(packages.validatePackage(pkg).manifest.apiVersion, 2);
    const external = await packages.packDirectory('addons/examples/language-pack');
    const original = JSON.stringify(external.manifest);
    const resolved = localization.manifest(external.manifest, 'en', external.files);
    assert.equal(resolved.name, 'Language pack example');
    assert.equal(JSON.stringify(external.manifest), original);
    const broken = JSON.parse(JSON.stringify(external)); delete broken.files['locales/en_US.json']; assert.throws(()=>packages.validatePackage(broken));
    const traversal = JSON.parse(JSON.stringify(external)); traversal.manifest.localization.files.en = '../en_US.json'; assert.throws(()=>packages.validatePackage(traversal));
    const malformed = JSON.parse(JSON.stringify(external)); malformed.files['locales/en_US.json'] = 'invalid JSON'; assert.throws(()=>packages.validatePackage(malformed));
    pkg.manifest.apiVersion = 1; assert.throws(() => packages.validatePackage(pkg), /API 2/);
    i18n.setLocale('ru');
    console.log('PASS: complete bilingual catalogs, placeholders, fallback, HTML escaping, language ownership, API v1 compatibility and localized metadata without changing signed content.');
})().catch(error => { console.error(error); process.exitCode = 1; });
