(() => {
    if (!window.packageRemoval) return;
    const api = window.packageRemoval, confirm = document.getElementById('install'), cancel = document.getElementById('cancel'), status = document.getElementById('status');
    const t = (key, fallback) => globalThis.noctuneI18n?.t(key) ?? fallback;
    function label(element, key, fallback) { element.dataset.i18n = key; element.textContent = t(key, fallback); }
    let ready = false, busy = false;
    const initialTheme = new URLSearchParams(location.search).get('kind') === 'theme';
    label(document.querySelector('title'), initialTheme ? 'packageRemoval.themeTitle' : 'packageRemoval.extensionTitle', 'Удаление — Noctune');
    label(document.querySelector('.badge'), 'packageRemoval.badge', 'Удаление');
    label(document.querySelector('.eyebrow'), initialTheme ? 'packageRemoval.themeHeading' : 'packageRemoval.extensionHeading', initialTheme ? 'Удаление темы' : 'Удаление расширения');
    document.querySelector('.details .note').hidden = true;
    document.body.classList.add('package-removal');
    label(confirm, 'player.interface.delete', 'Удалить'); confirm.className = 'danger';
    cancel.addEventListener('click', () => { if (!busy) api.cancel(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !busy) api.cancel(); });
    api.details().then(details => {
        const theme = details.kind === 'theme';
        label(document.querySelector('title'), theme ? 'packageRemoval.themeTitle' : 'packageRemoval.extensionTitle', 'Удаление — Noctune');
        label(document.querySelector('.badge'), 'packageRemoval.badge', 'Удаление');
        label(document.querySelector('.eyebrow'), theme ? 'packageRemoval.themeHeading' : 'packageRemoval.extensionHeading', theme ? 'Удаление темы' : 'Удаление расширения');
        const name = document.getElementById('name'); name.removeAttribute('data-i18n'); name.textContent = details.name;
        document.getElementById('description').textContent = details.description || '';
        const preview = document.getElementById('preview');
        preview.removeAttribute('data-i18n-alt'); preview.alt = details.name;
        if (details.preview) { preview.src = details.preview; preview.hidden = false; }
        if (!theme) document.body.classList.add('removing-extension');
        const metadata = document.getElementById('metadata');
        for (const [key, fallback, value] of [['settings.about.author', 'Автор', details.author], ['addonInstall.app.version', 'Версия', details.version], ...(theme && details.width && details.height ? [['themeInstall.app.sceneSize', 'Размер сцены', `${details.width} × ${details.height}`]] : [])]) {
            if (!value) continue;
            const term = document.createElement('dt'), detail = document.createElement('dd');
            label(term, key, fallback); detail.textContent = value; metadata.append(term, detail);
        }
        label(document.querySelector('.details .note'), theme ? 'addonStore.removeThemeDetail' : 'addonStore.removeExtensionDetail', theme ? 'Тема будет удалена из добавленных. Активная тема будет отключена.' : 'Расширение и его настройки будут удалены.');
        document.querySelector('.details .note').hidden = false;
        ready = true; confirm.disabled = false;
        cancel.focus();
    }).catch(error => { status.textContent = error.message || t('addonStore.removeFailed', 'Не удалось удалить пакет'); });
    confirm.addEventListener('click', async () => {
        if (!ready || busy) return;
        busy = true; confirm.disabled = cancel.disabled = true; status.textContent = '';
        label(confirm, 'packageRemoval.removing', 'Удаление…');
        try {
            const result = await api.confirm();
            if (!result.ok) throw new Error(result.error);
        } catch (error) {
            status.textContent = error.message || t('addonStore.removeFailed', 'Не удалось удалить пакет');
            busy = false; confirm.disabled = cancel.disabled = false; label(confirm, 'player.interface.delete', 'Удалить');
        }
    });
})();
