(function () {
    const api=window.addonContributions;
    if(!api)return;
    const node=(tag,cls,text)=>{const element=document.createElement(tag);if(cls)element.className=cls;if(text!==undefined)element.textContent=text;return element;};
    const catalogsRoot=node('div','addons-list');catalogsRoot.id='addon-catalogs';document.getElementById('panel-addons').append(catalogsRoot);
    const libraries=new Map();
    const schemesRow=node('div','settings-row');schemesRow.id='addon-color-schemes';document.getElementById('setting-dark-theme').closest('.settings-card').append(schemesRow);
    function renderSchemes() {
        schemesRow.replaceChildren();const items=api.schemes();schemesRow.hidden=!items.length;if(!items.length)return;
        schemesRow.append(node('label','settings-row-label','Цветовая схема расширения'));
        const control=window.addonSettingsControls.dropdown({label:'Цветовая схема',options:[{value:'',label:'Выберите схему'},...items.map((item,index)=>({value:String(index),label:item.name}))]},'','addon-color-scheme');
        control.input.addEventListener('change',()=>{const item=items[Number(control.input.value)];if(item)api.userScheme(item.owner,item.id);});schemesRow.append(control.wrapper);
    }
    async function play(catalog,track) {return window.addonProviders.play(catalog.owner,{provider:catalog.providerId,track});}
    function library(catalog) {
        const key=catalog.owner+':'+catalog.id,previous=libraries.get(key);
        if(previous&&previous.hash===catalog.hash&&previous.accountId===catalog.accountId)return previous.element;
        const element=node('section','integration-library addon-catalog'),toolbar=node('div','service-library-toolbar'),form=node('form','service-search'),search=node('input','integration-text-input'),refresh=node('button','actions-btn'),back=node('button','btn service-back','Назад'),heading=node('h4','service-library-heading','Библиотека'),status=node('p','settings-row-desc service-library-status'),body=node('div','service-library-content');
        const record={element,hash:catalog.hash,accountId:catalog.accountId};libraries.set(key,record);
        search.type='search';search.placeholder='Найти трек или исполнителя';search.maxLength=200;search.setAttribute('aria-label','Поиск в '+catalog.name);search.autocomplete='off';
        search.hidden=!catalog.capabilities.includes('search');form.append(search);
        refresh.type='button';refresh.setAttribute('aria-label','Обновить библиотеку');refresh.title='Обновить библиотеку';refresh.append(AddonPermissionView.icon('RefreshCw','provider-track-icon'));
        toolbar.append(form,refresh);back.type='button';back.hidden=true;element.append(toolbar,back,heading,status,body);
        let sequence=0,parent=null,selected=null,searchQuery='',timer=null,loading=false;
        const alive=id=>id===sequence&&libraries.get(key)===record&&api.catalogs().some(item=>item.owner===catalog.owner&&item.id===catalog.id&&item.hash===catalog.hash);
        const invoke=(method,args={})=>api.invoke(catalog.owner,'',method,{catalog:catalog.id,...args});
        function button(label,run,target=body){const el=node('button','btn',label);el.type='button';el.addEventListener('click',async()=>{el.disabled=true;try{await run();}catch(error){status.textContent=error.message;}finally{el.disabled=false;}});target.append(el);return el;}
        async function task(fn){const id=++sequence;loading=true;status.textContent='Загрузка…';refresh.disabled=true;try{await fn(id);if(alive(id))status.textContent='';}catch(error){if(alive(id))status.textContent=error.message;}finally{if(alive(id)){loading=false;refresh.disabled=false;}}}
        const selectionArgs=()=>({...selected,provider:catalog.providerId,catalog:catalog.id,hash:catalog.hash,accountId:catalog.accountId,persist:!searchQuery,searchQuery:searchQuery||undefined});
        async function openPlayer(entryId,close=false){
            const pl=await window.addonProviders.collection(catalog.owner,selectionArgs(),entryId);
            if(close)document.getElementById('settings-close-btn').click();return pl;
        }
        function drawTracks() {
            body.replaceChildren();heading.textContent=selected.name;back.hidden=false;
            const bar=node('div','service-playlist-toolbar'),count=node('span','settings-row-desc',selected.continuous?'Непрерывный поток':`${selected.tracks.length}${selected.total?' из '+selected.total:''} треков`);bar.append(count);
            if(catalog.playable)button('Открыть в плеере',()=>openPlayer(undefined,true),bar);body.append(bar);
            const rows=node('ul','service-tracks');
            for(const track of selected.tracks){
                const pl={addonId:catalog.owner,providerId:catalog.providerId};
                rows.append(window.addonProviders.trackRow({track,pl,catalog,play:()=>openPlayer(track.entryId)}));
            }
            body.append(rows);
            if(!selected.tracks.length)body.append(node('p','settings-row-desc','Треков пока нет'));
            if(selected.cursor&&!selected.continuous)button(searchQuery?'Ещё результаты':'Ещё 300 треков',()=>task(async id=>{
                const target=selected;let count=0;
                do {
                    if(searchQuery){const page=await invoke('catalog.search',{query:searchQuery,cursor:target.cursor});if(!alive(id))return;target.tracks.push(...page.items.map(track=>({...track,entryId:'search-'+track.id})));target.cursor=page.cursor;}
                    else {const page=await invoke('servicePlaylists.read',{id:target.id,cursor:target.cursor});if(!alive(id))return;if(page.revision!==target.revision)throw new Error('Плейлист изменился. Обновите список.');target.tracks.push(...page.tracks);target.cursor=page.cursor;}
                    count+=searchQuery?300:100;
                }while(target.cursor&&count<300&&target.tracks.length<10000);
                if(alive(id))drawTracks();
            }));
        }
        async function showPlaylist(id){searchQuery='';search.value='';await task(async serial=>{
            const result=await invoke('servicePlaylists.read',{id,reason:'open'});if(!alive(serial))return;
            while(result.cursor&&!result.continuous&&(result.tracks||[]).length<300){const page=await invoke('servicePlaylists.read',{id,cursor:result.cursor});if(!alive(serial))return;if(page.revision!==result.revision)throw new Error('Плейлист изменился. Откройте его заново.');result.tracks.push(...page.tracks);result.cursor=page.cursor;}
            selected=result;drawTracks();
        });}
        async function browse(next=null){searchQuery='';selected=null;await task(async serial=>{
            const page=await invoke('catalog.browse',{parent,cursor:next});if(!alive(serial))return;
            if(!next)body.replaceChildren();heading.textContent=parent?.title||'Библиотека';back.hidden=!parent;
            const grid=node('div','service-playlist-grid');
            for(const entry of page.items){
                if(entry.type==='track'){
                    const pl={addonId:catalog.owner,providerId:catalog.providerId};
                    grid.append(window.addonProviders.trackRow({track:entry,pl,catalog,play:()=>play(catalog,entry)}));continue;
                }
                const card=node('button','service-playlist-card'),cover=node('div','service-playlist-cover'),image=node('img'),fallback=node('span','service-playlist-symbol');card.type='button';
                fallback.append(AddonPermissionView.icon(entry.id==='wave'?'Radio':entry.id==='likes'?'Heart':entry.type==='playlist'?'ListMusic':'Library','service-playlist-icon'));cover.append(fallback,image);
                card.append(cover,node('span','service-playlist-name',entry.title),node('span','service-playlist-kind',entry.type==='playlist'?(entry.id==='wave'?'Поток':'Плейлист'):'Раздел'));
                window.addonProviders.image(image,entry.artwork,catalog);
                card.addEventListener('click',()=>entry.type==='playlist'?showPlaylist(entry.id):(parent={id:entry.id,type:entry.type,title:entry.title},browse()));grid.append(card);
            }
            body.append(grid);
            if(!page.items.length)body.append(node('p','settings-row-desc','Пока ничего нет'));
            if(page.cursor)button('Загрузить ещё',event=>browse(page.cursor));
        });}
        async function runSearch(){const query=search.value.trim();if(!query){parent=null;await browse();return;}parent=null;searchQuery=query;await task(async serial=>{
            const page=await invoke('catalog.search',{query});if(!alive(serial))return;
            selected={id:'search:'+query,name:'Поиск: '+query,revision:'search:'+query,tracks:page.items.map(track=>({...track,entryId:'search-'+track.id})),cursor:page.cursor};drawTracks();
        });}
        form.addEventListener('submit',event=>{event.preventDefault();clearTimeout(timer);runSearch();});
        search.addEventListener('input',()=>{clearTimeout(timer);sequence++;timer=setTimeout(runSearch,350);});
        back.addEventListener('click',()=>{search.value='';parent=null;browse();});
        refresh.addEventListener('click',()=>search.value.trim()?runSearch():selected?showPlaylist(selected.id):browse());
        // Wait for the card to mount before loading; detached views cannot consume image/network slots.
        queueMicrotask(()=>{if(element.isConnected)browse();});
        record.sync=playlist=>{if(!loading&&selected?.continuous&&playlist.service?.catalog===catalog.id&&playlist.service.id===selected.id&&playlist.addonId===catalog.owner){selected={...selected,tracks:playlist.tracks.slice(),cursor:playlist.service.cursor};if(element.isConnected)drawTracks();}};
        record.reload=()=>{if(!loading&&element.isConnected)browse();};
        return element;
    }
    function renderCatalogs() {
        catalogsRoot.replaceChildren();
        const active=new Set(api.catalogs().map(catalog=>catalog.owner+':'+catalog.id));
        for(const [key,record]of libraries)if(!active.has(key)){record.element.remove();libraries.delete(key);}
        for(const catalog of api.catalogs()) {
            const target=catalog.integration?document.querySelector('#integration-addon-'+catalog.owner+' .integration-library-slot'):catalogsRoot;
            if(!target)continue;
            if(!catalog.capabilities.some(action=>['create','rename','delete','addTracks','removeTracks','reorder'].includes(action))){const view=library(catalog);target.append(view);continue;}
            const card=node('article','settings-card addon-catalog'),status=node('p','settings-row-desc'),toolbar=node('div','addons-toolbar'),body=node('div','addon-catalog-content');
            card.append(node('h3','addon-name',catalog.name),status,toolbar,body);target.append(card);
            let selected=null,cursor=null,parent=null,lastMutation=null;
            const allowed=action=>catalog.capabilities.includes(action);
            const invoke=(action,args={})=>api.invoke(catalog.owner,'',action==='browse'?'catalog.browse':'servicePlaylists.'+action,{catalog:catalog.id,...args});
            const button=(title,fn,target=toolbar)=>{const element=node('button','btn',title);element.type='button';element.addEventListener('click',async()=>{element.disabled=true;try{await fn();status.textContent='';}catch(error){status.textContent=error.message;}finally{element.disabled=false;}});target.append(element);return element;};
            const nameInput=node('input','integration-text-input');nameInput.placeholder='Название плейлиста';nameInput.maxLength=300;nameInput.setAttribute('aria-label','Название плейлиста');
            async function mutate(action,extra={}) {
                const args={...(selected?{id:selected.id,revision:selected.revision}:{}),...extra};
                const fingerprint=JSON.stringify([action,args]);
                if(lastMutation?.fingerprint!==fingerprint)lastMutation={fingerprint,requestId:crypto.randomUUID()};
                const result=await invoke(action,{...args,requestId:lastMutation.requestId});lastMutation=null;
                if(action==='delete'){selected=null;await showPlaylists();}else await showPlaylist(result.id);
            }
            async function showPlaylist(id,next=null) {
                const result=await invoke('read',{id,cursor:next});
                if(next && selected?.revision!==result.revision)throw new Error('Плейлист изменился. Откройте его заново.');
                if(next && selected?.id===id)result.tracks=[...(selected.tracks||[]),...(result.tracks||[])];
                selected=result;cursor=result.cursor;body.replaceChildren();
                body.append(node('h4','settings-row-label',result.name));
                const controls=node('div','addons-toolbar');body.append(controls);
                if(allowed('rename')){nameInput.value=result.name;controls.append(nameInput);button('Переименовать',()=>mutate('rename',{name:nameInput.value}),controls);}
                if(allowed('delete'))button('Удалить плейлист',async()=>{if(confirm('Удалить плейлист «'+result.name+'» на сервере?'))await mutate('delete');},controls);
                const tracks=result.tracks||[];
                if(catalog.playable)button('Открыть загруженные треки в плеере',()=>window.addonProviders.collection(catalog.owner,{provider:catalog.providerId,accountId:catalog.accountId,id:result.id,name:result.name,tracks}),controls);
                tracks.forEach((track,index)=>{
                    const row=node('div','settings-row addon-catalog-track'),actions=node('div','addons-toolbar');row.append(node('span','settings-row-label',(track.artist?track.artist+' — ':'')+track.title),actions);body.append(row);
                    if(catalog.playable)button('Слушать',()=>window.addonProviders.collection(catalog.owner,{provider:catalog.providerId,accountId:catalog.accountId,id:result.id,name:result.name,tracks},track.entryId),actions);
                    if(allowed('removeTracks'))button('Убрать',()=>mutate('removeTracks',{entries:[track.entryId]}),actions);
                    if(allowed('reorder')&&!cursor&&tracks.length<=100&&index>0)button('Выше',()=>{const order=tracks.map(entry=>entry.entryId);[order[index-1],order[index]]=[order[index],order[index-1]];return mutate('reorder',{entries:order});},actions);
                });
                if(cursor)button('Ещё треки',()=>showPlaylist(id,cursor),body);
            }
            async function showPlaylists(next=null) {
                const result=await invoke('read',{cursor:next});if(!next)body.replaceChildren();cursor=result.cursor;
                for(const playlist of result.items)button(playlist.name,()=>showPlaylist(playlist.id),body);
                if(cursor)button('Ещё плейлисты',()=>showPlaylists(cursor),body);
            }
            async function browse(next=null) {
                const result=await invoke('browse',{parent,cursor:next});if(!next)body.replaceChildren();cursor=result.cursor;
                for(const entry of result.items) {
                    const row=node('div','settings-row addon-catalog-track'),actions=node('div','addons-toolbar');row.append(node('span','settings-row-label',entry.title),actions);body.append(row);
                    if(entry.type==='track') {
                        if(catalog.playable)button('Слушать',()=>play(catalog,entry),actions);
                        if(selected&&allowed('addTracks'))button('В «'+selected.name+'»',()=>mutate('addTracks',{tracks:[entry.id]}),actions);
                    } else if(entry.type==='playlist'&&allowed('read'))button('Открыть',()=>showPlaylist(entry.id),actions);
                    else button('Открыть',()=>{parent={id:entry.id,type:entry.type};return browse();},actions);
                }
                if(cursor)button('Загрузить ещё',()=>browse(cursor),body);
            }
            if(allowed('browse'))button('Каталог',()=>{parent=null;return browse();});
            if(allowed('read'))button('Плейлисты',()=>showPlaylists());
            if(allowed('create')){toolbar.append(nameInput);button('Создать плейлист',()=>{selected=null;return mutate('create',{name:nameInput.value});});}
        }
        catalogsRoot.hidden=!catalogsRoot.children.length;
    }
    document.addEventListener('addon-contributions-changed',()=>{renderSchemes();renderCatalogs();});
    document.addEventListener('addon-integrations-rendered',renderCatalogs);
    document.addEventListener('service-playlist-updated',event=>{const playlist=userPlaylists.find(item=>item.id===event.detail.playlistId);if(playlist)for(const record of libraries.values())record.sync?.(playlist);});
    renderSchemes();renderCatalogs();
})();
