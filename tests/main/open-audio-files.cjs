const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { audioFilesFromArgv, audioOpenRequestFromArgv, createAudioOpenQueue } = require('../../src/main/open-audio-files');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'noctune-open-'));
try {
    const audio = path.join(directory, 'Песня #1 with spaces.MP3');
    fs.writeFileSync(audio, 'test');
    fs.mkdirSync(path.join(directory, 'folder.mp3'));
    const input = ['Noctune', audio, pathToFileURL(audio).href, 'missing.flac', 'folder.mp3', 'document.txt', '--inspect', 'noctune://radio?url=test', 'https://example.com/file.mp3'];
    assert.deepEqual(audioFilesFromArgv(input, { cwd: directory }), [audio]);
    for (const action of ['play', 'new-playlist', 'add-playlist', 'enqueue']) {
        assert.deepEqual(audioOpenRequestFromArgv(['Noctune', '--noctune-action=' + action, '--', audio]), { action, files: [audio] });
    }
    assert.equal(audioOpenRequestFromArgv(['Noctune', '--noctune-action=invalid', audio]), null);
    assert.equal(audioOpenRequestFromArgv(['Noctune', '--', '--noctune-action=enqueue', audio]).action, 'play');
    assert.deepEqual(audioFilesFromArgv(['electron', 'app.mp3', path.basename(audio)], { defaultApp: true, cwd: directory }), [audio]);
    const requests = [];
    const queue = createAudioOpenQueue(files => requests.push(files));
    queue.enqueue([audio]); queue.enqueue([audio, 'second.flac']);
    assert.equal(requests.length, 0, 'cold startup waits for restored renderer');
    queue.setReady(true);
    assert.deepEqual(requests, [[audio, 'second.flac']]);
    queue.enqueue([audio]);
    assert.deepEqual(requests[1], [audio], 'warm startup can reopen the same file');
    queue.setReady(false); queue.enqueue(['reload.wav']);
    assert.equal(requests.length, 2);
    queue.setReady(true);
    assert.deepEqual(requests[2], ['reload.wav']);
    const actions = [];
    const actionQueue = createAudioOpenQueue((files, action) => actions.push({ files, action }));
    actionQueue.enqueue(['a.mp3'], 'enqueue');
    actionQueue.enqueue(['b.mp3'], 'enqueue');
    actionQueue.enqueue(['c.mp3'], 'new-playlist');
    actionQueue.setReady(true);
    assert.deepEqual(actions, [{ files: ['a.mp3', 'b.mp3'], action: 'enqueue' }, { files: ['c.mp3'], action: 'new-playlist' }]);
} finally {
    fs.rmSync(directory, { recursive: true, force: true });
}
console.log('PASS: audio argv, file URIs, spaces, Cyrillic, missing files, directories, deduplication and renderer readiness.');
