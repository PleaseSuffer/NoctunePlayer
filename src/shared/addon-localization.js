(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.AddonLocalization = api;
})(globalThis, function () {
    const locale = value => typeof value === 'string' && /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value);
    function resolve(value, files) {
        if (!value || value.files === undefined) return value;
        if (value.messages !== undefined || Object.keys(value).some(key => !['defaultLocale', 'files'].includes(key)) || !value.files || typeof value.files !== 'object' || Array.isArray(value.files) || Object.keys(value.files).length > 32) throw new Error(globalThis.noctuneI18n?.t('language.errors.invalidLocalizationFiles') ?? 'Invalid localization files');
        const messages = {};
        for (const [language, filename] of Object.entries(value.files)) {
            if (!locale(language) || typeof filename !== 'string' || !/^locales\/[a-z]{2,3}(?:_[A-Za-z0-9]{2,8})+\.json$/.test(filename) || !files || !Object.hasOwn(files, filename) || typeof files[filename] !== 'string') throw new Error(globalThis.noctuneI18n?.t('language.errors.missingLocalizationFile') ?? 'Missing or invalid localization file');
            messages[language] = JSON.parse(files[filename]);
        }
        const result = { defaultLocale: value.defaultLocale, messages };
        validate(result);
        return result;
    }
    function validate(value) {
        if (value === undefined) return;
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['defaultLocale', 'messages'].includes(key)) || !locale(value.defaultLocale) || !value.messages || !Object.hasOwn(value.messages, value.defaultLocale) || Object.keys(value.messages).length > 32 || JSON.stringify(value).length > 512 * 1024) throw new Error((globalThis.noctuneI18n?.t("language.errors.invalidExtensionLocalization") ?? "Invalid extension localization"));
        for (const [language, messages] of Object.entries(value.messages)) {
            if (!locale(language) || !messages || typeof messages !== 'object' || Array.isArray(messages) || Object.keys(messages).length > 2000) throw new Error((globalThis.noctuneI18n?.t("language.errors.invalidExtensionLanguage") ?? "Invalid extension language"));
            for (const [key, text] of Object.entries(messages)) if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$/.test(key) || ['constructor', 'prototype', '__proto__'].includes(key) || typeof text !== 'string' || text.length > 12000) throw new Error((globalThis.noctuneI18n?.t("language.errors.invalidExtensionMessage") ?? "Invalid extension message"));
        }
        const base = value.messages[value.defaultLocale];
        for (const messages of Object.values(value.messages)) for (const [key, text] of Object.entries(messages)) {
            if (!Object.hasOwn(base, key)) throw new Error((globalThis.noctuneI18n?.t("language.errors.missingDefaultExtensionMessage") ?? "Missing default extension message"));
            const placeholders = text => [...text.matchAll(/\{\w+\}/g)].map(m => m[0]).sort().join();
            if (placeholders(base[key]) !== placeholders(text)) throw new Error((globalThis.noctuneI18n?.t("language.errors.extensionPlaceholdersDiffer") ?? "Extension placeholders differ"));
        }
    }
    function manifest(input, language, files) {
        const result = JSON.parse(JSON.stringify(input)), bundle = resolve(input.localization, files);
        if (!bundle) return result;
        result.localization = bundle;
        const fallback = bundle.messages[bundle.defaultLocale] || {};
        const messages = bundle.messages[language] || bundle.messages[language?.split('-')[0]] || fallback;
        const translate = value => typeof value === 'string' ? (Object.hasOwn(messages, value) ? messages[value] : Object.hasOwn(fallback, value) ? fallback[value] : value) : value;
        function fields(object, names) { if (object) for (const key of names) if (typeof object[key] === 'string') object[key] = translate(object[key]); }
        fields(result, ['name', 'description']);
        for (const command of result.commands || []) fields(command, ['title']);
        for (const field of Object.values({ ...result.settings, ...result.parameterSchema })) { fields(field, ['label', 'description']); for (const option of field.options || []) fields(option, ['label']); }
        for (const provider of Object.values(result.oauth || {})) fields(provider, ['name']);
        for (const profile of Object.values(result.credentials || {})) fields(profile, ['name', 'description']);
        const panel = result.ui?.integrations;
        fields(panel, ['title', 'description']);
        for (const section of panel?.sections || []) fields(section, ['title']);
        return result;
    }
    return { validate, resolve, manifest };
});
