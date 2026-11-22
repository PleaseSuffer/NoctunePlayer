(function (root, factory) {
    const catalog = typeof module === 'object' && module.exports ? require('./locales') : root.noctuneLocale.initial.catalogs;
    root.NoctuneLocaleCatalog = catalog;
    const api = factory(catalog);
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.noctuneI18n = api;
})(globalThis, function (catalog) {
    const packs = new Map(), listeners = new Set();
    const sourceKeys = new Map(Object.entries(catalog.ru).map(([key, value]) => [value, key]));
    let locale = 'ru';
    const own = (value, key) => value && Object.hasOwn(value, key);
    const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const normalize = value => typeof value === 'string' && /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value) ? value : null;
    function interpolate(value, args = {}) {
        return value.replace(/\{([A-Za-z0-9_]+)\}/g, (all, key) => own(args, key) && ['string', 'number', 'boolean'].includes(typeof args[key]) ? String(args[key]) : all);
    }
    function t(key, args) {
        const messages = packs.get(locale)?.messages || catalog[locale] || catalog[locale.split('-')[0]];
        return interpolate(own(messages, key) ? messages[key] : catalog[locale.split('-')[0]]?.[key] ?? catalog.en[key] ?? catalog.ru[key] ?? key, args);
    }
    function notify() { for (const callback of listeners) callback(locale); }
    function setLocale(value) {
        if (!normalize(value) || !catalog[value] && !packs.has(value)) throw new Error((globalThis.noctuneI18n?.t("language.errors.unknownLanguage") ?? "Unknown language: ") + value);
        if (locale !== value) { locale = value; notify(); }
        return locale;
    }
    function validateMessages(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 3000 || JSON.stringify(value).length > 512 * 1024) throw new Error((globalThis.noctuneI18n?.t("language.errors.invalidLanguageMessages") ?? "Invalid language messages"));
        for (const [key, text] of Object.entries(value)) {
            if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$/.test(key) || ['constructor', 'prototype', '__proto__'].includes(key) || typeof text !== 'string' || text.length > 12000) throw new Error((globalThis.noctuneI18n?.t("language.errors.invalidLanguageMessage") ?? "Invalid language message: ") + key);
            const original = catalog.en[key] || catalog.ru[key];
            if (original && JSON.stringify([...original.matchAll(/\{\w+\}/g)].map(m => m[0]).sort()) !== JSON.stringify([...text.matchAll(/\{\w+\}/g)].map(m => m[0]).sort())) throw new Error((globalThis.noctuneI18n?.t("language.errors.languagePlaceholdersDiffer") ?? "Language placeholders differ: ") + key);
        }
        return Object.freeze({ ...value });
    }
    function register(owner, pack) {
        if (typeof owner !== 'string' || !owner || !pack || !normalize(pack.locale) || ['ru', 'en'].includes(pack.locale) || typeof pack.name !== 'string' || !pack.name.trim() || pack.name.length > 80) throw new Error((globalThis.noctuneI18n?.t("language.errors.invalidLanguagePack") ?? "Invalid language pack"));
        if (packs.has(pack.locale) && packs.get(pack.locale).owner !== owner) throw new Error((globalThis.noctuneI18n?.t("language.errors.languageAlreadyRegistered") ?? "Language already registered"));
        packs.set(pack.locale, { owner, name: pack.name, messages: validateMessages(pack.messages) }); notify();
        return pack.locale;
    }
    function unregister(owner) {
        for (const [id, pack] of packs) if (pack.owner === owner) { packs.delete(id); if (locale === id) locale = 'en'; }
        notify();
    }
    function localize(value, messages, fallback = 'en', args) {
        const available = messages?.[locale] || messages?.[locale.split('-')[0]] || messages?.[fallback];
        return interpolate(own(available, value) ? available[value] : value, args);
    }
    return Object.freeze({ t, text: source => sourceKeys.has(source) ? t(sourceKeys.get(source)) : source, html: (key, args) => escape(t(key, args)),
        // Migrated templates already escape their parameters at the original call site.
        legacyHtml: (key, args) => interpolate(escape(t(key)), args), escape, interpolate, localize, validateMessages,
        messages: () => ({ ...catalog.ru, ...catalog.en, ...(catalog[locale] || packs.get(locale)?.messages || {}) }),
        get locale() { return locale; }, setLocale, register, unregister,
        getPack: locale => { const pack = packs.get(locale); return pack ? { locale, owner: pack.owner, name: pack.name, messages: pack.messages } : null; },
        languages: () => [{ locale: 'ru', name: (globalThis.noctuneI18n?.t("language.names.russian", {}) ?? "Русский") }, { locale: 'en', name: 'English' }, ...[...packs].map(([locale, p]) => ({ locale, name: p.name }))],
        onChange(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    });
});
