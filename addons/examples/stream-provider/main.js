NoctuneAddon.define(async api => {
    await api.providers.register({
        id: 'public-audio', name: 'Публичное аудио',
        search: async ({ query }) => [{ id: 'example', title: query || 'Пример потока' }],
        async resolve({ trackId, reason }) {
            // A real integration obtains a fresh signed URL on EVERY resolve call.
            // reason === 'refresh' means the previous media URL stopped working.
            const settings = await api.settings.get();
            return { url: settings.url, transport: 'direct' };
            // For service errors return { error: { code: 'REGION_RESTRICTED', message: '...' } }.
        },
    });
    api.onCommand('play-example', async () => {
        try { await api.providers.play('public-audio', { id: 'example', title: 'Пример потока' }); }
        catch (error) { await api.notify(error.message); }
    });
});
