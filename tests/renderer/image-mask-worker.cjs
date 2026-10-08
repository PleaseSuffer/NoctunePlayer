const assert = require('node:assert/strict');
const { analyzeImage, thresholdMask } = require('../../src/renderer/effects/image-mask-worker');
const width = 32, height = 24;
const rgba = new Uint8ClampedArray(width * height * 4);
for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    const i=(y*width+x)*4;
    rgba[i]=rgba[i+1]=rgba[i+2]=x<width/2?0:255; rgba[i+3]=255;
}
const data = analyzeImage(rgba,width,height);
assert.equal(data.length,width*height*2);
assert.equal(data[(12*width+4)*2],0, 'uniform area has no false contour');
assert.ok(data[(12*width+15)*2]>100, 'object boundary produces a strong contour');
assert.equal(data[(12*width+28)*2+1],255, 'brightness mask preserves highlights');
const low=thresholdMask(data,1), high=thresholdMask(data,100);
assert.ok(high.filter((_,i)=>i%4===0).reduce((a,b)=>a+b,0)>=low.filter((_,i)=>i%4===0).reduce((a,b)=>a+b,0), 'one slider increases contour sensitivity');
assert.ok(high[(12*width+28)*4+1]>0, 'bright regions are marked');
assert.equal(high[(12*width+4)*4+1],0, 'dark regions remain unmarked');
rgba.fill(0);
assert.ok(analyzeImage(rgba,width,height).every(value=>value===0), 'transparent image has no false masks');
console.log('PASS: denoised contours, brightness regions, sensitivity monotonicity and transparent image handling.');
