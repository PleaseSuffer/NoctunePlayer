const https = require('node:https');
const dns = require('node:dns').promises;
const net = require('node:net');
const { allowsOrigin } = require('../../shared/addon-contributions');

const blocked = new net.BlockList();
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]]) blocked.addSubnet(address, prefix, 'ipv4');
function publicAddress(address) {
  if (net.isIP(address) === 4) return !blocked.check(address, 'ipv4');
  // Public IPv6 unicast only; exclude documentation, mapped and transition ranges.
  return net.isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !/^(2001:|2002:|3fff:)/i.test(address);
}
function httpsUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname.includes('*') || url.username || url.password || url.hash || (url.port && url.port !== '443') || url.href.length > 2048) throw new Error('Требуется публичный HTTPS-адрес без пароля и нестандартного порта');
  return url;
}
async function fetchText(value, { limit = 4 * 1024 * 1024, signal, redirects = 3, origins, deadline = Date.now() + 15000, method = 'GET', headers = {}, body, detailed = false, stream = false, headerOrigin, validateUrl } = {}) {
  const url = httpsUrl(value);
  validateUrl?.(url.href, method);
  if (origins && !allowsOrigin(origins, url.origin)) throw new Error('Домен не указан в разрешениях расширения');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (signal?.aborted) throw new Error('Запрос отменён');
  if (Date.now() >= deadline) throw new Error('Сервер не ответил за 15 секунд');
  let addresses;
  if (net.isIP(hostname)) addresses = [{ address: hostname, family: net.isIP(hostname) }];
  else {
    let timer, onAbort;
    try {
      addresses = await Promise.race([
        dns.lookup(hostname, { all: true }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Сервер не ответил за 15 секунд')), Math.max(1, deadline - Date.now()));
          onAbort = () => reject(new Error('Запрос отменён'));
          signal?.addEventListener('abort', onAbort, { once: true });
        }),
      ]);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
  }
  if (!addresses.length || addresses.some(entry => !publicAddress(entry.address))) throw new Error('Локальные и служебные сетевые адреса недоступны');
  if (signal?.aborted) throw new Error('Запрос отменён');
  return new Promise((resolve, reject) => {
    const options = {
      signal,
      method, headers: { 'Accept': '*/*', 'Accept-Encoding': 'identity', ...(headerOrigin && headerOrigin !== url.origin ? {} : headers) },
      // Pin DNS resolution to the checked addresses to prevent rebinding.
      lookup: (_host, options, callback) => options.all ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family),
    };
    const receive = response => {
      const status = response.statusCode;
      if ([301,302,303,307,308].includes(status)) {
        response.resume();
        if (!redirects || !response.headers.location) return reject(new Error('Слишком много перенаправлений'));
        const target = new URL(response.headers.location, url);
        if (target.origin !== url.origin && body !== undefined) { reject(new Error('Перенаправление тела запроса на другой домен запрещено')); return; }
        fetchText(target.href, { limit, signal, redirects: redirects - 1, origins, deadline, method: status === 303 ? 'GET' : method, headers, body: status === 303 ? undefined : body, detailed, stream, headerOrigin: headerOrigin || url.origin, validateUrl }).then(resolve, reject);
        return;
      }
      if (!detailed && (status < 200 || status >= 300)) { response.resume(); reject(new Error(`Сервер вернул HTTP ${status}`)); return; }
      if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') { response.destroy(); reject(new Error('Сжатый ответ не поддерживается')); return; }
      if (stream) { clearTimeout(timer); response.setTimeout(30000, () => response.destroy(new Error('Поток не отвечает'))); resolve(response); return; }
      const chunks = []; let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > limit) { response.destroy(); reject(new Error('Ответ превышает допустимый размер')); }
        else chunks.push(chunk);
      });
      response.on('aborted', () => reject(new Error('Сервер прервал ответ')));
      response.on('error', reject);
      response.on('end', () => resolve(detailed ? { status, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') } : Buffer.concat(chunks).toString('utf8')));
    };
    const request = method === 'GET' && body === undefined ? https.get(url, options, receive) : https.request(url, options, receive);
    if (method !== 'GET' || body !== undefined) request.end(body);
    const timer = setTimeout(() => request.destroy(new Error('Сервер не ответил за 15 секунд')), Math.max(1, deadline - Date.now()));
    request.on('close', () => clearTimeout(timer));
    request.on('error', reject);
  });
}
module.exports = { httpsUrl, publicAddress, fetchText };
