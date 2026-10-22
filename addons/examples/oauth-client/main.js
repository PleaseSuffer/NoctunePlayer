NoctuneAddon.define(api => {
    api.onCommand('check-profile', async () => {
        try {
            const status = await api.oauth.status('example-service');
            if (!status.connected) { await api.notify('Войдите в сервис в настройках расширения.'); return; }
            const response = await api.network.request({ url: 'https://api.example.com/me', oauth: 'example-service' });
            if (response.status === 401) { await api.notify('Авторизация отклонена. Войдите снова.'); return; }
            if (response.status === 403) { await api.notify('Недостаточно прав, подписки или доступ ограничен регионом.'); return; }
            if (response.status === 429) { await api.notify('Слишком много запросов. Повторите позже.'); return; }
            if (response.status < 200 || response.status >= 300) throw new Error('HTTP ' + response.status);
            const profile = JSON.parse(response.body);
            await api.notify('Подключён профиль: ' + String(profile.name || profile.id));
        } catch (error) { await api.notify(error.message); }
    });
});
