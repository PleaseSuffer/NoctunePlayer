const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/renderer/library/drag-drop.js', 'utf8');

(async () => {
    const handlers = {};
    const globalHandlers = {};
    const zone = { dataset: {}, contains: node => node === 'child', addEventListener: (event, callback) => { handlers[event] = callback; } };
    const imports = [];
    const tasks = [];
    const context = {
        userPlaylists: [{ id: 'music', type: 'folder' }, { id: 'radio', type: 'radio' }], currentPlaylistId: 'music', statusText: {},
        document: { getElementById: () => zone, addEventListener: (event, callback) => { globalHandlers[event] = callback; } },
        window: { addEventListener() {} },
        noctune: { getDroppedFilePath: file => file.nativePath || '' },
        queueAudioImport: task => tasks.push(task),
        addFilesToPlaylist: async (paths, id) => imports.push({ paths, id }),
    };
    vm.runInNewContext(source, context);
    function event(types = ['Files']) {
        return { prevented: false, stopped: false, dataTransfer: { types, files: [{ nativePath: '/music/Песня с пробелами.mp3' }, {}] }, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    }
    let drag = event(); handlers.dragover(drag);
    assert(drag.prevented && drag.stopped);
    assert.equal(drag.dataTransfer.dropEffect, 'copy');
    assert.equal(zone.dataset.dropState, 'accept');
    handlers.dragleave({ relatedTarget: 'child' }); assert.equal(zone.dataset.dropState, 'accept');
    let drop = event(); handlers.drop(drop);
    assert(drop.prevented && drop.stopped);
    assert.equal(zone.dataset.dropState, undefined);
    context.currentPlaylistId = 'radio';
    await tasks.shift()();
    assert.equal(imports[0].id, 'music', 'capture target playlist at drop time');
    assert.deepEqual(Array.from(imports[0].paths), ['/music/Песня с пробелами.mp3']);
    drag = event(); handlers.dragover(drag);
    assert.equal(drag.dataTransfer.dropEffect, 'none');
    assert.equal(zone.dataset.dropState, 'reject');
    handlers.drop(event()); assert.equal(tasks.length, 0);
    context.currentPlaylistId = null;
    handlers.drop(event()); assert.equal(tasks.length, 0);
    const text = event(['text/plain']); handlers.drop(text); assert.equal(text.prevented, false);
    const outside = event(); globalHandlers.drop(outside); assert(outside.prevented, 'outside drops cannot navigate Chromium');
    console.log('PASS: file-only drag/drop, copy feedback, native paths, captured destination, radio/empty rejection and navigation prevention.');
})().catch(error => { console.error(error); process.exitCode = 1; });
