/* Noctune Sleep · official Noctune extension · MIT */
NoctuneAddon.define(async api => {
    let settings = await api.settings.get(), deadline = 0, fading = false, timer = null, work = Promise.resolve();
    const serialize = action => { const result = work.then(action); work = result.catch(()=>{}); return result; };
    const notify = async message => { try { await api.notify(message); } catch (_) {} };
    async function release() { if (fading) { await api.audio.gain({gain:null}); fading = false; } }
    function schedule() {
        clearTimeout(timer);
        if (deadline) timer = setTimeout(()=>serialize(tick).catch(()=>{}),Math.min(1000,Math.max(50,deadline-Date.now())));
    }
    async function tick() {
        if (!deadline) return;
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
            deadline = 0; clearTimeout(timer);
            try { await api.player.pause(); await notify('Таймер завершён. Воспроизведение приостановлено.'); }
            catch (error) { await notify('Не удалось поставить воспроизведение на паузу: ' + error.message); }
            finally { await release(); }
            return;
        }
        try {
            if (settings.fade && !fading && remaining <= settings.fadeSeconds * 1000) {
                await api.audio.gain({gain:0,ramp:remaining/1000}); fading = true;
            }
        } catch (_) { await notify('Плавное затихание недоступно. Пауза сработает по таймеру.'); }
        finally { schedule(); }
    }
    async function start() {
        await release(); deadline = Date.now() + settings.minutes * 60000;
        await notify('Таймер запущен: ' + settings.minutes + ' мин.'); await tick();
    }
    api.onCommand('start-timer',()=>serialize(start));
    api.onCommand('cancel-timer',()=>serialize(async()=>{ deadline=0; clearTimeout(timer); await release(); await notify('Таймер отменён.'); }));
    api.onCommand('extend-timer',()=>serialize(async()=>{
        if (!deadline || deadline <= Date.now()) { await start(); return; }
        await release(); deadline += 5 * 60000; await notify('К таймеру добавлено 5 минут.'); await tick();
    }));
    api.onCommand('time-left',()=>serialize(async()=>{
        const seconds = Math.max(0,Math.ceil((deadline-Date.now())/1000));
        await notify(deadline ? `До паузы: ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}.` : 'Таймер не запущен.');
    }));
    api.on('settings.changed',event=>serialize(async()=>{
        const changedFade = settings.fade !== event.values.fade || settings.fadeSeconds !== event.values.fadeSeconds;
        settings = event.values;
        if (changedFade) await release();
        if (deadline) await tick();
    }));
    for (const command of ['start-timer','cancel-timer','extend-timer','time-left']) await api.hotkeys.register({command});
    if (settings.startOnEnable) await start();
});
