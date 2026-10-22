(function initAddonSettings() {
    const api = window.noctune?.addons;
    if (!api) return;
    const panel = document.getElementById('panel-addons');
    const list = document.getElementById('addons-list');
    const status = document.getElementById('addons-status');
    const integrations = document.getElementById('addon-integrations');
    window.addonSettingsControls = { dropdown };
    const hasPanel = addon => !!addon.ui?.integrations && (addon.grants || AddonPermissions.expand(addon.permissions)).includes('ui.integrations');
    let addons = [], busy = false, reloadSequence = 0;
    const updates = new Map();
    const dynamicControls = new Set();
    async function sourceOptions(field, value) {
        let available = [];
        try {
            if (field.source === 'appearance.schemes') available = (window.addonContributions?.schemes() || []).map(item=>({value:item.reference,label:item.name + ' · ' + item.provider}));
            else if (field.source === 'backgrounds') available = (await window.addonPlayer.listBackgrounds()).map(item=>({value:item.id,label:item.name}));
        } catch (_) { /* Keep saved selections if a source is temporarily unavailable. */ }
        const options = [...field.options,...available].filter((item,index,items)=>items.findIndex(other=>other.value===item.value)===index);
        if (!options.some(item=>item.value===value)) options.push({value,label:field.source==='backgrounds'?'Выбранные обои недоступны':'Выбранная схема недоступна',disabled:true});
        return options;
    }
    let sourceTimer;
    function refreshSources() {
        clearTimeout(sourceTimer);
        sourceTimer = setTimeout(() => {
            for (const item of dynamicControls) {
                if (!item.control.wrapper.isConnected) { dynamicControls.delete(item); continue; }
                sourceOptions(item.field,item.control.input.value).then(options=>{ if(item.control.wrapper.isConnected)item.control.updateOptions(options); });
            }
        },100);
    }
    document.addEventListener('addon-contributions-changed',refreshSources);
    window.addonEvents?.on(event=>{ if(event.type==='backgrounds.changed')refreshSources(); });
    const node = (tag, className, text) => {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    };
    let openedDropdown = null;
    function closeDropdown() { openedDropdown?.close(); }
    document.addEventListener('click', event => {
        if (openedDropdown && !openedDropdown.wrapper.contains(event.target) && !openedDropdown.menu.contains(event.target)) closeDropdown();
    });
    document.addEventListener('scroll', event => {
        if (openedDropdown && !openedDropdown.menu.contains(event.target)) openedDropdown.place();
    }, true);
    window.addEventListener('resize', closeDropdown);
    function dropdown(field, value, id) {
        const wrapper = node('div', 'viz-type-dropdown-wrapper performance-dropdown addon-select');
        const input = node('button', 'viz-type-dropdown-btn'); input.type = 'button'; input.value = value;
        input.setAttribute('aria-haspopup', 'listbox'); input.setAttribute('aria-expanded', 'false');
        input.setAttribute('aria-controls', id + '-options');
        const text = node('span', 'pd-label'), chevron = node('span', 'pd-chevron');
        chevron.append(AddonPermissionView.icon('ChevronDown', 'addon-dropdown-chevron'));
        input.append(text, chevron); wrapper.append(input);
        const menu = node('div', 'viz-type-dropdown-menu addon-dropdown-menu'); menu.id = id + '-options';
        menu.setAttribute('role', 'listbox'); menu.setAttribute('aria-label', field.label);
        let options = [];
        function updateOptions(next) {
            close(); field = {...field,options:next}; menu.replaceChildren();
            options = next.map(option => {
            const control = node('button', 'viz-type-menu-item', option.label); control.type = 'button';
            control.disabled = !!option.disabled;
            control.setAttribute('role', 'option'); control.dataset.value = option.value; control.tabIndex = -1;
            control.addEventListener('click', () => {
                input.value = option.value; sync(); close(); input.focus({ preventScroll: true });
                input.dispatchEvent(new Event('change', { bubbles: true }));
            });
            menu.append(control); return control;
            });
            sync();
        }
        function sync() {
            text.textContent = field.options.find(option => option.value === input.value)?.label || '';
            for (const option of options) {
                const selected = option.dataset.value === input.value;
                option.classList.toggle('active', selected); option.setAttribute('aria-selected', String(selected));
            }
        }
        function close() {
            input.classList.remove('open'); input.setAttribute('aria-expanded', 'false');
            if (openedDropdown?.input === input) openedDropdown = null;
            // Removing a focused option emits focusout synchronously. Mark it closed first.
            menu.remove();
        }
        function place() {
            const rect = input.getBoundingClientRect(), below = innerHeight - rect.bottom - 12, above = rect.top - 12;
            const down = below >= Math.min(280, options.length * 34 + 10) || below >= above;
            const width = Math.min(rect.width, innerWidth - 16);
            menu.style.width = width + 'px'; menu.style.maxHeight = Math.max(0, Math.min(280, down ? below : above)) + 'px';
            menu.style.left = Math.max(8, Math.min(rect.left, innerWidth - width - 8)) + 'px';
            menu.style.top = (down ? rect.bottom + 4 : rect.top - menu.getBoundingClientRect().height - 4) + 'px';
        }
        function open(focus = false) {
            if (input.disabled) return;
            closeDropdown(); sync(); document.body.append(menu); menu.classList.add('open');
            place();
            input.classList.add('open'); input.setAttribute('aria-expanded', 'true');
            openedDropdown = { wrapper, menu, input, close, place };
            if (focus) (options.find(option => !option.disabled && option.classList.contains('active')) || options.find(option=>!option.disabled))?.focus({ preventScroll: true });
        }
        input.addEventListener('click', () => { if (openedDropdown?.input === input) close(); else open(); });
        input.addEventListener('change', sync);
        function keydown(event) {
            if (event.key === 'Escape') { event.preventDefault(); close(); input.focus({ preventScroll: true }); }
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                if (openedDropdown?.input !== input) { open(true); return; }
                const enabled = options.filter(option=>!option.disabled), index = enabled.indexOf(document.activeElement);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
                enabled[next]?.focus({ preventScroll: true });
            }
        }
        wrapper.addEventListener('keydown', keydown); menu.addEventListener('keydown', keydown);
        function focusout(event) {
            if (openedDropdown?.input === input && !wrapper.contains(event.relatedTarget) && !menu.contains(event.relatedTarget)) close();
        }
        wrapper.addEventListener('focusout', focusout); menu.addEventListener('focusout', focusout);
        updateOptions(field.options); return { wrapper, input, sync, updateOptions };
    }
    function button(label, action, target, disabled = false) {
        const control = node('button', 'btn', label); control.type = 'button'; control.disabled = disabled;
        control.addEventListener('click', () => task(() => action(control)));
        target.append(control); return control;
    }
    async function task(action) {
        if (busy) return;
        busy = true; panel.setAttribute('aria-busy', 'true');
        try { await action(); }
        catch (error) { status.textContent = error.message || 'Не удалось выполнить действие'; document.getElementById('addon-integrations-status').textContent = status.textContent; }
        finally { busy = false; panel.setAttribute('aria-busy', 'false'); }
    }
    function runtimeStatus(addon) {
        if (addon.broken) return 'Повреждённый пакет';
        if (!addon.compatible) return 'Требуется другая версия Noctune';
        if (!addon.enabled) return 'Выключено';
        const state = window.addonHost?.state(addon.id);
        return state?.status === 'error' ? state.message : state?.status === 'running' ? 'Работает' : 'Запускается…';
    }
    function updateRuntime() {
        for (const addon of addons) {
            for (const card of [...list.children,...integrations.children].filter(element => element.dataset.addonId === addon.id)) {
            card.querySelector('.addon-runtime-status').textContent = runtimeStatus(addon);
            const running = addon.enabled && window.addonHost?.state(addon.id)?.status === 'running';
            card.querySelectorAll('[data-addon-command]').forEach(control => { control.disabled = !running; });
            }
        }
    }
    async function reload() {
        const sequence = ++reloadSequence, nextAddons = await api.list();
        const nextList = document.createDocumentFragment(), nextIntegrations = document.createDocumentFragment();
        const nextControls = new Set();
        if (!nextAddons.length) nextList.append(node('div', 'settings-card addons-empty', 'Расширений пока нет. Добавьте пакет из файла или по ссылке.'));
        for (const addon of nextAddons) {
            const card = node('article', 'settings-card addon-card'); card.dataset.addonId = addon.id;
            const header = node('div', 'addon-card-header');
            const info = node('div', 'addon-card-info');
            if (addon.artwork?.banner) { const banner = node('img', 'addon-banner'); banner.src = addon.artwork.banner; banner.alt = ''; banner.addEventListener('error', () => banner.remove()); card.append(banner); }
            if (addon.artwork?.icon) { const icon = node('img', 'addon-icon'); icon.src = addon.artwork.icon; icon.alt = ''; icon.addEventListener('error', () => icon.remove()); header.append(icon); }
            info.append(node('h3', 'addon-name', addon.name), node('div', 'settings-row-desc', addon.broken ? addon.id : `${addon.type === 'integration' ? 'Интеграция' : 'Дополнение'} · ${addon.version} · ${addon.author}`));
            if (addon.verifiedPublisher) {
                const badge = node('span', 'addon-verified-publisher', 'Официальное расширение');
                badge.prepend(AddonPermissionView.icon('BadgeCheck', 'addon-verified-icon'));
                badge.title = `Подпись ${addon.verifiedPublisher} проверена по ключу, встроенному в Noctune`;
                info.append(badge);
            }
            header.append(info);
            if (!addon.broken) {
                const toggle = node('label', 'toggle-switch'), input = node('input'); input.type = 'checkbox'; input.checked = addon.enabled; input.disabled = !addon.compatible;
                input.setAttribute('aria-label', 'Включить ' + addon.name);
                input.addEventListener('change', () => {
                    const enabled = input.checked;
                    if (busy) { input.checked = !enabled; return; }
                    task(async () => { try { await api.setEnabled(addon.id, enabled); await changed(); } catch (error) { input.checked = !enabled; throw error; } });
                });
                toggle.append(input, node('span', 'slider-round')); header.append(toggle);
            }
            card.append(header, node('p', 'settings-row-desc', addon.description), node('div', 'addon-runtime-status settings-row-desc', runtimeStatus(addon)));
            const actions = node('div', 'addons-toolbar');
            if (!addon.broken) {
                for (const command of hasPanel(addon) ? [] : addon.commands) {
                    const control = button(command.title, () => window.addonHost.command(addon.id, command.id), actions);
                    control.dataset.addonCommand = command.id;
                }
                if (addon.signed && (addon.update || addon.verifiedPublisher === 'Noctune')) button('Проверить обновление', () => check(addon), actions);
                if (updates.has(addon.id)) button('Обновить до ' + updates.get(addon.id).version, () => showReview(updates.get(addon.id)), actions);
                if (addon.rollbackAvailable) button('Вернуть предыдущую версию', async () => {
                    if (!window.confirm(`Вернуть предыдущую версию «${addon.name}»?`)) return;
                    await api.rollback(addon.id); await changed(); status.textContent = 'Предыдущая версия восстановлена';
                }, actions);
            }
            button('Удалить', async () => {
                if (!window.confirm(`Удалить «${addon.name}» и его настройки?`)) return;
                await api.remove(addon.id); await changed(); status.textContent = 'Расширение удалено';
            }, actions);
            card.append(actions);
            if (!addon.broken) {
                const detail = node('details', 'addon-details addon-disclosure'); detail.append(AddonPermissionView.summary('Разрешения и обновления', 'ShieldCheck'));
                const permissions = node('ul', 'addon-permission-list');
                AddonPermissionView.render(permissions, addon);
                if (addon.permissions.length) detail.append(permissions);
                if (!addon.permissions.length) detail.append(node('div', 'settings-row-desc', 'Дополнительные разрешения не запрашиваются'));
                if (addon.network?.origins.length) {
                    const origins = node('ul', 'addon-permission-list');
                    for (const origin of addon.network.origins) origins.append(node('li', 'settings-row-desc', AddonPermissionView.originLabel(origin)));
                    detail.append(origins);
                }
                detail.append(node('div', 'settings-row-desc', addon.signed ? 'Пакет подписан издателем' : 'Локальный пакет без подписи'));
                detail.append(node('div', 'settings-row-desc', addon.signed && (addon.update || addon.verifiedPublisher === 'Noctune') ? 'Обновления проверяются вручную' : 'Обновление: установите новый пакет из файла'));
                card.append(detail);
            }
            if (!addon.broken && hasPanel(addon)) {
                button('Настроить интеграцию', () => { document.querySelector('[data-panel="panel-integrations"]').click(); document.getElementById('integration-addon-'+addon.id)?.scrollIntoView({block:'start'}); }, actions);
                const integration = node('article','settings-card integration-card addon-card'); integration.id='integration-addon-'+addon.id; integration.dataset.addonId=addon.id;
                const heading=node('div','addon-card-header'),info=node('div','addon-card-info');info.append(node('h3','addon-name',addon.ui.integrations.title),node('p','addon-runtime-status settings-row-desc',runtimeStatus(addon)));
                const toggle=node('label','toggle-switch'),enabled=node('input');enabled.type='checkbox';enabled.checked=addon.enabled;enabled.disabled=!addon.compatible;enabled.setAttribute('aria-label','Включить '+addon.name);
                enabled.addEventListener('change',()=>task(async()=>{await api.setEnabled(addon.id,enabled.checked);await changed();}));toggle.append(enabled,node('span','slider-round'));heading.append(info,toggle);
                integration.append(heading,node('p','settings-row-desc',addon.ui.integrations.description||addon.description));
                const controls=node('div','addons-toolbar');
                const profile=Object.keys(addon.credentials||{})[0];
                if(profile&&addon.enabled){
                    const pkg=(await api.runtime()).find(item=>item.manifest.id===addon.id);
                    if(pkg){const state=await api.services(addon.id,pkg.digest,'credentials.status',{profile}).catch(()=>({configured:false}));
                        if(!state.configured)button('Подключить',async()=>{const result=await api.services(addon.id,pkg.digest,'credentials.configure',{profile});if(result.configured){window.addonEvents.emit('settings.credentials',{addonId:addon.id,profile,configured:true});await reload();}},controls);}
                }
                const library=node('div','integration-library-slot');library.dataset.librarySlot=addon.id;
                integration.append(controls,library); await renderConfiguration(addon,integration,nextControls); nextIntegrations.append(integration);
            } else if (!addon.broken && (addon.settings || addon.oauth || addon.credentials)) await renderConfiguration(addon,card,nextControls);
            nextList.append(card);
        }
        if (sequence !== reloadSequence) return;
        const content = panel.closest('.settings-content'), scrollTop = content?.scrollTop;
        // Keep the current layout until the replacement is complete, including open details.
        for (const [current, next] of [[list,nextList],[integrations,nextIntegrations]]) {
            for (const card of next.children) {
                const previous = [...current.children].find(item=>item.dataset.addonId===card.dataset.addonId);
                const details = previous?.querySelectorAll('.addon-disclosure');
                card.querySelectorAll('.addon-disclosure').forEach((detail,index)=>{ detail.open=!!details?.[index]?.open; });
            }
        }
        closeDropdown(); addons = nextAddons;
        list.replaceChildren(nextList); integrations.replaceChildren(nextIntegrations);
        dynamicControls.clear(); for (const item of nextControls) dynamicControls.add(item);
        if (content) content.scrollTo({top:scrollTop,behavior:'instant'});
        updateRuntime(); document.dispatchEvent(new Event('settings-sections-changed'));
        document.dispatchEvent(new Event('addon-integrations-rendered'));
    }
    async function renderConfiguration(addon, card, controls) {
        const section = node('details', 'addon-configuration addon-disclosure'); section.append(AddonPermissionView.summary(hasPanel(addon)?'Подключение и параметры':'Настройки расширения', 'Settings2'));
        if(hasPanel(addon)&&addon.commands.length){const actions=node('div','addons-toolbar');for(const command of addon.commands){const control=button(command.title,()=>window.addonHost.command(addon.id,command.id),actions);control.dataset.addonCommand=command.id;}section.append(actions);}
        let values = await api.settings(addon.id), saving = Promise.resolve();
        const visibility = () => { for (const row of section.querySelectorAll('[data-setting-key]')) { const when=addon.settings[row.dataset.settingKey].visibleWhen; row.hidden=!!when && values[when.field]!==when.equals; } };
        const ordered = hasPanel(addon) ? [...new Set([...addon.ui.integrations.sections.flatMap(section=>section.fields),...Object.keys(addon.settings||{})])] : Object.keys(addon.settings||{});
        for (const key of ordered) {
            const field=addon.settings[key];
            const row = node('div', 'settings-row addon-setting'), info = node('div', 'addon-setting-info');
            const controlId = 'addon-' + addon.id + '-' + key;
            const panelSection = hasPanel(addon) ? addon.ui.integrations.sections.find(group=>group.fields.includes(key)) : null;
            if (panelSection && panelSection.fields[0] === key) section.append(node('h4','settings-section-title',panelSection.title));
            row.dataset.settingKey = key;
            const label = node('label', 'settings-row-label', field.label); label.htmlFor = controlId; info.append(label);
            if (field.description) info.append(node('p', 'settings-row-desc', field.description));
            row.append(info);
            let input, wrapper, selectControl;
            if (field.type === 'toggle') {
                wrapper = node('label', 'toggle-switch'); input = node('input'); input.type = 'checkbox'; input.checked = values[key]; wrapper.append(input, node('span', 'slider-round'));
            } else if (field.type === 'select') {
                selectControl = dropdown(field.source ? {...field,options:await sourceOptions(field,values[key])} : field, values[key], controlId);
                if (field.source) controls.add({field,control:selectControl});
                input = selectControl.input; wrapper = selectControl.wrapper;
            } else {
                input = node('input', field.type === 'slider' ? 'addon-range' : 'integration-text-input addon-input'); input.type = field.type === 'slider' ? 'range' : field.type === 'number' ? 'number' : 'text'; input.value = values[key];
                if (['slider','number'].includes(field.type)) { input.min = field.min; input.max = field.max; input.step = field.step; }
                if (field.type === 'text') input.maxLength = field.maxLength || 500;
            }
            input.id = controlId;
            if (field.type === 'slider') { wrapper = node('div', 'scene-range-controls addon-slider'); const output = node('output', 'scene-parameter-value', String(values[key])); output.htmlFor = controlId; const update = () => { output.value = input.value; input.setAttribute('aria-valuetext', input.value); }; input.addEventListener('input', update); input.addEventListener('change', update); update(); wrapper.append(input, output); }
            input.addEventListener('change', async () => {
                const previous = values[key], value = field.type === 'toggle' ? input.checked : ['slider','number'].includes(field.type) ? Number(input.value) : input.value;
                const hadFocus = document.activeElement === input;
                input.disabled = true;
                const pending = saving.then(async () => { values = await api.setSettings(addon.id, { ...values, [key]: value }); visibility(); window.addonEvents.emit('settings.changed', { addonId: addon.id, values, key }); });
                saving = pending.catch(() => {});
                try { await pending; }
                catch (error) { if (field.type === 'toggle') input.checked = previous; else input.value = previous; selectControl?.sync(); status.textContent = error.message; }
                finally { input.disabled = false; if (hadFocus && document.activeElement === document.body) input.focus({ preventScroll: true }); }
            });
            row.append(wrapper || input); section.append(row);
        }
        visibility();
        for (const [profile, config] of Object.entries(addon.credentials || {})) {
            const row=node('div','settings-row addon-setting'),info=node('div','addon-setting-info'),controls=node('div','addons-toolbar'),message=node('p','settings-row-desc',addon.enabled?'Статус ключа не проверен':'Включите расширение для настройки');
            info.append(node('div','settings-row-label',config.name),message); row.append(info,controls);
            const grants=addon.grants||AddonPermissions.expand(addon.permissions);
            async function credential(action) {
                const pkg=(await api.runtime()).find(pkg=>pkg.manifest.id===addon.id); if(!pkg)throw new Error('Включите расширение');
                const result=await api.services(addon.id,pkg.digest,'credentials.'+action,{profile});
                if(action==='status')message.textContent=result.configured?'Ключ сохранён':result.secureStorage?'Ключ не настроен':'Защищённое хранилище ОС недоступно';
                else {if(grants.includes('credentials.status'))await credential('status');if(action==='disconnect'||result.configured===true)window.addonEvents.emit('settings.credentials',{addonId:addon.id,profile,configured:action==='configure'&&result.configured===true});}
            }
            if(grants.includes('credentials.configure'))button('Настроить ключ',()=>credential('configure'),controls,!addon.enabled);
            if(grants.includes('credentials.disconnect'))button('Удалить ключ',()=>credential('disconnect'),controls,!addon.enabled);
            if(addon.enabled&&grants.includes('credentials.status'))await credential('status').catch(error=>{message.textContent=error.message;});
            section.append(row);
        }
        for (const [provider, config] of Object.entries(addon.oauth || {})) {
            const row = node('div', 'settings-row addon-setting'), info = node('div', 'addon-setting-info'), controls = node('div', 'addons-toolbar'), message = node('p', 'settings-row-desc', addon.enabled ? 'Статус входа не проверен' : 'Включите расширение для входа');
            info.append(node('div', 'settings-row-label', config.name), message); row.append(info, controls);
            async function auth(action) {
                const packages = await api.runtime(), pkg = packages.find(pkg => pkg.manifest.id === addon.id);
                if (!pkg) throw new Error('Включите расширение');
                const result = await api.services(addon.id, pkg.digest, 'oauth.' + action, { provider });
                if (action === 'status') message.textContent = result.connected ? 'Вход выполнен' : result.secureStorage === false ? 'Защищённое хранилище ОС недоступно' : 'Вход не выполнен';
                else { if ((addon.grants||AddonPermissions.expand(addon.permissions)).includes('oauth.status')) await auth('status'); else message.textContent=action==='authorize'?'Вход выполнен':'Локальный доступ удалён'; window.addonEvents.emit('settings.oauth', { addonId: addon.id, provider, connected: action === 'authorize' }); }
            }
            const authGrants=addon.grants||AddonPermissions.expand(addon.permissions);
            if(authGrants.includes('oauth.authorize'))button('Войти', () => auth('authorize'), controls, !addon.enabled);
            if(authGrants.includes('oauth.disconnect'))button('Выйти', () => auth('disconnect'), controls, !addon.enabled);
            if (addon.enabled&&authGrants.includes('oauth.status')) await auth('status').catch(error => { message.textContent = error.message; });
            section.append(row);
        }
        card.append(section);
    }
    async function changed() {
        for (const candidate of updates.values()) api.discard(candidate.ticket).catch(() => {});
        updates.clear(); document.dispatchEvent(new Event('addons-changed')); await reload();
    }
    async function showReview(candidate) {
        if (!candidate) return;
        try {
            const installed = await api.openInstaller(candidate.ticket);
            if (installed) {
                await changed();
                status.textContent = candidate.state === 'update' ? 'Расширение обновлено' : 'Расширение установлено. Включите его в карточке.';
            } else {
                updates.delete(candidate.id);
                await reload();
                status.textContent = candidate.state === 'installed' ? 'Эта версия расширения уже установлена' : 'Установка отменена';
            }
        } catch (error) {
            updates.delete(candidate.id);
            await reload();
            throw error;
        }
    }
    async function check(addon, open = true) {
        status.textContent = 'Проверяем обновление «' + addon.name + '»…';
        if (updates.has(addon.id)) await api.discard(updates.get(addon.id).ticket);
        updates.delete(addon.id);
        const result = await api.checkUpdate(addon.id);
        if (result.ticket) {
            updates.set(addon.id, result); await reload();
            if (open) { await showReview(result); return; }
            status.textContent = 'Доступно обновление «' + addon.name + '»';
        }
        else status.textContent = result.message;
        return result;
    }
    document.getElementById('addons-store').addEventListener('click', () => task(() => api.openStore({ theme: document.body.getAttribute('data-theme') === 'dark' ? 'dark' : 'light', accent: getComputedStyle(document.body).getPropertyValue('--accent-color').trim() })));
    api.onChanged(() => changed().catch(error => { status.textContent = error.message; }));
    document.getElementById('addons-link-toggle').addEventListener('click', event => {
        const control = event.currentTarget, form = document.getElementById('addons-url-form');
        form.hidden = !form.hidden;
        control.setAttribute('aria-expanded', String(!form.hidden));
        if (!form.hidden) document.getElementById('addons-url').focus();
    });
    document.getElementById('addons-import').addEventListener('click', () => task(async () => showReview(await api.prepareFile())));
    document.getElementById('addons-url-form').addEventListener('submit', event => {
        event.preventDefault(); task(async () => { status.textContent = 'Загружаем пакет…'; await showReview(await api.prepareUrl(document.getElementById('addons-url').value.trim())); });
    });
    document.getElementById('addons-check-all').addEventListener('click', () => task(async () => {
        const eligible = addons.filter(addon => !addon.broken && addon.signed && (addon.update || addon.verifiedPublisher === 'Noctune'));
        if (!eligible.length) { status.textContent = 'Нет расширений с обновлениями по сети. Новую версию можно установить из файла.'; return; }
        const failures = [];
        for (const addon of eligible) {
            try { const result=await check(addon,false); if (['unavailable','incompatible'].includes(result?.state)) failures.push(addon.name+': '+result.message); }
            catch (_) { failures.push(addon.name); }
        }
        await reload();
        status.textContent = (updates.size ? `Доступно обновлений: ${updates.size}. Выберите обновление в карточке.` : failures.length ? 'Проверка обновлений завершена не полностью.' : 'Новых обновлений нет.') + (failures.length ? ' Не удалось проверить: ' + failures.join(', ') : '');
    }));
    document.addEventListener('addons-runtime-changed', updateRuntime);
    reload().catch(error => { status.textContent = error.message; });
})();
