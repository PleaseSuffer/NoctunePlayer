NoctuneAddon.define(async api => {
    async function request(path) {
        const result = await api.network.request({url: 'https://api.service.example' + path, credential: 'demo-token'});
        if (result.status !== 200) throw new Error('Fixture request failed');
        return JSON.parse(result.body);
    }
    const parameter = value => encodeURIComponent(value || '');
    await api.providers.register({
        id: 'demo-audio', name: 'Тестовая медиатека',
        resolve: ({trackId}) => ({url: 'https://media.service.example/audio/' + parameter(trackId) + '.wav'})
    });
    await api.catalog.register({
        id: 'demo-library', name: 'Тестовая медиатека', providerId: 'demo-audio', accountId: 'fixture-account',
        browse: ({parent}) => request('/catalog?parent=' + parameter(parent?.id)),
        search: ({query, cursor}) => request('/search?query=' + parameter(query) + '&cursor=' + parameter(cursor)),
        read: ({id, cursor, after}) => request('/playlists/' + parameter(id) + '?cursor=' + parameter(cursor) + '&after=' + parameter(after))
    });
});
