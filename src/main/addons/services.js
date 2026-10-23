const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { createVault } = require('./vault');
const { createOAuth } = require('./oauth');
const { fetchText, httpsUrl } = require('./network');
function createAddonServices({ store, directory, safeStorage, shell, clipboard, dialog, getWindow, credentialDialog }) {
  const vault = createVault({ directory, safeStorage }), files = new Map(), streams = new Map();
  const requests = new Map(), artwork = new Map();
  const oauth = createOAuth({ vault, openExternal: url => shell.openExternal(url), assertActive: (id, hash) => store.context(id, hash), approve: async (name, config) => {
    const answer = await dialog.showMessageBox(getWindow(), { type: 'question', title: 'Авторизация расширения', message: `${name}: ${config.name}`, detail: config.deviceCode ? `Код: ${config.deviceCode}\n${config.verificationUri}` : `Сервис: ${new URL(config.tokenUrl).hostname}\nПрава: ${config.scopes.join(', ')}\nВход откроется в системном браузере.`, buttons: ['Продолжить', 'Отмена'], defaultId: 0, cancelId: 1 });
    return answer.response === 0;
  } });
  function cancel(id) {
    oauth.cancel(id); credentialDialog?.cancel(id);
    for (const controller of requests.get(id) || []) controller.abort(); requests.delete(id);
    for (const [key, item] of files) if (item.id === id) files.delete(key);
    for (const [key, item] of streams) if (item.id === id) { item.controller.abort(); streams.delete(key); }
    for (const [key, item] of artwork) if(item.id===id)artwork.delete(key);
  }
  async function resource(id, hash, pkg, input) {
    const url = httpsUrl(input.url), headers = {};
    if (!require('../../shared/addon-contributions').allowsOrigin(pkg.manifest.network?.origins, url.origin)) throw new Error('Домен не разрешён');
    if (input.headers) {
      if (!pkg.grants.includes('network.headers') || typeof input.headers !== 'object' || Object.entries(input.headers).length > 16) throw new Error('Заголовки не разрешены');
      for (const [key, value] of Object.entries(input.headers)) {
        if (!/^[a-z0-9-]{1,64}$/i.test(key) || /^(host|cookie|authorization|proxy-|connection|transfer-encoding|content-length|origin|referer|sec-)/i.test(key) || typeof value !== 'string' || /[\r\n]/.test(value) || value.length > 4000) throw new Error('Недопустимый заголовок');
        headers[key] = value;
      }
    }
    const validateUrl = (value, method) => require('../../shared/addon-contributions').route(pkg.manifest, pkg.grants, value, method);
    validateUrl(url.href, input.method || 'GET');
    if (input.credential) {
      if (!pkg.grants.includes('credentials.use') || input.oauth) throw new Error('Нет права использования профиля');
      const config = Object.hasOwn(pkg.manifest.credentials || {}, input.credential) ? pkg.manifest.credentials[input.credential] : null;
      if (!config?.origins.includes(url.origin)) throw new Error('Профиль не разрешён для домена');
      const item = await vault.get(id, 'credential:' + input.credential);
      if (!item || item.config !== JSON.stringify(config) || (item.expiresAt && item.expiresAt <= Date.now())) throw new Error('Настройте профиль авторизации');
      headers[config.header] = (config.scheme ? config.scheme + ' ' : '') + item.value;
    }
    if (input.oauth) {
      const config = pkg.manifest.oauth?.[input.oauth];
      if (!config?.resourceOrigins.includes(url.origin)) throw new Error('OAuth не разрешён для домена');
      headers.Authorization = 'Bearer ' + await oauth.token(id, hash, input.oauth, config);
    }
    return { url: url.href, headers, origins: pkg.manifest.network.origins, validateUrl, headerOrigin: url.origin };
  }
  async function grantFile(id, hash, filename, write = false) {
    if (files.size >= 256) throw new Error('Слишком много открытых файлов');
    const real = await fs.realpath(filename), stat = await fs.stat(real);
    if (!stat.isFile()) throw new Error('Выберите обычный файл');
    const handle = crypto.randomUUID(); files.set(handle, { id, hash, path: real, dev: stat.dev, ino: stat.ino, write });
    return { handle, name: path.basename(real), size: stat.size };
  }
  async function selected(id, hash, handle, write) {
    const item = files.get(handle);
    if (!item || item.id !== id || item.hash !== hash || (write && !item.write)) throw new Error('Нет доступа к файлу');
    const file = await fs.open(item.path, (write ? constants.O_RDWR : constants.O_RDONLY) | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (stat.dev !== item.dev || stat.ino !== item.ino || !stat.isFile()) { await file.close(); throw new Error('Выбранный файл изменился'); }
    return { item, file, stat };
  }
  return {
    cancel, vault, oauth, grantFile,
    async remove(id) { cancel(id); await vault.remove(id); },
    async invoke(id, hash, method, args = {}) {
      const permission = method.startsWith('credentials.') ? method : { 'settings.get': 'settings.read', 'network.request': 'network.request', 'files.select': 'files.select', 'files.save': 'files.write', 'files.read': 'files.read', 'files.write': 'files.write', 'files.reveal': 'files.reveal', 'system.openFile': 'system.openFile', 'system.openExternal': 'system.openExternal', 'clipboard.read': 'clipboard.read', 'clipboard.write': 'clipboard.write', 'secrets.get': 'secrets.read', 'secrets.set': 'secrets.write', 'secrets.delete': 'secrets.delete', 'oauth.authorize': 'oauth.authorize', 'oauth.status': 'oauth.status', 'oauth.disconnect': 'oauth.disconnect', 'providers.stream': 'providers.play', 'providers.artwork':'catalog.register' }[method];
      const effectivePermission = method === 'artwork.fetch' ? 'artwork.provide' : permission;
      if (!effectivePermission) throw new Error('Неизвестный метод');
      const pkg = await store.context(id, hash, effectivePermission);
      if(method==='providers.artwork'||method==='artwork.fetch') {
        if(!pkg.grants.includes('network.request'))throw new Error('Обложке нужен доступ к сети');
        // Public images only: never forward OAuth, credentials, cookies or caller headers.
        const options=await resource(id,hash,pkg,{url:args.url}),key=id+':'+hash+':'+options.url;
        const cached=artwork.get(key);if(cached&&cached.expires>Date.now())return cached.value;
        const pending=requests.get(id)||new Set();if(pending.size>=3)throw new Error('Не более трёх сетевых запросов');
        const controller=new AbortController();pending.add(controller);requests.set(id,pending);
        let response;
        try {
          response=await fetchText(options.url,{...options,stream:true,detailed:true,signal:controller.signal});
          const mime=String(response.headers['content-type']||'').split(';')[0].trim();
          if(response.statusCode!==200||!/^image\/(png|jpeg|webp|gif|avif)$/.test(mime))throw new Error('Неподдерживаемая обложка');
          const chunks=[];let bytes=0;
          for await(const chunk of response){bytes+=chunk.length;if(bytes>512*1024)throw new Error('Обложка превышает 512 КБ');chunks.push(chunk);}
          await store.context(id,hash,effectivePermission);
          const value='data:'+mime+';base64,'+Buffer.concat(chunks).toString('base64');
          artwork.set(key,{id,value,expires:Date.now()+600000});while(artwork.size>64)artwork.delete(artwork.keys().next().value);
          return value;
        } finally {response?.destroy();pending.delete(controller);if(!pending.size&&requests.get(id)===pending)requests.delete(id);}
      }
      if (method.startsWith('credentials.')) {
        const config = Object.hasOwn(pkg.manifest.credentials || {}, args.profile) ? pkg.manifest.credentials[args.profile] : null;
        if (!config) throw new Error('Неизвестный профиль авторизации');
        const key = 'credential:' + args.profile;
        if (method === 'credentials.status') {
          if (!vault.available()) return { configured: false, secureStorage: false };
          const item = await vault.get(id, key); return { configured: !!item && item.config === JSON.stringify(config) && (!item.expiresAt || item.expiresAt > Date.now()), secureStorage: true, expiresAt:item?.expiresAt||null };
        }
        if (method === 'credentials.disconnect') { await vault.set(id, key, null); return; }
        if (method !== 'credentials.configure' || !credentialDialog || !vault.available()) throw new Error('Защищённый ввод недоступен');
        return credentialDialog.open(id, { addon: pkg.manifest.name, profile:args.profile, ...config }, async ({value,expiresAt}) => { await store.context(id, hash, 'credentials.configure'); await vault.set(id, key, { config: JSON.stringify(config), value, expiresAt }); });
      }
      if (method === 'settings.get') return store.settings(id);
      if (method.startsWith('oauth.')) {
        const config = pkg.manifest.oauth?.[args.provider]; if (!config) throw new Error('Неизвестный OAuth-провайдер');
        if (method === 'oauth.status') return oauth.status(id, args.provider, config);
        if (method === 'oauth.disconnect') return oauth.disconnect(id, args.provider);
        return oauth.authorize(id, hash, args.provider, config, pkg.manifest.name);
      }
      if (method.startsWith('secrets.')) {
        if (typeof args.key !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(args.key)) throw new Error('Некорректный ключ секрета');
        const key = 'user:' + args.key;
        if (method === 'secrets.get') return vault.get(id, key);
        if (method === 'secrets.set' && (typeof args.value !== 'string' || args.value.length > 16000)) throw new Error('Некорректный секрет');
        return vault.set(id, key, method === 'secrets.delete' ? null : args.value);
      }
      if (method === 'network.request') {
        const options = await resource(id, hash, pkg, args), verb = args.method || 'GET';
        if (!['GET','POST','PUT','PATCH','DELETE','HEAD'].includes(verb) || (args.body !== undefined && (typeof args.body !== 'string' || Buffer.byteLength(args.body) > 64 * 1024))) throw new Error('Некорректный запрос');
        const pending = requests.get(id) || new Set(); if (pending.size >= 3) throw new Error('Не более трёх сетевых запросов');
        const controller = new AbortController(); pending.add(controller); requests.set(id, pending);
        let result;
        try { await store.context(id, hash); result = await fetchText(options.url, { ...options, method: verb, body: args.body, detailed: true, signal: controller.signal, limit: 1024 * 1024 }); }
        finally { pending.delete(controller); if (!pending.size && requests.get(id) === pending) requests.delete(id); }
        await store.context(id, hash); return { status: result.status, body: result.body, headers: { 'content-type': result.headers['content-type'] || '', 'retry-after': result.headers['retry-after'] || '' } };
      }
      if (method === 'providers.stream') {
        const options = await resource(id, hash, pkg, args);
        if (!pkg.grants.includes('network.request')) throw new Error('Провайдеру нужен доступ к сети');
        const handle = crypto.randomUUID(), controller = new AbortController();
        for (const [key, item] of streams) if (Date.now() - item.created > 3600000) { item.controller.abort(); streams.delete(key); }
        for (const [key, item] of streams) if (item.id === id && item.hash === hash) { item.controller.abort(); streams.delete(key); }
        if (streams.size >= 64) throw new Error('Слишком много потоков');
        // Store no bearer token: obtain a fresh token when a range request arrives.
        streams.set(handle, { id, hash, input: args, controller, created: Date.now() });
        await store.context(id, hash); return 'noctune-stream://audio/' + handle;
      }
      if (method === 'system.openExternal') { const url = httpsUrl(args.url); await shell.openExternal(url.href); return null; }
      if (method === 'clipboard.read') return clipboard.readText().slice(0, 64 * 1024);
      if (method === 'clipboard.write') { if (typeof args.text !== 'string' || args.text.length > 64 * 1024) throw new Error('Слишком большой текст'); clipboard.writeText(args.text); return null; }
      if (method === 'files.select') {
        const result = await dialog.showOpenDialog(getWindow(), { title: pkg.manifest.name + ': выбрать файл', properties: ['openFile'] });
        await store.context(id, hash); return result.canceled ? null : grantFile(id, hash, result.filePaths[0]);
      }
      if (method === 'files.save') {
        const result = await dialog.showSaveDialog(getWindow(), { title: pkg.manifest.name + ': сохранить файл', defaultPath: 'extension-data.txt' });
        await store.context(id, hash); if (result.canceled) return null;
        const file = await fs.open(result.filePath, 'a', 0o600); await file.close();
        return grantFile(id, hash, result.filePath, true);
      }
      const { item, file, stat } = await selected(id, hash, args.handle, method === 'files.write');
      try {
        if (method === 'files.read') { if (stat.size > 4 * 1024 * 1024) throw new Error('Файл превышает 4 МБ'); const buffer = await file.readFile(); return { encoding: args.encoding === 'base64' ? 'base64' : 'utf8', data: buffer.toString(args.encoding === 'base64' ? 'base64' : 'utf8') }; }
        if (method === 'files.write') { if (typeof args.data !== 'string' || args.data.length > 6 * 1024 * 1024) throw new Error('Файл превышает 4 МБ'); const data = Buffer.from(args.data, args.encoding === 'base64' ? 'base64' : 'utf8'); if (data.length > 4 * 1024 * 1024) throw new Error('Файл превышает 4 МБ'); await file.truncate(0); await file.writeFile(data); return null; }
        if (method === 'files.reveal') { shell.showItemInFolder(item.path); return null; }
        if (!/\.(txt|json|md|png|jpe?g|webp|gif|mp3|flac|ogg|wav|m4a|opus)$/i.test(item.path)) throw new Error('Тип файла не поддерживается для открытия');
        const error = await shell.openPath(item.path); if (error) throw new Error(error); return null;
      } finally { await file.close(); }
    },
    async stream(request) {
      try {
        const url = new URL(request.url), item = streams.get(url.pathname.slice(1));
        if (!item || Date.now() - item.created > 6 * 3600000 || !['GET','HEAD'].includes(request.method)) return new Response('Stream expired', { status: 410 });
        const pkg = await store.context(item.id, item.hash, 'providers.play');
        const options = await resource(item.id, item.hash, pkg, { ...item.input, method: request.method }), range = request.headers.get('range');
        if (range && !/^bytes=\d*-\d*$/.test(range)) return new Response(null, { status: 416 });
        if (range) options.headers.Range = range;
        const response = await fetchText(options.url, { ...options, stream: true, detailed: true, method: request.method, signal: item.controller.signal });
        const headers = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
        for (const key of ['content-type','content-length','content-range','accept-ranges']) if (response.headers[key]) headers[key] = response.headers[key];
        if (![200,206].includes(response.statusCode)) { response.destroy(); return new Response(null, { status: response.statusCode }); }
        if (request.method === 'HEAD') response.resume();
        return new Response(request.method === 'HEAD' ? null : Readable.toWeb(response), { status: response.statusCode, headers });
      } catch (_) { return new Response('Stream unavailable', { status: 502 }); }
    },
  };
}
module.exports = { createAddonServices };
