const install = document.getElementById('install');
const cancel = document.getElementById('cancel');
const consent = document.getElementById('consent');
const status = document.getElementById('status');
let state = 'install', loading = true;
function applyState() {
    install.className = state === 'install' ? 'primary' : state;
    install.textContent = state === 'installed' ? 'Установлено' : state === 'update' ? 'Обновить' : 'Установить';
    install.disabled = loading || state === 'installed' || !consent.checked;
}
const publisherDetails = document.getElementById('publisher-details');
publisherDetails.classList.add('addon-disclosure');
publisherDetails.querySelector('summary').replaceWith(AddonPermissionView.summary('Ключ издателя', 'KeyRound'));
const text = (id, value) => { document.getElementById(id).textContent = value; };
consent.addEventListener('change', applyState);
cancel.addEventListener('click', () => addonInstaller.cancel());
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !cancel.disabled) addonInstaller.cancel(); });
addonInstaller.details().then(addon => {
    state = addon.state;
    text('badge', state === 'update' ? 'Обновление' : state === 'installed' ? 'Установлено' : 'Новое расширение');
    text('eyebrow', state === 'update' ? 'Обновление расширения' : 'Установка расширения');
    text('name', addon.name); text('description', addon.description);
    const metadata = document.getElementById('metadata');
    for (const [label, value] of [['Автор', addon.author], ['Версия', addon.installedVersion && state === 'update' ? `${addon.installedVersion} → ${addon.version}` : addon.version], ['Тип', addon.type === 'integration' ? 'Интеграция' : 'Дополнение']]) {
        const term = document.createElement('dt'), detail = document.createElement('dd');
        term.textContent = label; detail.textContent = value; metadata.append(term, detail);
    }
    const visiblePermissions = addon.grants || AddonPermissions.expand(addon.permissions);
    text('permission-count', String(visiblePermissions.length));
    document.getElementById('no-permissions').hidden = addon.permissions.length !== 0;
    const list = document.getElementById('permissions');
    AddonPermissionView.render(list, addon);
    for (const field of ['icon','banner']) { const image = document.getElementById('addon-' + field); if (addon.artwork?.[field]) { image.src = addon.artwork[field]; image.hidden = false; image.addEventListener('error', () => { image.hidden = true; }); } }
    for (const config of Object.values(addon.oauth || {})) {
        const item = document.createElement('li'); item.className = 'permission';
        const title = document.createElement('strong'); title.textContent = 'OAuth: ' + config.name;
        const note = document.createElement('p'); note.className = 'permission-description'; note.textContent = `Клиент: ${config.clientId}. Вход: ${config.flow}. Сервер токенов: ${new URL(config.tokenUrl).origin}. Права: ${config.scopes.join(', ')}. Доступ к ресурсам: ${config.resourceOrigins.join(', ')}.`;
        item.append(title, note); list.append(item);
    }
    for (const profile of Object.values(addon.credentials || {})) {
        const item=document.createElement('li');item.className='permission';
        const title=document.createElement('strong');title.textContent='Ключ доступа: '+profile.name;
        const note=document.createElement('p');note.className='permission-description';note.textContent='Защищённый ввод в Noctune. Использование только для: '+profile.origins.join(', ')+'. Значение не передаётся расширению напрямую.';
        item.append(title,note);list.append(item);
    }
    for (const route of addon.network?.routes || []) {
        const item=document.createElement('li');item.className='permission';
        const title=document.createElement('strong');title.textContent=route.methods.join(', ')+' '+route.origin+route.path+(route.prefix?'…':'');
        const note=document.createElement('p');note.className='permission-description';note.textContent=route.permission?'Необходимо право ['+route.permission+']':'В рамках разрешённого доступа к сети';item.append(title,note);list.append(item);
    }
    const origins = addon.network?.origins || [];
    document.getElementById('network-section').hidden = !origins.length;
    for (const origin of origins) {
        const item = document.createElement('li'); item.textContent = origin;
        if (state === 'update' && addon.addedOrigins.includes(origin)) {
            const label = document.createElement('span'); label.className = 'new-label'; label.textContent = 'Новый'; item.append(label);
        }
        document.getElementById('origins').append(item);
    }
    const verified = document.getElementById('verified-publisher');
    verified.hidden = !addon.verifiedPublisher;
    if (addon.verifiedPublisher) { verified.textContent = 'Официальное расширение · ' + addon.verifiedPublisher; verified.prepend(AddonPermissionView.icon('BadgeCheck', 'addon-verified-icon')); }
    text('signature-note', addon.verifiedPublisher ? 'Подпись Noctune проверена по ключу издателя, встроенному в плеер.' : addon.signed ? 'Подпись пакета проверена. При первой установке доверие к автору определяете вы.' : 'Пакет без подписи. Устанавливайте его, если доверяете источнику.');
    document.getElementById('publisher-details').hidden = !addon.publisher;
    if (addon.publisher) text('publisher', addon.publisher);
    text('activation-note', state === 'install' ? 'После установки расширение появится в настройках. Включите его в карточке, когда будете готовы.' : state === 'update' ? 'Настройки расширения сохранятся. При необходимости вы сможете вернуть предыдущую версию.' : 'Эта версия расширения уже установлена.');
    document.getElementById('consent-row').hidden = state === 'installed';
    text('consent-label', state === 'update' ? 'Разрешить обновление с указанным доступом' : 'Доверяю автору и разрешаю указанный доступ');
    if (state === 'installed') cancel.textContent = 'Закрыть';
    loading = false; consent.disabled = state === 'installed'; applyState();
}).catch(() => { status.textContent = 'Не удалось прочитать данные расширения. Выберите пакет снова.'; });
install.addEventListener('click', async () => {
    if (loading || !consent.checked || state === 'installed') return;
    loading = true; install.disabled = cancel.disabled = consent.disabled = true;
    install.textContent = state === 'update' ? 'Обновление…' : 'Установка…'; status.textContent = '';
    try {
        const result = await addonInstaller.install();
        if (!result.ok) throw new Error(result.error);
        if (result.installed) { state = 'installed'; cancel.textContent = 'Закрыть'; }
    } catch (error) { status.textContent = error.message || 'Не удалось установить расширение'; }
    finally { loading = false; cancel.disabled = false; consent.disabled = state === 'installed'; applyState(); }
});
