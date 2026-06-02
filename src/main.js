const { app, BrowserWindow, Menu, Tray, Notification, ipcMain, dialog, net } = require('electron');
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

async function initStore() {
  const { default: Store } = await import('electron-store');
  store = new Store();
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
    icon: iconPath
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
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  Menu.setApplicationMenu(null);
  win.loadFile('src/index.html');

  

  // Когда HTML полностью готов к отображению
  /*
  win.once('ready-to-show', () => {
    // Добавляем задержку в 5000 миллисекунд (5 секунд)
    setTimeout(() => {
      if (splash && !splash.isDestroyed()) {
        splash.close(); // Закрываем лоадер через 5 секунд
      }
      win.show(); // Показываем основное окно
    }, 5000);
  });
  */
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

// Обработчик проверки обновлений
ipcMain.handle('check-for-updates', async () => {
    return new Promise((resolve) => {
        const currentVersion = app.getVersion(); // Получает версию из package.json

        // Делаем запрос к публичному GitHub API для получения последнего релиза
        const request = net.request({
            method: 'GET',
            protocol: 'https:',
            hostname: 'api.github.com',
            port: 443,
            path: '/repos/PleaseSuffer/NoctunePlayer/releases/latest',
        });

        // GitHub API требует обязательного указания User-Agent
        request.setHeader('User-Agent', 'NoctunePlayer');

        request.on('response', (response) => {
            let body = '';
            
            response.on('data', (chunk) => {
                body += chunk.toString();
            });

            response.on('end', () => {
                if (response.statusCode !== 200) {
                    resolve({ success: false, error: `Сервер ответил кодом ${response.statusCode}` });
                    return;
                }

                try {
                    const data = JSON.parse(body);
                    // Очищаем тег от префикса 'v', если он есть (например, v1.0.1 -> 1.0.1)
                    const latestVersion = data.tag_name.replace(/^v/, '');
                    const cleanCurrentVersion = currentVersion.replace(/^v/, '');

                    // Сравниваем версии напрямую
                    const hasUpdate = latestVersion !== cleanCurrentVersion;

                    resolve({
                        success: true,
                        currentVersion,
                        latestVersion: data.tag_name,
                        hasUpdate,
                        updateUrl: data.html_url // Ссылка на страницу релиза на GitHub
                    });
                } catch (e) {
                    resolve({ success: false, error: 'Ошибка обработки данных от сервера' });
                }
            });
        });

        request.on('error', (err) => {
            resolve({ success: false, error: 'Нет подключения к сети или сервер недоступен' });
        });

        request.end();
    });
});

// Обработчик для открытия ссылки в браузере по умолчанию
/*
ipcMain.on('open-external-url', (event, url) => {
    const { shell } = require('electron');
    shell.openExternal(url);
});
*/

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

// Проверка обновлений из трея — с уведомлением о результате
ipcMain.on('tray-check-updates', async () => {
    if (Notification.isSupported()) {
        new Notification({
            title: 'Noctune Player',
            body: 'Проверяем наличие обновлений...',
            icon: iconPath
        }).show();
    }

    try {
        // Переиспользуем ту же логику что и в рендерере
        const result = await new Promise((resolve) => {
            const currentVersion = app.getVersion();
            const request = net.request({
                method: 'GET', protocol: 'https:',
                hostname: 'api.github.com', port: 443,
                path: '/repos/PleaseSuffer/NoctunePlayer/releases/latest',
            });
            request.setHeader('User-Agent', 'NoctunePlayer');
            request.on('response', (response) => {
                let body = '';
                response.on('data', (chunk) => { body += chunk.toString(); });
                response.on('end', () => {
                    if (response.statusCode !== 200) {
                        resolve({ success: false }); return;
                    }
                    try {
                        const data = JSON.parse(body);
                        const latestVersion = data.tag_name.replace(/^v/, '');
                        const cleanCurrent = currentVersion.replace(/^v/, '');
                        resolve({
                            success: true,
                            hasUpdate: latestVersion !== cleanCurrent,
                            latestVersion: data.tag_name,
                            currentVersion,
                            updateUrl: data.html_url
                        });
                    } catch(e) { resolve({ success: false }); }
                });
            });
            request.on('error', () => resolve({ success: false }));
            request.end();
        });

        if (!Notification.isSupported()) return;

        if (!result.success) {
            new Notification({
                title: 'Noctune Player',
                body: 'Не удалось проверить обновления. Проверьте подключение к сети.',
                icon: iconPath
            }).show();
        } else if (result.hasUpdate) {
            const notif = new Notification({
                title: 'Доступно обновление!',
                body: `Версия ${result.latestVersion} доступна (у вас v${result.currentVersion}). Нажмите чтобы открыть страницу загрузки.`,
                icon: iconPath
            });
            notif.on('click', () => {
                require('electron').shell.openExternal(result.updateUrl);
            });
            notif.show();
        } else {
            new Notification({
                title: 'Noctune Player',
                body: `У вас установлена актуальная версия (v${result.currentVersion}).`,
                icon: iconPath
            }).show();
        }
    } catch(e) {
        if (Notification.isSupported()) {
            new Notification({
                title: 'Noctune Player',
                body: 'Ошибка при проверке обновлений.',
                icon: iconPath
            }).show();
        }
    }
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
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('Noctune');
    initStore().then(() => {
      console.log('Store инициализирован');
    });
    createWindow();

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
            { label: 'GitHub', click: () => require('electron').shell.openExternal('https://github.com/PleaseSuffer/NoctunePlayer') },
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

    tray.on('click', () => {
      if (win.isVisible()) { win.focus(); } else { win.show(); win.focus(); }
      refreshTrayMenu();
    });
  });
}