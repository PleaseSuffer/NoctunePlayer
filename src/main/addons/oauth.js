const crypto = require('node:crypto');
const http = require('node:http');
const { fetchText } = require('./network');
const fingerprint = config => crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex');
function createOAuth({ vault, openExternal, approve, assertActive, fetch = fetchText }) {
  const active = new Map(), refreshes = new Map();
  const key = provider => 'oauth:' + provider;
  async function exchange(config, values, signal) {
    const result = await fetch(config.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values).toString(), detailed: true, signal, limit: 64 * 1024 });
    let data; try { data = JSON.parse(result.body); } catch (_) { throw new Error('Сервис вернул некорректный ответ OAuth'); }
    if (result.status >= 400 || data.error) { const error = new Error('OAuth: ' + String(data.error || 'HTTP ' + result.status).slice(0, 100)); error.code = data.error; throw error; }
    if (typeof data.access_token !== 'string' || !data.access_token || data.access_token.length > 16000 || /[\r\n]/.test(data.access_token) || (data.token_type && data.token_type.toLowerCase() !== 'bearer')) throw new Error('Некорректный токен OAuth');
    return { access: data.access_token, refresh: typeof data.refresh_token === 'string' ? data.refresh_token : null, expires: Number.isFinite(Number(data.expires_in)) ? Date.now() + Math.max(0, Number(data.expires_in)) * 1000 : null, fingerprint: fingerprint(config) };
  }
  async function save(id, hash, provider, token) { await assertActive(id, hash); await vault.set(id, key(provider), token); }
  function cancel(id) { active.get(id)?.abort(); active.delete(id); }
  return {
    cancel,
    async status(id, provider, config) {
      if (!vault.available()) return { connected: false, secureStorage: false };
      const token = await vault.get(id, key(provider));
      return { connected: !!token && token.fingerprint === fingerprint(config), secureStorage: true, expiresAt: token?.expires || null };
    },
    async disconnect(id, provider) { cancel(id); await vault.set(id, key(provider), null); },
    async authorize(id, hash, provider, config, name) {
      if (!vault.available()) throw new Error('Для OAuth требуется защищённое хранилище ОС');
      if (active.has(id)) throw new Error('Вход уже выполняется');
      const controller = new AbortController(); active.set(id, controller);
      const timeout = setTimeout(() => controller.abort(), 5 * 60000);
      let server;
      try {
        if (!await approve(name, config)) throw new Error('Вход отменён пользователем');
        await assertActive(id, hash);
        const verifier = crypto.randomBytes(32).toString('base64url'), state = crypto.randomBytes(32).toString('base64url');
        if (config.flow === 'device_code') {
          const response = await fetch(config.deviceAuthorizationUrl, { method: 'POST', body: new URLSearchParams({ client_id: config.clientId, scope: config.scopes.join(' ') }).toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, detailed: true, signal: controller.signal, limit: 64 * 1024 });
          const device = JSON.parse(response.body);
          if (response.status >= 400 || typeof device.device_code !== 'string' || !device.user_code || !device.verification_uri) throw new Error('Некорректный ответ Device OAuth');
          // Display the code only in the trusted native consent dialog.
          if (!await approve(name, { ...config, deviceCode: String(device.user_code).slice(0, 100), verificationUri: device.verification_uri })) throw new Error('Вход отменён');
          const uri = new URL(device.verification_uri_complete || device.verification_uri);
          if (uri.protocol !== 'https:' || uri.username || uri.password) throw new Error('Небезопасный адрес авторизации');
          await openExternal(uri.href);
          let interval = Math.max(5, Number(device.interval) || 5), deadline = Date.now() + Math.min(300, Number(device.expires_in) || 300) * 1000;
          while (Date.now() < deadline && !controller.signal.aborted) {
            await new Promise((resolve, reject) => { const done = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', abort); }; const abort = () => { done(); reject(new Error('Вход отменён')); }; const timer = setTimeout(() => { done(); resolve(); }, interval * 1000); controller.signal.addEventListener('abort', abort, { once: true }); });
            try { const token = await exchange(config, { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: device.device_code, client_id: config.clientId }, controller.signal); await save(id, hash, provider, token); return { connected: true }; }
            catch (error) { if (error.code === 'slow_down') interval += 5; else if (error.code !== 'authorization_pending') throw error; }
          }
          throw new Error('Время входа истекло');
        }
        const codePromise = new Promise((resolve, reject) => {
          server = http.createServer((req, res) => {
            const callback = new URL(req.url, 'http://127.0.0.1');
            if (req.method !== 'GET' || callback.pathname !== '/callback' || callback.searchParams.get('state') !== state) { res.writeHead(400).end('Invalid OAuth callback'); return; }
            res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
            if (callback.searchParams.has('error') || !callback.searchParams.get('code')) { res.end('Вход отменён. Можно закрыть вкладку.'); reject(new Error('Сервис отклонил вход')); }
            else { res.end('Вход в Noctune завершён. Можно закрыть вкладку.'); resolve(callback.searchParams.get('code')); }
          });
          server.on('error', reject);
          controller.signal.addEventListener('abort', () => reject(new Error('Вход отменён или время ожидания истекло')), { once: true });
        });
        // Attach rejection handling before opening the browser.
        codePromise.catch(() => {});
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.redirectPort || 0, '127.0.0.1', resolve); });
        const redirect = 'http://127.0.0.1:' + server.address().port + '/callback';
        const url = new URL(config.authorizationUrl);
        for (const [k, v] of Object.entries({ ...config.extraParams, response_type: 'code', client_id: config.clientId, redirect_uri: redirect, scope: config.scopes.join(' '), state, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' })) url.searchParams.set(k, v);
        await openExternal(url.href);
        const code = await codePromise;
        const token = await exchange(config, { grant_type: 'authorization_code', client_id: config.clientId, redirect_uri: redirect, code, code_verifier: verifier }, controller.signal);
        await save(id, hash, provider, token); return { connected: true };
      } finally { clearTimeout(timeout); server?.close(); server?.closeAllConnections(); if (active.get(id) === controller) active.delete(id); }
    },
    async token(id, hash, provider, config) {
      let token = await vault.get(id, key(provider));
      if (!token || token.fingerprint !== fingerprint(config)) throw new Error('Требуется вход в сервис');
      if (token.expires && token.expires < Date.now() + 60000) {
        if (!token.refresh) throw new Error('Срок авторизации истёк. Войдите снова');
        const requestKey = id + ':' + provider + ':' + hash;
        if (!refreshes.has(requestKey)) {
          const task = exchange(config, { grant_type: 'refresh_token', refresh_token: token.refresh, client_id: config.clientId }).then(async next => { const latest = await vault.get(id, key(provider)); if (!latest) throw new Error('Авторизация отключена'); if (latest.access !== token.access) return latest; next.refresh ||= token.refresh; await save(id, hash, provider, next); return next; }).catch(async error => { if (error.code === 'invalid_grant' && (await vault.get(id, key(provider)))?.access === token.access) await vault.set(id, key(provider), null); throw error; }).finally(() => refreshes.delete(requestKey));
          refreshes.set(requestKey, task);
        }
        token = await refreshes.get(requestKey);
      }
      await assertActive(id, hash); return token.access;
    },
  };
}
module.exports = { createOAuth };
