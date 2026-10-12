const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const calls = [];
const gradient = { addColorStop() {} };
const ctx = new Proxy({ createLinearGradient: () => gradient, createRadialGradient: () => gradient, save:()=>calls.push('save'), restore:()=>calls.push('restore') }, { get: (target,key) => target[key] ?? (()=>{}) });
class Surface { constructor(w,h) {this.width=w;this.height=h;} getContext(){return ctx;} }
const context = { window: {}, OffscreenCanvas: Surface, Math, Uint8Array, Float32Array };
vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../src/renderer/effects/scene-sdk.js'),'utf8'),context);
const manifest = { apiVersion:2, width:320, height:180, palette:{accent:'#abcdef',background:'#000000',gradient:['#abcdef','#123456','#654321']},parameterSchema:{waves:{default:1}} };
let closed=0;const images={mask:{width:320,height:180,close:()=>closed++}};
const api=context.window.NoctuneScene.create(new Surface(320,180),manifest,images);
const frame={width:200,height:200,dpr:1,dt:1/60,time:99,motion:true,lighting:{intensity:0},parameters:{waves:1},audio:{spectrum:new Uint8Array(4096).fill(255),playing:true,enabled:true,sampleRate:48000,intensity:1}};
for(const playing of [false,true])for(const enabled of [false,true])for(const motion of [false,true])for(const intensity of [0,1]){
    const test=context.window.NoctuneScene.create(new Surface(320,180),manifest,{});
    for(let i=0;i<90;i++)test.begin({...frame,motion,lighting:{intensity},audio:{...frame.audio,playing,enabled}});
    assert.equal(test.energy>.8,playing&&enabled,'audio response is independent of motion and lighting');
    assert.equal(test.time>0,motion);assert.equal(test.glowIntensity,intensity);test.dispose();
}
let resize=0,parameters=0,audio=0;
api.on('resize',()=>resize++);api.on('parameters',()=>parameters++);api.on('audio',()=>audio++);
api.begin(frame);assert.equal(resize,1);assert.equal(audio,1);assert.equal(api.glowIntensity,0);
const point=api.sceneToScreen(140,100),back=api.screenToScene(point.x,point.y);assert.ok(Math.abs(back.x-140)<1e-9);assert.ok(Math.abs(back.y-100)<1e-9);
assert.ok(api.visibleRect.width<api.width);
const activeTime=api.time;
api.begin({...frame,motion:false,parameters:{waves:2}});assert.equal(api.time,activeTime);assert.equal(parameters,1);
const options={count:32,minHz:35,maxHz:18000,smoothing:.7};
const bands=api.bandsSource(options);assert.equal(api.bandsSource(options),bands,'one source per frame');
api.bars({x:0,y:100,width:300,height:80,source:bands});api.line({x:0,y:100,width:300,height:80,source:bands});
for(let i=0;i<120;i++){api.begin({...frame,motion:false,audio:{...frame.audio,playing:false,spectrum:new Uint8Array(0)}});api.bandsSource(options);}
assert.ok([...bands].every(v=>v<.001),'pause decays common source');
for (const length of [0,32,1024,4096]) for (const rate of [22050,44100,96000]) {
    api.begin({...frame,audio:{...frame.audio,sampleRate:rate,spectrum:new Uint8Array(length).fill(200)}});
    assert.ok([...api.bandsSource(options)].every(v=>Number.isFinite(v)&&v>=0&&v<=1));
}
for(let i=0;i<120;i++){api.begin(frame);api.spectrum(32,35,18000,'dynamic-'+i);api.bandsSource({...options,count:2+i%100});}
assert.ok(api.bands.size<=api.quality.caches+1);assert.ok(api.sources.size<=api.quality.caches);assert.ok(api.geometry.size<=api.quality.caches);
const mainCtx=api.ctx;
assert.throws(()=>api.clipMask('mask',()=>{throw new Error('draw failure');}),/draw failure/);
assert.equal(api.ctx,mainCtx);assert.equal(api.surfaces.size,1,'temporary surface released on callback failure');
const saved=calls.length;assert.throws(()=>api.clip([[[0,0],[10,0],[10,10]]],()=>{throw Error('clip failure');}));assert.equal(calls.slice(saved).at(-1),'restore');
api.setPalette(manifest.palette);assert.equal(api.maskCache.size,0);assert.equal(api.surfaces.size,0);
const surface=api.createSurface(100,100);api.releaseSurface(surface);assert.equal(api.surfaces.size,0);
assert.throws(()=>api.createSurface(0,1));assert.throws(()=>api.bandsSource({count:10000}));
assert.throws(()=>api.waterRipple({x:10,y:10,rings:0}));assert.throws(()=>api.radialSpectrum({source:[NaN,1]}));
api.replaceImage('mask',{width:320,height:180,close:()=>closed++});assert.equal(closed,1);
api.reset();assert.equal(api.time,0);assert.equal(api.energy,0);
api.dispose();api.dispose();assert.equal(closed,2);assert.equal(api.surfaces.size,0);assert.throws(()=>api.begin(frame),/disposed/);
console.log('PASS: API v2 Worker-safe surfaces, frozen time, coordinates, shared/decaying bands, FFT layouts, bounded caches, callback cleanup and image disposal.');
