/* Noctune Dusk · official Noctune extension · MIT */
NoctuneAddon.define(async api => {
    let settings=await api.settings.get(), lastTheme=null, lastWallpaper=null, timer=null, refreshTimer=null, work=Promise.resolve(), lastError=null, period=null;
    const serialize=action=>{const result=work.then(action);work=result.catch(()=>{});return result;};
    const notify=async message=>{try{await api.notify(message);}catch(_){}};
    function minute(value) {
        if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))throw new Error('Укажите время в формате ЧЧ:ММ, например 07:00.');
        const [hours,minutes]=value.split(':').map(Number);return hours*60+minutes;
    }
    function currentPeriod() {
        const day=minute(settings.dayStart),night=minute(settings.nightStart),now=new Date(),time=now.getHours()*60+now.getMinutes();
        if(day===night)throw new Error('Начало дня и ночи должны различаться.');
        return (day<night?time>=day&&time<night:time>=day||time<night)?'day':'night';
    }
    async function release() {
        await api.appearance.select({id:null}); await api.backgrounds.override({id:null});
        lastTheme=null; lastWallpaper=null; period=null;
    }
    async function apply(force=false,forceWallpaper=force) {
        if(!settings.automatic){if(lastTheme!==null||lastWallpaper!==null)await release();return;}
        try {
            const next=currentPeriod(),chosen=settings[next+'Theme'],available=await api.appearance.list();
            const found=available.find(item=>item.id===chosen);
            const target=found?chosen:next==='day'?'light':'dark';
            const themeKey=next+':'+target;
            if(force||lastTheme!==themeKey){await api.appearance.select({id:target});lastTheme=themeKey;}
            const wallpaper=settings.wallpapers?settings[next+'Wallpaper']:'';
            const wallpaperKey=next+':'+wallpaper;
            if(forceWallpaper||lastWallpaper!==wallpaperKey){
                if(wallpaper){const items=await api.backgrounds.list();if(!items.some(item=>item.id===wallpaper))throw new Error('Выбранные обои недоступны. Выберите другой фон в настройках Dusk.');}
                await api.backgrounds.override({id:wallpaper||null});lastWallpaper=wallpaperKey;
            }
            period=next;
            if(!found&&lastError!==chosen){lastError=chosen;await notify('Выбранная схема недоступна. Временно используется '+(next==='day'?'светлое':'тёмное')+' оформление. Включите расширение с нужной схемой.');}
            else if(found)lastError=null;
        } catch(error){
            if(!/обои/.test(error.message))await release();
            else{await api.backgrounds.override({id:null});lastWallpaper=null;}
            if(lastError!==error.message){lastError=error.message;await notify(error.message);}
        }
    }
    function schedule() {
        clearTimeout(timer);
        const now=new Date();
        timer=setTimeout(()=>serialize(async()=>{try{await apply();}finally{schedule();}}).catch(()=>{}),Math.max(1000,(60-now.getSeconds())*1000-now.getMilliseconds()+30));
    }
    api.on('settings.changed',event=>serialize(async()=>{settings=event.values;await apply(true);schedule();}));
    api.on('appearance.schemes',()=>{
        clearTimeout(refreshTimer);
        refreshTimer=setTimeout(()=>serialize(()=>apply(true,false)).catch(()=>{}),250);
    });
    api.onCommand('apply-now',()=>serialize(async()=>{await apply(true);schedule();}));
    api.onCommand('schedule-status',()=>serialize(async()=>{await notify(!settings.automatic?'Расписание выключено.':period==='day'?'Сейчас действует дневное оформление.':period==='night'?'Сейчас действует ночное оформление.':'Расписание ожидает корректных настроек.');}));
    await apply(); schedule();
});
