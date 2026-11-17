const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
(async()=>{
 let now=1000,calls=0,active=true,release,block=false,invalidations=0,invalidateInAction=false;const context={Date:{now:()=>now},document:{dispatchEvent(){invalidations++;}},Event:class{},CustomEvent:class{},userPlaylists:[],playlistOrder:[],currentIndex:-1,fileEntries:[],externalAudioQueue:[],renderPlaylistsDropdown(){},addonEvents:{emit(){}}};context.window=context;
 vm.runInNewContext(fs.readFileSync('src/renderer/addons/providers.js','utf8'),context);
 const api=context.addonProviders,one={addonId:'cache-addon',providerId:'cache-provider',trackId:'one'},two={...one,trackId:'two'};
 api.register(one.addonId,'hash',{id:one.providerId,name:'Cache',trackActions:true,inlineActions:true},async action=>{if(action!=='trackActions'){if(invalidateInAction)api.invalidate(one.addonId,{provider:one.providerId,trackIds:['one']});return;}calls++;if(block)await new Promise(resolve=>release=resolve);return [{id:active?'unlike':'like',title:'Like',icon:'Heart',inline:true,active}];});
 await api.actions(one,'row');await api.actions(two,'row');assert.equal(calls,2);
 await api.actions(one,'row');assert.equal(calls,2);assert.equal(api.cachedActions(one)[0].active,true);
 api.invalidate(one.addonId,{provider:one.providerId,trackIds:['one']});assert.equal(api.cachedActions(one)[0].active,true,'last confirmed icon remains paintable during refresh');
 await api.actions(two,'row');assert.equal(calls,2,'unrelated row remains cached');
 active=false;block=true;const first=api.actions(one,'row'),second=api.actions(one,'row');assert.equal(calls,3,'same-track callbacks coalesce');release();await Promise.all([first,second]);block=false;assert.equal(api.cachedActions(one)[0].active,false);
 await assert.rejects(api.action(one,'forged'),/устарело/);await api.actions(one);assert.equal(calls,4,'menu revalidates even with fresh row cache');
 now+=61000;await api.actions(one,'row');assert.equal(calls,5,'expired row revalidates');
 await api.actions(one);invalidateInAction=true;const beforeInvalidation=invalidations;await api.action(one,'like');assert.equal(invalidations,beforeInvalidation+1,'explicit provider invalidation is not duplicated after its action');
 api.cleanup(one.addonId);assert.equal(api.cachedActions(one),undefined);
 console.log('PASS: immediate last-state rendering, same-track coalescing, targeted invalidation, independent menu authorization, TTL refresh and cleanup.');
})().catch(error=>{console.error(error);process.exitCode=1;});
