const { app, BrowserWindow, Menu, Tray, Notification, ipcMain, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

const iconPath = path.join(__dirname, '..', 'resources', 'app.ico');

app.commandLine.appendSwitch('hardware-media-key-handling');
app.commandLine.appendSwitch('enable-features', 'MediaSessionService');

let win = null;
let splash = null; // Окно загрузки
let tray = null;
let isQuiting = false;
let minimizeToTray = true; // Управляется из настроек рендерера

let store;

// ── Интеграция: Discord Rich Presence ──────────────────────────────────────
// Подключение к локальному Discord-клиенту живёт в main-процессе (а не в
// рендерере), чтобы переживать перезагрузку страницы и быть единой точкой
// правды для статуса соединения. Рендерер только присылает, что показывать.
let discordRPC = null;            // экземпляр Client из @xhayper/discord-rpc
let discordRPCEnabled = false;    // включена ли интеграция в настройках
let discordRPCClientId = null;    // Application ID текущего подключения
let discordRPCConnected = false;  // подключены ли мы прямо сейчас
let discordRPCReconnectTimer = null;
let discordRPCLastActivity = null; // последняя активность — переотправляем после реконнекта

// ── Deep-link для кнопки «Слушать» радиостанции в Discord Rich Presence ────
// Ссылка вида noctune://radio?name=...&url=... открывает копию плеера у
// друга и запускает у него то же радио (см. SKILL/инструкцию в чате).
const DEEP_LINK_PROTOCOL = 'noctune';
let pendingDeepLink = null;

function parseDeepLinkUrl(rawUrl) {
  try {
    if (!rawUrl || !rawUrl.toLowerCase().startsWith(`${DEEP_LINK_PROTOCOL}://`)) return null;
    const u = new URL(rawUrl);
    if (u.hostname !== 'radio') return null;
    const name = u.searchParams.get('name');
    const url = u.searchParams.get('url');
    if (!url) return null;
    return { name: name ? decodeURIComponent(name) : 'Радиостанция', url };
  } catch (e) {
    return null;
  }
}

function dispatchDeepLink(payload) {
  if (!payload) return;
  if (win && !win.isDestroyed() && win.webContents) {
    win.webContents.send('deep-link-radio', payload);
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  } else {
    // Окно ещё не создано/не загружено — отдадим ссылку сразу после старта
    pendingDeepLink = payload;
  }
}

function handleArgvForDeepLink(argv) {
  for (const arg of argv) {
    const parsed = parseDeepLinkUrl(arg);
    if (parsed) { dispatchDeepLink(parsed); break; }
  }
}

async function initStore() {
  const { default: Store } = await import('electron-store');
  store = new Store();
}

function scheduleDiscordReconnect() {
  if (discordRPCReconnectTimer || !discordRPCEnabled || !discordRPCClientId) return;
  discordRPCReconnectTimer = setTimeout(() => {
    discordRPCReconnectTimer = null;
    if (discordRPCEnabled && discordRPCClientId) connectDiscordRPC(discordRPCClientId);
  }, 15000);
}

async function connectDiscordRPC(clientId) {
  discordRPCEnabled = true;
  discordRPCClientId = clientId;
  if (discordRPCConnected && discordRPC && discordRPC.clientId === clientId) return { ok: true };

  // Если уже было соединение с другим clientId — закрываем перед новым
  if (discordRPC) {
    try { await discordRPC.destroy(); } catch (e) {}
    discordRPC = null;
    discordRPCConnected = false;
  }

  let RPC;
  try {
    RPC = require('@xhayper/discord-rpc');
  } catch (e) {
    return { ok: false, error: 'not-installed' };
  }

  try {
    discordRPC = new RPC.Client({ clientId });

    discordRPC.on('ready', () => {
      discordRPCConnected = true;
      if (win && !win.isDestroyed()) win.webContents.send('discord-rpc-status', { connected: true });
      // Если на момент подключения уже была активность — отправляем её сразу
      if (discordRPCLastActivity) {
        discordRPC.user?.setActivity(discordRPCLastActivity).catch(() => {});
      }
    });

    discordRPC.on('disconnected', () => {
      discordRPCConnected = false;
      if (win && !win.isDestroyed()) win.webContents.send('discord-rpc-status', { connected: false });
      scheduleDiscordReconnect();
    });

    await discordRPC.login();
    return { ok: true };
  } catch (e) {
    discordRPCConnected = false;
    discordRPC = null;
    if (win && !win.isDestroyed()) win.webContents.send('discord-rpc-status', { connected: false, error: String(e && e.message || e) });
    scheduleDiscordReconnect();
    return { ok: false, error: String(e && e.message || e) };
  }
}

async function disconnectDiscordRPC() {
  discordRPCEnabled = false;
  discordRPCClientId = null;
  discordRPCLastActivity = null;
  if (discordRPCReconnectTimer) { clearTimeout(discordRPCReconnectTimer); discordRPCReconnectTimer = null; }
  if (discordRPC) {
    try { await discordRPC.destroy(); } catch (e) {}
  }
  discordRPC = null;
  discordRPCConnected = false;
}

// ── Интеграция: Last.fm (скробблинг) ────────────────────────────────────────
// API key/secret принадлежат самому приложению Noctune (регистрируются один
// раз разработчиком на last.fm/api/account/create), а не отдельному
// пользователю. Каждый пользователь один раз авторизует СВОЙ аккаунт через
// classic desktop-flow: auth.getToken → пользователь подтверждает в браузере
// → auth.getSession отдаёт персональный session key, который живёт бессрочно
// (пока пользователь не отзовёт доступ на last.fm/settings/applications) и
// хранится локально в electron-store.
//
// ЧТОБЫ ФУНКЦИЯ ЗАРАБОТАЛА: зарегистрируйте приложение на
// https://www.last.fm/api/account/create (бесплатно, ~2 минуты, никакого
// review/модерации не требуется) и подставьте выданные API key и
// Shared secret вместо плейсхолдеров ниже.
const LASTFM_API_KEY    = 'ВСТАВЬТЕ_СЮДА_API_KEY';
const LASTFM_API_SECRET = 'ВСТАВЬТЕ_СЮДА_SHARED_SECRET';
const LASTFM_AUTH_ROOT  = 'https://www.last.fm/api/auth/';

let lastfmSessionKey = null;
let lastfmUsername = null;

// Ручной оверрайд ключа/секрета — пользователь может ввести свои в
// настройках (Интеграции → Last.fm → «Ручная настройка»); хранится в том же
// electron-store, что и остальные настройки (через store:set из preload.js),
// поэтому здесь просто читаем его заново на каждый запрос — без кеширования,
// чтобы смена ключа в настройках сразу подхватывалась.
function lastfmActiveCredentials() {
  try {
    if (store && store.get('setting_lastfm_manual') === '1') {
      const key = (store.get('setting_lastfm_manual_key') || '').trim();
      const secret = (store.get('setting_lastfm_manual_secret') || '').trim();
      if (key && secret) return { key, secret };
    }
  } catch (e) {}
  return { key: LASTFM_API_KEY, secret: LASTFM_API_SECRET };
}

function lastfmSign(params) {
  // Подпись = md5(конкатенация "ключ+значение" всех параметров в алфавитном
  // порядке ключей, БЕЗ format/callback, + shared secret) — формат из
  // документации last.fm/api/webauth.
  const { secret } = lastfmActiveCredentials();
  const keys = Object.keys(params).filter(k => k !== 'format' && k !== 'callback').sort();
  let base = '';
  for (const k of keys) base += k + params[k];
  base += secret;
  return require('crypto').createHash('md5').update(base, 'utf8').digest('hex');
}

function lastfmRequest(params, httpMethod = 'GET') {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const querystring = require('querystring');

    const { key } = lastfmActiveCredentials();
    const fullParams = Object.assign({ api_key: key, format: 'json' }, params);
    fullParams.api_sig = lastfmSign(fullParams);
    const body = querystring.stringify(fullParams);

    const options = {
      hostname: 'ws.audioscrobbler.com',
      path: '/2.0/' + (httpMethod === 'GET' ? ('?' + body) : ''),
      method: httpMethod,
      headers: httpMethod === 'POST'
        ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
        : {},
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) reject(new Error(json.message || ('Last.fm error ' + json.error)));
          else resolve(json);
        } catch (e) { reject(new Error('Некорректный ответ Last.fm')); }
      });
    });
    req.on('error', reject);
    if (httpMethod === 'POST') req.write(body);
    req.end();
  });
}

function lastfmLoadSession() {
  lastfmSessionKey = store.get('lastfm_session_key') || null;
  lastfmUsername   = store.get('lastfm_username') || null;
}

async function lastfmBeginAuth() {
  const res = await lastfmRequest({ method: 'auth.getToken' }, 'GET');
  const token = res.token;
  const authUrl = `${LASTFM_AUTH_ROOT}?api_key=${LASTFM_API_KEY}&token=${token}`;
  shell.openExternal(authUrl);
  return { ok: true, token };
}

async function lastfmCompleteAuth(token) {
  // Вызывается после того, как пользователь нажал «Разрешить доступ» в
  // браузере — до этого момента getSession с валидным, но неподтверждённым
  // токеном отвечает ошибкой (это штатно, рендерер это учитывает при опросе).
  const res = await lastfmRequest({ method: 'auth.getSession', token }, 'GET');
  lastfmSessionKey = res.session.key;
  lastfmUsername = res.session.name;
  store.set('lastfm_session_key', lastfmSessionKey);
  store.set('lastfm_username', lastfmUsername);
  return { ok: true, username: lastfmUsername };
}

function lastfmDisconnect() {
  lastfmSessionKey = null;
  lastfmUsername = null;
  store.delete('lastfm_session_key');
  store.delete('lastfm_username');
}

async function lastfmUpdateNowPlaying({ artist, track, album, duration }) {
  if (!lastfmSessionKey) return { ok: false, error: 'not-connected' };
  const params = { method: 'track.updateNowPlaying', artist, track, sk: lastfmSessionKey };
  if (album) params.album = album;
  if (duration) params.duration = String(Math.round(duration));
  try { await lastfmRequest(params, 'POST'); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

async function lastfmScrobble({ artist, track, album, timestamp, duration }) {
  if (!lastfmSessionKey) return { ok: false, error: 'not-connected' };
  const params = { method: 'track.scrobble', artist, track, timestamp: String(timestamp), sk: lastfmSessionKey };
  if (album) params.album = album;
  if (duration) params.duration = String(Math.round(duration));
  try { await lastfmRequest(params, 'POST'); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

function createWindow() {
  // 1. Создаем splash screen (окно загрузки)
  splash = new BrowserWindow({
    width: 400,
    height: 400,
    frame: false,
    transparent: false,
    backgroundColor: '#121212',
    alwaysOnTop: false,
    center: true,
    icon: iconPath,
    resizable: false,
    maximizable: false
  });


  // Загружаем inline HTML с продвинутой Canvas-анимацией (реалистичная черная дыра)
  const splashHTML = `
  <html>
    <head>
      <style>
        body {
          background: #06040a; /* Практически абсолютная чернота космоса */
          margin: 0;
          height: 100vh;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          overflow: hidden;
        }

        /* Контейнер для холста Canvas */
        .canvas-container {
          position: relative;
          width: 250px;
          height: 250px;
          margin-bottom: 20px;
          display: flex;
          justify-content: center;
          align-items: center;
        }

        canvas {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
        }

        /* Тень самой сингулярности поверх холста для идеального стыка */
        .singularity-core {
          position: absolute;
          width: 46px;
          height: 46px;
          background: #000000;
          border-radius: 50%;
          box-shadow: 0 0 15px #000000;
          z-index: 5;
        }

        /* Строка загрузки */
        .loading-status {
          display: flex;
          align-items: center;
          gap: 12px;
          z-index: 10;
          margin-top: 10px;
        }

        .spinner {
          width: 16px;
          height: 16px;
          border: 2px solid rgba(147, 51, 234, 0.15);
          border-radius: 50%;
          border-top-color: #a855f7;
          animation: spin 0.9s linear infinite;
        }

        .text {
          color: #ebdfff;
          font-size: 13px;
          letter-spacing: 2.5px;
          font-weight: 400;
          text-transform: uppercase;
          text-shadow: 0 0 8px rgba(168, 85, 247, 0.4);
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      </style>
    </head>
    <body>
      <div class="canvas-container">
        <canvas id="blackHoleCanvas" width="500" height="500"></canvas>
        <div class="singularity-core"></div>
      </div>

      <div class="loading-status">
        <div class="spinner"></div>
        <div class="text">Noctune Loading...</div>
      </div>

      <script>
        const canvas = document.getElementById('blackHoleCanvas');
        const ctx = canvas.getContext('2d');
        
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        
        // Настройки физики черной дыры
        const particleCount = 1200; // Количество частиц в диске
        const minRadius = 25;       // Горизонт событий (внутренний радиус)
        const maxRadius = 160;      // Граница аккреционного диска
        const particles = [];

        // Палитра частиц (фиолетовые, индиго и редкие неоново-розовые акценты)
        const colors = [
          'rgba(147, 51, 234, ',  // Purple
          'rgba(99, 102, 241, ',  // Indigo
          'rgba(79, 70, 229, ',   // Deep Blue
          'rgba(236, 72, 153, '   // Pink
        ];

        class Particle {
          constructor() {
            this.reset();
            // Случайная начальная фаза, чтобы диск был равномерно заполнен при старте
            this.angle = Math.random() * Math.PI * 2; 
          }

          reset() {
            this.radius = Math.random() * (maxRadius - minRadius) + minRadius;
            this.angle = 0;
            
            // Уменьшили базовый коэффициент с 0.6 до 0.2 (замедление в 3 раза)
            this.speed = (0.2 / Math.pow(this.radius, 0.6)) * (0.8 + Math.random() * 0.4); 
            this.size = Math.random() * 1.5 + 0.5;
            
            // Выбираем цвет
            const colorPicker = Math.random();
            if (colorPicker < 0.5) this.baseColor = colors[0];
            else if (colorPicker < 0.8) this.baseColor = colors[1];
            else if (colorPicker < 0.95) this.baseColor = colors[2];
            else this.baseColor = colors[3];

            // Постепенное угасание к краям
            const distanceRatio = (this.radius - minRadius) / (maxRadius - minRadius);
            this.alpha = distanceRatio < 0.1 ? distanceRatio * 10 : (1 - distanceRatio);
          }

          update() {
            this.angle += this.speed;
            
            // Пропорционально снизили скорость затягивания в центр (0.015)
            this.radius -= this.speed * 0.015; 

            // Если частица пересекла горизонт событий — отправляем её обратно на внешний радиус
            if (this.radius <= minRadius) {
              this.reset();
              this.radius = maxRadius - Math.random() * 20;
            }
          }

          draw() {
            // Искажение орбиты (наклон диска под углом)
            const x = centerX + Math.cos(this.angle) * this.radius;
            const y = centerY + Math.sin(this.angle) * this.radius * 0.65 + (Math.cos(this.angle) * 15);

            ctx.beginPath();
            ctx.arc(x, y, this.size, 0, Math.PI * 2);
            ctx.fillStyle = this.baseColor + this.alpha + ')';
            ctx.fill();
          }
        }

        // Инициализация пула частиц
        for (let i = 0; i < particleCount; i++) {
          particles.push(new Particle());
        }

        // Главный цикл анимации
        function animate() {
          // Увеличили непрозрачность фона очистки холста до 0.35.
          // Так как частицы теперь смещаются на совсем крошечное расстояние за кадр, 
          // старая прозрачность размывала бы их в сплошные статичные линии.
          ctx.fillStyle = 'rgba(6, 4, 10, 0.35)';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          // Свечение самого горизонта событий
          const glow = ctx.createRadialGradient(centerX, centerY, minRadius * 0.8, centerX, centerY, minRadius * 2.5);
          glow.addColorStop(0, 'rgba(0, 0, 0, 1)');
          glow.addColorStop(0.2, 'rgba(147, 51, 234, 0.4)');
          glow.addColorStop(0.5, 'rgba(79, 70, 229, 0.15)');
          glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
          
          ctx.fillStyle = glow;
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          // Обновление и отрисовка частиц
          particles.forEach(p => {
            p.update();
            p.draw();
          });

          requestAnimationFrame(animate);
        }

        animate();
      </script>
    </body>
  </html>
  `;

  splash.loadURL(
    'data:text/html;charset=UTF-8,' + encodeURIComponent(splashHTML),
    { baseURLForDataURL: `file://${__dirname}/` }
  );


  // 2. Создаем основное окно, но НЕ ПОКАЗЫВАЕМ его сразу (show: false)
  win = new BrowserWindow({
    width: 1050,
    height: 800,
    minWidth: 900,
    minHeight: 640,
    show: false,                // прячем до полной загрузки
    backgroundColor: '#121212', // Заменяем белый экран на темно-серый/черный
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // preload.js использует require('fs')/require('path') напрямую
      preload: path.join(__dirname, 'preload.js'),
    }
  });

  Menu.setApplicationMenu(null);
  win.loadFile('src/index.html');

  

  win.once('ready-to-show', () => {
    if (splash && !splash.isDestroyed()) {
      splash.close(); // Закрываем лоадер
    }
    win.show(); // Показываем основное окно без белых вспышек
  });

  win.webContents.on('did-finish-load', () => {
    const savedPath = store.get('music-directory');
    if (savedPath) {
      win.webContents.send('load-saved-directory', savedPath);
    }
    if (pendingDeepLink) {
      win.webContents.send('deep-link-radio', pendingDeepLink);
      pendingDeepLink = null;
    }
  });

  win.on('close', function (event) {
    if (isQuiting) return; // Выход из трея — закрываем без вопросов

    event.preventDefault();

    // Спрашиваем рендерер: играет ли музыка и включено ли сворачивание в трей
    win.webContents.send('query-playing-state');

    ipcMain.once('playing-state-response', (_e, isPlaying, minimizeToTraySetting) => {
      // Настройка из рендерера имеет приоритет (синхронизируем флаг)
      if (typeof minimizeToTraySetting === 'boolean') minimizeToTray = minimizeToTraySetting;

      if (minimizeToTray && isPlaying) {
        // Сворачивание включено и музыка играет — скрываем в трей
        win.hide();
        if (Notification.isSupported()) {
          new Notification({
            title: 'Noctune Player',
            body: 'Приложение свёрнуто в трей и продолжает воспроизведение.',
            icon: iconPath
          }).show();
        }
      } else {
        // Сворачивание выключено, или музыка на паузе — закрываем
        isQuiting = true;
        app.quit();
      }
    });
  });
}

// Получаем изменение настройки "сворачивать в трей" из рендерера
ipcMain.on('setting-minimize-to-tray-changed', (_e, value) => {
    minimizeToTray = value;
});

// ── Автообновления через electron-updater ──────────────────────────────
// Заменяет прежний самописный опрос GitHub API. Публикация релизов должна
// быть настроена через electron-builder (build.publish в package.json) —
// тогда electron-builder сам кладёт latest.yml рядом с установщиком, а
// autoUpdater умеет сравнивать версии, докачивать дельту и запускать
// установку. Сам процесс: main проверяет/качает, о результатах сообщает
// рендереру через события updater:*, рендерер решает, показывать ли toast.
autoUpdater.autoDownload = false;      // по умолчанию — только по клику в toast
autoUpdater.autoInstallOnAppQuit = false;

function sendToRenderer(channel, ...args) {
    if (win && !win.isDestroyed() && win.webContents) {
        win.webContents.send(channel, ...args);
    }
}

autoUpdater.on('checking-for-update', () => sendToRenderer('updater:checking'));
autoUpdater.on('update-available', (info) => sendToRenderer('updater:available', {
    version: info.version, releaseDate: info.releaseDate, releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null
}));
autoUpdater.on('update-not-available', (info) => sendToRenderer('updater:not-available', { version: info && info.version }));
autoUpdater.on('download-progress', (progress) => sendToRenderer('updater:progress', {
    percent: progress.percent, bytesPerSecond: progress.bytesPerSecond, transferred: progress.transferred, total: progress.total
}));
autoUpdater.on('update-downloaded', (info) => sendToRenderer('updater:downloaded', { version: info.version }));
autoUpdater.on('error', (err) => sendToRenderer('updater:error', String(err && err.message || err)));

ipcMain.handle('updater:check', async (_e, silent) => {
    try {
        // Настройка "автоматически скачивать" читается из хранилища перед
        // каждой проверкой — пользователь мог поменять её только что.
        const autoDl = store && store.get('setting_auto_download_updates');
        autoUpdater.autoDownload = autoDl === '1';
        await autoUpdater.checkForUpdates();
        return { ok: true };
    } catch (e) {
        if (!silent) sendToRenderer('updater:error', String(e && e.message || e));
        return { ok: false, error: String(e && e.message || e) };
    }
});

ipcMain.handle('updater:download', async () => {
    try {
        await autoUpdater.downloadUpdate();
        return { ok: true };
    } catch (e) {
        sendToRenderer('updater:error', String(e && e.message || e));
        return { ok: false, error: String(e && e.message || e) };
    }
});

ipcMain.handle('updater:install', () => {
    isQuiting = true;
    autoUpdater.quitAndInstall();
    return { ok: true };
});

// Обработчик для открытия ссылки в браузере по умолчанию
ipcMain.on('open-external-url', (_event, url) => {
    shell.openExternal(url);
});

// Обработчик для открытия ссылки во встроенном браузере
ipcMain.on('open-internal-url', (_event, url) => {
    const browserWin = new BrowserWindow({
        width: 1024,
        height: 768,
        title: url,
        icon: iconPath,
        parent: win,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        }
    });
    browserWin.setMenu(null);
    browserWin.loadURL(url);
    browserWin.webContents.on('page-title-updated', (_e, title) => {
        browserWin.setTitle(title);
    });
});

// Обработчик для получения сохраненного пути
ipcMain.handle('get-saved-directory', () => {
  return store.get('music-directory');
});

ipcMain.handle('dialog:openFiles', async () => {
    const result = await dialog.showOpenDialog(win, {
        properties: ['openFile', 'multiSelections'],
        filters: [
            { name: 'Аудиофайлы', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac'] }
        ]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths;
});

ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory']
    });

    if (result.canceled || result.filePaths.length === 0) {
        return null;
    }

    const dirPath = result.filePaths[0];
    store.set('music-directory', dirPath);
    return dirPath;
});

ipcMain.handle('dialog:openImage', async () => {
    const result = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: [
            { name: 'Изображения и видео', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'mp4', 'webm', 'mkv', 'mov', 'm4v', 'ogv', 'avi'] },
            { name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] },
            { name: 'Видео', extensions: ['mp4', 'webm', 'mkv', 'mov', 'm4v', 'ogv', 'avi'] }
        ]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
});

// ── Импорт/экспорт плейлистов в .m3u ────────────────────────────────────
ipcMain.handle('dialog:openM3U', async () => {
    const result = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: [{ name: 'Плейлисты M3U', extensions: ['m3u', 'm3u8'] }]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
});

ipcMain.handle('dialog:saveM3U', async (_e, defaultName) => {
    const result = await dialog.showSaveDialog(win, {
        defaultPath: (defaultName || 'playlist') + '.m3u',
        filters: [{ name: 'Плейлисты M3U', extensions: ['m3u'] }]
    });
    if (result.canceled || !result.filePath) return null;
    return result.filePath;
});

// ── Хранилище настроек рендерера (electron-store) ──────────────────────
// Единая точка правды: рендерер больше не пишет напрямую в localStorage —
// всё уходит сюда через preload.js, что переживает очистку данных сайта и
// хранится вместе с остальными настройками приложения (userData/config.json).
ipcMain.on('store:get-all-sync', (event) => {
    try {
        event.returnValue = (store && store.store) || {};
    } catch (e) {
        event.returnValue = {};
    }
});

ipcMain.on('store:set', (_e, key, value) => {
    try { if (store) store.set(key, value); } catch (e) {}
});

ipcMain.on('store:delete', (_e, key) => {
    try { if (store) store.delete(key); } catch (e) {}
});

ipcMain.handle('get-app-version', () => {
    return app.getVersion();
});

ipcMain.handle('get-tech-versions', async () => {
    let storeVersion = '—';
    try {
        const pkg = require(require('path').join(__dirname, '..', 'node_modules', 'electron-store', 'package.json'));
        storeVersion = pkg.version;
    } catch(e) {}
    return {
        electron: process.versions.electron,
        node: process.versions.node,
        chrome: process.versions.chrome,
        electronStore: storeVersion,
    };
});

// Проверка обновлений из трея — с уведомлением о результате через
// electron-updater; те же события updater:* заодно долетают и до окна
// (если оно открыто), так что в приложении тоже появится toast.
function performTrayUpdateCheck() {
    if (Notification.isSupported()) {
        new Notification({
            title: 'Noctune Player',
            body: 'Проверяем наличие обновлений...',
            icon: iconPath
        }).show();
    }

    const onAvailable = (info) => {
        cleanup();
        if (!Notification.isSupported()) return;
        const notif = new Notification({
            title: 'Доступно обновление!',
            body: `Версия ${info.version} доступна. Нажмите, чтобы открыть Noctune и скачать.`,
            icon: iconPath
        });
        notif.on('click', () => { if (win) { win.show(); win.focus(); } });
        notif.show();
    };
    const onNotAvailable = () => {
        cleanup();
        if (Notification.isSupported()) {
            new Notification({
                title: 'Noctune Player',
                body: `У вас установлена актуальная версия (v${app.getVersion()}).`,
                icon: iconPath
            }).show();
        }
    };
    const onError = () => {
        cleanup();
        if (Notification.isSupported()) {
            new Notification({
                title: 'Noctune Player',
                body: 'Не удалось проверить обновления. Проверьте подключение к сети.',
                icon: iconPath
            }).show();
        }
    };
    function cleanup() {
        autoUpdater.removeListener('update-available', onAvailable);
        autoUpdater.removeListener('update-not-available', onNotAvailable);
        autoUpdater.removeListener('error', onError);
    }
    autoUpdater.once('update-available', onAvailable);
    autoUpdater.once('update-not-available', onNotAvailable);
    autoUpdater.once('error', onError);

    autoUpdater.checkForUpdates().catch(() => onError());
}

ipcMain.on('tray-check-updates', performTrayUpdateCheck);

// ── Интеграция: Discord Rich Presence — IPC ──────────────────────────────
ipcMain.handle('discord-rpc-connect', async (_e, clientId) => {
    if (!clientId) return { ok: false, error: 'no-client-id' };
    return connectDiscordRPC(clientId);
});

ipcMain.handle('discord-rpc-disconnect', async () => {
    await disconnectDiscordRPC();
    return { ok: true };
});

ipcMain.handle('discord-rpc-status', () => {
    return { connected: discordRPCConnected, enabled: discordRPCEnabled };
});

// ── Интеграция: Last.fm — IPC ────────────────────────────────────────────
ipcMain.handle('lastfm-begin-auth', async () => {
    try { return await lastfmBeginAuth(); }
    catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});
ipcMain.handle('lastfm-complete-auth', async (_e, token) => {
    try { return await lastfmCompleteAuth(token); }
    catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});
ipcMain.handle('lastfm-disconnect', () => {
    lastfmDisconnect();
    return { ok: true };
});
ipcMain.handle('lastfm-status', () => ({ connected: !!lastfmSessionKey, username: lastfmUsername }));
ipcMain.handle('lastfm-now-playing', (_e, payload) => lastfmUpdateNowPlaying(payload || {}));
ipcMain.handle('lastfm-scrobble', (_e, payload) => lastfmScrobble(payload || {}));

ipcMain.on('discord-rpc-set-activity', (_e, activity) => {
    discordRPCLastActivity = activity || null;
    if (!discordRPC || !discordRPCConnected || !activity) return;
    discordRPC.user?.setActivity(activity).catch(() => {});
});

ipcMain.on('discord-rpc-clear-activity', () => {
    discordRPCLastActivity = null;
    if (!discordRPC || !discordRPCConnected) return;
    discordRPC.user?.clearActivity().catch(() => {});
});

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
    handleArgvForDeepLink(commandLine);
  });

  // macOS отдаёт кастомные ссылки через отдельное событие, а не argv
  app.on('open-url', (event, url) => {
    event.preventDefault();
    const parsed = parseDeepLinkUrl(url);
    if (parsed) dispatchDeepLink(parsed);
  });

  // Регистрируем noctune:// как протокол, обрабатываемый этим приложением —
  // тогда кнопка «Слушать» в Discord Rich Presence (см. интеграцию выше)
  // открывает именно копию плеера, а не браузер.
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
    }
  } else {
    app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL);
  }

  // Chromium буферизует записи localStorage и не всегда успевает сбросить их
  // на диск перед завершением процесса. Из-за этого настройка, изменённая
  // непосредственно перед закрытием приложения (например, переключатель
  // "Восстанавливать воспроизведение"), могла теряться. Принудительно
  // дописываем localStorage на диск перед любым выходом из приложения.
  app.on('before-quit', () => {
    try {
      if (win && !win.isDestroyed()) {
        win.webContents.session.flushStorageData();
      }
    } catch (e) {}
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('Noctune');
    initStore().then(() => {
      console.log('Store инициализирован');
      lastfmLoadSession();
    });
    createWindow();
    handleArgvForDeepLink(process.argv);

    tray = new Tray(iconPath);

    // Состояние воспроизведения для отображения в трее
    let trayIsPlaying = false;
    let trayTrackTitle = 'Ничего не играет';
    let trayPrevEnabled = false;
    let trayNextEnabled = false;

    function buildTrayMenu() {
      const visible = win.isVisible();
      return Menu.buildFromTemplate([
        {
          label: visible ? 'Свернуть' : 'Развернуть',
          click: () => { if (visible) { win.hide(); } else { win.show(); win.focus(); } }
        },
        { type: 'separator' },
        { type: 'separator' },
        {
          label: 'Воспроизведение',
          sublabel: trayTrackTitle,
          submenu: [
            {
              label: trayIsPlaying ? 'Пауза' : 'Воспроизвести',
              click: () => win.webContents.send('tray-cmd', 'toggle')
            },
            { type: 'separator' },
            {
              label: 'Следующая песня',
              enabled: trayNextEnabled,
              click: () => win.webContents.send('tray-cmd', 'next')
            },
            {
              label: 'Предыдущая песня',
              enabled: trayPrevEnabled,
              click: () => win.webContents.send('tray-cmd', 'prev')
            },
          ]
        },
        { type: 'separator' },
        {
          label: 'О приложении',
          submenu: [
            { label: 'Noctune Player v' + app.getVersion(), enabled: false },
            { label: 'Проверить обновления', click: () => performTrayUpdateCheck() },
            { label: 'GitHub', click: () => shell.openExternal('https://github.com/PleaseSuffer/NoctunePlayer') },
          ]
        },
        { type: 'separator' },
        {
          label: 'Закрыть приложение',
          click: () => { isQuiting = true; app.quit(); }
        }
      ]);
    }

    function refreshTrayMenu() {
      tray.setContextMenu(buildTrayMenu());
    }

    // Обновление состояния трея из рендерера
    ipcMain.on('tray-state-update', (_e, state) => {
      if (typeof state.isPlaying === 'boolean') trayIsPlaying = state.isPlaying;
      if (state.trackTitle) trayTrackTitle = state.trackTitle;
      if (typeof state.prevEnabled === 'boolean') trayPrevEnabled = state.prevEnabled;
      if (typeof state.nextEnabled === 'boolean') trayNextEnabled = state.nextEnabled;
      refreshTrayMenu();
    });

    tray.setToolTip('Noctune Player');
    refreshTrayMenu();

    // Обновляем метку при смене видимости окна
    win.on('show', refreshTrayMenu);
    win.on('hide', refreshTrayMenu);

    // Сигнализируем рендереру о видимости окна, чтобы он мог поставить на
    // паузу requestAnimationFrame-циклы (визуализатор, звёзды, конфетти, фон)
    // пока плеер свёрнут в трей и не тратить CPU/GPU впустую.
    win.on('show', () => sendToRenderer('window-tray-visibility', true));
    win.on('hide', () => sendToRenderer('window-tray-visibility', false));

    tray.on('click', () => {
      if (win.isVisible()) { win.focus(); } else { win.show(); win.focus(); }
      refreshTrayMenu();
    });
  });
}