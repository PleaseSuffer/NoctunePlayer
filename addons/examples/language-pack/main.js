NoctuneAddon.define(async api => {
    if (api.version !== 2) return;
    await api.i18n.register({
        locale: 'en-GB',
        name: 'English (UK) · SDK example',
        // Unspecified application messages fall back to bundled English.
        messages: JSON.parse(api.readText('locales/en_GB.json')),
    });
});
