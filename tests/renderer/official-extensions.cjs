const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
async function activate(slug,values={},initial=new Date(2026,9,22,12).getTime()) {
    const manifest=JSON.parse(fs.readFileSync(`addons/official/noctune-${slug}/manifest.json`,'utf8'));
    let settings=Object.fromEntries(Object.entries(manifest.settings).map(([key,field])=>[key,field.default]));settings={...settings,...values};
    let now=initial,start,serial=0,pauses=0;const timers=new Map(),events={},commands={},gains=[],themes=[],walls=[],registered=[],notices=[];
    const available=[{id:'light'},{id:'dark'},{id:'system'},{id:'scheme:other-provider:graphite'}],backgrounds=[{id:'background:'+'a'.repeat(64)}];
    class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
    const api={settings:{get:async()=>settings},on:(name,fn)=>{events[name]=fn;},onCommand:(name,fn)=>{commands[name]=fn;},
        hotkeys:{register:async()=>{}},notify:async text=>{notices.push(text);},player:{pause:async()=>{pauses++;}},audio:{gain:async args=>{gains.push(args);}},
        appearance:{list:async()=>available,select:async({id})=>{themes.push(id);},register:async item=>{registered.push(item);},switch:async({id})=>{themes.push(id);}},
        backgrounds:{list:async()=>backgrounds,override:async({id})=>{walls.push(id);}},
    };
    vm.runInNewContext(fs.readFileSync(`addons/official/noctune-${slug}/main.js`,'utf8'),{NoctuneAddon:{define:fn=>{start=fn(api);}},Date:Clock,setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:now+ms});return id;},clearTimeout:id=>timers.delete(id)});
    await start;
    return {api,commands,events,gains,themes,walls,registered,notices,available,backgrounds,get pauses(){return pauses;},
        async change(next){settings={...settings,...next};await events['settings.changed']({values:settings});},
        async advance(ms){now+=ms;let count=0;for(;;){const next=[...timers].filter(([,task])=>task.at<=now).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)return;assert(++count<100);timers.delete(next[0]);await next[1].fn();}},
        async setTime(date){const target=date.getTime();await this.advance(target-now);},
    };
}
(async()=>{
    const sleep=await activate('sleep',{minutes:5});
    assert.equal(sleep.gains.length,0,'enabling does not arm the timer by default');
    await sleep.commands['start-timer']();await sleep.advance(281000);
    assert.equal(sleep.gains.length,1);assert.equal(sleep.gains[0].gain,0);assert.equal(sleep.gains[0].ramp,19);
    await sleep.advance(18000);assert.equal(sleep.gains.length,1,'one Web Audio ramp, no repeated graph updates');
    await sleep.commands['cancel-timer']();assert.equal(sleep.gains.at(-1).gain,null);await sleep.advance(10000);assert.equal(sleep.pauses,0);
    await sleep.commands['start-timer']();await sleep.change({minutes:60});await sleep.advance(300000);assert.equal(sleep.pauses,1,'duration edits do not reset an armed timer');
    const suspended=await activate('sleep',{minutes:5,startOnEnable:true});await suspended.advance(3600000);assert.equal(suspended.pauses,1,'resume past the deadline pauses once');await suspended.advance(10000);assert.equal(suspended.pauses,1);
    const extended=await activate('sleep',{minutes:5,startOnEnable:true});await extended.advance(281000);await extended.commands['extend-timer']();assert.equal(extended.gains.at(-1).gain,null);await extended.advance(20000);assert.equal(extended.pauses,0);
    const shades=await activate('shades');assert.equal(shades.registered.length,6);assert.equal(shades.themes.at(-1),'graphite');
    await shades.change({applySelected:false});assert.equal(shades.themes.at(-1),null);
    await shades.change({keepAccent:true});assert(shades.registered.slice(-6).every(item=>!Object.hasOwn(item.palette,'accent')));
    assert.equal(shades.registered.filter(item=>item.mode==='light').length,6);
    const dusk=await activate('dusk',{dayTheme:'scheme:other-provider:graphite'});
    assert.equal(dusk.themes.at(-1),'scheme:other-provider:graphite');assert.equal(dusk.walls.at(-1),null);
    const themeCalls=dusk.themes.length;await dusk.advance(60000);assert.equal(dusk.themes.length,themeCalls,'unchanged schedule does not reapply colors');
    dusk.available.splice(3,1);await dusk.events['appearance.schemes']();await dusk.advance(250);assert.equal(dusk.themes.at(-1),'light');
    dusk.available.push({id:'scheme:other-provider:graphite'});await dusk.events['appearance.schemes']();await dusk.advance(250);assert.equal(dusk.themes.at(-1),'scheme:other-provider:graphite');
    await dusk.change({wallpapers:true,dayWallpaper:'background:'+'a'.repeat(64)});assert.equal(dusk.walls.at(-1),'background:'+'a'.repeat(64));
    dusk.backgrounds.length=0;await dusk.commands['apply-now']();assert.equal(dusk.walls.at(-1),null,'missing wallpaper releases only its override');assert.equal(dusk.themes.at(-1),'scheme:other-provider:graphite');
    await dusk.change({dayStart:'29:00'});assert.equal(dusk.themes.at(-1),null,'invalid time releases appearance');
    await dusk.change({dayStart:'21:00',nightStart:'21:00'});assert.equal(dusk.themes.at(-1),null);
    await dusk.change({dayStart:'07:00',nightStart:'21:00',wallpapers:false,automatic:false});assert.equal(dusk.walls.at(-1),null);
    const midnight=await activate('dusk',{dayStart:'22:00',nightStart:'06:00'},new Date(2026,9,22,23).getTime());
    assert.equal(midnight.themes.at(-1),'light');await midnight.setTime(new Date(2026,9,23,0));assert.equal(midnight.themes.at(-1),'light');await midnight.setTime(new Date(2026,9,23,7));assert.equal(midnight.themes.at(-1),'dark');
    console.log('PASS: Sleep real-time deadline, single audio ramp, cancel/extend/resume, Shades palettes/provider-only mode, Dusk midnight schedule, source removal/recovery, optional wallpapers and invalid-time cleanup.');
})().catch(error=>{console.error(error);process.exitCode=1;});
