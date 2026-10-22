const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os'),fs=require('node:fs/promises');
const {Readable}=require('node:stream');
const root=path.resolve(__dirname,'../..'),network=require(path.join(root,'src/main/addons/network'));
let count=0,mode='valid',enabled=true,pending;
network.fetchText=async(url,options)=>{
    count++;assert.deepEqual(options.headers,{});assert.equal(options.headerOrigin,'https://images.example.com');
    if(mode==='pending')await new Promise((resolve,reject)=>{pending=resolve;options.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});});
    const response=Readable.from([mode==='large'?Buffer.alloc(512*1024+1):Buffer.from('fixture')]);
    response.statusCode=mode==='status'?404:200;response.headers={'content-type':mode==='svg'?'image/svg+xml':'image/png'};return response;
};
const {createAddonServices}=require(path.join(root,'src/main/addons/services'));
(async()=>{
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'noctune-artwork-'));
    try{
        const grants=['catalog.register','network.request'];
        const store={context:async(id,hash,permission)=>{if(!enabled||id!=='fixture'||hash!=='current'||!grants.includes(permission))throw new Error('Denied');return {grants,manifest:{network:{origins:['https://images.example.com'],routes:[{origin:'https://images.example.com',path:'/covers/',prefix:true,methods:['GET']}]}}};}};
        const services=createAddonServices({store,directory,safeStorage:{isEncryptionAvailable:()=>false}});
        const call=(url,extra={})=>services.invoke('fixture','current','providers.artwork',{url,...extra});
        assert.equal(await call('https://images.example.com/covers/a',{credential:'forbidden',oauth:'forbidden',headers:{Authorization:'never-forward'}}),'data:image/png;base64,Zml4dHVyZQ==');
        await call('https://images.example.com/covers/a');assert.equal(count,1,'memory cache');
        await assert.rejects(call('https://elsewhere.example/covers/a'),/Домен/);
        await assert.rejects(call('https://images.example.com/private/a'),/маршрут|Маршрут/);
        mode='svg';await assert.rejects(call('https://images.example.com/covers/b'),/обложка/);
        mode='status';await assert.rejects(call('https://images.example.com/covers/b'),/обложка/);
        mode='large';await assert.rejects(call('https://images.example.com/covers/b'),/512/);
        mode='pending';const request=call('https://images.example.com/covers/c');await new Promise(resolve=>setImmediate(resolve));services.cancel('fixture');await assert.rejects(request,/aborted/);
        mode='valid';await call('https://images.example.com/covers/a');assert.equal(count,6,'owner cleanup clears image cache');
        enabled=false;await assert.rejects(call('https://images.example.com/covers/a'),/Denied/);
        console.log('PASS: public artwork origin/routes, no credential forwarding, MIME/size/status restrictions, memory cache, cancellation and disabled owner.');
    }finally{await fs.rm(directory,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
