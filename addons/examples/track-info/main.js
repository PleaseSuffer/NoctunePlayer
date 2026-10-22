NoctuneAddon.define(async api => {
    api.onCommand('show-track', async () => {
        const track = await api.player.current();
        const count = (await api.storage.get('uses') || 0) + 1;
        await api.storage.set('uses', count);
        const title = [track.artist, track.title].filter(Boolean).join(' — ') || 'Трек не выбран';
        await api.notify(`${title} · запусков команды: ${count}`);
    });
});
