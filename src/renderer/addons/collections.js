(function () {
    const api = window.addonProviders;
    if (!api) return;
    const names = new Map(), epochs = new Map();
    let restoreRunning=false,restoreRequested=false;
    const referencesKey = 'addon_service_playlists', imageCache = new Map(), imageJobs = [];
    let imageBusy = 0, menu = null;
    const node = (tag, cls, text) => { const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el; };
    const identity = (owner, args) => JSON.stringify([owner,args.provider,args.accountId,args.catalog,args.id]);
    const catalogs = () => window.addonContributions?.catalogs() || [];
    const currentCatalog = source => catalogs().find(c=>c.owner===source.owner&&c.id===source.catalog&&c.accountId===source.accountId&&c.hash===source.hash);
    const register = api.register.bind(api), cleanup = api.cleanup.bind(api), watch = api.watch.bind(api);
    api.register = (owner, hash, args, call) => { register(owner,hash,args,call); names.set(owner+':'+args.id,args.name); };
    const reference = pl => ({owner:pl.addonId,provider:pl.providerId,accountId:pl.accountId,catalog:pl.service.catalog,id:pl.service.id,name:pl.name,playlistId:pl.id});
    function saved() { try { const value=JSON.parse(appStorage.getItem(referencesKey)||'[]');return Array.isArray(value)?value.filter(item=>item&&['owner','provider','accountId','catalog','id','playlistId'].every(key=>typeof item[key]==='string'&&item[key].length>0&&item[key].length<=300)).slice(0,64):[]; } catch(_){return [];} }
    function remember(pl) {
        const values=saved(),value=reference(pl),key=identity(value.owner,value),index=values.findIndex(item=>identity(item.owner,item)===key);
        if(index>=0)values[index]=value;else values.push(value);
        appStorage.setItem(referencesKey,JSON.stringify(values.slice(-64)));
    }
    async function read(source, args={}) {
        if(!currentCatalog(source))throw new Error('Интеграция отключена или аккаунт изменился');
        if(source.query){
            const page=await window.addonContributions.invoke(source.owner,'','catalog.search',{catalog:source.catalog,query:source.query,cursor:args.cursor});
            if(!currentCatalog(source))throw new Error('Интеграция отключена');
            return {id:source.id,name:'Поиск: '+source.query,revision:source.revision,tracks:page.items.map(track=>({...track,entryId:'search-'+track.id})),cursor:page.cursor};
        }
        const result=await window.addonContributions.invoke(source.owner,'','servicePlaylists.read',{catalog:source.catalog,id:source.id,...args});
        if(!currentCatalog(source))throw new Error('Интеграция отключена или аккаунт изменился');
        return result;
    }
    function convert(owner, provider, track, index) {
        if(!track||typeof track.id!=='string'||!track.id||track.id.length>300||typeof track.title!=='string'||!track.title)throw new Error('Некорректный трек сервиса');
        return {kind:'provider',trackId:track.id,id:track.id,title:track.title.slice(0,300),name:track.title.slice(0,300),artist:String(track.artist||'').slice(0,300),album:String(track.album||'').slice(0,300),
            artwork:typeof track.artwork==='string'?track.artwork:'',duration:Number(track.duration)||0,canonicalId:String(track.canonicalId||track.id),entryId:track.entryId||'entry-'+index,addonId:owner,providerId:provider};
    }
    function notifyError(error) { showNotification?.(String(error.message||error),'error','Музыкальный сервис'); }
    function update(pl) {
        renderPlaylistsDropdown();
        if(currentPlaylistId===pl.id)api.render(pl);
        document.dispatchEvent(new CustomEvent('service-playlist-updated',{detail:{playlistId:pl.id}}));
    }
    api.collection = async (owner,args,entryId) => {
        if(!api.has(owner,args.provider))throw new Error('Интеграция отключена');
        if(!Array.isArray(args.tracks)||args.tracks.length>10000)throw new Error('Не более 10000 треков');
        const key=identity(owner,args);
        let pl=userPlaylists.find(item=>item.type==='provider'&&item.collectionKey===key);
        const existing=saved().find(item=>identity(item.owner,item)===key);
        if(!pl){pl={id:existing?.playlistId||'provider_'+crypto.randomUUID(),type:'provider',addonId:owner,collectionKey:key};userPlaylists.push(pl);}
        const tracks=args.tracks.map((track,index)=>convert(owner,args.provider,track,index));
        if(activePlaylistId===pl.id&&pl.playingEntryId&&!tracks.some(track=>track.entryId===pl.playingEntryId)) {
            const playing=pl.tracks?.find(track=>track.entryId===pl.playingEntryId);if(playing)tracks.unshift(playing);
        }
        Object.assign(pl,{name:String(args.name||names.get(owner+':'+args.provider)||'Музыкальный сервис').slice(0,300),providerId:args.provider,accountId:args.accountId,tracks,artwork:args.artwork||'',serviceName:names.get(owner+':'+args.provider)||'Интеграция'});
        if(args.catalog)pl.service={owner,catalog:args.catalog,id:args.id,accountId:args.accountId,hash:args.hash,cursor:args.cursor||null,revision:args.revision,query:args.searchQuery||null,continuous:!!args.continuous,total:args.total,error:'',pending:null};
        if(pl.service&&args.persist!==false)remember(pl);
        renderPlaylistsDropdown();
        if(args.select!==false)await selectPlaylist(pl.id);
        else if(currentPlaylistId===pl.id)api.render(pl);
        if(entryId!==undefined){const index=pl.tracks.findIndex(track=>track.entryId===entryId);if(index<0)throw new Error('Трек больше не находится в плейлисте');await playTrack(playlistOrder.indexOf(index));}
        return pl;
    };
    api.openCollection = async (catalog,id,{select=true,limit=300,playEntry}={}) => {
        const source={owner:catalog.owner,catalog:catalog.id,id,accountId:catalog.accountId,hash:catalog.hash};
        const result=await read(source,{reason:'open'});
        const pl=await api.collection(catalog.owner,{...result,provider:catalog.providerId,accountId:catalog.accountId,catalog:catalog.id,hash:catalog.hash,select});
        // One SDK callback stays <=100 items; opening a collection loads several pages without a monolithic RPC.
        while(pl.service.cursor&&!pl.service.continuous&&pl.tracks.length<limit)await api.loadMore(pl);
        if(playEntry!==undefined){const index=pl.tracks.findIndex(track=>track.entryId===playEntry);if(select&&index>=0)await playTrack(playlistOrder.indexOf(index));}
        return pl;
    };
    api.loadMore = async (pl,{after,force=false}={}) => {
        const source=pl.service;if(!source||(!source.cursor&&!source.continuous))return 0;
        if(source.pending)return source.pending;
        if(!force&&source.retryAt>Date.now())return 0;
        const epoch=epochs.get(pl.addonId)||0;
        source.pending=(async()=>{
            const result=await read(source,{cursor:source.cursor,after,reason:'continue'});
            if(pl.service!==source||(epochs.get(pl.addonId)||0)!==epoch||!userPlaylists.includes(pl))return 0;
            if(!source.continuous&&result.revision!==source.revision)throw new Error('Плейлист изменился. Обновите его из интеграции.');
            const known=new Set(pl.tracks.slice(source.continuous?-50:0).map(track=>source.continuous?track.canonicalId:track.entryId));
            const incoming=(result.tracks||[]).map((track,index)=>convert(pl.addonId,pl.providerId,track,pl.tracks.length+index));
            const added=incoming.filter(track=>{const id=source.continuous?track.canonicalId:track.entryId;if(known.has(id))return false;known.add(id);return true;});
            if(pl.tracks.length+added.length>10000&&!source.continuous)throw new Error('Достигнут предел 10000 треков');
            pl.tracks.push(...added);source.cursor=result.cursor||null;source.continuous=result.continuous===true;source.error='';source.retryAt=added.length?0:Date.now()+5000;
            if(source.continuous&&pl.tracks.length>500){const playing=pl.tracks.findIndex(track=>track.entryId===pl.playingEntryId),count=Math.min(pl.tracks.length-500,Math.max(0,playing-20));if(count){pl.tracks.splice(0,count);playNextIndex=playNextIndex>=count?playNextIndex-count:-1;}}
            update(pl);return added.length;
        })().catch(error=>{if(pl.service===source)source.error=error.message;throw error;}).finally(()=>{source.pending=null;if(currentPlaylistId===pl.id){const button=playlistElem.querySelector('.provider-load-more button');if(button)button.disabled=false;}});
        return source.pending;
    };
    api.ensureNext = async token => {
        const pl=userPlaylists.find(item=>item.id===activePlaylistId);
        if(!pl?.service||currentPlaylistId!==pl.id)return;
        if(isShuffle?currentShufflePos+1<shuffleList.length:currentIndex+1<playlistOrder.length)return;
        const after=fileEntries[playlistOrder[currentIndex]]?.trackId;
        await api.loadMore(pl,{after,force:true});
        if(token!==_loadToken)return;
    };
    api.play = async (owner,args) => {
        const active=userPlaylists.find(pl=>pl.id===activePlaylistId),found=active?.addonId===owner&&active.providerId===args.provider?active.tracks.findIndex(track=>track.trackId===args.track.id):-1;
        if(found>=0){if(currentPlaylistId!==active.id)await selectPlaylist(active.id);return playTrack(playlistOrder.indexOf(found));}
        const name=names.get(owner+':'+args.provider)||'Музыкальный сервис';
        const track={...args.track,entryId:'track-'+args.track.id};
        return api.collection(owner,{provider:args.provider,id:'selection',name,tracks:[track],persist:false},track.entryId);
    };
    function addQueue(pl,track,next=false) {
        if(externalAudioQueue.length>=500)throw new Error('Очередь заполнена');
        const entry={queueId:crypto.randomUUID(),provider:{addonId:pl.addonId,providerId:pl.providerId,track:{...track,id:track.trackId||track.id}}};
        if(next)externalAudioQueue.unshift(entry);else externalAudioQueue.push(entry);
        window.addonEvents.emit('queue.changed');
    }
    function hideMenu(){if(menu){menu.remove();menu=null;}}
    api.menu = (event,{pl,track,play,remove}) => {
        event.preventDefault();event.stopPropagation();hideMenu();
        menu=node('div','context-menu provider-context-menu');menu.setAttribute('role','menu');
        const target=menu;
        const action=(label,icon,run)=>{const button=node('button');button.type='button';button.setAttribute('role','menuitem');button.append(AddonPermissionView.icon(icon,'provider-menu-icon'),node('span','',label));button.addEventListener('click',()=>{if(button.disabled)return;button.disabled=true;hideMenu();Promise.resolve().then(run).catch(notifyError);});target.append(button);return button;};
        action('Воспроизвести','Play',play);
        action('Воспроизвести следующим','ListStart',()=>addQueue(pl,track,true));
        action('Добавить в очередь','ListPlus',()=>addQueue(pl,track));
        if(remove)action('Убрать из этого списка','ListMinus',remove);
        document.body.append(menu);menu.style.display='block';
        const position=()=>{target.style.left=Math.max(8,Math.min(event.clientX,innerWidth-target.offsetWidth-8))+'px';target.style.top=Math.max(8,Math.min(event.clientY,innerHeight-target.offsetHeight-8))+'px';};
        position();menu.querySelector('button')?.focus();
        const entry={...track,addonId:pl.addonId,providerId:pl.providerId};
        const loading=action('Загрузка действий…','LoaderCircle',()=>{});loading.disabled=true;
        api.actions(entry).then(actions=>{
            if(menu!==target)return;
            loading.remove();
            for(const item of actions)action(item.title,item.icon,()=>api.action(entry,item.id));
            position();
        }).catch(error=>{if(menu===target){loading.textContent='Не удалось загрузить действия';loading.title=String(error.message||error);position();}});
    };
    document.addEventListener('click',hideMenu);document.addEventListener('scroll',hideMenu,true);document.addEventListener('keydown',event=>{if(event.key==='Escape')hideMenu();});
    async function drainImages(){
        while(imageBusy<2&&imageJobs.length){const job=imageJobs.shift();if(job.image&&!job.image.isConnected){job.resolve('');continue;}imageBusy++;
            noctune.addons.services(job.catalog.owner,job.catalog.hash,'providers.artwork',{url:job.url}).then(value=>{imageCache.set(job.key,value);while(imageCache.size>96)imageCache.delete(imageCache.keys().next().value);if(job.image?.isConnected){job.image.src=value;job.image.classList.add('loaded');}job.resolve(value);}).catch(()=>job.resolve('')).finally(()=>{imageBusy--;drainImages();});}
    }
    api.artwork = entry => {
        const catalog=catalogs().find(item=>item.owner===entry.addonId&&item.providerId===entry.providerId);
        if(!catalog||!entry.artwork)return Promise.resolve('');
        const key=catalog.owner+':'+catalog.hash+':'+entry.artwork;
        if(imageCache.has(key))return Promise.resolve(imageCache.get(key));
        return new Promise(resolve=>{imageJobs.push({image:null,url:entry.artwork,catalog,key,resolve});drainImages();});
    };
    const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{for(const item of entries)if(item.isIntersecting){observer.unobserve(item.target);item.target._loadArtwork?.();}},{rootMargin:'120px'}):null;
    api.image = (image,url,catalog) => {
        if(!url||!catalog)return;
        image.alt='';image.decoding='async';
        image.addEventListener('error',()=>{image.removeAttribute('src');image.classList.remove('loaded');},{once:true});
        image._loadArtwork=()=>{const key=catalog.owner+':'+catalog.hash+':'+url;if(imageCache.has(key)){image.src=imageCache.get(key);image.classList.add('loaded');return;}
            return new Promise(resolve=>{imageJobs.push({image,url,catalog,key,resolve});drainImages();});};
        if(observer)observer.observe(image);else image._loadArtwork();
    };
    api.trackRow = ({track,index,pl,catalog,play,remove}) => {
        const row=node('li','provider-track'),image=node('img','track-cover-thumb'),placeholder=node('div','track-cover-placeholder');
        if(index!==undefined)row.dataset.id=index;
        placeholder.append(AddonPermissionView.icon('Music','provider-track-icon'));
        const info=node('div','track-name-block');info.append(node('div','track-title-item',track.title),node('div','track-artist-item',track.artist||'Неизвестный исполнитель'));
        const duration=node('div','track-meta',track.duration?formatTime(track.duration):'');if(index!==undefined)duration.id='meta-'+index;
        const button=node('button','actions-btn');button.type='button';button.setAttribute('aria-label','Действия с треком «'+track.title+'»');button.append(AddonPermissionView.icon('EllipsisVertical','provider-track-icon'));
        const intentPlay=()=>{window.addonEvents.emit('playback.skip',{reason:'selection'});return play();};
        const context=event=>api.menu(event,{pl,track,play:intentPlay,remove});
        button.addEventListener('click',context);row.addEventListener('contextmenu',context);
        row.addEventListener('click',event=>{if(!event.target.closest('.actions-btn, .provider-inline-actions'))Promise.resolve().then(intentPlay).catch(notifyError);});
        row.tabIndex=0;row.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target===row){event.preventDefault();Promise.resolve().then(intentPlay).catch(notifyError);}});
        row.append(image,placeholder,info,duration);
        const entry={...track,addonId:pl.addonId,providerId:pl.providerId};
        if(api.hasInline(entry))row.append(inlineControls(entry));
        row.append(button);api.image(image,track.artwork,catalog);return row;
    };
    // Only visible rows request state; two callbacks at a time stay within Worker quotas.
    const inlineJobs=[], inlineQueued=new WeakSet();let inlineBusy=0;
    function queueInline(control){if(inlineQueued.has(control))return;inlineQueued.add(control);inlineJobs.push(control);drainInline();}
    function drainInline(){while(inlineBusy<2&&inlineJobs.length){const control=inlineJobs.shift();inlineQueued.delete(control);if(!control.isConnected)continue;inlineBusy++;control._refresh().finally(()=>{inlineBusy--;drainInline();});}}
    const inlineObserver=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{for(const item of entries)if(item.isIntersecting){inlineObserver.unobserve(item.target);queueInline(item.target);}}):null;
    function inlineControls(entry){
        const control=node('span','provider-inline-actions');control._entry=entry;let sequence=0;
        control.addEventListener('click',event=>event.stopPropagation());
        control._refresh=async()=>{
            const serial=++sequence;
            try{
                const actions=await api.actions(entry,'row');if(!control.isConnected||serial!==sequence)return;
                control.replaceChildren();
                for(const action of actions.filter(item=>item.inline).slice(0,3)){
                    const button=node('button','provider-inline-action'+(action.active?' is-active':''));button.type='button';button.title=action.title;button.setAttribute('aria-label',action.title);button.setAttribute('aria-pressed',String(action.active));button.append(AddonPermissionView.icon(action.icon,'provider-track-icon'));
                    button.addEventListener('click',async()=>{
                        if(button.disabled)return;button.disabled=true;
                        try{await api.actions(entry);await api.action(entry,action.id);}catch(error){notifyError(error);}finally{queueInline(control);}
                    });control.append(button);
                }
                control.removeAttribute('title');
            }catch(error){if(serial===sequence){control.replaceChildren();control.title=String(error.message||error);}}
        };
        queueMicrotask(()=>{if(!control.isConnected)return;if(inlineObserver)inlineObserver.observe(control);else queueInline(control);});
        return control;
    }
    document.addEventListener('provider-track-actions-changed',event=>{
        const {addonId,providerId,trackIds}=event.detail;
        for(const control of document.querySelectorAll('.provider-inline-actions')){
            const entry=control._entry;if(!entry||entry.addonId!==addonId||entry.providerId!==providerId||trackIds&&!trackIds.includes(entry.trackId||entry.id))continue;
            for(const button of control.querySelectorAll('button'))button.disabled=true;
            if(inlineObserver)inlineObserver.observe(control);else queueInline(control);
        }
    });
    api.render = pl => {
        const previousShuffle=isShuffle&&activePlaylistId===pl.id?shuffleList.map(index=>fileEntries[playlistOrder[index]]?.entryId):[];
        fileEntries=pl.tracks.slice();playlistOrder=fileEntries.map((_,i)=>i);parsedMetadataCache={};
        currentIndex=activePlaylistId===pl.id?fileEntries.findIndex(track=>track.entryId===pl.playingEntryId):-1;
        shuffleList=[];currentShufflePos=-1;
        if(isShuffle){
            const positions=new Map(fileEntries.map((track,index)=>[track.entryId,index]));
            shuffleList=previousShuffle.filter(id=>positions.has(id)).map(id=>positions.get(id));
            if(!shuffleList.length)buildShuffleList();
            else {
                const known=new Set(shuffleList),added=playlistOrder.filter(index=>!known.has(index));
                for(let i=added.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[added[i],added[j]]=[added[j],added[i]];}
                shuffleList.push(...added);currentShufflePos=shuffleList.indexOf(currentIndex);
            }
        }
        playlistElem.replaceChildren();
        const catalog=pl.service&&currentCatalog(pl.service)||catalogs().find(item=>item.owner===pl.addonId&&item.providerId===pl.providerId);
        fileEntries.forEach((track,index)=>{const row=api.trackRow({track,index,pl,catalog,play:()=>playTrack(playlistOrder.indexOf(index)),remove:()=>{if(track.entryId===pl.playingEntryId&&activePlaylistId===pl.id){stopTrack();updatePlayIcons(false);pl.playingEntryId=null;}pl.tracks.splice(index,1);update(pl);}});if(index===currentIndex)row.classList.add('active');playlistElem.append(row);});
        if(pl.service&&(!pl.service.continuous&&pl.service.cursor||pl.service.error)){const row=node('li','provider-load-more'),button=node('button','btn',pl.service.continuous?'Обновить поток':'Загрузить ещё треки');button.type='button';button.disabled=!!pl.service.pending;button.addEventListener('click',()=>api.loadMore(pl,{after:fileEntries[playlistOrder[currentIndex]]?.trackId,force:true}).catch(notifyError));row.append(button);playlistElem.append(row);}
        if(!pl.tracks.length)playlistElem.append(node('li','provider-empty','В этом списке пока нет треков'));
        if(activePlaylistId!==pl.id)statusText.textContent=pl.service?.continuous?'Поток сервиса':`Треков: ${pl.tracks.length}${pl.service?.total?' из '+pl.service.total:''}`;
    };
    api.watch = (element,entry,token) => {
        watch(element,entry,token);
        element.addEventListener('timeupdate',()=>{if(token!==_loadToken||element.paused)return;const pl=userPlaylists.find(item=>item.id===activePlaylistId);if(pl?.service&&!pl.service.pending&&currentPlaylistId===pl.id&&(isShuffle?currentShufflePos>=shuffleList.length-2:currentIndex>=playlistOrder.length-2)&&element.currentTime>Math.min(15,element.duration/2))api.loadMore(pl,{after:entry.trackId}).catch(()=>{});});
    };
    api.cleanup = owner => {hideMenu();if(userPlaylists.some(pl=>pl.id===activePlaylistId&&pl.addonId===owner)){stopTrack();updatePlayIcons(false);activePlaylistId=null;}epochs.set(owner,(epochs.get(owner)||0)+1);cleanup(owner);for(const key of imageCache.keys())if(key.startsWith(owner+':'))imageCache.delete(key);};
    api.removeCatalog = (owner,catalog) => {
        const removed=userPlaylists.filter(pl=>pl.addonId===owner&&pl.service?.catalog===catalog);
        if(removed.some(pl=>pl.id===activePlaylistId)){stopTrack();updatePlayIcons(false);activePlaylistId=null;}
        userPlaylists=userPlaylists.filter(pl=>!removed.includes(pl));
        if(removed.some(pl=>pl.id===currentPlaylistId)){currentPlaylistId=null;fileEntries=[];playlistOrder=[];playlistElem.replaceChildren();}
        renderPlaylistsDropdown();
    };
    api.closeCollection = id => {
        const pl=userPlaylists.find(item=>item.id===id&&item.type==='provider');if(!pl)return;
        const values=saved().filter(item=>item.playlistId!==id);appStorage.setItem(referencesKey,JSON.stringify(values));
        if(activePlaylistId===id){stopTrack();updatePlayIcons(false);activePlaylistId=null;}
        userPlaylists=userPlaylists.filter(item=>item!==pl);
        if(currentPlaylistId===id){currentPlaylistId=null;fileEntries=[];playlistOrder=[];playlistElem.replaceChildren();if(userPlaylists[0])selectPlaylist(userPlaylists[0].id);}
        renderPlaylistsDropdown();
    };
    api.restore = async () => {
        restoreRequested=true;if(restoreRunning)return;restoreRunning=true;
        try {
            do {
                restoreRequested=false;
                for(const value of saved()){
                    const catalog=catalogs().find(item=>item.owner===value.owner&&item.id===value.catalog&&item.accountId===value.accountId);
                    if(!catalog||userPlaylists.some(pl=>pl.collectionKey===identity(value.owner,value)))continue;
                    // Restore sequentially to respect each extension's network and Worker limits.
                    try {await api.openCollection(catalog,value.id,{select:false});}catch(_){}
                }
            }while(restoreRequested);
        }finally{restoreRunning=false;}
    };
    document.addEventListener('addon-contributions-changed',api.restore);
})();
