(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory;else root.addonInterface=factory(document);})(globalThis,function(document){
    const elements=new Map();
    const validId=id=>typeof id==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(id);
    const error=()=>{throw new Error(globalThis.noctuneI18n?.t('permissions.interface.invalid') ?? 'Invalid interface request');};
    function render(){
        for(const slot of document.querySelectorAll('[data-addon-elements]'))slot.remove();
        for(const [owner,items] of elements){
            const card=[...document.querySelectorAll('#addon-integrations [data-addon-id], #addons-list [data-addon-id]')].find(node=>node.dataset.addonId===owner);
            if(!card)continue;
            const slot=document.createElement('div');slot.dataset.addonElements=owner;slot.setAttribute('aria-live','polite');
            for(const item of items.values()){
                const row=document.createElement('div');row.className='settings-row';
                const label=document.createElement('strong'),value=document.createElement('span');label.textContent=item.label;value.textContent=item.value;row.append(label,value);
                if(item.progress!==undefined){const progress=document.createElement('progress');progress.max=1;progress.value=item.progress;progress.setAttribute('aria-label',item.label);row.append(progress);}
                slot.append(row);
            }
            card.append(slot);
        }
    }
    document.addEventListener('addon-integrations-rendered',render);
    return {
        invoke(owner,method,args,grants){
            const permission=method.startsWith('ui.')?'ui.elements':method;
            if(!grants.has(permission))error();
            if(method==='notifications.dismiss'){
                if(!validId(args.key))error();let removed=false;
                for(const toast of document.querySelectorAll('#notification-stack .notification-toast'))if(toast.dataset.replaceKey===owner+':'+args.key){toast.remove();removed=true;}
                return removed;
            }
            if(!['ui.set','ui.remove'].includes(method)||!validId(args.id))error();
            const items=elements.get(owner)||new Map();
            if(method==='ui.remove'){const removed=items.delete(args.id);if(!items.size)elements.delete(owner);render();return removed;}
            if(typeof args.label!=='string'||!args.label.trim()||args.label.length>120||typeof args.value!=='string'||args.value.length>500||args.progress!==undefined&&(!Number.isFinite(args.progress)||args.progress<0||args.progress>1)||!items.has(args.id)&&items.size>=8)error();
            items.set(args.id,{label:args.label,value:args.value,progress:args.progress});elements.set(owner,items);render();return null;
        },
        cleanup(owner){elements.delete(owner);for(const toast of document.querySelectorAll('#notification-stack .notification-toast'))if(toast.dataset.replaceKey?.startsWith(owner+':'))toast.remove();render();},
    };
});
