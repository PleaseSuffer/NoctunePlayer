(function () {
    const dialog = document.getElementById('tag-editor');
    const form = document.getElementById('tag-editor-form');
    const fields = document.getElementById('tag-editor-fields');
    const save = document.getElementById('tag-editor-save');
    const status = document.getElementById('tag-editor-status');
    const retry = document.getElementById('tag-editor-retry');
    const discard = document.getElementById('tag-editor-discard');
    const menu = document.getElementById('menu-edit-tags');
    const numeric = new Set(['year', 'track', 'trackCount', 'disc', 'discCount']);
    const t = key => globalThis.noctuneI18n.t('tagEditor.' + key);
    let target = null, original = null, revision = null, busy = false, serial = 0, returnFocus = null;
    const local = entry => entry && entry.kind !== 'radio' && entry.kind !== 'provider' && !!entry.path;

    function patch() {
        const result = {};
        if (!original) return result;
        for (const key of Object.keys(original)) {
            const value = numeric.has(key) ? Number(form.elements.namedItem(key).value) : form.elements.namedItem(key).value;
            if (value !== original[key]) result[key] = value;
        }
        return result;
    }
    function update() {
        save.disabled = busy || !original || !Object.keys(patch()).length;
        form.setAttribute('aria-busy', String(busy));
        for (const id of ['tag-editor-close', 'tag-editor-cancel']) document.getElementById(id).disabled = busy;
    }
    function message(key, error = false) { status.textContent = key ? t(key) : ''; status.dataset.error = String(error); }
    function errorMessage(code) {
        const known = ['failed', 'unsupported', 'changed', 'missing', 'permission', 'busy', 'space', 'linked', 'invalid'];
        message('errors.' + (known.includes(code) ? code : 'failed'), true);
    }
    function close(force = false) {
        if (busy) return;
        if (!force && Object.keys(patch()).length) { discard.hidden = false; document.getElementById('tag-editor-keep').focus(); return; }
        dialog.close();
    }
    async function load() {
        const request = ++serial;
        busy = true; original = null; fields.disabled = true; retry.hidden = true; update(); message('loading');
        try {
            const result = await noctune.metadata.readTags(target.path);
            if (request !== serial || !dialog.open) return;
            if (!result.ok) { errorMessage(result.code); retry.hidden = false; return; }
            original = result.tags; revision = result.revision;
            for (const [key, value] of Object.entries(original)) form.elements.namedItem(key).value = numeric.has(key) && !value ? '' : value;
            fields.disabled = false; message('');
            form.elements.namedItem('title').focus();
            const extension = target.name.split('.').pop().toUpperCase();
            document.getElementById('tag-editor-format').textContent = extension + ' · ' + new Intl.NumberFormat(globalThis.noctuneI18n.locale, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 }).format(result.size / 1024 / 1024);
        } catch (_) { if (request === serial) { errorMessage('failed'); retry.hidden = false; } }
        finally { if (request === serial) { busy = false; update(); } }
    }
    async function open(entry) {
        if (!local(entry) || dialog.open) return;
        target = { ...entry }; original = null; revision = null; discard.hidden = true;
        returnFocus = document.activeElement;
        form.reset();
        document.getElementById('tag-editor-filename').textContent = entry.name;
        const filePath = document.getElementById('tag-editor-path');
        filePath.textContent = entry.path; filePath.title = entry.path;
        document.getElementById('tag-editor-format').textContent = '';
        document.getElementById('tag-editor-read-off').hidden = appStorage.getItem('setting_read_tags') !== '0';
        const cover = document.getElementById('tag-editor-cover');
        cover.hidden = true; cover.removeAttribute('src');
        dialog.showModal();
        const loading = load();
        const request = serial;
        // Read the thumbnail independently of the playback cover request queue.
        noctune.metadata.parseFile(entry.path, entry.name).then(meta => {
            if (request !== serial || !dialog.open) return;
            if (meta.coverThumbnailDataUrl) { cover.src = meta.coverThumbnailDataUrl; cover.hidden = false; }
        }).catch(() => {});
        await loading;
    }
    form.addEventListener('input', () => { discard.hidden = true; update(); });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (busy || !original || !Object.keys(patch()).length) return;
        if (!form.reportValidity()) return;
        const changes = patch();
        busy = true; fields.disabled = true; discard.hidden = true; update(); message('saving');
        try {
            const result = await noctune.metadata.saveTags(target.path, changes, revision);
            if (!result.ok) { errorMessage(result.code); return; }
            original = result.tags; revision = result.revision;
            // Refresh by file path, since the playlist may have changed during disk I/O.
            const metadata = await readFileMetadata(target.path, target.name);
            fileEntries.forEach((entry, index) => {
                if (!local(entry) || entry.path !== target.path) return;
                parsedMetadataCache[index] = metadata;
                entry._fileSize = metadata.fileSize;
            });
            await refreshFileMetadataViews(metadata, target.path);
            busy = false; close(true);
            showNotification(t('saved'), 'success', t('title'));
        } catch (_) { errorMessage('failed'); }
        finally { busy = false; fields.disabled = !original; update(); }
    });
    for (const id of ['tag-editor-close', 'tag-editor-cancel']) document.getElementById(id).addEventListener('click', () => close());
    document.getElementById('tag-editor-keep').addEventListener('click', () => { discard.hidden = true; form.elements.namedItem('title').focus(); });
    document.getElementById('tag-editor-discard-confirm').addEventListener('click', () => close(true));
    retry.addEventListener('click', load);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('close', () => { serial++; target = null; original = null; returnFocus?.focus(); });
    // Keep player shortcuts out of the modal, including when a button has focus.
    dialog.addEventListener('keydown', event => {
        event.stopPropagation();
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!save.disabled) form.requestSubmit(); }
    });
    menu.addEventListener('click', () => open(fileEntries[selectedTrackIndexInMenu]));
    window.updateTrackTagMenu = entry => {
        menu.style.display = local(entry) ? 'flex' : 'none';
        requestAnimationFrame(() => {
            const bounds = contextMenu.getBoundingClientRect();
            contextMenu.style.left = Math.max(8, Math.min(bounds.left, innerWidth - bounds.width - 8)) + 'px';
            contextMenu.style.top = Math.max(8, Math.min(bounds.top, innerHeight - bounds.height - 8)) + 'px';
        });
    };
    playlistElem.addEventListener('contextmenu', event => {
        const row = event.target.closest('li[data-id]');
        const button = row?.querySelector('.track-item-action');
        if (!button) return;
        event.preventDefault();
        button.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: event.clientX + 140, clientY: event.clientY }));
    });
})();
