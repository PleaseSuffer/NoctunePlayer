// Small generated PCM file: no media downloads or external encoders are needed.
function chunk(id, data) {
    const header = Buffer.alloc(8); header.write(id); header.writeUInt32LE(data.length, 4);
    return Buffer.concat([header, data, Buffer.alloc(data.length % 2)]);
}
function audioFixture(seconds = 2) {
    const format = Buffer.alloc(16);
    format.writeUInt16LE(1, 0); format.writeUInt16LE(1, 2); format.writeUInt32LE(8000, 4);
    format.writeUInt32LE(16000, 8); format.writeUInt16LE(2, 12); format.writeUInt16LE(16, 14);
    const pcm = Buffer.alloc(8000 * seconds * 2);
    for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.round(3000 * Math.sin(2 * Math.PI * 440 * i / 8000)), i * 2);
    const info = chunk('LIST', Buffer.concat([Buffer.from('INFO'), chunk('INAM', Buffer.from('Before edit\0')), chunk('IART', Buffer.from('Artist\0')), chunk('IPRD', Buffer.from('Night sessions\0'))]));
    const body = Buffer.concat([Buffer.from('WAVE'), chunk('fmt ', format), info, chunk('data', pcm)]);
    const header = Buffer.alloc(8); header.write('RIFF'); header.writeUInt32LE(body.length, 4);
    return { buffer: Buffer.concat([header, body]), pcm };
}
function readPcm(buffer) {
    for (let i = 12; i + 8 <= buffer.length;) {
        const size = buffer.readUInt32LE(i + 4);
        if (buffer.toString('ascii', i, i + 4) === 'data') return buffer.subarray(i + 8, i + 8 + size);
        i += 8 + size + size % 2;
    }
    throw Error('Missing PCM chunk');
}
module.exports = { audioFixture, readPcm };
