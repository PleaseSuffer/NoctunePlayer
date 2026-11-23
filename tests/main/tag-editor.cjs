const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { audioFixture, readPcm } = require('../helpers/tag-audio.cjs');
const { runTagOperation, registerTagEditor } = require('../../src/main/tag-editor');
const { File, Picture, ByteVector } = require('node-taglib-sharp');
(async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'noctune-tags-'));
    try {
        const filePath = path.join(directory, 'song.wav');
        const fixture = audioFixture();
        fs.writeFileSync(filePath, fixture.buffer);
        const raw = await runTagOperation({ action: 'read', filePath });
        assert.equal(raw.tags.title, 'Before edit', 'RIFF string terminators are excluded from editable text');
        assert.equal(raw.tags.artist, 'Artist');
        const albumArtistOnly = await runTagOperation({ action: 'save', filePath, patch: { albumArtist: 'Various artists' }, expectedRevision: raw.revision });
        assert(albumArtistOnly.ok, JSON.stringify(albumArtistOnly));
        assert.equal(albumArtistOnly.tags.artist, 'Artist', 'editing album artist preserves RIFF track artist');
        assert.equal(albumArtistOnly.tags.album, 'Night sessions', 'editing album artist preserves RIFF album');
        const picture = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64');
        const seeded = File.createFromPath(filePath);
        seeded.tag.pictures = [Picture.fromData(ByteVector.fromByteArray(picture))];
        seeded.tag.copyright = 'Keep copyright'; seeded.tag.comment = 'Keep comment'; seeded.save(); seeded.dispose();
        const read = await runTagOperation({ action: 'read', filePath });
        assert(read.ok); assert.equal(read.tags.title, 'Before edit');
        const patch = { title: 'Ночной трек 日本語 🎵', artist: 'Первый; Second', album: 'Album', albumArtist: 'Band', genre: 'Rock; Jazz', year: 2026, track: 3, trackCount: 12, disc: 1, discCount: 2 };
        const saved = await runTagOperation({ action: 'save', filePath, patch, expectedRevision: read.revision });
        assert(saved.ok, JSON.stringify(saved));
        const { parseFile } = await import('music-metadata');
        const metadata = await parseFile(filePath);
        assert.equal(metadata.common.title, patch.title); assert.equal(metadata.common.album, patch.album);
        assert.equal(metadata.common.year, 2026); assert.equal(metadata.common.track.no, 3); assert.equal(metadata.common.track.of, 12);
        assert.equal(metadata.common.disk.no, 1); assert.equal(metadata.common.disk.of, 2);
        assert.deepEqual(Buffer.from(metadata.common.picture[0].data), picture);
        assert(metadata.common.comment.some(comment => comment.text === 'Keep comment'));
        assert.equal(metadata.common.copyright, 'Keep copyright');
        assert.deepEqual(readPcm(fs.readFileSync(filePath)), fixture.pcm);
        const before = fs.readFileSync(filePath);
        for (const patch of [{ year: -1 }, { title: 1 }, { surprise: 'bad' }, { title: 'nul\0' }]) {
            assert.equal((await runTagOperation({ action: 'save', filePath, patch, expectedRevision: saved.revision })).code, 'invalid');
            assert.deepEqual(fs.readFileSync(filePath), before);
        }
        assert.equal((await runTagOperation({ action: 'save', filePath, patch: { title: 'Stale' }, expectedRevision: read.revision })).code, 'changed');
        assert.deepEqual(fs.readFileSync(filePath), before);
        const cleared = await runTagOperation({ action: 'save', filePath, patch: { title: '', artist: '', year: 0, track: 0 }, expectedRevision: saved.revision });
        assert(cleared.ok); assert.equal(cleared.tags.title, ''); assert.equal(cleared.tags.artist, ''); assert.equal(cleared.tags.year, 0);
        assert.equal((await parseFile(filePath)).common.title, undefined);
        const broken = path.join(directory, 'broken.mp3'); fs.writeFileSync(broken, 'Not an audio file');
        assert.equal((await runTagOperation({ action: 'read', filePath: broken })).ok, false);
        assert.equal(fs.readFileSync(broken, 'utf8'), 'Not an audio file');
        assert.deepEqual(fs.readdirSync(directory).sort(), ['broken.mp3', 'song.wav']);
        const handlers = new Map(); const mainFrame = {}; const webContents = { mainFrame };
        registerTagEditor({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, getWindow: () => ({ webContents }) });
        for (const handler of handlers.values()) {
            await assert.rejects(handler({ sender: {}, senderFrame: mainFrame }, { filePath }));
            await assert.rejects(handler({ sender: webContents, senderFrame: {} }, { filePath }));
        }
        console.log('PASS: tag disk roundtrip with independent parser, Unicode, clearing, PCM/cover/extra-tag preservation, invalid/stale write safety, temporary cleanup and IPC isolation.');
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
