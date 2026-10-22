(function () {
    const api=window.addonContributions;
    if(!api)return;
    const node=(tag,cls,text)=>{const element=document.createElement(tag);if(cls)element.className=cls;if(text!==undefined)element.textContent=text;return element;};
    const catalogsRoot=node('div','addons-list');catalogsRoot.id='addon-catalogs';document.getElementById('panel-addons').append(catalogsRoot);
    const schemesRow=node('div','settings-row');schemesRow.id='addon-color-schemes';document.getElementById('setting-dark-theme').closest('.settings-card').append(schemesRow);
    function renderSchemes() {
        schemesRow.replaceChildren();const items=api.schemes();schemesRow.hidden=!items.length;if(!items.length)return;
        schemesRow.append(node('label','settings-row-label','Цветовая схема расширения'));
        const control=window.addonSettingsControls.dropdown({label:'Цветовая схема',options:[{value:'',label:'Выберите схему'},...items.map((item,index)=>({value:String(index),label:item.name}))]},'','addon-color-scheme');
        control.input.addEventListener('change',()=>{const item=items[Number(control.input.value)];if(item)api.userScheme(item.owner,item.id);});schemesRow.append(control.wrapper);
    }
    async function play(catalog,track) {return window.addonProviders.play(catalog.owner,{provider:catalog.providerId,track});}
    function renderCatalogs() {
        catalogsRoot.replaceChildren();
        for(const catalog of api.catalogs()) {
            const card=node('article','settings-card addon-catalog'),status=node('p','settings-row-desc'),toolbar=node('div','addons-toolbar'),body=node('div','addon-catalog-content');
            card.append(node('h3','addon-name',catalog.name),status,toolbar,body);catalogsRoot.append(card);
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
    }
    document.addEventListener('addon-contributions-changed',()=>{renderSchemes();renderCatalogs();});
    renderSchemes();renderCatalogs();
})();
