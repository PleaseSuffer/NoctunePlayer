const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const { AUDIO_EXTENSIONS } = require('./open-audio-files');

const textFields = { title: 'title', artist: 'performers', album: 'album', albumArtist: 'albumArtists', genre: 'genres', comment: 'comment' };
const numberFields = ['year', 'track', 'trackCount', 'disc', 'discCount'];
const listFields = new Set(['artist', 'albumArtist', 'genre']);
function fail(code) { throw Object.assign(new Error(code), { code }); }
function revision(filename) {
  const s = fs.statSync(filename, { bigint: true });
  if (!s.isFile()) fail('unsupported');
  return [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(':');
}
function validatePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) fail('invalid');
  for (const [key, value] of Object.entries(patch)) {
    if (Object.hasOwn(textFields, key)) {
      if (typeof value !== 'string' || value.length > 10000 || value.includes('\0')) fail('invalid');
    } else if (numberFields.includes(key)) {
      if (!Number.isInteger(value) || value < 0 || value > (key === 'year' ? 9999 : 65535)) fail('invalid');
    } else fail('invalid');
  }
}
async function readTags(filename) {
  // Use the same reader as playback, without filename fallbacks or artwork decoding.
  const { parseFile } = await import('music-metadata');
  const { common, format } = await parseFile(filename, { duration: false, skipCovers: true });
  if (!(format.sampleRate > 0) || !(format.numberOfChannels > 0)) fail('unsupported');
  const text = value => String(value || '').replace(/\0+$/, '');
  const list = (values, fallback) => (values || (fallback ? [fallback] : [])).map(text).join('; ');
  return {
    title: text(common.title), artist: list(common.artists, common.artist), album: text(common.album),
    albumArtist: list(common.albumartists, common.albumartist), genre: list(common.genre),
    comment: text(common.comment?.[0]?.text ?? common.comment?.[0]),
    year: common.year || 0, track: common.track.no || 0, trackCount: common.track.of || 0,
    disc: common.disk.no || 0, discCount: common.disk.of || 0,
  };
}
async function operate({ action, filePath, patch, expectedRevision }) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || !AUDIO_EXTENSIONS.has(path.extname(filePath).slice(1).toLowerCase())) fail('unsupported');
  const filename = fs.realpathSync(filePath);
  const before = revision(filename);
  if (action === 'read') {
    const tags = await readTags(filename);
    if (before !== revision(filename)) fail('changed');
    return { tags, revision: before, size: fs.statSync(filename).size };
  }
  if (action !== 'save') fail('invalid');
  validatePatch(patch);
  if (before !== expectedRevision) fail('changed');
  const stat = fs.statSync(filename);
  // Replacing one hard link would silently leave other library entries unchanged.
  if (stat.nlink > 1) fail('linked');
  fs.accessSync(filename, fs.constants.W_OK);
  const temporary = path.join(path.dirname(filename), `.noctune-tags-${randomUUID()}${path.extname(filename)}`);
  try {
    fs.copyFileSync(filename, temporary, fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE);
    const canonical = path.extname(filename).toLowerCase() === '.wav' ? await readTags(temporary) : null;
    const { File, TagTypes } = require('node-taglib-sharp');
    const file = File.createFromPath(temporary);
    try {
      // RIFF IART/IPRD have different mappings in the writer. Seed the canonical
      // artist/album values before it creates ID3, so an unrelated edit cannot
      // turn an artist into an album artist or hide the existing album.
      if (canonical) for (const key of ['artist', 'albumArtist', 'album']) {
        const value = canonical[key];
        file.tag[textFields[key]] = listFields.has(key) ? value.split(';').map(v => v.trim()).filter(Boolean) : value;
      }
      for (const [key, value] of Object.entries(patch)) {
        const field = textFields[key] || key;
        file.tag[field] = listFields.has(key) ? value.split(';').map(v => v.trim()).filter(Boolean) : value;
      }
      if (canonical) {
        const info = file.getTag(TagTypes.RiffInfo, true);
        const values = { ...canonical, ...patch };
        info.setValuesFromStrings('IART', values.artist.split(';').map(v => v.trim()).filter(Boolean));
        info.setValuesFromStrings('IPRD', values.album ? [values.album] : []);
      }
      if (Object.hasOwn(patch, 'comment')) {
        // Vorbis DESCRIPTION and COMMENT are both displayed as comments by the
        // reader; update an existing alias so the old text cannot reappear.
        const xiph = file.getTag(TagTypes.Xiph, false);
        if (xiph?.getField('DESCRIPTION').length) xiph.description = patch.comment;
      }
      file.save();
    } finally { file.dispose(); }
    const tags = await readTags(temporary);
    // Verify the requested values survived the format's writer before replacing anything.
    for (const [key, value] of Object.entries(patch)) {
      const expected = listFields.has(key) ? value.split(';').map(v => v.trim()).filter(Boolean).join('; ') : value;
      if (tags[key] !== expected) fail('unsupported');
    }
    fs.chmodSync(temporary, stat.mode);
    const fd = fs.openSync(temporary, 'r+');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (fs.realpathSync(filePath) !== filename || revision(filename) !== before) fail('changed');
    fs.renameSync(temporary, filename);
    return { tags, revision: revision(filename), size: fs.statSync(filename).size };
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') console.error('Tag temporary cleanup:', error.code); }
  }
}

function runTagOperation(input) {
  return new Promise(resolve => {
    const worker = new Worker(__filename, { workerData: input });
    let answered = false;
    worker.once('message', result => { answered = true; resolve(result); });
    worker.once('error', () => resolve({ ok: false, code: 'failed' }));
    worker.once('exit', () => { if (!answered) resolve({ ok: false, code: 'failed' }); });
  });
}
function registerTagEditor({ ipcMain, getWindow }) {
  const pending = new Set();
  for (const action of ['read', 'save']) ipcMain.handle(`tags:${action}`, async (event, input) => {
    const win = getWindow();
    if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Unavailable for this window');
    if (!input || typeof input.filePath !== 'string') return { ok: false, code: 'invalid' };
    let filename;
    try { filename = await fs.promises.realpath(input.filePath); } catch { return { ok: false, code: 'missing' }; }
    if (pending.has(filename)) return { ok: false, code: 'busy' };
    pending.add(filename);
    try { return await runTagOperation({ ...input, action }); } finally { pending.delete(filename); }
  });
}
if (!isMainThread) {
  operate(workerData).then(result => parentPort.postMessage({ ok: true, ...result })).catch(error => {
    const codes = { ENOENT: 'missing', EACCES: 'permission', EPERM: 'permission', EBUSY: 'busy', ENOSPC: 'space', EROFS: 'permission' };
    parentPort.postMessage({ ok: false, code: codes[error.code] || (['unsupported', 'invalid', 'changed', 'linked'].includes(error.code) ? error.code : 'failed') });
  });
}
module.exports = { runTagOperation, registerTagEditor, validatePatch };
