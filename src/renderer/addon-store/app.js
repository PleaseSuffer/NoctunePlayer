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
    const sectionTabs = [byId('tab-extensions'),byId('tab-themes')];
    const t = (key, fallback) => globalThis.noctuneI18n?.t(key) ?? fallback;
    let section = query.get('section') === 'themes' ? 'theme' : 'extension', channel = 'official';
    let catalog = null, busy = false, refreshing = false;
    const node = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; };
    function icon(name) { const element = node('i'); element.setAttribute('data-lucide',name); return element; }
    function selectTab(index, focus = false) {
        channel = index ? 'community' : 'official';
        tabs.forEach((tab, i) => { tab.setAttribute('aria-selected',String(index === i)); tab.tabIndex = index === i ? 0 : -1; });
        byId('store-results').setAttribute('aria-labelledby', `${section === 'theme' ? 'tab-themes' : 'tab-extensions'} ${tabs[index].id}`);
        byId('community-note').hidden = channel !== 'community';
        byId('community-actions').hidden = channel !== 'community';
        if (focus) tabs[index].focus();
        render();
    }
    tabs.forEach((tab,index) => {
        tab.addEventListener('click',() => selectTab(index));
        tab.addEventListener('keydown',event => {
            if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
            event.preventDefault(); selectTab(event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index,true);
        });
    });
    function selectSection(index, focus = false) {
        section = index ? 'theme' : 'extension';
        sectionTabs.forEach((tab,i)=>{ tab.setAttribute('aria-selected',String(i===index)); tab.tabIndex=i===index?0:-1; });
        selectTab(channel === 'community' ? 1 : 0);
        if (focus) sectionTabs[index].focus();
    }
    sectionTabs.forEach((tab,index)=>{
        tab.addEventListener('click',()=>selectSection(index));
        tab.addEventListener('keydown',event=>{ if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return; event.preventDefault(); selectSection(event.key==='Home'?0:event.key==='End'?1:1-index,true); });
    });
    function render() {
        if (!catalog) return;
        const active = catalog.catalogs?.[section === 'extension' && channel === 'official' ? 'official' : 'marketplace'] || catalog;
        const sources={builtin:t('addonStore.app.bundledCatalog','Встроенный каталог'),cache:t('addonStore.app.savedCatalog','Сохранённый каталог'),network:t('addonStore.app.githubCatalog','Каталог GitHub')};
        byId('catalog-source').textContent=sources[active.source] || t('addonStore.noctuneCatalog','Каталог Noctune');
        byId('catalog-source').title=t('addonStore.app.updated','Обновлён: ')+new Date(active.generatedAt).toLocaleString(globalThis.noctuneI18n?.locale || 'ru');
        byId('catalog-message').textContent=active.message || '';
        const list = byId('catalog'); list.replaceChildren();
        const search = byId('search').value.trim().toLocaleLowerCase();
        const inSection = catalog.entries.filter(entry=>(entry.kind || 'extension')===section);
        const entries = inSection.filter(entry=>(entry.channel || 'official')===channel && [entry.name,entry.description,entry.author].join(' ').toLocaleLowerCase().includes(search));
        byId('official-count').textContent = String(inSection.filter(entry=>(entry.channel || 'official')==='official').length);
        byId('community-count').textContent = String(inSection.filter(entry=>entry.channel==='community').length);
        byId('search').placeholder = section === 'theme' ? t('marketplace.findTheme','Найти тему') : t('addonStore.findExtension','Найти расширение');
        byId('search').setAttribute('aria-label',byId('search').placeholder);
        byId('empty').hidden = !!entries.length;
        byId('empty').textContent = search ? t('addonStore.nothingFoundTryAnotherName','Ничего не найдено. Попробуйте другое название.') : section === 'theme' ? t('marketplace.noThemes','В этом разделе пока нет тем.') : t('marketplace.noExtensions','В этом разделе пока нет расширений.');
        for (const entry of entries) {
            const card = node('article','store-card'); card.dataset.addonId = entry.id; card.dataset.kind = entry.kind || 'extension';
            if (entry.artwork.banner) { const banner = node('img','card-banner'); banner.src = entry.artwork.banner; banner.alt = ''; card.append(banner); }
            const body = node('div','card-body'), heading = node('div','card-heading');
            const picture = node(entry.artwork.icon ? 'img' : 'span','card-icon' + (entry.artwork.icon ? '' : ' card-placeholder'));
            if (entry.artwork.icon) { picture.src = entry.artwork.icon; picture.alt = ''; } else picture.append(icon(entry.kind === 'theme' ? 'palette' : 'puzzle'));
            const title = node('div'), author = node('div','card-author',entry.author); author.prepend(icon(entry.channel === 'community' ? 'users' : 'badge-check'));
            title.append(node('h2','card-title',entry.name),author); heading.append(picture,title);
            const metadata = node('div','card-metadata');
            metadata.append(node('span','',entry.kind === 'theme' ? t('marketplace.theme','Тема') : entry.type === 'integration' ? (globalThis.noctuneI18n?.t("addonInstall.app.integration", {}) ?? "Интеграция") : (globalThis.noctuneI18n?.t("addonInstall.app.addOn", {}) ?? "Дополнение")),node('span','',(globalThis.noctuneI18n?.t("addonStore.app.version", {}) ?? "Версия ") + entry.version),node('span','','Noctune ' + entry.minNoctuneVersion + '+'));
            const actions = node('div','card-actions'), control = node('button','primary'); control.type = 'button';
            const labels = { install:(globalThis.noctuneI18n?.t("addonInstall.install", {}) ?? "Установить"),update:(globalThis.noctuneI18n?.t("addonStore.updatePackage", {}) ?? "Обновить"),installed:(globalThis.noctuneI18n?.t("addonInstall.app.installed", {}) ?? "Установлено"),conflict:(globalThis.noctuneI18n?.t("addonStore.app.differentPublisher", {}) ?? "Другой издатель") };
            control.textContent = !entry.compatible ? (globalThis.noctuneI18n?.t("addonStore.app.incompatible", {}) ?? "Несовместимо") : entry.state === 'installed' ? labels.installed : !entry.published ? (globalThis.noctuneI18n?.t("addonStore.app.comingToTheStore", {}) ?? "Скоро в магазине") : labels[entry.state];
            control.disabled = busy || !entry.compatible || !entry.published || ['installed','conflict'].includes(entry.state);
            const state = !entry.compatible ? (globalThis.noctuneI18n?.t("addonStore.app.checkYourNoctuneVersion", {}) ?? "Проверьте версию Noctune") : entry.state === 'installed' ? entry.enabled ? (globalThis.noctuneI18n?.t("addonStore.app.enabledInPlayer", {}) ?? "Включено в плеере") : (globalThis.noctuneI18n?.t("addonStore.app.canBeEnabledInSettings", {}) ?? "Можно включить в настройках") : entry.state === 'conflict' ? (globalThis.noctuneI18n?.t("addonStore.app.idBelongsToAnExtensionFromAnotherPublisher", {}) ?? "ID занят расширением другого издателя") : !entry.published ? (globalThis.noctuneI18n?.t("addonStore.app.preparingForPublication", {}) ?? "Готовится к публикации") : (globalThis.noctuneI18n?.t("addonStore.app.officialExtension", {}) ?? "Официальное расширение");
            const scope = entry.channel === 'community' ? t('addonStore.community','Пользовательские') : t('addonStore.official','Официальные');
            actions.append(node('span','card-state',entry.state === 'install' && entry.published && entry.compatible ? scope : state),control);
            control.addEventListener('click',() => install(entry));
            body.append(heading,node('p','card-description',entry.description),metadata,actions); card.append(body); list.append(card);
        }
        lucide.createIcons();
    }
    async function load(refresh = false) {
        if (refresh && refreshing) return;
        if (refresh) { refreshing = true; byId('refresh').disabled = true; byId('catalog-message').textContent = (globalThis.noctuneI18n?.t("addonStore.app.refreshingCatalog", {}) ?? "Обновляем каталог…"); }
        try {
            catalog = await api.list(refresh);
            const names = { builtin:(globalThis.noctuneI18n?.t("addonStore.app.bundledCatalog", {}) ?? "Встроенный каталог"),cache:(globalThis.noctuneI18n?.t("addonStore.app.savedCatalog", {}) ?? "Сохранённый каталог"),network:(globalThis.noctuneI18n?.t("addonStore.app.githubCatalog", {}) ?? "Каталог GitHub") };
            byId('catalog-source').textContent = names[catalog.source] || (globalThis.noctuneI18n?.t("addonStore.noctuneCatalog", {}) ?? "Каталог Noctune");
            byId('catalog-source').title = (globalThis.noctuneI18n?.t("addonStore.app.updated", {}) ?? "Обновлён: ") + new Date(catalog.generatedAt).toLocaleString(globalThis.noctuneI18n?.locale || 'ru');
            byId('catalog-message').textContent = catalog.message; render();
        } catch (error) { byId('catalog-message').textContent = error.message || (globalThis.noctuneI18n?.t("addonStore.app.couldNotLoadCatalog", {}) ?? "Не удалось загрузить каталог"); }
        finally { if (refresh) { refreshing = false; byId('refresh').disabled = false; } }
    }
    async function install(entry) {
        if (busy) return;
        busy = true; byId('status').textContent = t('marketplace.downloading','Загружаем пакет…'); render();
        try {
            const result = await api.install(entry.id,entry.kind || 'extension',entry.channel || 'official');
            byId('status').textContent = result.installed ? entry.kind === 'theme' ? t('marketplace.themeInstalled','Тема установлена. Выберите её в настройках оформления.') : (globalThis.noctuneI18n?.t("addonStore.app.extensionInstalledEnableItInPlayerSettings", {}) ?? "Расширение установлено. Включите его в настройках плеера.") : (globalThis.noctuneI18n?.t("addonStore.app.installationCanceled", {}) ?? "Установка отменена");
            await load(true);
        } catch (error) { byId('status').textContent = error.message || (globalThis.noctuneI18n?.t("extensions.installer.couldNotInstallExtension", {}) ?? "Не удалось установить расширение"); }
        finally { busy = false; render(); }
    }
    for (const kind of ['repository','documentation','submission']) byId(kind).addEventListener('click',() => api.openLink(kind).catch(error => { byId('status').textContent = error.message; }));
    byId('search').addEventListener('input',render);
    byId('refresh').addEventListener('click',() => load(true));
    api.onRefresh(state => { if(state?.section === 'themes')selectSection(1); return load(true); });
    lucide.createIcons();
    selectSection(section === 'theme' ? 1 : 0);
    load().then(() => load(true));
})();
