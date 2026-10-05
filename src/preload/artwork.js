'use strict';
function resizeArtwork(picture, nativeImage, size, quality) {
    if (!picture?.data || picture.data.length > 16 * 1024 * 1024) return null;
    try {
        const image = nativeImage.createFromBuffer(Buffer.from(picture.data));
        if (image.isEmpty()) return null;
        return encodeArtwork(image, size, quality);
    } catch (_) { return null; }
}
function encodeArtwork(image, size, quality) {
    try {
        const dimensions = image.getSize();
        if (dimensions.width * dimensions.height > 25000000) return null;
        const scale = Math.min(1, size / Math.max(dimensions.width, dimensions.height));
        const resized = scale < 1 ? image.resize({ width: Math.max(1, Math.round(dimensions.width * scale)), height: Math.max(1, Math.round(dimensions.height * scale)), quality: 'good' }) : image;
        const jpeg = resized.toJPEG(quality);
        if (jpeg.length > (size <= 96 ? 32 * 1024 : 1024 * 1024)) return null;
        return 'data:image/jpeg;base64,' + jpeg.toString('base64');
    } catch (_) { return null; }
}
function createSerialQueue() {
    const jobs = [];
    let running = false;
    async function drain() {
        if (running) return;
        running = true;
        while (jobs.length) {
            const job = jobs.shift();
            try { job.resolve(await job.action()); } catch (error) { job.reject(error); }
        }
        running = false;
    }
    return (action, priority = false) => new Promise((resolve, reject) => {
        const job = { action, resolve, reject };
        if (priority) jobs.unshift(job); else jobs.push(job);
        drain();
    });
}
module.exports = { resizeArtwork, encodeArtwork, createSerialQueue };
