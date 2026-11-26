const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const elements=new Map(),events={},records=new Map();
const updater={download:async()=>({ok:true}),install(){}};
for(const name of ['Checking','NotAvailable','Unavailable','Error','Available','Progress','Downloaded'])updater['on'+name]=fn=>events[name]=fn;
const center={find:key=>records.has(key)?key:undefined,update:(id,patch)=>Object.assign(records.get(id),patch),dismiss:id=>records.get(id).dismissed=true};
vm.runInNewContext(fs.readFileSync('src/renderer/updates/updater.js','utf8'),{
 notificationCenter:center,document:{getElementById(id){if(!elements.has(id))elements.set(id,{style:{},addEventListener(){}});return elements.get(id);}},
 appStorage:{getItem:()=> '0',setItem(){}},noctune:{updater},setInterval(){},clearInterval(){},setTimeout(){},
 showNotification(message,type,title,stack,options={}){records.set(options.replaceKey,{message,type,title,...options});},
});
events.Available({version:'9.0.0'});assert.equal(records.get('player-update').important,true);
records.get('player-update').actions[0].onClick();assert.equal(records.size,1);assert.equal(records.get('player-update').pinned,true);
events.Progress({percent:42,bytesPerSecond:2097152});assert.equal(records.get('player-update').progress,0.42);assert.equal(records.get('player-update').progressLabel,'42% · 2.0 MB/s');
events.Downloaded({version:'9.0.0'});assert.equal(records.size,1);assert.equal(records.get('player-update').important,true);assert.notEqual(records.get('player-update').pinned,true);assert.equal(records.get('player-update').actions[0].primary,true);
console.log('PASS: update availability, download speed/progress and ready-to-install share one important notification.');
