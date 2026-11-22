(function () {
    const i18n = globalThis.noctuneI18n;
    const lastText = new WeakMap();
    let translatedLocale = i18n.locale;
    function translate(root = document) {
        const nodes = [...(root.querySelectorAll?.('[data-i18n], [data-i18n-title], [data-i18n-placeholder], [data-i18n-aria-label], [data-i18n-alt]') || [])];
        if (root.nodeType === 1) nodes.unshift(root);
        for (const node of nodes) {
            if (node.hasAttribute('data-i18n')) {
                const key = node.getAttribute('data-i18n'), current = node.textContent.trim();
                const previous = lastText.get(node);
                if (previous === undefined || current === previous || current === globalThis.NoctuneLocaleCatalog.ru[key]?.trim() || current === globalThis.NoctuneLocaleCatalog.en[key]?.trim()) { node.textContent = i18n.t(key); lastText.set(node, node.textContent.trim()); }
            }
            for (const attr of ['title', 'placeholder', 'aria-label', 'alt']) if (node.hasAttribute('data-i18n-' + attr)) node.setAttribute(attr, i18n.t(node.getAttribute('data-i18n-' + attr)));
        }
        document.documentElement.lang = i18n.locale;
    }
    function populate() {
        const select = document.getElementById('setting-language');
        if (!select) return;
        select.replaceChildren(...i18n.languages().map(language => { const option = document.createElement('option'); option.value = language.locale; option.textContent = language.name; return option; }));
        select.value = i18n.locale;
        const menu = document.getElementById('language-menu');
        const label = document.getElementById('language-label');
        if (label) label.textContent = select.selectedOptions[0]?.textContent || i18n.locale;
        if (menu) menu.replaceChildren(...i18n.languages().map(language => {
            const option = document.createElement('button');
            option.type = 'button'; option.className = 'viz-type-menu-item';
            option.setAttribute('role', 'option'); option.tabIndex = -1;
            option.dataset.locale = language.locale; option.textContent = language.name;
            option.classList.toggle('active', language.locale === i18n.locale);
            option.setAttribute('aria-selected', String(language.locale === i18n.locale));
            return option;
        }));
    }
    function setupLanguageDropdown() {
        const select = document.getElementById('setting-language');
        const button = document.getElementById('setting-language-button');
        const menu = document.getElementById('language-menu');
        const wrapper = document.getElementById('language-dropdown');
        if (!select || !button || !menu || !wrapper) return;
        const options = () => [...menu.querySelectorAll('[data-locale]')];
        function open(value, focus = false) {
            menu.classList.toggle('open', value); button.classList.toggle('open', value);
            button.setAttribute('aria-expanded', String(value));
            if (value && focus) (options().find(option => option.classList.contains('active')) || options()[0])?.focus();
        }
        button.addEventListener('click', () => open(!menu.classList.contains('open')));
        menu.addEventListener('click', event => {
            const option = event.target.closest('[data-locale]');
            if (!option || !menu.contains(option)) return;
            open(false); button.focus();
            if (option.dataset.locale === select.value) return;
            select.value = option.dataset.locale;
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        document.addEventListener('click', event => { if (!wrapper.contains(event.target)) open(false); });
        wrapper.addEventListener('focusout', event => { if (!wrapper.contains(event.relatedTarget)) open(false); });
        wrapper.addEventListener('keydown', event => {
            const items = options();
            if (['Enter', ' '].includes(event.key) && items.includes(document.activeElement)) {
                event.preventDefault(); document.activeElement.click();
            } else if (event.key === 'Escape') {
                event.preventDefault(); open(false); button.focus();
            } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                if (!menu.classList.contains('open')) { open(true, true); return; }
                const index = items.indexOf(document.activeElement);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                items[next]?.focus();
            }
        });
    }
    async function selectLanguage(locale) {
        // Persist before reloading; reload rebuilds dynamic menus, cached labels and workers.
        if (window.noctuneLocale) await window.noctuneLocale.set({ locale, pack: i18n.getPack(locale) });
        else { localStorage.setItem('noctune-language', locale); location.reload(); }
    }
    if (window.noctuneLocale?.initial?.pack) i18n.register(window.noctuneLocale.initial.pack.owner || 'user-selection', window.noctuneLocale.initial.pack);
    window.noctuneLocale?.onChange(() => location.reload());
    try { i18n.setLocale(window.noctuneLocale?.initial?.locale || localStorage.getItem('noctune-language') || 'ru'); } catch {}
    translatedLocale = i18n.locale;
    function init() {
        translate(); populate();
        setupLanguageDropdown();
        document.getElementById('setting-language')?.addEventListener('change', event => selectLanguage(event.target.value).catch(error => { console.error(error); populate(); }));
        // Only explicitly marked application strings are translated. Track names,
        // provider content, form values and other user data are never inspected.
        const observer = new MutationObserver(records => { for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) translate(node); });
        observer.observe(document.body, { childList: true, subtree: true });
    }
    i18n.onChange(() => { if (translatedLocale !== i18n.locale) { translate(); translatedLocale = i18n.locale; window.noctuneLocale?.set({ locale: i18n.locale, pack: i18n.getPack(i18n.locale) }).catch(console.error); } populate(); });
    globalThis.noctuneTranslateDocument = translate;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
