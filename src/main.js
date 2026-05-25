const { app, BrowserWindow, Menu, Tray, Notification, ipcMain, dialog } = require('electron');
const path = require('path');

app.commandLine.appendSwitch('hardware-media-key-handling');
app.commandLine.appendSwitch('enable-features', 'MediaSessionService');

let win = null;
let splash = null; // Окно загрузки
let tray = null;
let isQuiting = false;

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
    icon: path.join(__dirname, 'app.ico')
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
    minWidth: 1050,
    minHeight: 800,
    show: false,                // прячем до полной загрузки
    backgroundColor: '#121212', // Заменяем белый экран на темно-серый/черный
    icon: path.join(__dirname, 'app.ico'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  Menu.setApplicationMenu(null);
  win.loadFile('index.html');

  

  // Когда HTML полностью готов к отображению
  // Когда HTML полностью готов к отображению
  win.once('ready-to-show', () => {
    // Добавляем задержку в 5000 миллисекунд (5 секунд)
    setTimeout(() => {
      if (splash && !splash.isDestroyed()) {
        splash.close(); // Закрываем лоадер через 5 секунд
      }
      win.show(); // Показываем основное окно
    }, 5000);
  });
  /*
  win.once('ready-to-show', () => {
    if (splash && !splash.isDestroyed()) {
      splash.close(); // Закрываем лоадер
    }
    win.show(); // Показываем основное окно без белых вспышек
  });
  */

  win.webContents.on('did-finish-load', () => {
    const savedPath = store.get('music-directory');
    if (savedPath) {
      win.webContents.send('load-saved-directory', savedPath);
    }
  });

  win.on('close', function (event) {
    if (!isQuiting) {
      event.preventDefault();
      win.hide();

      if (Notification.isSupported()) {
        new Notification({
          title: 'Noctune Player',
          body: 'Приложение свернуто в трей и продолжает работу.',
          icon: path.join(__dirname, 'app.ico')
        }).show();
      }
    }
    return false;
  });
}

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

    const iconPath = path.join(__dirname, 'app.ico');
    tray = new Tray(iconPath);
    
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Развернуть', click: () => win.show() },
      { 
        label: 'Выход', 
        click: () => {
          isQuiting = true;
          app.quit();
        } 
      }
    ]);

    tray.setToolTip('Noctune Player');
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
      win.show();
    });
  });
}