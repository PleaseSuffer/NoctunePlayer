const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'm4a', 'flac'];
const AUDIO_OPT_IN = 'AudioFileAssociationsEnabled';
const regString = value => '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

function audioRegistration(executable) {
    if (!path.win32.isAbsolute(executable) || /[\r\n\0]/.test(executable)) throw new Error('Некорректный путь к приложению.');
    const lines = ['Windows Registry Editor Version 5.00', ''];
    const section = (key, values) => {
        lines.push(`[HKEY_CURRENT_USER\\${key}]`);
        for (const [name, value] of values) lines.push(`${name === null ? '@' : regString(name)}=${value}`);
        lines.push('');
    };
    const icon = regString(`"${executable}",0`);
    for (const extension of AUDIO_EXTENSIONS) {
        const progId = `Noctune.Audio.${extension}`;
        const key = `Software\\Classes\\${progId}`;
        section(key, [[null, regString(`Noctune ${extension} audio`)]]);
        section(key + '\\DefaultIcon', [[null, icon]]);
        section(key + '\\shell\\open', [[null, regString('Открыть в Noctune')]]);
        section(key + '\\shell\\open\\command', [[null, regString(`"${executable}" "%1"`)]]);
        section(`Software\\Classes\\.${extension}\\OpenWithProgids`, [[progId, 'hex(0):']]);
        section('Software\\Noctune\\Capabilities\\FileAssociations', [[`.${extension}`, regString(progId)]]);
        const menu = `Software\\Classes\\SystemFileAssociations\\.${extension}\\shell\\Noctune`;
        // Remove the old direct verb before installing the cascading menu.
        lines.push(`[-HKEY_CURRENT_USER\\${menu}]`, '');
        section(menu, [['MUIVerb', regString('Noctune')], ['Icon', icon], ['ExtendedSubCommandsKey', regString('Noctune.Commands')]]);
    }
    for (const [key, label, action] of [
        ['01play', 'Воспроизвести', 'play'], ['02new', 'Открыть в новом плейлисте', 'new-playlist'],
        ['03add', 'Добавить в плейлист', 'add-playlist'], ['04queue', 'Добавить в очередь', 'enqueue'],
    ]) {
        const menu = `Software\\Classes\\Noctune.Commands\\shell\\${key}`;
        section(menu, [['MUIVerb', regString(label)], ['Icon', icon], ['MultiSelectModel', regString('Player')]]);
        section(menu + '\\command', [[null, regString(`"${executable}" --noctune-action=${action} -- "%1"`)]]);
    }
    section('Software\\Noctune\\Capabilities', [['ApplicationName', regString('Noctune')], ['ApplicationDescription', regString('Noctune music player')], ['ApplicationIcon', icon]]);
    section('Software\\RegisteredApplications', [['Noctune', regString('Software\\Noctune\\Capabilities')]]);
    section('Software\\Noctune', [[AUDIO_OPT_IN, 'dword:00000001']]);
    return lines.join('\r\n');
}

async function registerWindowsAudio({ executable, run, env = process.env }) {
    const content = audioRegistration(executable);
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'noctune-audio-'));
    const file = path.join(directory, 'audio.reg');
    try {
        await fs.writeFile(file, Buffer.from('\ufeff' + content, 'utf16le'));
        const system = path.win32.join(env.SystemRoot || process.env.SystemRoot || 'C:\\Windows', 'System32');
        await run(path.win32.join(system, 'reg.exe'), ['import', file, '/reg:64'], { timeout: 15000, windowsHide: true });
        // Notify Explorer without interpolating paths or other user-controlled data.
        await run(path.win32.join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [
            '-NoProfile', '-NonInteractive', '-Command',
            'Add-Type -MemberDefinition \'[System.Runtime.InteropServices.DllImport("shell32.dll")] public static extern void SHChangeNotify(uint e, uint f, System.IntPtr a, System.IntPtr b);\' -Name Shell -Namespace Noctune; [Noctune.Shell]::SHChangeNotify(0x08000000,0,[IntPtr]::Zero,[IntPtr]::Zero)',
        ], { timeout: 10000, windowsHide: true }).catch(() => {});
    } finally {
        await fs.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
        await fs.rmdir(directory);
    }
}

module.exports = { AUDIO_EXTENSIONS, AUDIO_OPT_IN, audioRegistration, registerWindowsAudio };
