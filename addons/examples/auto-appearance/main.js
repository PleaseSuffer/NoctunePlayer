NoctuneAddon.define(async api => {
    let settings = await api.settings.get(), index = 0, activeSession = null, applied = false;
    api.on('settings.changed', event => { settings = event.values; });
    api.on('track.changed', async event => {
        activeSession = event.sessionId; applied = false;
        if (!settings.enabled || settings.mode !== 'alternate') return;
        const themes = await api.themes.list();
        if (themes.length) {
            // The host rechecks the session when the new scene is ready to be shown.
            try { await api.themes.switch({ id: themes[index++ % themes.length].id, sessionId: event.sessionId }); }
            catch (_) { /* A newer track superseded this request. */ }
        }
    });
    api.on('progress.updated', async event => {
        if (!settings.enabled || event.sessionId !== activeSession || applied || event.position < settings.seconds) return;
        // Set the latch before awaiting: a seek across the threshold triggers once per play session.
        applied = true;
        const level = Math.round(settings.brightness * 255).toString(16).padStart(2, '0');
        try { await api.themes.apply({ sessionId: event.sessionId, palette: { accent: '#' + level + '88ff', gradient: ['#6b44cc', '#9966ff', '#d4aaff'] } }); }
        catch (_) { /* Stale session. */ }
    });
});
