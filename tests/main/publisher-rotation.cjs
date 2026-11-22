const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const p=require('../../src/main/addons/package'),publishers=require('../../src/shared/addon-publishers'),{createAddonStore}=require('../../src/main/addons/store');
(async()=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'noctune-rotation-'));try{
 const old=await p.readPackage('addons/distribution/noctune-chroma/1.0.0/noctune-chroma-1.0.0.noctaddon'),next=await p.readPackage('addons/distribution/noctune-chroma/1.0.1/noctune-chroma-1.0.1.noctaddon');
 const a=p.signingIdentity(old,true),b=p.signingIdentity(next,true);assert(publishers.canRotate(old.manifest.id,a,b));assert(!publishers.canRotate('other-addon',a,b));assert(!publishers.canRotate(old.manifest.id,b,a));
 const store=createAddonStore({directory:root,appVersion:'1.4.1'});await store.confirm((await store.preparePackage(old)).ticket);await store.setEnabled(old.manifest.id,true);
 const candidate=await store.preparePackage(next);assert.deepEqual(candidate.publisherRotation,{from:a,to:b});await assert.rejects(store.confirm(candidate.ticket),/ключа/);assert.equal((await store.list())[0].publisher,a);
 await store.confirm(candidate.ticket,true);assert.equal((await store.list())[0].publisher,b);assert.equal((await store.list())[0].enabled,true);
 await store.rollback(old.manifest.id);assert.equal((await store.list())[0].publisher,a);assert.equal((await store.runtime()).length,1);
 console.log('PASS: bounded publisher rotation, separate mandatory consent, preserved enablement, legacy signature verification and rollback.');
}finally{await fs.rm(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
