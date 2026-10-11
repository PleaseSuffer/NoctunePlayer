const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { packDirectory } = require('../../src/main/scene-themes');
const { createThemeInstaller } = require('../../src/main/theme-installer');
(async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'noctune-install-window-'));
    try {
        const file = path.join(temporary, 'theme.noctheme');
        const theme = await packDirectory(path.resolve('themes/builtin/03-rain-window'));
        const handlers = new Map(), windows = [], installed = [];
        const waitForWindow = async count => {for(let i=0;i<300&&windows.length<count;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(windows.length,count);};
        class Window extends EventEmitter {
            constructor(options) { super(); this.options=options; this.webContents=new EventEmitter(); this.webContents.mainFrame={}; this.webContents.setWindowOpenHandler=()=>{}; windows.push(this); }
            setMenu() {} show() {} focus() {}
            async loadFile() {}
            close() {const event={preventDefault:()=>{event.prevented=true;}}; this.emit('close', event); if(!event.prevented)this.destroy();}
            destroy() {this.emit('closed');}
        }
        const installer = createThemeInstaller({BrowserWindow:Window, ipcMain:{handle:(id,cb)=>handlers.set(id,cb),on:(id,cb)=>handlers.set(id,cb)},store:{installationStatus:async()=>({state:'install'}),installPackage:async theme => {installed.push(theme); return {name:theme.manifest.name};}}});
        await fs.writeFile(file, JSON.stringify(theme));
        let task = installer.open(file); await waitForWindow(1);
        let window=windows.at(-1), event={sender:window.webContents,senderFrame:window.webContents.mainFrame};
        assert.equal(window.options.modal, undefined); assert.equal(window.options.parent, undefined); assert.equal(window.options.webPreferences.sandbox, true);
        assert.equal((await handlers.get('theme-install:details')(event)).name, theme.manifest.name);
        await assert.rejects(handlers.get('theme-install:details')({...event,senderFrame:{}}));
        assert.equal(installed.length,0);
        handlers.get('theme-install:cancel')(event); assert.equal(await task,null); assert.equal(installed.length,0);
        await assert.rejects(handlers.get('theme-install:details')(event), 'closed windows lose access');
        task=installer.open(file); await waitForWindow(2);
        window=windows.at(-1); event={sender:window.webContents,senderFrame:window.webContents.mainFrame};
        await fs.writeFile(file,'{}');
        assert.equal((await handlers.get('theme-install:confirm')(event)).ok,true);
        assert.equal((await task).name,theme.manifest.name); assert.equal(installed[0].manifest.name,theme.manifest.name,'installs the previewed snapshot even if the source changes');
        await assert.rejects(installer.open(file)); assert.equal(windows.length,2,'invalid files never get an installable preview');
        console.log('PASS: standalone sandboxed installer, sender/frame isolation, cancel without writes, closed-window cleanup and previewed snapshot installation.');
    } finally {await fs.rm(temporary,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
