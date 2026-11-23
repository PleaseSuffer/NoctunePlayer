const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const localization=require('../../src/shared/addon-localization');
const source=fs.readFileSync('src/renderer/effects/scene-host.js','utf8');
const manifest={id:'localized-test',name:'theme.name',palette:{background:'#000'},capabilities:{motion:true,visualizer:'none'},parameterSchema:{music:{type:'toggle',label:'parameters.music',default:true}},localization:{defaultLocale:'en',messages:{en:{'theme.name':'Orbit','parameters.music':'Audio response'},ru:{'theme.name':'Орбита','parameters.music':'Реакция на музыку'}}}};
async function check(locale,expected){
 const events={};let iframe;
 const context={window:{AddonLocalization:localization,noctuneI18n:{locale},addEventListener:(n,f)=>events[n]=f,requestEffectsFrame(){}},
  document:{addEventListener(){},dispatchEvent(){},getElementById:()=>null,body:{prepend(){},classList:{add(){},remove(){}}},createElement:()=>iframe={style:{},setAttribute(){},remove(){},contentWindow:{}}},
  matchMedia:()=>({matches:false}),appStorage:{getItem:()=>null,setItem(){}},noctune:{sceneThemes:{read:async()=>({apiVersion:2,manifest})}},
  innerWidth:1000,innerHeight:600,devicePixelRatio:1,crypto:require('node:crypto').webcrypto,TextEncoder,Uint8Array,Event,setTimeout:()=>0,clearTimeout(){},btoa:s=>Buffer.from(s,'binary').toString('base64')};
 vm.runInNewContext(source,context);
 // A stale/localized gallery label must not hide a raw-manifest overwrite.
 const pending=context.window.sceneThemes.activate({id:'import-localized',parameterSchema:{music:{label:'stale label'}}});await new Promise(resolve=>setImmediate(resolve));
 const payload=JSON.parse(Buffer.from(iframe.srcdoc.match(/type="application\/octet-stream">([^<]+)/)[1],'base64').toString());
 for(const type of ['ready','frame'])events.message({source:iframe.contentWindow,data:{sceneChannel:payload.channel,type}});
 const metadata=await pending;
 assert.equal(metadata.parameterSchema.music.label,expected);assert.equal(metadata.id,'import-localized');assert.equal(metadata.packageId,'localized-test');
 assert.equal(payload.manifest.parameterSchema.music.label,'parameters.music','runtime package remains unmodified');
}
(async()=>{await check('ru','Реакция на музыку');await check('en','Audio response');await check('fr','Audio response');console.log('PASS: activated scenes retain localized parameter labels and language fallback.');})().catch(e=>{console.error(e);process.exitCode=1;});
