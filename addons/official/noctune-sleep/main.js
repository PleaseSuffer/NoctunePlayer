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
            try { await api.player.pause(); await notify(api.i18n.t("notifications.timerFinished")); }
            catch (error) { await notify(api.i18n.t("errors.pauseFailed") + error.message); }
            finally { await release(); }
            return;
        }
        try {
            if (settings.fade && !fading && remaining <= settings.fadeSeconds * 1000) {
                await api.audio.gain({gain:0,ramp:remaining/1000}); fading = true;
            }
        } catch (_) { await notify(api.i18n.t("warnings.fadeUnavailable")); }
        finally { schedule(); }
    }
    async function start() {
        await release(); deadline = Date.now() + settings.minutes * 60000;
        await notify(api.i18n.t("notifications.timerStarted") + settings.minutes + api.i18n.t("units.minutesAbbreviation")); await tick();
    }
    api.onCommand('start-timer',()=>serialize(start));
    api.onCommand('cancel-timer',()=>serialize(async()=>{ deadline=0; clearTimeout(timer); await release(); await notify(api.i18n.t("notifications.timerCancelled")); }));
    api.onCommand('extend-timer',()=>serialize(async()=>{
        if (!deadline || deadline <= Date.now()) { await start(); return; }
        await release(); deadline += 5 * 60000; await notify(api.i18n.t("notifications.timerExtended")); await tick();
    }));
    api.onCommand('time-left',()=>serialize(async()=>{
        const seconds = Math.max(0,Math.ceil((deadline-Date.now())/1000));
        await notify(deadline ? api.i18n.t("notifications.timeRemaining",{p0:(Math.floor(seconds/60)),p1:(String(seconds%60).padStart(2,'0'))}) : api.i18n.t("notifications.timerNotRunning"));
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
