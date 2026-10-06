const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Element {
    constructor() { this.listeners = {}; this.style = { setProperty: (key, value) => { this.style[key] = value; } }; this.children = []; this.textContent = ''; this.scrollTop = 0; this.clientHeight = 400; this.offsetHeight = 40; this.classes = new Set(); this.classList = { toggle: (name, on) => { if (on) this.classes.add(name); else this.classes.delete(name); }, contains: name => this.classes.has(name) }; }
    querySelectorAll() { return this.children; }
    contains(element) { return this === element || this.children.includes(element); }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    replaceChildren() { this.children = []; }
    appendChild(child) { this.children.push(child); }
    focus() {}
    setAttribute(name, value) { this[name] = value; }
    getAttribute(name) { return this[name] || null; }
    removeAttribute(name) { delete this[name]; }
    getBoundingClientRect() { return { top: 0, left: 0 }; }
    getAnimations() { return []; }
    animate(frames, options) { this.animation = { frames, options }; }
    scrollTo({ top }) { this.scrollTop = top; }
}
const ids = ['lyrics-modal', 'btn-lyrics', 'mini-btn-lyrics', 'lyrics-close', 'setting-lyrics-enabled', 'lyrics-status', 'lyrics-content', 'lyrics-track', 'lyrics-retry', 'lyrics-follow', 'lyrics-view-toggle', 'setting-lyrics-autoscroll', 'lyrics-settings-body', 'lyrics-cover-image', 'lyrics-cover-placeholder', 'lyrics-seek', 'lyrics-play', 'lyrics-song-title', 'lyrics-song-artist', 'lyrics-time-current', 'lyrics-time-total', 'lyrics-prev', 'lyrics-next', 'lyrics-appearance-settings', 'setting-lyrics-color-mode', 'setting-lyrics-color', 'setting-lyrics-dim', 'setting-lyrics-blur', 'setting-lyrics-size', 'setting-lyrics-inactive', 'setting-lyrics-shadow', 'lyrics-custom-color-row', 'setting-lyrics-dim-label', 'setting-lyrics-blur-label', 'setting-lyrics-size-label', 'setting-lyrics-inactive-label', 'lyrics-color-dropdown', 'lyrics-color-menu', 'lyrics-color-label', 'lyrics-color-icon', 'setting-lastfm-covers', 'setting-lastfm-cover-cache', 'lastfm-cover-cache-settings', 'lastfm-cover-cache-clear', 'lastfm-cover-cache-status'];
ids.push('lyrics-radio-station', 'lyrics-seek-row', 'lyrics-volume-popover', 'lyrics-shuffle', 'lyrics-repeat', 'lyrics-volume', 'lyrics-volume-button', 'lyrics-volume-icon');
const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
for (const id of ['player-cover-img', 'player-cover-placeholder', 'player-cover-wrap', 'lyrics-cover-wrap', 'cover-download-status', 'lastfm-cover-cache-options', 'lastfm-cover-cache-limit', 'lastfm-cover-cache-limit-label', 'cover-cache-location-button', 'cover-cache-location-menu', 'cover-cache-location-dropdown', 'cover-cache-location-label', 'lastfm-cover-cache-usage', 'lastfm-cover-cache-path', 'settings-fab']) elements[id] = new Element();
for (const id of ['cover-cache-custom-row', 'cover-cache-custom-path', 'cover-cache-choose-folder', 'cover-cache-open-folder', 'cover-cache-location-hint']) elements[id] = new Element();
elements['cover-cache-location-menu'].children = ['app', 'music', 'custom'].map(location => { const item = new Element(); item.setAttribute('data-location', location); return item; });
const layout = { '.lyrics-now-playing': new Element(), '.lyrics-text-column': new Element() };
elements['lyrics-color-menu'].children = ['adaptive', 'accent', 'custom', 'light', 'dark'].map(mode => { const item = new Element(); item.setAttribute('data-mode', mode); return item; });
const requests = [];
let lyricsCancels = 0;
const windowListeners = {};
const storage = new Map();
let coverProgress;
const context = {
    document: { addEventListener() {}, querySelector: selector => layout[selector], getElementById: id => elements[id], createElement: () => new Element(), activeElement: new Element(), body: new Element() },
    appStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }, window: { matchMedia: () => ({ matches: false }), addEventListener: (name, callback) => { windowListeners[name] = callback; } },
    noctune: { lastfm: { onCoverProgress: callback => { coverProgress = callback; } }, lyrics: { cancel: async () => { lyricsCancels++; }, get: payload => new Promise(resolve => requests.push({ payload, resolve })) } },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, isRadioMode: false, localAudioElement: null,
    isShuffle: false, repeatMode: 0, isMuted: false, volumeSlider: { value: '0.8' },
    toggleShuffle() { context.isShuffle = !context.isShuffle; }, toggleRepeat() { context.repeatMode = (context.repeatMode + 1) % 3; }, toggleMute() { context.isMuted = !context.isMuted; },
    currentTrackDuration: 0, isPlaying: false, _trackLoading: false, formatTime: () => '0:00', lucide: { createIcons() {} },
};
vm.createContext(context); vm.runInContext(fs.readFileSync('src/renderer/integrations/lyrics.js', 'utf8'), context);
// radio-search.js loads after lyrics.js: its handlers must not be read during initialization.
context.updateVolumeThrottled = value => { context.volumeSlider.value = value; };
context.handleVolumeWheel = event => { event.preventDefault(); context.volumeSlider.value = Number(context.volumeSlider.value) + (event.deltaY < 0 ? 0.01 : -0.01); };
const flush = () => new Promise(resolve => setImmediate(resolve));
(async () => {
    context.window.setLyricsTrack({ artist: 'Artist', title: 'A' }, 1);
    assert.equal(requests.length, 0, 'closed dialog does not fetch');
    elements['btn-lyrics'].listeners.click(); assert.equal(requests.length, 1);
    assert.equal(elements['lyrics-status'].textContent, 'Ищем текст песни…');
    assert.equal(elements['lyrics-modal'].classList.contains('lyrics-expanded'), false);
    elements['lyrics-view-toggle'].listeners.click();
    assert.equal(elements['lyrics-modal'].classList.contains('lyrics-expanded'), true);
    assert.equal(context.document.body.classList.contains('lyrics-expanded'), true);
    assert.equal(storage.get('setting_lyrics_expanded'), '1');
    assert.equal(requests.length, 1, 'view changes do not refetch lyrics');
    elements['lyrics-view-toggle'].listeners.click();
    assert.equal(elements['lyrics-modal'].classList.contains('lyrics-expanded'), false);
    assert.equal(context.document.body.classList.contains('lyrics-expanded'), false);
    assert.equal(storage.get('setting_lyrics_expanded'), '0');
    context.window.setLyricsTrack({ artist: 'Artist', title: 'B' }, 2); assert.equal(requests.length, 2);
    requests[0].resolve({ status: 'found', plain: 'Old text', lines: [] }); await flush();
    assert.equal(elements['lyrics-content'].children.length, 0, 'old response ignored');
    requests[1].resolve({ status: 'found', plain: '<script>Unsafe markup</script>', lines: [] }); await flush();
    assert.equal(elements['lyrics-content'].children[0].textContent, '<script>Unsafe markup</script>', 'API text is rendered as text');
    context.window.setLyricsTrack({ artist: 'Artist', title: 'C' }, 3);
    elements['lyrics-view-toggle'].listeners.click();
    elements['setting-lyrics-enabled'].checked = false; elements['setting-lyrics-enabled'].listeners.change();
    requests[2].resolve({ status: 'found', plain: 'Late', lines: [] }); await flush();
    assert.equal(elements['lyrics-modal'].style.display, 'none');
    assert.equal(context.document.body.classList.contains('lyrics-expanded'), false, 'disable restores player visibility');
    assert.equal(elements['lyrics-settings-body'].style.display, 'none');
    assert.equal(elements['lyrics-appearance-settings'].style.display, 'none');
    assert.equal(elements['lyrics-content'].children.length, 0, 'disabled integration ignores pending response');
    assert.equal(elements['btn-lyrics'].hidden, true);
    assert.equal(elements['mini-btn-lyrics'].hidden, true);
    elements['setting-lyrics-enabled'].checked = true; elements['setting-lyrics-enabled'].listeners.change();
    elements['mini-btn-lyrics'].listeners.click();
    assert.equal(elements['lyrics-modal'].style.display, 'flex');
    assert.equal(elements['lyrics-modal'].classList.contains('lyrics-expanded'), true, 'opening restores expanded dialog');
    assert.equal(requests.length, 4, 'mini-player opens the same lyrics dialog');
    elements['lyrics-shuffle'].listeners.click();
    assert.equal(context.isShuffle, true);
    assert.equal(elements['lyrics-shuffle'].getAttribute('aria-pressed'), 'true');
    for (const mode of [1, 2, 0]) { elements['lyrics-repeat'].listeners.click(); assert.equal(context.repeatMode, mode); }
    elements['lyrics-volume'].value = '0.35'; elements['lyrics-volume'].listeners.input();
    assert.equal(context.volumeSlider.value, '0.35');
    assert.equal(elements['lyrics-volume-popover'].style['--volume-level'], 0.35);
    let prevented = false;
    elements['lyrics-volume'].listeners.wheel({ deltaY: -1, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(context.volumeSlider.value, 0.36);
    elements['lyrics-volume-button'].listeners.click();
    assert.equal(context.isMuted, true);
    assert.equal(elements['lyrics-volume-popover'].style['--volume-level'], 0);
    assert.equal(elements['lyrics-volume-icon'].getAttribute('data-lucide'), 'volume-x');
    const controls = [];
    context.playPrev = () => controls.push('prev');
    context.playNext = () => controls.push('next');
    context.togglePlayback = () => { controls.push('play'); context.isPlaying = !context.isPlaying; };
    context.startSourceAt = position => controls.push(position);
    context.currentTrackDuration = 100;
    context.localAudioElement = { currentTime: 10, duration: 100, getAttribute: () => 'track.mp3' };
    elements['lyrics-prev'].listeners.click(); elements['lyrics-next'].listeners.click(); elements['lyrics-play'].listeners.click();
    elements['lyrics-seek'].value = 50; elements['lyrics-seek'].listeners.input();
    assert.deepEqual(controls, ['prev', 'next', 'play', 50]);
    elements['setting-lyrics-autoscroll'].checked = false;
    elements['setting-lyrics-autoscroll'].listeners.change();
    assert.equal(elements['lyrics-appearance-settings'].style.display, 'flex');
    assert.equal(context.window.getLyricsAppearance().mode, 'adaptive');
    context.window.applyLyricsAppearanceTheme({ mode: 'custom', color: '#123456', dim: 40, blur: 4, size: 120, inactive: 55, shadow: false });
    assert.equal(elements['lyrics-custom-color-row'].style.display, 'flex');
    assert.equal(elements['lyrics-modal'].style['--lyrics-color'], '#123456');
    assert.equal(elements['lyrics-modal'].style['--lyrics-dim'], 0.4);
    assert.equal(elements['lyrics-modal'].style['--lyrics-shadow'], 'none');
    assert.equal(elements['setting-lyrics-dim-label'].textContent, '40%');
    context.window.applyLyricsAppearanceTheme({ mode: 'accent' });
    assert.equal(elements['lyrics-modal'].style['--lyrics-color'], 'var(--accent-color)');
    context.window.applyLyricsAppearanceTheme({ mode: 'invalid', color: 'url(unsafe)', dim: 999, blur: -5, size: 'broken', inactive: 0 });
    assert.equal(context.window.getLyricsAppearance().mode, 'adaptive');
    assert.equal(context.window.getLyricsAppearance().color, '#ffffff');
    assert.equal(context.window.getLyricsAppearance().dim, 80);
    assert.equal(context.window.getLyricsAppearance().blur, 0);
    assert.equal(context.window.getLyricsAppearance().size, 100);
    assert.equal(context.window.getLyricsAppearance().inactive, 15);
    elements['setting-lyrics-color-mode'].listeners.click();
    assert.equal(elements['lyrics-color-menu'].classList.contains('open'), true);
    elements['lyrics-color-menu'].children[2].listeners.click();
    assert.equal(context.window.getLyricsAppearance().mode, 'custom');
    assert.equal(elements['lyrics-color-label'].textContent, 'Свой цвет');
    assert.equal(elements['lyrics-color-menu'].classList.contains('open'), false);
    requests[3].resolve({ status: 'missing' }); await flush();
    assert.equal(elements['lyrics-modal'].classList.contains('lyrics-no-text'), true);
    assert.equal(layout['.lyrics-now-playing'].animation.options.duration, 380, 'missing lyrics animate centering');
    assert.equal(elements['lyrics-status'].textContent, 'Текст этой песни не найден.');
    context.window.setLyricsTrack({ artist: 'Artist', title: 'D' }, 4);
    assert.equal(elements['lyrics-modal'].classList.contains('lyrics-no-text'), true, 'keeps layout until new lyrics arrive');
    requests[4].resolve({ status: 'error' }); await flush();
    assert.equal(elements['lyrics-modal'].classList.contains('lyrics-no-text'), false, 'network errors remain visible and retryable');
    const artworkRequests = [];
    context.noctune.lastfm = { cover: payload => new Promise(resolve => artworkRequests.push({ payload, resolve })) };
    context.window.lastfmEnabled = true;
    context.window.refreshLyricsArtwork();
    assert.equal(artworkRequests.length, 1);
    context.window.setLyricsTrack({ artist: 'Artist', title: 'E', coverDataUrl: 'data:image/png;base64,embedded' }, 5);
    assert.equal(artworkRequests.length, 1, 'embedded cover avoids network lookup');
    artworkRequests[0].resolve({ status: 'found', dataUrl: 'data:image/png;base64,oldRemote' }); await flush();
    assert.equal(elements['lyrics-cover-image'].src, 'data:image/png;base64,embedded', 'stale artwork cannot replace embedded cover');
    context.fileEntries = [
        { path: 'D:/music/F.mp3', kind: 'file' },
        { path: 'D:/other/F.mp3', kind: 'file' },
        { path: 'D:/music/embedded.mp3', kind: 'file' },
        { path: 'D:/music/F.mp3', kind: 'file' },
    ];
    context.parsedMetadataCache = {
        0: { artist: 'Artist', title: 'F' }, 1: { artist: 'Artist', title: 'F' },
        2: { artist: 'Artist', title: 'Embedded', coverDataUrl: 'data:image/png;base64,embedded' },
        3: { artist: 'Artist', title: 'F' },
    };
    for (let index = 0; index < 4; index++) {
        elements['cover-' + index] = new Element(); elements['cover-ph-' + index] = new Element();
    }
    context.window.setLyricsTrack({ artist: 'Artist', title: 'F', filePath: 'D:/music/F.mp3' }, 6);
    assert.equal(artworkRequests.length, 2);
    assert.equal(artworkRequests[1].payload.filePath, 'D:/music/F.mp3');
    coverProgress({ requestId: artworkRequests[1].payload.requestId, phase: 'downloading', progress: .5 });
    assert.equal(elements['player-cover-wrap'].getAttribute('data-artwork-state'), 'downloading');
    assert.equal(elements['player-cover-wrap'].style['--cover-progress'], .5);
    coverProgress({ requestId: artworkRequests[0].payload.requestId, phase: 'downloading', progress: .1 });
    assert.equal(elements['player-cover-wrap'].style['--cover-progress'], .5, 'stale progress ignored');
    const cancellationsBeforeClose = lyricsCancels;
    elements['lyrics-close'].listeners.click();
    assert.equal(lyricsCancels, cancellationsBeforeClose + 1, 'closing cancels automatic lyrics retries');
    context.noctune.metadata = { thumbnail: async () => 'data:image/jpeg;base64,smallThumbnail' };
    artworkRequests[1].resolve({ status: 'found', dataUrl: 'data:image/png;base64,newRemote' }); await flush();
    assert.equal(elements['lyrics-cover-image'].src, 'data:image/png;base64,newRemote');
    assert.equal(elements['player-cover-img'].src, 'data:image/png;base64,newRemote', 'remote artwork applies to main screen');
    assert.equal(elements['cover-0'].src, 'data:image/jpeg;base64,smallThumbnail', 'download updates playlist thumbnail');
    assert.equal(elements['cover-3'].src, 'data:image/jpeg;base64,smallThumbnail', 'duplicate entries for the file update together');
    assert.equal(elements['cover-1'].getAttribute('src'), null, 'same title in a different folder does not receive wrong artwork');
    assert.equal(elements['cover-2'].src, 'data:image/png;base64,embedded', 'embedded artwork retains priority');
    elements['cover-3'].onerror();
    assert.equal(elements['cover-3'].getAttribute('src'), null, 'failed thumbnail restores placeholder');
    elements['cover-0'].onload(); assert.equal(elements['cover-0'].classList.contains('loaded'), true);
    const oldThumbnailLoad = elements['cover-0'].onload;
    context.fileEntries[0] = { path: 'D:/other/replacement.mp3', kind: 'file' };
    elements['cover-0'].classList.toggle('loaded', false);
    oldThumbnailLoad(); assert.equal(elements['cover-0'].classList.contains('loaded'), false, 'late image load cannot affect replacement entry');
    context.fileEntries[0] = { path: 'D:/music/F.mp3', kind: 'file' };
    elements['cover-0'] = new Element();
    context.window.updateTrackArtwork(0, context.parsedMetadataCache[0], 'D:/music/F.mp3');
    assert.equal(elements['cover-0'].src, 'data:image/jpeg;base64,smallThumbnail', 'playlist rebuild restores artwork by file path');
    elements['player-cover-img'].listeners.load();
    assert.equal(elements['player-cover-img'].classList.contains('loaded'), true);
    assert.equal(elements['player-cover-wrap'].getAttribute('data-artwork-state'), 'ready');
    context.noctune.lastfm.coverCacheStats = async () => ({ ok: true, bytes: 1048576, limitMB: 30, directory: 'cache-folder' });
    context.noctune.lastfm.configureCoverCache = context.noctune.lastfm.coverCacheStats;
    elements['settings-fab'].listeners.click(); await flush();
    assert.equal(elements['lastfm-cover-cache-usage'].textContent, 'Занято: 1.0 МБ из 30 МБ');
    elements['setting-lastfm-cover-cache'].checked = false; elements['setting-lastfm-cover-cache'].listeners.change();
    assert.equal(elements['lastfm-cover-cache-options'].style.display, 'none');
    elements['setting-lastfm-covers'].checked = false; elements['setting-lastfm-covers'].listeners.change();
    assert.equal(elements['lyrics-cover-image'].hidden, true);
    assert.equal(elements['cover-0'].getAttribute('src'), null, 'disabling Last.fm removes remote thumbnails');
    assert.equal(elements['cover-2'].src, 'data:image/png;base64,embedded', 'disabling Last.fm keeps embedded thumbnails');
    elements['cover-cache-location-menu'].children[1].listeners.click(); await flush();
    assert.equal(elements['cover-cache-location-label'].textContent, 'В папке с музыкой');
    const savedSettings = [];
    context.appStorage.setItem = (key, value) => savedSettings.push([key, value]);
    context.noctune.lastfm.chooseCoverCacheFolder = async () => ({ canceled: true });
    await elements['cover-cache-location-menu'].children[2].listeners.click();
    assert.equal(elements['cover-cache-location-label'].textContent, 'В папке с музыкой', 'cancel keeps previous location');
    assert.equal(elements['cover-cache-choose-folder'].disabled, false);
    context.noctune.lastfm.chooseCoverCacheFolder = async () => ({ ok: true, directory: 'D:/chosen-covers' });
    await elements['cover-cache-location-menu'].children[2].listeners.click();
    assert.equal(elements['cover-cache-location-label'].textContent, 'Своя папка');
    assert.equal(elements['cover-cache-custom-row'].style.display, 'flex');
    assert.equal(elements['cover-cache-custom-path'].textContent, 'D:/chosen-covers');
    assert(savedSettings.some(([key, value]) => key === 'setting_lastfm_cover_cache_custom_path' && value === 'D:/chosen-covers'));
    let openedFolderPayload;
    context.noctune.lastfm.openCoverCacheFolder = async payload => { openedFolderPayload = payload; return { ok: true }; };
    await elements['cover-cache-open-folder'].listeners.click();
    assert.equal(openedFolderPayload.filePath, 'D:/music/F.mp3', 'open action resolves cache from current music file');
    context.noctune.lastfm.openCoverCacheFolder = async () => ({ ok: false });
    await elements['cover-cache-open-folder'].listeners.click();
    assert.equal(elements['lastfm-cover-cache-status'].textContent, 'Не удалось открыть папку обложек.');
    elements['btn-lyrics'].listeners.click();
    assert.equal(elements['lyrics-modal'].classList.contains('lyrics-expanded'), true, 'close preserves expanded preference');
    elements['lyrics-view-toggle'].listeners.click();
    elements['lyrics-close'].listeners.click();
    elements['btn-lyrics'].listeners.click();
    assert.equal(elements['lyrics-modal'].classList.contains('lyrics-expanded'), false, 'collapsed preference also persists');
    const requestCount = requests.length;
    context.isRadioMode = true;
    context.window.setLyricsTrack({ radio: true, stationName: 'Test FM', title: '', artist: '' }, 7);
    assert.equal(elements['lyrics-seek-row'].hidden, true);
    assert.equal(elements['lyrics-radio-station'].textContent, 'Test FM');
    context.window.setLyricsTrack({ radio: true, stationName: 'Test FM', artist: 'Radio Artist', title: 'Radio Song' }, 7);
    assert.equal(elements['lyrics-song-title'].textContent, 'Radio Song');
    assert.equal(elements['lyrics-song-artist'].textContent, 'Radio Artist');
    assert.equal(requests.length, requestCount, 'radio metadata does not fetch lyrics');
    const radioArt = [];
    let radioCancels = 0;
    context.noctune.lastfm.cover = payload => new Promise(resolve => radioArt.push({ payload, resolve }));
    context.noctune.lastfm.cancelRadioCover = async () => { radioCancels++; };
    elements['setting-lastfm-covers'].checked = true;
    elements['setting-lastfm-covers'].listeners.change();
    assert.equal(radioArt.length, 1);
    assert.equal(radioArt[0].payload.transient, true);
    context.window.setLyricsTrack({ radio: true, stationName: 'Test FM', artist: 'Radio Artist', title: 'Radio Song' }, 7);
    assert.equal(radioArt.length, 1, 'duplicate radio metadata does not refetch');
    context.window.setLyricsTrack({ radio: true, stationName: 'Test FM', artist: 'New Artist', title: 'New Song' }, 7);
    radioArt[0].resolve({ status: 'found', dataUrl: 'data:image/png;base64,oldradio' }); await flush();
    assert.equal(elements['lyrics-cover-image'].getAttribute('src'), null, 'old radio song response is ignored');
    radioArt[1].resolve({ status: 'found', dataUrl: 'data:image/png;base64,radio' }); await flush();
    assert.equal(elements['lyrics-cover-image'].src, 'data:image/png;base64,radio');
    assert.equal(elements['player-cover-img'].src, 'data:image/png;base64,radio');
    context.window.setLyricsTrack({ radio: true, stationName: 'Another FM', artist: 'New Artist', title: 'New Song' }, 9);
    assert.equal(elements['lyrics-cover-image'].getAttribute('src'), null, 'station change releases previous image');
    radioArt[2].resolve({ status: 'error' }); await flush();
    windowListeners.online();
    assert.equal(radioArt.length, 4, 'connectivity restoration retries current radio track');
    elements['setting-lastfm-covers'].checked = false; elements['setting-lastfm-covers'].listeners.change();
    radioArt[3].resolve({ status: 'found', dataUrl: 'data:image/png;base64,disabledradio' }); await flush();
    assert.equal(elements['lyrics-cover-image'].getAttribute('src'), null, 'disabling auto-covers ignores pending response');
    elements['setting-lastfm-covers'].checked = true; elements['setting-lastfm-covers'].listeners.change();
    context.window.clearRadioArtwork();
    radioArt[4].resolve({ status: 'found', dataUrl: 'data:image/png;base64,stoppedradio' }); await flush();
    assert.equal(elements['lyrics-cover-image'].getAttribute('src'), null, 'stop releases image and ignores pending response');
    assert(radioCancels >= 4);
    context.window.setLyricsTrack({ radio: true, stationName: 'Another FM', artist: '', title: '' }, 10);
    assert.equal(radioArt.length, 5, 'station without track metadata does not search for a cover');
    context.window.lastfmEnabled = false;
    context.window.setLyricsTrack({ radio: true, stationName: 'Another FM', artist: 'Artist', title: 'Song' }, 10);
    assert.equal(radioArt.length, 5, 'disabled Last.fm prevents lookup');
    context.isRadioMode = false;
    context.window.setLyricsTrack({ artist: 'Local Artist', title: 'Local Song' }, 8);
    assert.equal(elements['lyrics-seek-row'].hidden, false, 'local tracks restore progress');
    assert.equal(elements['lyrics-radio-station'].hidden, true);
    context.window.lastfmEnabled = true;
    const coverRemovals = [];
    let manualCoverRequests = 0;
    context.noctune.lastfm.trackCoverCacheStatus = async () => ({ ok: true, cached: true });
    context.noctune.lastfm.removeTrackCoverCache = async payload => { coverRemovals.push(payload); return { ok: true }; };
    context.noctune.lastfm.cover = async () => { manualCoverRequests++; return { status: 'found', dataUrl: 'data:image/png;base64,manualCover' }; };
    context.window.setLyricsTrack({ ...context.parsedMetadataCache[0], filePath: context.fileEntries[0].path }, 11);
    await flush();
    const coverInfo = await context.window.getTrackCoverCacheInfo(0, context.fileEntries[0]);
    assert.equal(coverInfo.cached, true);
    assert.equal(coverInfo.payload.filePath, context.fileEntries[0].path);
    const beforeDeleteRequests = manualCoverRequests;
    await context.window.changeTrackCover(coverInfo.payload, true);
    assert.equal(manualCoverRequests, beforeDeleteRequests, 'delete does not immediately redownload');
    assert.equal(elements['player-cover-img'].getAttribute('src'), null, 'delete removes current remote cover');
    assert.equal(elements['cover-0'].getAttribute('src'), null, 'delete removes remote playlist thumbnail');
    assert.equal(elements['cover-2'].src, 'data:image/png;base64,embedded', 'embedded artwork remains intact');
    await context.window.changeTrackCover(coverInfo.payload, false);
    assert.equal(manualCoverRequests, beforeDeleteRequests + 1, 'refresh forces one lookup after removing negative cache');
    assert.equal(elements['player-cover-img'].src, 'data:image/png;base64,manualCover');
    assert.equal(elements['cover-0'].src, 'data:image/jpeg;base64,smallThumbnail');
    assert.equal(coverRemovals.length, 2);
    const html = fs.readFileSync('src/renderer/index.html', 'utf8');
    assert.equal(html.includes('cover-download-status'), false, 'cover status text is removed');
    assert(html.includes('data-lucide="trash-2"') && html.includes('data-lucide="folder-open"'));
    assert(html.indexOf('id="lyrics-appearance-settings"') < html.indexOf('Импорт/экспорт темы'));
    const integrations = html.slice(html.indexOf('id="panel-integrations"'), html.indexOf('id="panel-hotkeys"'));
    assert(integrations.indexOf('id="integration-card-lyrics"') > integrations.indexOf('id="integration-card-lastfm"'));
    assert.equal((html.match(/id="integration-card-lyrics"/g) || []).length, 1);
    console.log('PASS: on-demand fetching, track-switch race, safe text rendering, disable and pending-response cancellation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
