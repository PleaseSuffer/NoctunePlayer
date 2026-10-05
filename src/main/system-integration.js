const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const runFile = promisify(execFile);

const DESKTOP_ID = 'com.noctune.player.desktop';
const AUDIO_MIME_TYPES = [
  'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/vnd.wave',
  'audio/ogg', 'application/ogg', 'audio/mp4', 'audio/x-m4a', 'audio/flac', 'audio/x-flac',
];

function desktopString(value) {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
}

function desktopExecArg(value) {
  // Exec quoting is a separate layer from desktop-entry string escaping.
  return desktopString('"' + value.replace(/[\\"`$]/g, '\\$&').replace(/%/g, '%%') + '"');
}

function linuxDesktopEntry(executable, icon) {
  return '[Desktop Entry]\nType=Application\nName=Noctune\nComment=Music player\n' +
    `Exec=${desktopExecArg(executable)} %F\nIcon=${desktopString(icon)}\n` +
    `Terminal=false\nCategories=AudioVideo;Audio;Player;\nStartupWMClass=com.noctune.player\nMimeType=${AUDIO_MIME_TYPES.join(';')};\n`;
}

function createSystemIntegration({ app, shell, iconPath, platform = process.platform, env = process.env, run = runFile }) {
  async function registerLinux() {
    const dataHome = env.XDG_DATA_HOME && path.isAbsolute(env.XDG_DATA_HOME)
      ? env.XDG_DATA_HOME : path.join(app.getPath('home'), '.local', 'share');
    const applications = path.join(dataHome, 'applications');
    const icons = path.join(dataHome, 'icons', 'hicolor', '512x512', 'apps');
    const executable = env.APPIMAGE || app.getPath('exe');
    if (!path.isAbsolute(executable)) throw new Error('Не удалось определить путь к приложению.');
    const icon = path.join(icons, 'com.noctune.player.png');
    await fs.mkdir(applications, { recursive: true });
    await fs.mkdir(icons, { recursive: true });
    await fs.copyFile(iconPath, icon);
    await fs.writeFile(path.join(applications, DESKTOP_ID), linuxDesktopEntry(executable, icon), 'utf8');
    // Optional utility: desktop environments can read the entry without it.
    await run('update-desktop-database', [applications], { timeout: 10000 }).catch(() => {});
  }

  return {
    async apply(action) {
      try {
        if (!['register', 'default'].includes(action)) throw new Error('Неизвестное действие.');
        if (!app.isPackaged) throw new Error('Системная интеграция доступна в установленной или распакованной сборке приложения.');
        if (platform === 'win32') {
          await shell.openExternal('ms-settings:defaultapps');
          return { ok: true, message: 'Выберите Noctune в приложениях по умолчанию и назначьте нужные аудиоформаты.' };
        }
        if (platform !== 'linux') throw new Error('Эта платформа не поддерживается.');
        await registerLinux();
        if (action === 'register') return { ok: true, message: 'Noctune добавлен в меню «Открыть с помощью».' };
        await run('xdg-mime', ['default', DESKTOP_ID, ...AUDIO_MIME_TYPES], { timeout: 15000 });
        const results = await Promise.all(AUDIO_MIME_TYPES.map(async type => {
          const { stdout } = await run('xdg-mime', ['query', 'default', type], { timeout: 10000 });
          return stdout.trim() === DESKTOP_ID;
        }));
        if (results.some(value => !value)) throw new Error('Окружение рабочего стола не применило все ассоциации. Выберите Noctune через свойства аудиофайла → «Открыть с помощью».');
        return { ok: true, message: 'Noctune назначен плеером по умолчанию для MP3, WAV, OGG, M4A и FLAC.' };
      } catch (error) {
        const message = error.code === 'ENOENT'
          ? 'Не найден xdg-mime. Установите пакет xdg-utils или выберите Noctune через свойства аудиофайла.'
          : error.message;
        return { ok: false, message };
      }
    },
  };
}

module.exports = { DESKTOP_ID, AUDIO_MIME_TYPES, desktopExecArg, linuxDesktopEntry, createSystemIntegration };
