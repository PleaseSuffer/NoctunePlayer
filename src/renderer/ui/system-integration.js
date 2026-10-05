(() => {
    const section = document.getElementById('system-integration-settings');
    const register = document.getElementById('btn-register-file-handler');
    const defaults = document.getElementById('btn-default-file-handler');
    const message = document.getElementById('system-integration-message');
    if (!['win32', 'linux'].includes(noctune.platform)) {
        section.hidden = true;
        return;
    }
    register.hidden = noctune.platform !== 'linux';
    defaults.textContent = noctune.platform === 'win32' ? 'Выбрать по умолчанию' : 'Назначить по умолчанию';
    message.textContent = noctune.platform === 'win32'
        ? 'После установки подменю Noctune позволяет воспроизвести треки, открыть новый плейлист, добавить файлы в текущий плейлист или очередь. Выбор плеера по умолчанию выполняется в настройках Windows.'
        : 'Добавьте Noctune в меню «Открыть с помощью» или назначьте его плеером по умолчанию. Для AppImage и распакованной сборки сохраните приложение в постоянной папке.';
    async function apply(action) {
        register.disabled = defaults.disabled = true;
        message.textContent = 'Применение настроек…';
        try {
            const result = await noctune.systemIntegration.apply(action);
            message.textContent = result.message;
            message.style.color = result.ok ? '' : 'var(--accent-color)';
        } catch (_) {
            message.textContent = 'Не удалось применить системные настройки.';
        } finally {
            register.disabled = defaults.disabled = false;
        }
    }
    register.addEventListener('click', () => apply('register'));
    defaults.addEventListener('click', () => apply('default'));
})();
