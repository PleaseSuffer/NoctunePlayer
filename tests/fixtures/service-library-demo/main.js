NoctuneAddon.define(async api => {
    const likes = new Set(), dislikes = new Set();
    let current = null;
    api.onCommand('toggle-like', async () => {
        const snapshot = await api.player.current();
        if (!current || snapshot.sessionId !== current.sessionId) throw new Error('Выберите трек сервиса');
        if (likes.has(current.trackId)) likes.delete(current.trackId); else likes.add(current.trackId);
    });
    await api.hotkeys.register({ command: 'toggle-like' });
    async function request(path) {
        const result = await api.network.request({url: 'https://api.service.example' + path, credential: 'demo-token'});
        if (result.status !== 200) throw new Error('Fixture request failed');
        return JSON.parse(result.body);
    }
    const parameter = value => encodeURIComponent(value || '');
    await api.providers.register({
        id: 'demo-audio', name: 'Тестовая медиатека',
        resolve: ({trackId, sessionId}) => { current = { trackId, sessionId }; return {url: 'https://media.service.example/audio/' + parameter(trackId) + '.wav'}; },
        trackActions: ({trackId}) => [
            {id:likes.has(trackId)?'unlike':'like',title:likes.has(trackId)?'Не нравится':'Нравится',icon:'Heart'},
            {id:dislikes.has(trackId)?'undislike':'dislike',title:dislikes.has(trackId)?'Отменить дизлайк':'Дизлайк — реже рекомендовать',icon:'ThumbsDown'}
        ],
        trackAction: ({trackId, action}) => {
            if(action==='like')likes.add(trackId);else if(action==='unlike')likes.delete(trackId);
            else if(action==='dislike')dislikes.add(trackId);else if(action==='undislike')dislikes.delete(trackId);
            else throw new Error('Unknown action');
        }
    });
    await api.catalog.register({
        id: 'demo-library', name: 'Тестовая медиатека', providerId: 'demo-audio', accountId: 'fixture-account',
        browse: ({parent}) => request('/catalog?parent=' + parameter(parent?.id)),
        search: ({query, cursor}) => request('/search?query=' + parameter(query) + '&cursor=' + parameter(cursor)),
        read: ({id, cursor, after}) => request('/playlists/' + parameter(id) + '?cursor=' + parameter(cursor) + '&after=' + parameter(after))
    });
});
