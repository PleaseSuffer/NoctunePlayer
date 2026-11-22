const install = document.getElementById('install');
const cancel = document.getElementById('cancel');
const consent = document.getElementById('consent');
const status = document.getElementById('status');
let state = 'install', loading = true;
function applyState() {
    install.className = state === 'install' ? 'primary' : state;
    install.textContent = state === 'installed' ? (globalThis.noctuneI18n?.t("addonInstall.app.installed", {}) ?? "Установлено") : state === 'update' ? (globalThis.noctuneI18n?.t("addonStore.refresh", {}) ?? "Обновить") : (globalThis.noctuneI18n?.t("addonInstall.install", {}) ?? "Установить");
    install.disabled = loading || state === 'installed' || !consent.checked;
}
const publisherDetails = document.getElementById('publisher-details');
publisherDetails.classList.add('addon-disclosure');
publisherDetails.querySelector('summary').replaceWith(AddonPermissionView.summary((globalThis.noctuneI18n?.t("addonInstall.publisherKey", {}) ?? "Ключ издателя"), 'KeyRound'));
const text = (id, value) => { document.getElementById(id).textContent = value; };
consent.addEventListener('change', applyState);
cancel.addEventListener('click', () => addonInstaller.cancel());
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !cancel.disabled) addonInstaller.cancel(); });
addonInstaller.details().then(addon => {
    state = addon.state;
    text('badge', state === 'update' ? (globalThis.noctuneI18n?.t("addonInstall.app.update", {}) ?? "Обновление") : state === 'installed' ? (globalThis.noctuneI18n?.t("addonInstall.app.installed", {}) ?? "Установлено") : (globalThis.noctuneI18n?.t("addonInstall.newExtension", {}) ?? "Новое расширение"));
    text('eyebrow', state === 'update' ? (globalThis.noctuneI18n?.t("addonInstall.app.extensionUpdate", {}) ?? "Обновление расширения") : (globalThis.noctuneI18n?.t("addonInstall.installExtension", {}) ?? "Установка расширения"));
    text('name', addon.name); text('description', addon.description);
    const metadata = document.getElementById('metadata');
    for (const [label, value] of [[(globalThis.noctuneI18n?.t("settings.about.author", {}) ?? "Автор"), addon.author], [(globalThis.noctuneI18n?.t("addonInstall.app.version", {}) ?? "Версия"), addon.installedVersion && state === 'update' ? `${addon.installedVersion} → ${addon.version}` : addon.version], [(globalThis.noctuneI18n?.t("addonInstall.app.type", {}) ?? "Тип"), addon.type === 'integration' ? (globalThis.noctuneI18n?.t("addonInstall.app.integration", {}) ?? "Интеграция") : (globalThis.noctuneI18n?.t("addonInstall.app.addOn", {}) ?? "Дополнение")]]) {
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
        const note = document.createElement('p'); note.className = 'permission-description'; note.textContent = (globalThis.noctuneI18n?.t("addonInstall.app.clientSignInTokenServerPermissionsResourceAccess", {p0: (config.clientId), p1: (config.flow), p2: (new URL(config.tokenUrl).origin), p3: (config.scopes.join(', ')), p4: (config.resourceOrigins.join(', '))}) ?? "Клиент: {p0}. Вход: {p1}. Сервер токенов: {p2}. Права: {p3}. Доступ к ресурсам: {p4}.".replace(/\{(p\d+)\}/g, (_, k) => ({p0: (config.clientId), p1: (config.flow), p2: (new URL(config.tokenUrl).origin), p3: (config.scopes.join(', ')), p4: (config.resourceOrigins.join(', '))})[k] ?? "{"+k+"}"));
        item.append(title, note); list.append(item);
    }
    for (const profile of Object.values(addon.credentials || {})) {
        const item=document.createElement('li');item.className='permission';
        const title=document.createElement('strong');title.textContent=(globalThis.noctuneI18n?.t("addonInstall.app.accessKey", {}) ?? "Ключ доступа: ")+profile.name;
        const note=document.createElement('p');note.className='permission-description';note.textContent=(globalThis.noctuneI18n?.t("addonInstall.app.secureInputInNoctuneUseOnlyFor", {}) ?? "Защищённый ввод в Noctune. Использование только для: ")+profile.origins.join(', ')+(globalThis.noctuneI18n?.t("addonInstall.app.theValueIsNotSentDirectlyToTheExtension", {}) ?? ". Значение не передаётся расширению напрямую.");
        item.append(title,note);list.append(item);
    }
    const origins = addon.network?.origins || [];
    document.getElementById('network-section').hidden = !origins.length;
    AddonPermissionView.renderNetwork(document.getElementById('origins'), addon);
    const verified = document.getElementById('verified-publisher');
    verified.hidden = !addon.verifiedPublisher;
    if (addon.verifiedPublisher) { verified.textContent = (globalThis.noctuneI18n?.t("addonInstall.app.officialExtension", {}) ?? "Официальное расширение · ") + addon.verifiedPublisher; verified.prepend(AddonPermissionView.icon('BadgeCheck', 'addon-verified-icon')); }
    text('signature-note', addon.verifiedPublisher ? (globalThis.noctuneI18n?.t("addonInstall.app.noctuneSignatureVerifiedUsingThePublisherKeyBundledWithThePlayer", {}) ?? "Подпись Noctune проверена по ключу издателя, встроенному в плеер.") : addon.signed ? (globalThis.noctuneI18n?.t("extensions.install.signedPackageHint", {}) ?? "Подпись пакета проверена. При первой установке доверие к автору определяете вы.") : (globalThis.noctuneI18n?.t("addonInstall.app.unsignedPackageInstallOnlyIfYouTrustTheSource", {}) ?? "Пакет без подписи. Устанавливайте его, если доверяете источнику."));
    document.getElementById('publisher-details').hidden = !addon.publisher;
    if (addon.publisher) text('publisher', addon.publisher);
    text('activation-note', state === 'install' ? (globalThis.noctuneI18n?.t("extensions.install.enableHint", {}) ?? "После установки расширение появится в настройках. Включите его в карточке, когда будете готовы.") : state === 'update' ? (globalThis.noctuneI18n?.t("extensions.install.updateHint", {}) ?? "Настройки расширения сохранятся. При необходимости вы сможете вернуть предыдущую версию.") : (globalThis.noctuneI18n?.t("addonInstall.app.thisExtensionVersionIsAlreadyInstalled", {}) ?? "Эта версия расширения уже установлена."));
    document.getElementById('consent-row').hidden = state === 'installed';
    text('consent-label', state === 'update' ? (globalThis.noctuneI18n?.t("addonInstall.app.allowTheUpdateWithTheListedAccess", {}) ?? "Разрешить обновление с указанным доступом") : (globalThis.noctuneI18n?.t("addonInstall.iTrustTheAuthorAndAllowTheListedAccess", {}) ?? "Доверяю автору и разрешаю указанный доступ"));
    if (state === 'installed') cancel.textContent = (globalThis.noctuneI18n?.t("player.interface.close", {}) ?? "Закрыть");
    loading = false; consent.disabled = state === 'installed'; applyState();
}).catch(() => { status.textContent = (globalThis.noctuneI18n?.t("addonInstall.app.couldNotReadExtensionDataSelectThePackageAgain", {}) ?? "Не удалось прочитать данные расширения. Выберите пакет снова."); });
install.addEventListener('click', async () => {
    if (loading || !consent.checked || state === 'installed') return;
    loading = true; install.disabled = cancel.disabled = consent.disabled = true;
    install.textContent = state === 'update' ? (globalThis.noctuneI18n?.t("addonInstall.app.updating", {}) ?? "Обновление…") : (globalThis.noctuneI18n?.t("addonInstall.app.installing", {}) ?? "Установка…"); status.textContent = '';
    try {
        const result = await addonInstaller.install();
        if (!result.ok) throw new Error(result.error);
        if (result.installed) { state = 'installed'; cancel.textContent = (globalThis.noctuneI18n?.t("player.interface.close", {}) ?? "Закрыть"); }
    } catch (error) { status.textContent = error.message || (globalThis.noctuneI18n?.t("extensions.installer.couldNotInstallExtension", {}) ?? "Не удалось установить расширение"); }
    finally { loading = false; cancel.disabled = false; consent.disabled = state === 'installed'; applyState(); }
});
