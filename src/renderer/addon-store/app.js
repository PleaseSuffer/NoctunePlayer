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
            metadata.append(node('span','',entry.type === 'integration' ? (globalThis.noctuneI18n?.t("addonInstall.app.integration", {}) ?? "Интеграция") : (globalThis.noctuneI18n?.t("addonInstall.app.addOn", {}) ?? "Дополнение")),node('span','',(globalThis.noctuneI18n?.t("addonStore.app.version", {}) ?? "Версия ") + entry.version),node('span','','Noctune ' + entry.minNoctuneVersion + '+'));
            const actions = node('div','card-actions'), control = node('button','primary'); control.type = 'button';
            const labels = { install:(globalThis.noctuneI18n?.t("addonInstall.install", {}) ?? "Установить"),update:(globalThis.noctuneI18n?.t("addonStore.refresh", {}) ?? "Обновить"),installed:(globalThis.noctuneI18n?.t("addonInstall.app.installed", {}) ?? "Установлено"),conflict:(globalThis.noctuneI18n?.t("addonStore.app.differentPublisher", {}) ?? "Другой издатель") };
            control.textContent = !entry.compatible ? (globalThis.noctuneI18n?.t("addonStore.app.incompatible", {}) ?? "Несовместимо") : entry.state === 'installed' ? labels.installed : !entry.published ? (globalThis.noctuneI18n?.t("addonStore.app.comingToTheStore", {}) ?? "Скоро в магазине") : labels[entry.state];
            control.disabled = busy || !entry.compatible || !entry.published || ['installed','conflict'].includes(entry.state);
            const state = !entry.compatible ? (globalThis.noctuneI18n?.t("addonStore.app.checkYourNoctuneVersion", {}) ?? "Проверьте версию Noctune") : entry.state === 'installed' ? entry.enabled ? (globalThis.noctuneI18n?.t("addonStore.app.enabledInPlayer", {}) ?? "Включено в плеере") : (globalThis.noctuneI18n?.t("addonStore.app.canBeEnabledInSettings", {}) ?? "Можно включить в настройках") : entry.state === 'conflict' ? (globalThis.noctuneI18n?.t("addonStore.app.idBelongsToAnExtensionFromAnotherPublisher", {}) ?? "ID занят расширением другого издателя") : !entry.published ? (globalThis.noctuneI18n?.t("addonStore.app.preparingForPublication", {}) ?? "Готовится к публикации") : (globalThis.noctuneI18n?.t("addonStore.app.officialExtension", {}) ?? "Официальное расширение");
            actions.append(node('span','card-state',state),control);
            control.addEventListener('click',() => install(entry.id));
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
    async function install(id) {
        if (busy) return;
        busy = true; byId('status').textContent = (globalThis.noctuneI18n?.t("addonStore.app.downloadingExtension", {}) ?? "Загружаем расширение…"); render();
        try {
            const result = await api.install(id);
            byId('status').textContent = result.installed ? (globalThis.noctuneI18n?.t("addonStore.app.extensionInstalledEnableItInPlayerSettings", {}) ?? "Расширение установлено. Включите его в настройках плеера.") : (globalThis.noctuneI18n?.t("addonStore.app.installationCanceled", {}) ?? "Установка отменена");
            await load(true);
        } catch (error) { byId('status').textContent = error.message || (globalThis.noctuneI18n?.t("extensions.installer.couldNotInstallExtension", {}) ?? "Не удалось установить расширение"); }
        finally { busy = false; render(); }
    }
    for (const kind of ['repository','documentation','submission']) byId(kind).addEventListener('click',() => api.openLink(kind).catch(error => { byId('status').textContent = error.message; }));
    byId('search').addEventListener('input',render);
    byId('refresh').addEventListener('click',() => load(true));
    api.onRefresh(() => load(true));
    lucide.createIcons();
    load().then(() => load(true));
})();
