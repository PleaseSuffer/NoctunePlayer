(() => {
    const api = window.addonStore;
    const byId = id => document.getElementById(id);
    const query = new URLSearchParams(location.search);
    document.documentElement.dataset.theme = query.get('theme') === 'light' ? 'light' : 'dark';
    const accent = query.get('accent');
    if (/^#[a-f0-9]{6}$/i.test(accent)) {
        document.documentElement.style.setProperty('--accent', accent);
        const rgb = accent.slice(1).match(/../g).map(value => parseInt(value,16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
        document.documentElement.style.setProperty('--accent-ink', rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 > .179 ? '#171220' : '#ffffff');
    }
    const tabs = [byId('tab-official'),byId('tab-community')];
    let catalog = null, busy = false, refreshing = false;
    const node = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; };
    function icon(name) { const element = node('i'); element.setAttribute('data-lucide',name); return element; }
    function selectTab(index, focus = false) {
        tabs.forEach((tab, i) => { tab.setAttribute('aria-selected',String(index === i)); tab.tabIndex = index === i ? 0 : -1; byId(tab.getAttribute('aria-controls')).hidden = index !== i; });
        byId('refresh').hidden = index !== 0;
        if (focus) tabs[index].focus();
    }
    tabs.forEach((tab,index) => {
        tab.addEventListener('click',() => selectTab(index));
        tab.addEventListener('keydown',event => {
            if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
            event.preventDefault(); selectTab(event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index,true);
        });
    });
    function render() {
        if (!catalog) return;
        const list = byId('catalog'); list.replaceChildren();
        const search = byId('search').value.trim().toLocaleLowerCase();
        const entries = catalog.entries.filter(entry => [entry.name,entry.description,entry.author].join(' ').toLocaleLowerCase().includes(search));
        byId('official-count').textContent = String(catalog.entries.length);
        byId('empty').hidden = !!entries.length;
        for (const entry of entries) {
            const card = node('article','store-card'); card.dataset.addonId = entry.id;
            if (entry.artwork.banner) { const banner = node('img','card-banner'); banner.src = entry.artwork.banner; banner.alt = ''; card.append(banner); }
            const body = node('div','card-body'), heading = node('div','card-heading');
            const picture = node(entry.artwork.icon ? 'img' : 'span','card-icon' + (entry.artwork.icon ? '' : ' card-placeholder'));
            if (entry.artwork.icon) { picture.src = entry.artwork.icon; picture.alt = ''; } else picture.append(icon('puzzle'));
            const title = node('div'), author = node('div','card-author',entry.author); author.prepend(icon('badge-check'));
            title.append(node('h2','card-title',entry.name),author); heading.append(picture,title);
            const metadata = node('div','card-metadata');
            metadata.append(node('span','',entry.type === 'integration' ? 'Интеграция' : 'Дополнение'),node('span','','Версия ' + entry.version),node('span','','Noctune ' + entry.minNoctuneVersion + '+'));
            const actions = node('div','card-actions'), control = node('button','primary'); control.type = 'button';
            const labels = { install:'Установить',update:'Обновить',installed:'Установлено',conflict:'Другой издатель' };
            control.textContent = !entry.compatible ? 'Несовместимо' : entry.state === 'installed' ? labels.installed : !entry.published ? 'Скоро в магазине' : labels[entry.state];
            control.disabled = busy || !entry.compatible || !entry.published || ['installed','conflict'].includes(entry.state);
            const state = !entry.compatible ? 'Проверьте версию Noctune' : entry.state === 'installed' ? entry.enabled ? 'Включено в плеере' : 'Можно включить в настройках' : entry.state === 'conflict' ? 'ID занят расширением другого издателя' : !entry.published ? 'Готовится к публикации' : 'Официальное расширение';
            actions.append(node('span','card-state',state),control);
            control.addEventListener('click',() => install(entry.id));
            body.append(heading,node('p','card-description',entry.description),metadata,actions); card.append(body); list.append(card);
        }
        lucide.createIcons();
    }
    async function load(refresh = false) {
        if (refresh && refreshing) return;
        if (refresh) { refreshing = true; byId('refresh').disabled = true; byId('catalog-message').textContent = 'Обновляем каталог…'; }
        try {
            catalog = await api.list(refresh);
            const names = { builtin:'Встроенный каталог',cache:'Сохранённый каталог',network:'Каталог GitHub' };
            byId('catalog-source').textContent = names[catalog.source] || 'Каталог Noctune';
            byId('catalog-source').title = 'Обновлён: ' + new Date(catalog.generatedAt).toLocaleString();
            byId('catalog-message').textContent = catalog.message; render();
        } catch (error) { byId('catalog-message').textContent = error.message || 'Не удалось загрузить каталог'; }
        finally { if (refresh) { refreshing = false; byId('refresh').disabled = false; } }
    }
    async function install(id) {
        if (busy) return;
        busy = true; byId('status').textContent = 'Загружаем расширение…'; render();
        try {
            const result = await api.install(id);
            byId('status').textContent = result.installed ? 'Расширение установлено. Включите его в настройках плеера.' : 'Установка отменена';
            await load();
        } catch (error) { byId('status').textContent = error.message || 'Не удалось установить расширение'; }
        finally { busy = false; render(); }
    }
    for (const kind of ['repository','documentation','submission']) byId(kind).addEventListener('click',() => api.openLink(kind).catch(error => { byId('status').textContent = error.message; }));
    byId('search').addEventListener('input',render);
    byId('refresh').addEventListener('click',() => load(true));
    lucide.createIcons();
    load().then(() => load(true));
})();
