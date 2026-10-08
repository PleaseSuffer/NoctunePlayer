const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/renderer/effects/visualizer.js', 'utf8');
const draw = source.slice(source.indexOf('            ctx.clearRect(0, 0, canvas.clientWidth'), source.indexOf("            } else if (style === 'fireworks')")) + '\n}\n';
const window = {};
let accent = '#abcdef';
let rectangles = [], paints = [], gradients = [], points = [], dots = [], strokes = 0, fillAlphas = [], dashes = [];
const ctx = {
    setLineDash(value) { dashes.push([...value]); }, clearRect() {}, save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo(x,y) { points.push([x,y]); }, lineTo(x,y) { points.push([x,y]); }, quadraticCurveTo(x,y,endX,endY) { points.push([endX,endY]); }, arc(...args) { dots.push(args); },
    roundRect(...args) { rectangles.push(args); }, fillRect() { paints.push(this.fillStyle); },
    fill() { paints.push(this.fillStyle); fillAlphas.push(this.globalAlpha); }, stroke() { paints.push(this.strokeStyle); strokes++; },
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
for (const style of ['circle-smooth', 'circle-lines', 'circle-dots', 'circle-double', 'bars-bottom', 'bars-center', 'bars-top', 'orbits', 'ribbon-top', 'ribbon-center', 'ribbon-bottom', 'waveform']) {
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
// Compare geometry with an asymmetric spectrum, so accidental duplication cannot pass.
for (let i = 0; i < context.dataArray.length; i++) context.dataArray[i] = (i * 17) % 256;
window.vizCircleSize = 1;
window.vizCircleMirror = true;
window.vizCircleRotation = 0;
render('circle-smooth', 'custom');
const unrotated = points.map(point => [...point]);
for (let i = 1; i < 70; i++) {
    assert.ok(Math.abs(points[i][0] + points[140 - i][0] - 800) < 1e-8, 'circle reflects about vertical diameter');
    assert.ok(Math.abs(points[i][1] - points[140 - i][1]) < 1e-8);
}
window.vizCircleRotation = 90;
render('circle-smooth', 'custom');
for (let i = 0; i < 140; i++) {
    assert.ok(Math.abs(points[i][0] - (400 - (unrotated[i][1] - 300))) < 1e-8, '90 degrees rotates geometry');
    assert.ok(Math.abs(points[i][1] - (300 + (unrotated[i][0] - 400))) < 1e-8);
}
render('circle-dots', 'custom');
for (let i = 1; i < 48; i++) {
    assert.ok(Math.abs(dots[i][0] - dots[96 - i][0]) < 1e-8);
    assert.ok(Math.abs(dots[i][1] + dots[96 - i][1] - 600) < 1e-8, 'rotated dotted ring retains symmetry');
}
window.vizBarsMirror = true;
window.vizBarsReflect = true;
window.vizBarsOffset = -100;
render('bars-bottom', 'gradient');
assert.equal(rectangles[0][1] + rectangles[0][3] / 2, 300, 'offset moves reflected baseline to center');
for (let i = 0; i < 40; i++) {
    const left = rectangles[i], right = rectangles[79 - i];
    assert.equal(left[3], right[3], 'both sides sample identical spectrum bins');
    assert.ok(Math.abs(left[0] + right[0] + left[2] - 800) < 1e-8, 'bar placement is symmetric');
}
window.vizBarsOffset = 100;
render('bars-top', 'custom');
assert.equal(rectangles[0][1] + rectangles[0][3] / 2, 300);
window.vizBarsOffset = 40;
render('bars-center', 'custom');
assert.equal(rectangles[0][1] + rectangles[0][3] / 2, 420, 'centered baseline moves with slider');
window.vizBarsOffset = 999;
render('bars-center', 'custom');
assert.equal(rectangles[0][1] + rectangles[0][3] / 2, 600, 'invalid offset cannot move baseline beyond canvas');
// Isolated bands: changing bass must leave the middle and treble rings unchanged.
window.vizCircleMirror = false;
window.vizCircleRotation = 0;
context.analyzer.context = { sampleRate:44100 };
context.dataArray.fill(0);
window._orbitFall = undefined;
render('orbits', 'custom');
const silentOrbits = points.map(point => [...point]);
assert.equal(strokes, 3, 'orbits draw three frequency-band rings');
for (let i = 0; i <= 2; i++) context.dataArray[i] = 255;
render('orbits', 'custom');
assert.notDeepEqual(points.slice(0,96), silentOrbits.slice(0,96), 'bass changes the inner orbit');
assert.deepEqual(points.slice(96), silentOrbits.slice(96), 'bass does not alter mid/treble orbits');
context.dataArray.fill(0); window._orbitFall = undefined;
for (let i = 24; i < 140; i++) context.dataArray[i] = 255;
render('orbits', 'custom');
assert.deepEqual(points.slice(0,192), silentOrbits.slice(0,192), 'treble does not alter bass/mid orbits');
assert.notDeepEqual(points.slice(192), silentOrbits.slice(192), 'treble changes the outer orbit');
const loudTreble = window._orbitFall[250];
context.dataArray.fill(0); render('orbits', 'custom');
assert.ok(window._orbitFall[250] > 0 && window._orbitFall[250] < loudTreble, 'orbits decay smoothly during silence');
for (const sampleRate of [8000, 48000, 96000]) {
    context.analyzer.context.sampleRate = sampleRate;
    render('orbits', 'gradient');
    assert.ok(points.every(point => point.every(Number.isFinite)), 'frequency bands are bounded at every sample rate');
}
window.vizRibbonOffset = 0;
window.vizRibbonMirror = true;
context.dataArray.fill(128);
for (const [style, baseline] of [['ribbon-top',0], ['ribbon-center',300], ['ribbon-bottom',600]]) {
    render(style, 'custom');
    assert.equal(rectangles.length, 0, 'ribbon is a continuous filled curve');
    assert.equal(strokes, 1);
    assert.equal(points[0][0], 0);
    assert.equal(points[80][0], 800);
    assert.ok(Math.abs(points[0][1] + points.at(-1)[1] - baseline * 2) < 1e-8, 'ribbon reflects vertically about selected baseline');
    for (let i = 0; i < 40; i++) assert.equal(window.barFall[i], window.barFall[79 - i], 'ribbon spectrum mirrors horizontally');
}
window.vizRibbonOffset = -100;
render('ribbon-bottom', 'gradient');
assert.deepEqual(gradients.at(-1).axis, [0,90,0,510], 'ribbon gradient follows shifted baseline');
window.vizRibbonScrollGrad = true;
render('ribbon-bottom', 'gradient');
assert.equal(gradients.at(-1).stops.length, 9, 'ribbon supports animated gradients');
window.vizShowInner = true;
window.vizOrbitMode = 'lines';
window.vizOrbitSpacing = 30;
fillAlphas = []; render('orbits', 'custom');
assert.equal(fillAlphas.length, 3);
assert.ok(fillAlphas.every(alpha => alpha >= 0.2), 'orbit filling is visibly stronger');
window.vizShowInner = false;
fillAlphas = []; render('orbits', 'custom');
assert.equal(fillAlphas.length, 0, 'filling can be disabled');
window._orbitFall = undefined;
context.dataArray.fill(0);
window.vizOrbitSpacing = 10;
render('orbits', 'custom');
const nearRadius = points[192][1] - 300;
window.vizOrbitSpacing = 60;
render('orbits', 'custom');
assert.equal((points[192][1] - 300) - nearRadius, 150, 'spacing moves the outer orbit while preserving the inner radius');
window.vizOrbitMode = 'dots';
render('orbits', 'custom');
assert.equal(dots.length, 288, 'dots draw each orbit without continuous strokes');
assert.equal(strokes, 0);
window.vizOrbitMode = 'dashes';
dashes = []; render('orbits', 'custom');
assert.equal(strokes, 3);
assert.deepEqual(dashes, [[8,7], [8,7], [8,7]]);
console.log('PASS: visualizer geometry, band-specific orbits, fill toggle, orbit patterns and spacing, mirrored ribbon layouts and gradients.');
