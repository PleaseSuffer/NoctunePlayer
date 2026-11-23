const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const events={},sent=[];let iframe,raf,now=100,settings=false;
const manifest={id:'watchdog-test',palette:{background:'#000'},capabilities:{motion:true,visualizer:'none'}};
const context={window:{addEventListener:(n,f)=>events[n]=f,requestEffectsFrame:f=>raf=f,effectsPerformance:{get effectiveFps(){return settings?30:60}}},
 document:{hidden:false,addEventListener(){},dispatchEvent(){},getElementById:id=>id==='settings-overlay'?{classList:{contains:()=>settings}}:null,
 createElement:()=>iframe={style:{},setAttribute(){},remove(){},contentWindow:{postMessage:data=>sent.push(data)}},body:{prepend(){},classList:{add(){},remove(){}}}},
 matchMedia:()=>({matches:false}),appStorage:{getItem:()=>null,setItem(){},removeItem(){}},noctune:{sceneThemes:{read:async()=>({apiVersion:2,manifest})}},
 innerWidth:1000,innerHeight:600,devicePixelRatio:1,crypto:require('node:crypto').webcrypto,TextEncoder,Uint8Array,Event,performance,setTimeout:()=>0,clearTimeout(){},btoa:v=>Buffer.from(v,'binary').toString('base64')};
vm.runInNewContext(fs.readFileSync('src/renderer/effects/scene-host.js','utf8'),context);
(async()=>{
 const active=context.window.sceneThemes.activate({id:manifest.id});await new Promise(r=>setImmediate(r));
 const data=JSON.parse(Buffer.from(iframe.srcdoc.match(/type="application\/octet-stream">([^<]+)/)[1],'base64').toString());
 const reply=type=>events.message({source:iframe.contentWindow,data:{sceneChannel:data.channel,type}});
 reply('ready');reply('frame');await active;
 const tick=delta=>raf(now+=delta);
 tick(20);assert(sent.length);tick(8000);assert(context.window.sceneThemes.active,'host stall does not disable a responsive scene');
 reply('frame');tick(20);assert(context.window.sceneThemes.active,'queued reply remains accepted');
 context.document.hidden=true;for(let i=0;i<80;i++)tick(100);context.document.hidden=false;tick(20);assert(context.window.sceneThemes.active,'hidden host does not time out a scene');
 reply('frame');settings=true;tick(40);assert.equal(context.window.sceneThemes.performance.frameLimit,30);reply('frame');settings=false;tick(40);assert.equal(context.window.sceneThemes.performance.frameLimit,60);
 for(let i=0;i<60;i++)tick(100);assert.equal(context.window.sceneThemes.active,false,'unresponsive scene still times out with a responsive host');
 console.log('PASS: delayed host/hidden resume preserve scene; responsive-host timeout and foreground settings frame budget remain enforced.');
})().catch(e=>{console.error(e);process.exitCode=1});
