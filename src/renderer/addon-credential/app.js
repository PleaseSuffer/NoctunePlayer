const secret = document.getElementById('secret'), save = document.getElementById('save'), cancel = document.getElementById('cancel');
const expires = document.getElementById('expires'), expiryPreview = document.getElementById('expiry-preview');
let expiryRequest = 0;
expires.addEventListener('input', async () => {
    const request = ++expiryRequest;
    try {
        const result = await credentialDialog.expiry(expires.value.trim() || null);
        if (request !== expiryRequest) return;
        expiryPreview.classList.toggle('invalid', !result.ok);
        if (!result.ok) expiryPreview.textContent = result.error;
        else if (result.expiresAt === null) expiryPreview.textContent = '';
        else {
            const date = new Date(result.expiresAt).toLocaleString(globalThis.noctuneI18n?.locale || 'ru');
            expiryPreview.textContent = globalThis.noctuneI18n?.t('addonCredential.expirationPreview', { date }) ?? 'Noctune перестанет использовать токен: ' + date;
        }
    } catch (_) {
        if (request === expiryRequest) expiryPreview.textContent = globalThis.noctuneI18n?.t('addonCredential.expirationFailed') ?? 'Не удалось рассчитать срок действия.';
    }
});
credentialDialog.details().then(details => {
    document.getElementById('name').textContent = details.addon + ' · ' + details.name;
    document.getElementById('description').textContent = details.description || (globalThis.noctuneI18n?.t("addonCredential.app.configureServiceAccess", {}) ?? "Настройка доступа к сервису");
    const links = document.getElementById('help-links');
    for (const [index, link] of (details.links || []).entries()) {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = link.label; button.title = link.url;
        button.addEventListener('click', async () => {
            button.disabled = true;
            try { await credentialDialog.openLink(index); }
            catch (_) { document.getElementById('error').textContent = globalThis.noctuneI18n?.t('addonCredential.app.couldNotOpenLink') ?? 'Не удалось открыть ссылку в браузере.'; }
            finally { button.disabled = false; }
        });
        links.appendChild(button);
    }
    document.getElementById('origins').textContent = (globalThis.noctuneI18n?.t("addonCredential.app.theKeyWillBeUsedFor", {}) ?? "Ключ будет использоваться для: ") + details.origins.join(', '); secret.focus();
});
document.getElementById('form').addEventListener('submit', async event => {
    event.preventDefault(); save.disabled = cancel.disabled = true;
    try { const result = await credentialDialog.save({value:secret.value,expiresIn:expires.value.trim() || null}); if (result.ok) secret.value = ''; else document.getElementById('error').textContent = result.error || (globalThis.noctuneI18n?.t("addonCredential.app.notSaved", {}) ?? "Сохранение не выполнено"); }
    catch (_) { document.getElementById('error').textContent=(globalThis.noctuneI18n?.t("addonCredential.app.couldNotSaveTheKeyTryAgain", {}) ?? "Не удалось сохранить ключ. Повторите попытку."); }
    finally { save.disabled = cancel.disabled = false; }
});
cancel.addEventListener('click', () => credentialDialog.cancel());
