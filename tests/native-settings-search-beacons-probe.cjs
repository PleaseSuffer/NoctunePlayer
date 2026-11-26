const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const output=path.join(__dirname,'.artifacts/settings-search-beacons');fs.mkdirSync(output,{recursive:true});
app.setPath('userData',fs.mkdtempSync(path.join(output,'profile-')));
const delay=ms=>new Promise(r=>setTimeout(r,ms));let started=false;
setTimeout(()=>app.exit(2),60000);
app.on('browser-window-created',(_,win)=>win.webContents.on('did-finish-load',async()=>{
 if(!win.webContents.getURL().endsWith('/renderer/index.html')||started)return;started=true;win.show();win.webContents.setBackgroundThrottling(false);
 const run=code=>win.webContents.executeJavaScript(code).catch(e=>{console.error('CODE:',code);throw e});
 async function until(code,label){for(let i=0;i<120;i++){if(await run(code))return;await delay(50)}throw Error(label)}
 const search=async value=>{await run(`if(document.getElementById('settings-search-toggle').getAttribute('aria-expanded')!=='true')document.getElementById('settings-search-toggle').click();document.getElementById('settings-search-input').value=${JSON.stringify(value)};document.getElementById('settings-search-input').dispatchEvent(new Event('input',{bubbles:true}))`);await delay(150)};
 try{
 await delay(700);win.setSize(1200,850);
 await run(`document.getElementById('settings-fab').click();window.__beacons=[];window.__animate=Element.prototype.animate;Element.prototype.animate=function(frames,options){if(options?.id==='settings-search-beacon'){const r=this.getBoundingClientRect(),v=document.querySelector('.settings-content').getBoundingClientRect();__beacons.push({id:this.id,text:this.textContent.slice(0,100),visible:r.bottom>v.top&&r.top<v.bottom&&r.right>v.left&&r.left<v.right,panel:this.closest('.settings-panel')?.id,active:document.querySelector('.settings-panel.active')?.id,hidden:document.hidden,duration:options.duration,pseudo:options.pseudoElement,time:performance.now()})}return __animate.call(this,frames,options)};void 0`);
 await search('цвет');await until(`__beacons.length>0`,'first visible pulse');
 assert(await run(`__beacons.every(b=>b.visible&&b.panel===b.active&&!b.hidden&&b.pseudo==='::after')`));
 assert(await run(`[...document.getAnimations()].filter(a=>a.id==='settings-search-beacon').length<=2`));
 assert(await run(`document.querySelectorAll('.settings-panel:not(.active) .settings-search-beacon').length===0`));
 const first=await run(`__beacons.length`);await delay(5300);assert((await run(`__beacons.length`))>first,'periodic pulse');
 await run(`document.querySelector('.settings-content').scrollTop=document.querySelector('.settings-content').scrollHeight`);await delay(200);
 assert(await run(`[...document.querySelectorAll('.settings-search-beacon')].every(n=>{const r=n.getBoundingClientRect(),v=document.querySelector('.settings-content').getBoundingClientRect();return r.bottom>v.top&&r.top<v.bottom})`),'offscreen animations cancelled');
 await delay(5200);assert(await run(`__beacons.every(b=>b.visible&&b.panel===b.active)`),'scroll pulses stay in viewport');
 await win.webContents.debugger.attach('1.3');
 await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await delay(100);
 const reduced=await run(`__beacons.length`);assert.equal(await run(`[...document.getAnimations()].filter(a=>a.id==='settings-search-beacon').length`),0);
 await delay(5200);assert.equal(await run(`__beacons.length`),reduced,'reduced motion has no recurring animations');
 await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});await until(`__beacons.length>${reduced}`,'motion resumes');
 win.webContents.send('window-tray-visibility',false);await delay(100);const hidden=await run(`__beacons.length`);
 assert.equal(await run(`[...document.getAnimations()].filter(a=>a.id==='settings-search-beacon').length`),0);
 await delay(5200);assert.equal(await run(`__beacons.length`),hidden,'hidden window has no pulses');
 win.webContents.send('window-tray-visibility',true);await until(`__beacons.length>${hidden}`,'visible window resumes');
 await search('производительность');await until(`document.querySelector('.settings-section-title.settings-search-beacon')`,'matching heading pulses');
 for(const theme of ['dark','light']){
 await run(`document.getElementById('setting-dark-theme').checked=${theme==='dark'};document.getElementById('setting-dark-theme').dispatchEvent(new Event('change'))`);await delay(450);
 await until(`[...document.getAnimations()].some(a=>a.id==='settings-search-beacon')`,'screenshot pulse');
 await run(`for(const a of document.getAnimations())if(a.id==='settings-search-beacon'){a.pause();a.currentTime=440}`);await delay(100);
 fs.writeFileSync(path.join(output,theme+'.png'),(await win.webContents.capturePage()).toPNG());
 }
 await run(`document.getElementById('settings-search-clear').click()`);await delay(50);
 assert.equal(await run(`document.querySelectorAll('.settings-search-beacon,.settings-search-beacon-anchor').length`),0,'clear releases observers/anchors');
 assert.equal(await run(`[...document.getAnimations()].filter(a=>a.id==='settings-search-beacon').length`),0);
 await search('цвет');await until(`document.querySelector('.settings-search-beacon')`,'before close');
 await run(`document.getElementById('settings-close-btn').click()`);const closed=await run(`__beacons.length`);
 await delay(5200);assert.equal(await run(`__beacons.length`),closed,'closed settings have no recurring animations');
 assert.equal(await run(`[...document.getAnimations()].filter(a=>a.id==='settings-search-beacon').length`),0);
 console.log('PASS: periodic compositor-only pulses, bounded concurrency, viewport/active-panel eligibility, scroll cancellation, reduced motion, tray suspension/resume, heading matches and clear/close cleanup.');app.exit(0);
 }catch(e){console.error(e);app.exit(1)}
}));
require('../src/main/index');
