const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../../addons/community/yandex-music/main.js'), 'utf8');
const code = source.slice(source.indexOf('    async function saveTrack('), source.indexOf('    async function resolve('));
(async () => {
    const commands = {}, timers = [], shown = [], updated = [], canceled = [];
    const jobs = new Map(), states = new Map(), requests = [];
    const api = {
        onCommand: (id, handler) => { commands[id] = handler; },
        downloads: {
            start: async args => { requests.push(args);const id = args.filename; states.set(id, {id, name:id, state:'running', bytes:1048576, total:2097152}); return {id}; },
            status: async ({id}) => states.get(id),
            cancel: async ({id}) => { canceled.push(id); states.get(id).state = 'canceled'; },
            folder: async args => args
        },
        notifications: {update: async args => { updated.push(args); return true; }}
    };
    const context = vm.createContext({api, downloadJobs:jobs, generation:0, settings:{downloadName:'title'}, registeredAccount:'1',
        trackMetadata:new Map([['1',{title:'One'}],['2',{title:'Two'}]]),
        ratingTrack:async id=>({realId:id,epoch:0}), mp3Source:async()=>({url:'https://example.com/audio'}),
        short:value=>String(value).slice(0,300), notice:async(message,key,options)=>shown.push({message,key,...options}),
        setTimeout:handler=>timers.push(handler), Date, lastError:'',trackId:track=>String(track.id),cover:()=>''});
    vm.runInContext(code, context);
    vm.runInContext(source.slice(source.indexOf('    function trackView('),source.indexOf('    function cover(')),context);
    context.trackView({id:'1',title:'One',artists:[{name:'First'},{name:'Second'}],albums:[{title:'Album',year:2026,genre:'Electronic',artists:[{name:'Album Artist'}],trackPosition:{index:3,volume:1},volumes:[[1,2,3]]}]},'1');
    await context.saveTrack('1'); await context.saveTrack('2');
    assert.deepEqual(JSON.parse(JSON.stringify(requests[0].metadata)),{title:'One',artist:'First; Second',album:'Album',albumArtist:'Album Artist',genre:'Electronic',year:2026,track:3,disc:1,trackCount:3,discCount:1});
    assert.notEqual(shown[0].key, shown[1].key);
    assert.equal(shown[0].pinned,true);
    await assert.rejects(context.saveTrack('1'), /уже сохраняется/);
    await timers.shift()();
    assert.equal(updated.at(-1).progress,0.5);
    assert.match(updated.at(-1).progressLabel,/50%.*МБ/);
    states.get('Two.mp3').total=null;
    states.get('Two.mp3').phase='tagging';
    await timers.shift()(); assert.equal(updated.at(-1).progress,null);
    assert.match(updated.at(-1).progressLabel,/метаданных/);
    states.get('One.mp3').state='completed';
    await timers.shift()();
    assert.equal(updated.at(-1).type,'success'); assert.equal(updated.at(-1).pinned,false);
    assert.equal(updated.at(-1).actions[0].command,'open-download-folder');
    await commands['cancel-downloads']();
    assert.deepEqual(canceled,['Two.mp3']);
    await timers.shift()();
    assert.equal(updated.at(-1).progressLabel,'Отменено'); assert.equal(jobs.size,0);
    await context.saveTrack('1'); states.get('One.mp3').state='failed'; states.get('One.mp3').error='Network failed';
    await timers.shift()();
    assert.equal(updated.at(-1).type,'error'); assert.equal(updated.at(-1).pinned,false);
    assert.equal(updated.at(-1).copyText,'Network failed');
    assert.equal((await commands['open-download-folder']()).action,'open');
    console.log('PASS: Yandex concurrent downloads, progress, unknown size, cancellation, completion, failure and folder actions.');
})().catch(error=>{console.error(error);process.exitCode=1;});
