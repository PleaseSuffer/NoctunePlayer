const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac']);
const OPEN_ACTIONS = new Set(['play', 'new-playlist', 'add-playlist', 'enqueue']);

function audioOpenRequestFromArgv(argv, options = {}) {
  let action = 'play';
  for (const arg of argv.slice(options.defaultApp ? 2 : 1)) {
    if (arg === '--') break;
    if (typeof arg === 'string' && arg.startsWith('--noctune-action=')) action = arg.slice('--noctune-action='.length);
  }
  if (!OPEN_ACTIONS.has(action)) return null;
  const files = audioFilesFromArgv(argv, options);
  return files.length ? { action, files } : null;
}

function audioFilesFromArgv(argv, { cwd = process.cwd(), defaultApp = false, isFile = filename => fs.statSync(filename).isFile() } = {}) {
  const files = new Set();
  for (const arg of argv.slice(defaultApp ? 2 : 1)) {
    if (typeof arg !== 'string' || !arg || arg.startsWith('-')) continue;
    try {
      if (/^[a-z][a-z\d+.-]*:\/\//i.test(arg) && !arg.startsWith('file://')) continue;
      const filename = arg.startsWith('file://') ? fileURLToPath(arg) : path.resolve(cwd, arg);
      if (AUDIO_EXTENSIONS.has(path.extname(filename).slice(1).toLowerCase()) && isFile(filename)) files.add(filename);
    } catch (_) { /* Missing files and invalid URIs must not prevent startup. */ }
  }
  return [...files];
}

function createAudioOpenQueue(send, { delay = 0 } = {}) {
  let ready = false;
  let pending = [];
  let timer = null;
  function flush() {
    clearTimeout(timer);
    timer = null;
    if (!ready || pending.length === 0) return;
    const requests = pending;
    pending = [];
    for (const request of requests) send([...new Set(request.files)], request.action);
  }
  return {
    enqueue(files, action = 'play') {
      if (!files.length || !OPEN_ACTIONS.has(action)) return;
      const last = pending.at(-1);
      if (last?.action === action) last.files.push(...files);
      else pending.push({ files: [...files], action });
      if (!ready) return;
      if (!delay) flush();
      else { clearTimeout(timer); timer = setTimeout(flush, delay); }
    },
    setReady(value) { ready = value; flush(); },
  };
}

module.exports = { AUDIO_EXTENSIONS, OPEN_ACTIONS, audioFilesFromArgv, audioOpenRequestFromArgv, createAudioOpenQueue };
