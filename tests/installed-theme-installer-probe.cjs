// Run with the installed app closed. Previews and cancels an isolated fixture; installs no theme.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { packDirectory } = require('../src/main/scene-themes');
const executable = path.resolve(process.argv[2]);
const mode = process.argv.includes('--update') ? 'update' : process.argv.includes('--existing') ? 'installed' : 'install';
const buttonLabel = mode === 'installed' ? 'Установлено' : mode === 'update' ? 'Обновить' : 'Установить';
const pause = () => new Promise(resolve => setTimeout(resolve,100));
let child;
const sockets=[];
async function connect(target) {
    const socket=new WebSocket(target.webSocketDebuggerUrl), pending=new Map(); let sequence=0;
    sockets.push(socket);
    await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
    socket.onmessage=event=>{const message=JSON.parse(event.data), request=pending.get(message.id);if(request){pending.delete(message.id);clearTimeout(request.timer);message.error?request.reject(new Error(message.error.message)):request.resolve(message.result);}};
    return async expression=>{
        const id=++sequence;
        const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout'));},10000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));});
        if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
        return result.result.value;
    };
}
(async()=>{
    const output=path.resolve(__dirname,'.artifacts/installed-theme');await fs.mkdir(output,{recursive:true});
    const theme=await packDirectory(path.resolve(__dirname,'../themes/builtin/03-rain-window'));
    theme.manifest.name='Installed preview probe '+Date.now();
    if (mode === 'install') theme.manifest.id='installed-preview-probe-'+Date.now();
    if (mode === 'update') theme.manifest.version='99999.0.0';
    const file=path.join(output,'Тема для проверки.noctheme');await fs.writeFile(file,JSON.stringify(theme));
    const port=9234;
    child=spawn(executable,[`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1',file],{windowsHide:true,stdio:'ignore'});
    let targets,main,preview;
    for(let i=0;i<150;i++){
        try{targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();main=targets.find(t=>t.type==='page'&&t.url.endsWith('/renderer/index.html'));preview=targets.find(t=>t.type==='page'&&t.url.endsWith('/theme-install/index.html'));}catch{}
        if(main&&preview)break;await pause();
    }
    assert(main&&preview,'installed file-open creates the player and a separate preview page');assert.notEqual(main.id,preview.id);
    const evaluateMain=await connect(main),evaluatePreview=await connect(preview);
    for(let i=0;i<100;i++){if(await evaluatePreview(`document.getElementById('name')?.textContent === ${JSON.stringify(theme.manifest.name)} && document.getElementById('install')?.textContent === ${JSON.stringify(buttonLabel)}`))break;await pause();}
    const details=await evaluatePreview(`({name:document.getElementById('name').textContent,description:document.getElementById('description').textContent,preview:document.getElementById('preview').naturalWidth,metadata:document.getElementById('metadata').textContent,install:document.getElementById('install').textContent,cancel:document.getElementById('cancel').textContent})`);
    assert.equal(details.name,theme.manifest.name);assert.equal(details.description,theme.manifest.description);assert(details.preview>0);assert(details.metadata.includes(theme.manifest.author));assert.equal(details.install,buttonLabel);assert.equal(details.cancel,'Отмена');
    if(mode!=='install'){
        const button=await evaluatePreview(`(()=>{const b=document.getElementById('install'),s=getComputedStyle(b);return {disabled:b.disabled,background:s.backgroundColor,border:s.borderColor};})()`);
        assert.equal(button.disabled,mode==='installed');assert.equal(button.background,'rgba(0, 0, 0, 0)');assert.equal(button.border,mode==='installed'?'rgb(99, 197, 138)':'rgb(228, 194, 96)');
    }
    const before=await evaluateMain(`noctune.sceneThemes.list().then(list=>list.themes.map(t=>t.id))`);
    await evaluatePreview(`document.getElementById('cancel').click()`);await pause();
    const after=await evaluateMain(`noctune.sceneThemes.list().then(list=>list.themes.map(t=>t.id))`);
    assert.deepEqual(after,before,'cancel adds no installed theme');
    console.log('PASS: installed .noctheme preview state '+mode+', correct button/outline and cancellation without changes.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{for(const socket of sockets)socket.close();if(child&&child.exitCode===null)child.kill();});
