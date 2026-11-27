const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const events={},sent=[];let iframe,raf;
const manifest={id:'clock-test',palette:{background:'#000000'},capabilities:{motion:true,visualizer:'none'}};
const context={window:{addEventListener:(name,fn)=>events[name]=fn,requestEffectsFrame:fn=>raf=fn},
    document:{hidden:false,addEventListener(){},dispatchEvent(){},getElementById:()=>null,
        createElement:()=>iframe={style:{},setAttribute(){},remove(){},contentWindow:{postMessage:data=>sent.push(data)}},body:{prepend(){},classList:{add(){}}}},
    matchMedia:()=>({matches:true}),appStorage:{getItem:()=>null,setItem(){}},
    noctune:{sceneThemes:{read:async()=>({apiVersion:2,manifest})}},
    innerWidth:1000,innerHeight:500,devicePixelRatio:1,crypto:require('node:crypto').webcrypto,
    TextEncoder,Uint8Array,Event,performance,setTimeout:()=>0,clearTimeout(){},
    btoa:value=>Buffer.from(value,'binary').toString('base64'),
    localAudioElement:null,radioAudioElement:null,isRadioMode:false};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../src/renderer/effects/scene-host.js'),'utf8'),context);
(async()=>{
    const active=context.window.sceneThemes.activate({id:manifest.id});
    await new Promise(resolve=>setImmediate(resolve));
    const data=JSON.parse(Buffer.from(iframe.srcdoc.match(/type="application\/octet-stream">([^<]+)/)[1],'base64').toString());
    assert.deepEqual(data.initialFrame.playback,{position:null,duration:null,playing:false,live:false});
    const message=type=>events.message({source:iframe.contentWindow,data:{sceneChannel:data.channel,type}});
    message('ready');message('frame');await active;
    let now=100;
    const tick=()=>{raf(now+=100);if(sent.length)message('frame');return sent.at(-1)?.frame;};
    context.localAudioElement={currentTime:65.25,duration:240,paused:false,ended:false};
    assert.deepEqual(JSON.parse(JSON.stringify(tick().playback)),{position:65.25,duration:240,playing:true,live:false});
    const count=sent.length;tick();assert.equal(sent.length,count,'static scenes are not redrawn for an unchanged clock');
    context.localAudioElement.currentTime=66.1;assert.equal(tick().playback.position,66.1,'clock advances with all motion and FFT off');
    context.localAudioElement.paused=true;assert.equal(tick().playback.playing,false);
    context.localAudioElement.currentTime=17.8;assert.equal(tick().playback.position,17.8,'paused seek is delivered');
    context.localAudioElement={currentTime:0,duration:180,paused:true,ended:false};
    assert.equal(tick().playback.position,0,'track replacement resets the media position');
    context.localAudioElement.currentTime=360001;context.localAudioElement.duration=Infinity;
    assert.equal(tick().playback.position,360001);assert.equal(tick().playback.duration,null);
    context.isRadioMode=true;context.radioAudioElement={currentTime:999999,duration:Infinity,paused:false,ended:false};
    assert.deepEqual(JSON.parse(JSON.stringify(tick().playback)),{position:null,duration:null,playing:true,live:true});
    context.isRadioMode=false;context.localAudioElement=null;assert.equal(tick().playback.position,null);
    context.localAudioElement={currentTime:0,duration:240,paused:true,ended:false};
    context.trackTitle={textContent:'First track'};context.trackArtist={textContent:'Artist'};
    assert.equal(tick().playback.title,'First track');assert.equal(tick().playback.artist,'Artist');
    const beforeRename=sent.length;context.trackTitle.textContent='Next track';
    assert.equal(tick().playback.title,'Next track');assert(sent.length>beforeRename,'paused metadata changes redraw static themes');
    context.trackTitle.textContent='x'.repeat(600);assert.equal(tick().playback.title.length,512);
    context.localAudioElement=null;assert.equal(tick().playback.title,undefined,'empty playback has no stale title');
    console.log('PASS: scene media clock, pause/seek/track replacement, long tracks, radio and static-frame delivery.');
})().catch(error=>{console.error(error);process.exitCode=1;});
