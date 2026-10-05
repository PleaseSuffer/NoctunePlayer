const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/renderer/effects/visualizer.js', 'utf8');
const draw = source.slice(source.indexOf('            ctx.clearRect(0, 0, canvas.clientWidth'), source.indexOf("            } else if (style === 'fireworks')")) + '\n}\n';
const window = {};
let accent = '#abcdef';
let rectangles = [], paints = [], gradients = [], points = [], dots = [], strokes = 0;
const ctx = {
    clearRect() {}, save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo(x,y) { points.push([x,y]); }, lineTo(x,y) { points.push([x,y]); }, quadraticCurveTo() {}, arc(...args) { dots.push(args); },
    roundRect(...args) { rectangles.push(args); }, fillRect() { paints.push(this.fillStyle); },
    fill() { paints.push(this.fillStyle); }, stroke() { paints.push(this.strokeStyle); strokes++; },
    createLinearGradient(...axis) { const gradient = { axis, stops:[], addColorStop(p,c) { this.stops.push([p,c]); } }; gradients.push(gradient); return gradient; }
};
const context = { window, ctx, canvas:{ clientWidth:800, clientHeight:600 }, bufferLength:256, dataArray:new Uint8Array(256).fill(128),
    analyzer:{ fftSize:256, getByteTimeDomainData(array) { array.fill(140); } }, performance:{ now:() => 1000 },
    document:{ documentElement:{} }, getComputedStyle:() => ({ getPropertyValue:() => accent }) };
vm.createContext(context);
function render(style, mode) {
    rectangles = []; paints = []; gradients = []; points = []; dots = []; strokes = 0;
    window.vizStyle = style; window.vizColorMode = mode; window.vizCustomColor = '#123456';
    vm.runInContext('(function(){' + draw + '})()', context);
}
for (const style of ['circle-smooth', 'circle-lines', 'circle-dots', 'circle-double', 'bars-bottom', 'bars-center', 'bars-top', 'waveform']) {
    render(style, 'custom');
    assert.ok(paints.length > 0, style);
    assert.ok(paints.every(p => p === '#123456'), `${style}: custom color applies to every element, including peaks`);
    assert.equal(gradients.length, 0, 'solid modes do not allocate gradients');
    render(style, 'accent'); assert.ok(paints.every(p => p === accent));
    accent = '#654321'; render(style, 'accent'); assert.ok(paints.every(p => p === accent), 'accent updates immediately');
    render(style, 'gradient'); assert.ok(gradients.length > 0);
}
render('bars-bottom', 'gradient');
assert.equal(rectangles.length, 80);
assert.equal(rectangles[0][1] + rectangles[0][3], 600, 'bottom bars end at the canvas edge');
assert.deepEqual(gradients.at(-1).axis, [0,600,0,180]);
render('bars-center', 'gradient');
assert.equal(rectangles[0][1] + rectangles[0][3] / 2, 300, 'centered bars expand symmetrically');
assert.deepEqual(gradients.at(-1).axis, [0,90,0,510]);
assert.equal(window.barFall.length, 80, 'both positions use the same smoothing storage');
window.vizScrollGrad = true;
render('bars-bottom', 'gradient'); assert.equal(gradients.at(-1).stops.length, 9, 'animated gradient retains its seamless cycle');
render('bars-center', 'custom'); assert.equal(gradients.length, 0, 'solid color ignores saved gradient animation');
render('bars-bottom', 'custom'); const bottomHeight = rectangles[0][3];
render('bars-top', 'custom');
assert.equal(rectangles[0][1], 0, 'top bars start at the upper edge');
assert.equal(rectangles[0][3], bottomHeight, 'top bars mirror bottom bar heights');
render('bars-top', 'gradient'); assert.equal(gradients.at(-1).axis[1] < gradients.at(-1).axis[3], true, 'top gradient follows the mirrored direction');
window.vizShowInner = false;
window.vizCircleSize = 0.6; render('circle-smooth', 'custom'); const smallRadius = points[0][1] - 300;
window.vizCircleSize = 1.4; render('circle-smooth', 'custom'); const largeRadius = points[0][1] - 300;
assert.equal(smallRadius, 90); assert.equal(largeRadius, 210);
render('circle-dots', 'custom'); assert.equal(dots.length, 96);
render('circle-double', 'custom'); assert.equal(strokes, 2, 'double circle draws two contours');
console.log('PASS: all visualizer variants, live accent/custom colors, gradients, bar placement, shared smoothing and animated palette.');
