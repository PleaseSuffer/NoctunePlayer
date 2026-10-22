/* Noctune Shades · official Noctune extension · MIT */
NoctuneAddon.define(async api => {
    const schemes = [
        ['graphite','Графит','dark',['#1b1b20','#26262d','#f2f2f5','#aaaab6','#3b3b45','#32323b','#a9a9be','#c9bddf']],
        ['slate','Сланец','dark',['#18212c','#243140','#eef4fc','#a8b8cd','#3a4a60','#2c3b4e','#7db5e8','#b9a7e7']],
        ['cocoa','Какао','dark',['#261e1c','#352925','#f6eee8','#c4ada0','#544039','#41322c','#dfb08b','#e7c5ab']],
        ['ivory','Слоновая кость','light',['#f5f0e7','#fffaf2','#37332d','#766b5b','#dbd1c1','#eae1d4','#9b6f44','#80575c']],
        ['mist','Туман','light',['#edf1f5','#fbfcfe','#2c3643','#657488','#ced7e2','#e1e8f0','#537daa','#78669d']],
        ['rose','Пудра','light',['#f7edef','#fff9fa','#44333a','#876873','#e7cfd7','#efdee4','#ad637e','#91628f']],
    ];
    const roles = ['background','surface','text','muted','border','hover','accent','secondary'];
    let settings = await api.settings.get(), work = Promise.resolve();
    const serialize = action => { const result=work.then(action);work=result.catch(()=>{});return result; };
    async function register() {
        for (const [id,name,mode,colors] of schemes) {
            const palette = Object.fromEntries(roles.filter(role=>role!=='accent'||!settings.keepAccent).map(role=>[role,colors[roles.indexOf(role)]]));
            await api.appearance.register({id,name,mode,palette});
        }
    }
    async function apply() { await api.appearance.switch({id:settings.applySelected?settings.scheme:null}); }
    api.on('settings.changed',event=>serialize(async()=>{
        const registerAgain=settings.keepAccent!==event.values.keepAccent; settings=event.values;
        if(registerAgain)await register(); await apply();
    }));
    api.onCommand('apply-selected',()=>serialize(()=>api.appearance.switch({id:settings.scheme})));
    api.onCommand('release-colors',()=>serialize(()=>api.appearance.switch({id:null})));
    await register(); await apply();
});
