/* Pixel analysis runs once per image, independently of the playback frame loop. */
function analyzeImage(rgba, width, height) {
    const gray = new Uint8Array(width * height);
    const smooth = new Uint8Array(gray.length);
    const data = new Uint8Array(gray.length * 2);
    for (let i = 0; i < gray.length; i++) gray[i] = Math.round(rgba[i * 4] * 0.2126 + rgba[i * 4 + 1] * 0.7152 + rgba[i * 4 + 2] * 0.0722) * rgba[i * 4 + 3] / 255;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        let sum = 0, count = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx >= 0 && xx < width && yy >= 0 && yy < height) { sum += gray[yy * width + xx]; count++; }
        }
        smooth[y * width + x] = sum / count;
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = y * width + x;
        data[i * 2 + 1] = smooth[i];
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) continue;
        const a = i - width, b = i + width;
        const gx = -smooth[a - 1] + smooth[a + 1] - 2 * smooth[i - 1] + 2 * smooth[i + 1] - smooth[b - 1] + smooth[b + 1];
        const gy = -smooth[a - 1] - 2 * smooth[a] - smooth[a + 1] + smooth[b - 1] + 2 * smooth[b] + smooth[b + 1];
        data[i * 2] = Math.min(255, Math.hypot(gx, gy) / 4);
    }
    return data;
}

function thresholdMask(data, sensitivity) {
    const amount = Math.max(1, Math.min(100, Number(sensitivity) || 50));
    const edges = 127 - amount * 1.15;
    const lights = 250 - amount * 1.1;
    const rgba = new Uint8ClampedArray(data.length * 2);
    for (let i = 0; i < data.length / 2; i++) {
        rgba[i * 4] = Math.max(0, Math.min(255, (data[i * 2] - edges) * 4));
        rgba[i * 4 + 1] = Math.max(0, Math.min(255, (data[i * 2 + 1] - lights) * 4));
        rgba[i * 4 + 3] = 255;
    }
    return rgba;
}

if (typeof module !== 'undefined') module.exports = { analyzeImage, thresholdMask };
if (typeof self !== 'undefined') {
    let base = null;
    self.onmessage = async event => {
        const { type, token, sensitivity } = event.data;
        try {
            if (type === 'analyze') {
                const { bitmap } = event.data;
                const { width, height } = bitmap;
                const canvas = new OffscreenCanvas(width, height);
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(bitmap, 0, 0);
                bitmap.close();
                base = { width, height, data: analyzeImage(ctx.getImageData(0, 0, width, height).data, width, height) };
                const data = base.data.slice();
                self.postMessage({ type: 'base', token, width, height, data }, [data.buffer]);
                return;
            }
            if (event.data.base) base = event.data.base;
            if (!base) throw new Error('mask-not-ready');
            const { width, height, data } = base;
            const rgba = thresholdMask(data, sensitivity);
            const sharp = new OffscreenCanvas(width, height);
            sharp.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
            const glow = new OffscreenCanvas(width, height);
            const ctx = glow.getContext('2d');
            ctx.filter = 'blur(5px)';
            ctx.drawImage(sharp, 0, 0);
            const points = [];
            const step = Math.max(1, Math.ceil(Math.sqrt(width * height / 600)));
            for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) {
                let best = -1, strength = 40;
                for (let dy = 0; dy < step && y + dy < height; dy++) for (let dx = 0; dx < step && x + dx < width; dx++) {
                    const i = (y + dy) * width + x + dx;
                    if (rgba[i * 4] > strength) { best = i; strength = rgba[i * 4]; }
                }
                if (best !== -1 && points.length < 600) points.push([(best % width) / width, Math.floor(best / width) / height]);
            }
            const sharpBitmap = sharp.transferToImageBitmap(), glowBitmap = glow.transferToImageBitmap();
            self.postMessage({ type: 'prepared', token, sharp: sharpBitmap, glow: glowBitmap, points }, [sharpBitmap, glowBitmap]);
        } catch (_) { self.postMessage({ type: 'error', token }); }
    };
}
