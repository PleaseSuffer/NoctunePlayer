(() => {
    const section = document.getElementById('system-integration-settings');
    const register = document.getElementById('btn-register-file-handler');
    const defaults = document.getElementById('btn-default-file-handler');
    const message = document.getElementById('system-integration-message');
    if (!['win32', 'linux'].includes(noctune.platform)) {
        section.hidden = true;
        return;
    }
    register.hidden = false;
    defaults.textContent = noctune.platform === 'win32' ? (globalThis.noctuneI18n?.t("settings.general.setAsDefault", {}) ?? "Выбрать по умолчанию") : (globalThis.noctuneI18n?.t("ui.systemIntegration.setAsDefault", {}) ?? "Назначить по умолчанию");
    message.textContent = noctune.platform === 'win32'
        ? (globalThis.noctuneI18n?.t("ui.systemIntegration.onlyNocthemeThemesAreRegisteredAutomaticallyDuringInstallationAddMusicFormatsAndTheNoctuneSubme", {}) ?? "При установке автоматически регистрируются только темы .noctheme. Музыкальные форматы и подменю Noctune добавляются кнопкой ниже. Приложение по умолчанию выбирается в настройках Windows.")
        : (globalThis.noctuneI18n?.t("ui.systemIntegration.onlyNocthemeThemesAreRegisteredAutomaticallyAddMusicFormatsToOpenWithOrSetNoctuneAsTheDefaultKe", {}) ?? "Автоматически регистрируются только темы .noctheme. Добавьте музыкальные форматы в «Открыть с помощью» или назначьте Noctune приложением по умолчанию. Для AppImage и распакованной сборки сохраните приложение в постоянной папке.");
    async function apply(action) {
        register.disabled = defaults.disabled = true;
        message.textContent = (globalThis.noctuneI18n?.t("ui.systemIntegration.applyingSettings", {}) ?? "Применение настроек…");
        try {
            const result = await noctune.systemIntegration.apply(action);
            message.textContent = result.message;
            message.style.color = result.ok ? '' : 'var(--accent-color)';
        } catch (_) {
            message.textContent = (globalThis.noctuneI18n?.t("ui.systemIntegration.couldNotApplySystemSettings", {}) ?? "Не удалось применить системные настройки.");
        } finally {
            register.disabled = defaults.disabled = false;
        }
    }
    register.addEventListener('click', () => apply('register'));
    defaults.addEventListener('click', () => apply('default'));
})();
