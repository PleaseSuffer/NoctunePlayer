const secret = document.getElementById('secret'), save = document.getElementById('save'), cancel = document.getElementById('cancel');
credentialDialog.details().then(details => {
    document.getElementById('name').textContent = details.addon + ' · ' + details.name;
    document.getElementById('description').textContent = details.description || 'Настройка доступа к сервису';
    document.getElementById('origins').textContent = 'Ключ будет использоваться для: ' + details.origins.join(', '); secret.focus();
});
document.getElementById('form').addEventListener('submit', async event => {
    event.preventDefault(); save.disabled = cancel.disabled = true;
    try { const result = await credentialDialog.save({value:secret.value,expiresAt:document.getElementById('expires').value?new Date(document.getElementById('expires').value).getTime():null}); if (result.ok) secret.value = ''; else document.getElementById('error').textContent = result.error || 'Сохранение не выполнено'; }
    catch (_) { document.getElementById('error').textContent='Не удалось сохранить ключ. Повторите попытку.'; }
    finally { save.disabled = cancel.disabled = false; }
});
cancel.addEventListener('click', () => credentialDialog.cancel());
