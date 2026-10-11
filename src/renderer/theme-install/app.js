const install = document.getElementById('install');
const cancel = document.getElementById('cancel');
const status = document.getElementById('status');
let installState = 'install';
function applyInstallState(state) {
    installState = state;
    install.className = state === 'install' ? 'primary' : state;
    install.textContent = state === 'installed' ? 'Установлено' : state === 'update' ? 'Обновить' : 'Установить';
    install.disabled = state === 'installed';
}
cancel.addEventListener('click', () => themeInstaller.cancel());
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !cancel.disabled) themeInstaller.cancel(); });
themeInstaller.details().then(theme => {
    document.getElementById('name').textContent = theme.name;
    document.getElementById('description').textContent = theme.description || 'Описание не указано';
    const preview = document.getElementById('preview'); preview.src = theme.preview; preview.hidden = false;
    const metadata = document.getElementById('metadata');
    for (const [label, value] of [['Автор', theme.author || 'Не указан'], ['Версия', theme.version], ['Размер сцены', `${theme.width} × ${theme.height}`],
        ['Возможности', [theme.capabilities.motion && 'Анимации', theme.capabilities.visualizer !== 'none' && 'Визуализатор'].filter(Boolean).join(' · ') || 'Статичная сцена']]) {
        const term = document.createElement('dt'), detail = document.createElement('dd');
        term.textContent = label; detail.textContent = value; metadata.append(term, detail);
    }
    applyInstallState(theme.installation.state);
}).catch(() => { status.textContent = 'Не удалось прочитать данные темы'; });
install.addEventListener('click', async () => {
    install.disabled = cancel.disabled = true; install.textContent = 'Установка…'; status.textContent = '';
    try {
        const result = await themeInstaller.install();
        if (!result.ok) throw new Error(result.error);
        if (result.installed) { applyInstallState('installed'); cancel.disabled = false; }
    } catch (error) {
        status.textContent = error.message || 'Не удалось установить тему';
        cancel.disabled = false; applyInstallState(installState);
    }
});
