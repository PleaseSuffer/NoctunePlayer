(() => {
    'use strict';
    const panel = document.getElementById('panel-appearance');
    const advanced = document.getElementById('bg-image-advanced-settings');
    const card = advanced.closest('.settings-card');
    // File selection stays available even when a scene hides all ordinary background effects.
    const chooser = document.getElementById('btn-choose-bg-image');
    const chooserRow = chooser.closest('.settings-row');
    advanced.before(chooserRow);
    // Recent images remain reachable even while the interactive scene is active.
    chooserRow.after(document.getElementById('bg-recent-row'));
    const glow = document.getElementById('setting-bg-glow-enabled').closest('.settings-option-group').parentElement;
    glow.classList.add('ordinary-background-glow');
    const backgroundCollection = document.createElement('div'); backgroundCollection.className = 'scene-collections background-collections'; card.append(backgroundCollection);
    const collection = document.createElement('div'); collection.className = 'scene-collections';
    const status = document.createElement('p'); status.className = 'settings-row-desc'; status.setAttribute('role', 'status'); collection.append(status);
    function gallery(title, id, target = collection) {
        const section = document.createElement('section'), label = document.createElement('div'), list = document.createElement('div');
        label.className = 'settings-row-label'; label.textContent = title; list.className = 'scene-gallery'; list.id = id;
        section.append(label, list); target.append(section); return list;
    }
    const backgrounds = gallery('Встроенные фоны', 'bg-presets-list', backgroundCollection);
    const builtins = gallery('Встроенные темы', 'scene-builtins-list');
    const imports = gallery('Добавленные темы', 'scene-imported-list');
    const empty = document.createElement('p'); empty.className = 'settings-row-desc'; empty.textContent = 'Импортируйте файл .noctheme — он содержит сцену, её слои и анимации.'; imports.after(empty);
    const options = document.createElement('div'); options.id = 'scene-theme-options'; options.hidden = true;
    const name = document.createElement('div'); name.className = 'settings-row-label';
    const description = document.createElement('p'); description.className = 'settings-row-desc';
    options.append(name, description); collection.append(options);
    function toggle(label, key, checked, changed) {
        const row = document.createElement('div'); row.className = 'settings-row';
        const text = document.createElement('label'); text.className = 'settings-row-label'; text.textContent = label;
        const control = document.createElement('label'); control.className = 'toggle-switch';
        const input = document.createElement('input'); input.type = 'checkbox'; input.checked = checked; input.id = key.replace('setting_', 'scene-option-'); text.htmlFor = input.id;
        const slider = document.createElement('span'); slider.className = 'slider-round'; control.append(input, slider);
        input.addEventListener('change', () => { appStorage.setItem(key, input.checked ? '1' : '0'); changed(input.checked); });
        row.append(text, control); options.append(row); return input;
    }
    toggle('Цвета плеера из темы', 'setting_scene_colors', appStorage.getItem('setting_scene_colors') !== '0', () => window.sceneThemes.preferencesChanged());
    const motion = toggle('Анимации окружения и персонажа', 'setting_scene_motion', appStorage.getItem('setting_scene_motion') !== '0', () => window.sceneThemes.preferencesChanged());
    const visualizer = toggle('Визуализатор сцены', 'setting_scene_visualizer_enabled', appStorage.getItem('setting_scene_visualizer_enabled') !== '0', () => window.sceneThemes.preferencesChanged());
    function rangeControl(label, key, max, step, min=0, target=options) {
        const row=document.createElement('div');row.className='settings-row scene-range-row';
        const body=document.createElement('div');body.className='scene-range-body';
        const title=document.createElement('label');title.className='settings-row-label';title.textContent=label;
        const controls=document.createElement('div');controls.className='scene-range-controls';
        const slider=document.createElement('input');slider.type='range';slider.id='scene-'+key;slider.min=min;slider.max=max;slider.step=step;title.htmlFor=slider.id;
        const value=document.createElement('span');value.className='scene-parameter-value';
        controls.append(slider,value);body.append(title,controls);row.append(body);target.append(row);
        return {row,slider,value,key};
    }
    const intensity=rangeControl('Отклик на звук','intensity',2.5,.1,.2);
    intensity.slider.setAttribute('aria-label','Отклик визуализатора сцены');
    intensity.slider.addEventListener('input',()=>{
        appStorage.setItem('setting_scene_intensity',intensity.slider.value);
        window.sceneThemes.preferencesChanged();
        intensity.value.textContent=Number(intensity.slider.value).toFixed(1)+'×';
    });
    function parameter(label, key, max, step, scale) {
        const {row,slider,value}=rangeControl(label,key,max,step);
        slider.addEventListener('input',()=>{
            const metadata=window.sceneThemes.metadata;if(!metadata)return;
            let stored;try{stored=JSON.parse(appStorage.getItem('setting_scene_preferences')||'{}');}catch(_){stored={};}
            if(!stored || typeof stored!=='object' || Array.isArray(stored))stored={};
            const id=metadata.apiVersion===2?metadata.packageId:metadata.id;
            stored[id]={...stored[id],[key]:Number(slider.value)/scale};
            appStorage.setItem('setting_scene_preferences',JSON.stringify(stored));window.sceneThemes.preferencesChanged();
        });
        return {row,slider,value,key,scale};
    }
    const frequency=parameter('Доля средних и высоких частот','frequencyMix',100,1,100);
    const visualizerGroup=document.createElement('div');visualizerGroup.className='settings-option-group';
    const visualizerRow=visualizer.closest('.settings-row');visualizerRow.before(visualizerGroup);
    const visualizerDetail=document.createElement('div');visualizerDetail.dataset.settingsDetail='';visualizerDetail.id='scene-visualizer-details';
    visualizerDetail.append(intensity.row,frequency.row);visualizerGroup.append(visualizerRow,visualizerDetail);
    const lighting=parameter('Интенсивность свечения объектов','glowIntensity',3,.1,1);
    const customParameters=document.createElement('div');options.append(customParameters);
    const localLabel=value=>typeof value==='string'?value:value?.ru || value?.en || Object.values(value || {})[0] || '';
    let parameterTheme=null;
    function renderParameters(metadata) {
        const signature=metadata ? JSON.stringify([metadata.packageId,metadata.parameterSchema]) : null;
        if(signature!==parameterTheme){
            parameterTheme=signature;customParameters.replaceChildren();
            for(const [key,p] of Object.entries(metadata?.parameterSchema || {})){
                let input;
                if(p.type==='slider'){
                    const control=rangeControl(localLabel(p.label),'custom-'+key,p.max,p.step,p.min,customParameters);
                    input=control.slider;control.value.dataset.parameterValue=key;
                }else{
                    const row=document.createElement('div');row.className='settings-row';
                    const label=document.createElement('label');label.className='settings-row-label';label.textContent=localLabel(p.label);
                    input=document.createElement(p.type==='select'?'select':'input');input.id='scene-custom-'+key;label.htmlFor=input.id;
                    if(p.type==='toggle'){
                        input.type='checkbox';
                        const control=document.createElement('label');control.className='toggle-switch';
                        const thumb=document.createElement('span');thumb.className='slider-round';control.append(input,thumb);
                        row.append(label,control);
                    }else{
                        input.className='scene-parameter-select';
                        for(const option of p.options){const node=document.createElement('option');node.value=option.value;node.textContent=localLabel(option.label);input.append(node);}
                        row.append(label,input);
                    }
                    customParameters.append(row);
                }
                input.dataset.parameter=key;
                input.addEventListener(p.type==='slider'?'input':'change',()=>window.sceneThemes.setParameter(key,p.type==='toggle'?input.checked:p.type==='slider'?Number(input.value):input.value));
            }
        }
        const values=window.sceneThemes.parameters || {};
        for(const [key,p] of Object.entries(metadata?.parameterSchema || {})){
            const input=customParameters.querySelector('[data-parameter="'+key+'"]'),value=values[key]??p.default;
            if(p.type==='toggle')input.checked=value;else input.value=value;
            if(p.type==='slider'){
                const text=window.sceneParameterValues.formatSlider(value,p);
                customParameters.querySelector('[data-parameter-value="'+key+'"]').textContent=text;
                input.setAttribute('aria-valuetext',text);
            }
        }
    }
    const groups = [], children = [...panel.children]; let group;
    for (const node of children) {
        const heading = node.matches('.settings-section-title') ? node : node.querySelector(':scope > .settings-section-title');
        if (heading) {
            group = { title: heading.textContent.trim(), pane: document.createElement('div') };
            group.pane.className = 'appearance-section';
            groups.push(group); panel.append(group.pane);
        }
        if (group) group.pane.append(node);
    }
    const themeSection = document.createElement('div'); themeSection.className = 'appearance-section'; themeSection.id = 'appearance-themes-section';
    const themeHeading = document.createElement('div'); themeHeading.className = 'settings-section-title'; themeHeading.textContent = 'Темы';
    const themeCard = document.createElement('div'); themeCard.className = 'settings-card';
    const enableRow = document.createElement('div'); enableRow.className = 'settings-row';
    const enableLabel = document.createElement('label'); enableLabel.className = 'settings-row-label'; enableLabel.textContent = 'Интерактивная тема'; enableLabel.htmlFor = 'setting-scene-enabled';
    const enableControl = document.createElement('label'); enableControl.className = 'toggle-switch';
    const themeEnabled = document.createElement('input'); themeEnabled.type = 'checkbox'; themeEnabled.id = 'setting-scene-enabled';
    const enableSlider = document.createElement('span'); enableSlider.className = 'slider-round'; enableControl.append(themeEnabled, enableSlider); enableRow.append(enableLabel, enableControl);
    themeCard.append(enableRow, collection); themeSection.append(themeHeading, themeCard); groups.find(g=>g.title==='Фон').pane.after(themeSection);
    themeEnabled.addEventListener('change', async () => {
        appStorage.setItem('setting_scene_enabled', themeEnabled.checked ? '1' : '0');
        if (!themeEnabled.checked) { window.sceneThemes.deactivate(false); return; }
        const saved = themes.find(t=>t.id===appStorage.getItem('setting_scene_theme')) || themes[0];
        if (saved) await select(saved);
        else { themeEnabled.checked=false; appStorage.setItem('setting_scene_enabled','0'); status.textContent='Добавьте тему кнопкой +.'; }
    });
    const imageEffectsTab = groups.find(g => g.title === 'Визуальные эффекты');
    const vizTab = groups.find(g => g.title === 'Визуализатор');
    const confettiTab = groups.find(g => g.title === 'Конфетти');
    const starsGroup = document.getElementById('setting-show-stars').closest('.settings-option-group');
    starsGroup.classList.add('ordinary-stars-options');
    const adaptiveAccentRow = document.getElementById('setting-adaptive-accent').closest('.settings-row');
    adaptiveAccentRow.classList.add('ordinary-adaptive-accent');
    const accentSwatches = document.getElementById('accent-swatches');
    const accentPicker = document.getElementById('accent-color-picker');
    const accentHint = document.createElement('p'); accentHint.className = 'settings-row-desc'; accentHint.textContent = 'Акцент задан интерактивной темой. Изменить источник цвета можно в разделе «Темы».'; accentHint.hidden = true; accentSwatches.after(accentHint);
    function changed(metadata) {
        renderParameters(metadata);
        themeEnabled.checked = !!metadata;
        options.hidden = !metadata;
        if (metadata) { name.textContent = metadata.name; description.textContent = metadata.description; }
        for (const g of [imageEffectsTab, vizTab, confettiTab]) if (g) g.pane.hidden = !!metadata;
        document.dispatchEvent(new Event('settings-sections-changed'));
        motion.disabled = !!metadata && !metadata.capabilities.motion;
        visualizer.disabled = !!metadata && metadata.capabilities.visualizer === 'none';
        visualizer.checked = appStorage.getItem('setting_scene_visualizer_enabled') !== '0';
        visualizerDetail.hidden = !visualizer.checked || visualizer.disabled;
        intensity.slider.value=appStorage.getItem('setting_scene_intensity') || '1';
        intensity.value.textContent=Number(intensity.slider.value).toFixed(1)+'×';
        if(metadata){
            let stored;try{const all=JSON.parse(appStorage.getItem('setting_scene_preferences')||'{}');stored=all[metadata.apiVersion===2?metadata.packageId:metadata.id]??all[metadata.id];}catch(_){}
            for(const p of [frequency,lighting]){const v=stored?.[p.key] ?? metadata.parameters?.[p.key] ?? (p===frequency ? .6 : 1);p.slider.value=Number(v)*p.scale;p.value.textContent=p===frequency?Math.round(Number(v)*100)+'%':Number(v).toFixed(1)+'×';}
        }
        const inherited = !!metadata && appStorage.getItem('setting_scene_colors') !== '0';
        accentHint.hidden = !inherited; accentPicker.disabled = inherited;
        accentSwatches.classList.toggle('scene-color-controlled', inherited);
        accentSwatches.querySelectorAll('.accent-swatch').forEach(s => s.classList.toggle('active', s.dataset.color === (inherited ? metadata.palette.accent : appStorage.getItem('setting_accent_color'))));
        accentPicker.value = inherited ? metadata.palette.accent : appStorage.getItem('setting_accent_color') || '#4a90e2';
        collection.querySelectorAll('[data-scene-id]').forEach(b => { const on = metadata?.id === b.dataset.sceneId; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
        backgrounds.querySelectorAll('button').forEach(b => b.classList.toggle('active', !metadata && window.bgImagePath === b.dataset.path));
    }
    window.sceneThemes.onChange(changed);
    const notifyError = error => { if (error.message !== 'Выбор темы отменён') { status.textContent = error.message; if (!error.sceneNotified) showNotification(error.message, 'warning', null, null, { copyText: error.stack || error.message }); } };
    async function select(metadata) {
        status.textContent = 'Загрузка сцены…';
        try { await window.sceneThemes.activate(metadata); status.textContent = ''; }
        catch (error) { themeEnabled.checked=window.sceneThemes.active; if(!themeEnabled.checked)appStorage.setItem('setting_scene_enabled','0');notifyError(error); }
    }
    function tile(list, title, image, click) {
        const item = document.createElement('div'); item.className = 'scene-gallery-item';
        const button = document.createElement('button'); button.type='button'; button.className = 'scene-tile'; button.title = title; button.setAttribute('aria-label', title);
        const img = document.createElement('img'); img.src = image; img.alt = ''; img.loading = 'lazy';
        const label = document.createElement('span'); label.textContent = title; button.append(img, label);
        button.addEventListener('click', click); item.append(button); list.append(item); return { item, button };
    }
    let themes = [];
    async function refresh() {
        const result = await noctune.sceneThemes.list(); themes = result.themes;
        backgrounds.replaceChildren(); builtins.replaceChildren(); imports.replaceChildren();
        result.presets.forEach(p => {
            const { button } = tile(backgrounds, p.name, noctune.fs.toFileUrl(p.path), () => { window.backgroundSettings.select(p.path); changed(null); status.textContent = ''; }); button.dataset.path = p.path;
        });
        themes.forEach(t => {
            const { item, button } = tile(t.builtin ? builtins : imports, t.name, t.preview, () => select(t)); button.dataset.sceneId = t.id;
            if (!t.builtin && t.removable !== false) {
                const remove = document.createElement('button'); remove.className = 'scene-remove'; remove.textContent = '×'; remove.title = 'Удалить импортированную тему'; remove.setAttribute('aria-label', 'Удалить ' + t.name);
                remove.addEventListener('click', async () => {
                    try { if (window.sceneThemes.metadata?.packageId === t.packageId || window.sceneThemes.metadata?.id === t.id || appStorage.getItem('setting_scene_theme') === t.id) window.sceneThemes.deactivate(); await noctune.sceneThemes.remove(t.id); await refresh(); }
                    catch (error) { notifyError(error); }
                }); item.append(remove);
            }
        });
        for (const list of [imports]) {
            const item=document.createElement('div');item.className='scene-gallery-item';
            const button=document.createElement('button');button.type='button';button.className='scene-tile scene-add-tile';button.title='Добавить тему';button.setAttribute('aria-label','Добавить тему');
            button.innerHTML='<i data-lucide="plus"></i>';
            button.addEventListener('click', importTheme);item.append(button);list.append(item);
        }
        lucide.createIcons();
        empty.hidden = themes.some(t => !t.builtin); changed(window.sceneThemes.metadata); return themes;
    }
    async function importTheme() {
        const buttons=[...collection.querySelectorAll('.scene-add-tile')];buttons.forEach(b=>b.disabled=true);
        try { const imported = await noctune.sceneThemes.import(); if (imported) await installedTheme(imported); }
        catch (error) { notifyError(error); }
        finally { buttons.forEach(b=>b.disabled=false); }
    }
    function announceThemeInstall(theme) {
        const updated = theme.action === 'update';
        status.textContent = updated ? `Тема «${theme.name}» обновлена до версии ${theme.version}` : `Тема «${theme.name}» добавлена в список`;
        showNotification(status.textContent, 'success', updated ? 'Тема обновлена' : 'Тема установлена');
    }
    async function installedTheme(theme) {
        const active = window.sceneThemes.metadata;
        await refresh();
        if (theme.action === 'update' && active && (active.packageId === theme.packageId || active.id === theme.id)) {
            const replacement = themes.find(t => t.id === theme.id) || themes.find(t => t.packageId === theme.packageId);
            // activate keeps the old scene until the new candidate renders its first
            // frame, so a bad update doesn't leave the player without a background.
            if (replacement) await window.sceneThemes.activate(replacement);
        }
        announceThemeInstall(theme);
    }
    let externalImportTask = Promise.resolve();
    noctune.sceneThemes.onImported(result => {
        externalImportTask = externalImportTask.then(async () => {
            if (result.error) throw new Error(result.error);
            await installedTheme(result.theme);
        }).catch(notifyError);
    });
    refresh().then(async list => {
        const id = appStorage.getItem('setting_scene_theme');
        // Migrate the previous single background toggle to the separate scene mode.
        if(appStorage.getItem('setting_scene_enabled')===null)appStorage.setItem('setting_scene_enabled',id && appStorage.getItem('setting_bg_image_enabled')!=='0'?'1':'0');
        if (!id || appStorage.getItem('setting_scene_enabled') !== '1') return;
        let saved = list.find(t => t.id === id);
        if (!saved) {
            try { const previous = await noctune.sceneThemes.read(id); saved = list.find(t => t.packageId === previous.manifest.id); } catch (_) { /* Removed/unavailable themes stay disabled. */ }
        }
        if (saved) await select(saved);
        else { appStorage.removeItem('setting_scene_theme'); status.textContent = 'Сохранённая тема недоступна. Выберите другой фон.'; }
    }).catch(notifyError).finally(() => noctune.sceneThemes.ready());
})();
