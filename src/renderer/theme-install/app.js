const install = document.getElementById('install');
const cancel = document.getElementById('cancel');
const status = document.getElementById('status');
let installState = 'install';
function applyInstallState(state) {
    installState = state;
    install.className = state === 'install' ? 'primary' : state;
    install.textContent = state === 'installed' ? (globalThis.noctuneI18n?.t("addonInstall.app.installed", {}) ?? "Установлено") : state === 'update' ? (globalThis.noctuneI18n?.t("addonStore.updatePackage", {}) ?? "Обновить") : (globalThis.noctuneI18n?.t("addonInstall.install", {}) ?? "Установить");
    install.disabled = state === 'installed';
}
cancel.addEventListener('click', () => themeInstaller.cancel());
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !cancel.disabled) themeInstaller.cancel(); });
themeInstaller.details().then(theme => {
    document.getElementById('name').textContent = theme.name;
    document.getElementById('description').textContent = theme.description || (globalThis.noctuneI18n?.t("themeInstall.app.noDescriptionProvided", {}) ?? "Описание не указано");
    const preview = document.getElementById('preview'); preview.src = theme.preview; preview.hidden = false;
    const metadata = document.getElementById('metadata');
    for (const [label, value] of [[(globalThis.noctuneI18n?.t("settings.about.author", {}) ?? "Автор"), theme.author || (globalThis.noctuneI18n?.t("themeInstall.app.notSpecified", {}) ?? "Не указан")], [(globalThis.noctuneI18n?.t("addonInstall.app.version", {}) ?? "Версия"), theme.version], [(globalThis.noctuneI18n?.t("themeInstall.app.sceneSize", {}) ?? "Размер сцены"), `${theme.width} × ${theme.height}`],
        [(globalThis.noctuneI18n?.t("themeInstall.app.capabilities", {}) ?? "Возможности"), [theme.capabilities.motion && (globalThis.noctuneI18n?.t("themeInstall.app.animations", {}) ?? "Анимации"), theme.capabilities.visualizer !== 'none' && (globalThis.noctuneI18n?.t("settings.appearance.visualizer", {}) ?? "Визуализатор")].filter(Boolean).join(' · ') || (globalThis.noctuneI18n?.t("themeInstall.app.staticScene", {}) ?? "Статичная сцена")]]) {
        const term = document.createElement('dt'), detail = document.createElement('dd');
        term.textContent = label; detail.textContent = value; metadata.append(term, detail);
    }
    applyInstallState(theme.installation.state);
}).catch(() => { status.textContent = (globalThis.noctuneI18n?.t("themeInstall.app.couldNotReadThemeData", {}) ?? "Не удалось прочитать данные темы"); });
install.addEventListener('click', async () => {
    install.disabled = cancel.disabled = true; install.textContent = (globalThis.noctuneI18n?.t("addonInstall.app.installing", {}) ?? "Установка…"); status.textContent = '';
    try {
        const result = await themeInstaller.install();
        if (!result.ok) throw new Error(result.error);
        if (result.installed) { applyInstallState('installed'); cancel.disabled = false; }
    } catch (error) {
        status.textContent = error.message || (globalThis.noctuneI18n?.t("themeInstall.app.couldNotInstallTheme", {}) ?? "Не удалось установить тему");
        cancel.disabled = false; applyInstallState(installState);
    }
});
