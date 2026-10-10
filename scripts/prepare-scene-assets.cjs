// Normalize generated backgrounds and existing alpha layers to the final scene canvas.
// Run with Electron; no windows are opened and no character artwork is regenerated.
const {app,nativeImage}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
app.whenReady().then(async()=>{
    const [sky,outside]=process.argv.slice(2);
    if(!sky||!outside)throw new Error('Provide the two imagegen output paths');
    for(const [id,replacement] of [['02-night-hill',sky],['03-rain-window',outside]]){
        const dir=path.join(root,'themes/builtin',id),manifestPath=path.join(dir,'manifest.json');
        const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
        for(const [key,relative] of Object.entries(manifest.assets)){
            if(key==='preview')continue;
            const target=path.join(dir,relative),source=key==='sky'||key==='outside'?replacement:target;
            const image=nativeImage.createFromPath(source);
            if(image.isEmpty())throw new Error('Invalid image: '+source);
            await fs.writeFile(target,image.resize({width:1920,height:1080,quality:'best'}).toPNG());
            console.log(id+'/'+key+': 1920x1080');
        }
        manifest.width=1920;manifest.height=1080;manifest.version='1.2.0';
        await fs.writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
    }
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>app.quit());
