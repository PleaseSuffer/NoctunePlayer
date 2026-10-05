const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 900, height: 850 });
    try {
        const html = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');
        const css = fs.readFileSync(path.join(__dirname, '../src/renderer/styles/app.css'), 'utf8');
        const settings = fs.readFileSync(path.join(__dirname, '../src/renderer/ui/settings.js'), 'utf8');
        const block = settings.slice(settings.indexOf('            // ---- APPEARANCE: Visualizer type dropdown'), settings.indexOf('            // ---- APPEARANCE: Fireworks (Салют) settings'));
        const content = html.slice(html.indexOf('<div class="settings-section-title">Визуализатор'), html.indexOf('</div><!-- /viz-advanced-settings -->'));
        const waveformColor = html.slice(html.indexOf('<div id="waveform-color-row"'), html.indexOf('</div>', html.indexOf('<div id="waveform-color-row"')) + 6);
        await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<html><head><style>${css}</style></head><body style="display:block;">${waveformColor}${content}</body></html>`));
        await win.webContents.executeJavaScript(`const appStorage = { data: {}, getItem(k) { return this.data[k] ?? null; }, setItem(k,v) { this.data[k] = String(v); } }; const lucide = { createIcons() {} }; ${block}`);
        const result = await win.webContents.executeJavaScript(`(() => {
            const visible = id => getComputedStyle(document.getElementById(id)).display !== 'none';
            selectVizType('bars-center');
            const legacyBars = { label: document.getElementById('viz-type-label').textContent, position: document.querySelector('#viz-bars-position .pd-label').textContent, style: window.vizStyle };
            selectVizType('circle-lines'); selectVizType('bars');
            const retainedBars = window.vizStyle;
            selectVizType('circle'); const retainedCircle = window.vizStyle;
            selectVizColorMode('accent'); const accent = { gradient: visible('viz-settings-gradient'), custom: visible('viz-custom-color-row'), animation: visible('viz-rotate-speed-row') };
            selectVizColorMode('custom'); applyVizCustomColor('#123456');
            const custom = { visible: visible('viz-custom-color-row'), color: window.vizCustomColor };
            selectVizColorMode('gradient'); const gradient = visible('viz-settings-gradient');
            const button = document.querySelector('#viz-color-mode .viz-type-dropdown-btn');
            button.click(); const expanded = button.getAttribute('aria-expanded');
            button.dispatchEvent(new KeyboardEvent('keydown', { key:'Home', bubbles:true }));
            document.activeElement.click(); const keyboardChoice = window.vizColorMode;
            button.click(); button.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }));
            const escaped = button.getAttribute('aria-expanded') === 'false' && document.activeElement === button;
            selectVizType('fireworks'); const fireworksColor = visible('viz-settings-color');
            const defaultCircleSize = window.vizCircleSize;
            const sizeSlider = document.getElementById('setting-viz-circle-size');
            sizeSlider.value = '125'; sizeSlider.dispatchEvent(new Event('input'));
            const sizeSetting = { value:window.vizCircleSize, stored:appStorage.getItem('setting_viz_circle_size'), label:document.getElementById('setting-viz-circle-size-label').textContent };
            selectVizType('circle'); document.querySelector('[data-value="circle-dots"]').click();
            const dotsStyle = window.vizStyle;
            document.querySelector('[data-value="circle-double"]').click(); const doubleStyle = window.vizStyle;
            selectVizType('bars'); document.querySelector('[data-value="bars-top"]').click(); const topStyle = window.vizStyle;
            const topLabel = document.querySelector('#viz-bars-position .pd-label').textContent;
            selectVizType('circle'); const rememberedCircle = window.vizStyle;
            applyVizCircleSize('invalid'); const invalidSize = window.vizCircleSize;
            applyVizCircleSize(9); const clampedSize = window.vizCircleSize;
            const newVariants = { defaultCircleSize, sizeSetting, dotsStyle, doubleStyle, topStyle, topLabel, rememberedCircle, invalidSize, clampedSize };
            const standardDropdowns = [...document.querySelectorAll('[data-viz-option]')].every(root => root.className === 'viz-type-dropdown-wrapper' && root.querySelector('.pd-icon [data-lucide]') && [...root.querySelectorAll('[role="option"]')].every(option => option.tagName === 'DIV' && option.querySelector('[data-lucide]')));
            function appearance(element) {
                const css = getComputedStyle(element);
                return Object.fromEntries(['fontFamily', 'fontSize', 'fontWeight', 'textAlign', 'backgroundColor', 'padding', 'borderRadius', 'border', 'boxShadow'].map(key => [key, css[key]]));
            }
            const reference = document.querySelector('#viz-type-dropdown-menu [data-viz="waveform"]');
            const referenceButton = document.getElementById('viz-type-dropdown-btn');
            const styleChecks = [], widths = [];
            for (const id of ['viz-circle-mode', 'viz-bars-position', 'viz-color-mode']) {
                selectVizType(id === 'viz-bars-position' ? 'bars' : 'circle');
                selectVizColorMode('custom');
                const root = document.getElementById(id);
                styleChecks.push({ button:appearance(root.querySelector('.viz-type-dropdown-btn')), option:appearance(root.querySelector('[role="option"]:not(.active)')), menu:appearance(root.querySelector('.viz-type-dropdown-menu')) });
                widths.push([root.getBoundingClientRect().width, document.getElementById('viz-type-dropdown-wrapper').getBoundingClientRect().width]);
            }
            const pickerReference = appearance(document.getElementById('waveform-color-picker'));
            const pickerChecks = ['viz-custom-color', 'viz-grad-color1', 'viz-grad-color2', 'viz-grad-color3', 'fw-custom-color1', 'fw-custom-color2', 'fw-custom-color3'].map(id => {
                const element = document.getElementById(id);
                return { style:appearance(element), width:getComputedStyle(element).width, height:getComputedStyle(element).height, labelFont:getComputedStyle(document.querySelector('label[for="' + id + '"]')).fontSize };
            });
            return { legacyBars, retainedBars, retainedCircle, accent, custom, gradient, expanded, keyboardChoice, escaped, fireworksColor, newVariants, standardDropdowns, styleChecks, widths, referenceOption:appearance(reference), referenceButton:appearance(referenceButton), referenceMenu:appearance(document.getElementById('viz-type-dropdown-menu')), pickerReference, pickerChecks, types: document.querySelectorAll('#viz-type-dropdown-menu [data-viz]').length };
        })()`);
        assert.deepEqual(result.legacyBars, { label: 'Полосы', position: 'По центру', style: 'bars-center' });
        assert.equal(result.retainedBars, 'bars-center'); assert.equal(result.retainedCircle, 'circle-lines');
        assert.deepEqual(result.accent, { gradient:false, custom:false, animation:false });
        assert.deepEqual(result.custom, { visible:true, color:'#123456' });
        assert.equal(result.gradient, true); assert.equal(result.expanded, 'true');
        assert.equal(result.keyboardChoice, 'accent'); assert.equal(result.escaped, true);
        assert.equal(result.fireworksColor, false); assert.equal(result.types, 4);
        assert.deepEqual(result.newVariants, { defaultCircleSize:1, sizeSetting:{ value:1.25, stored:'1.25', label:'125%' }, dotsStyle:'circle-dots', doubleStyle:'circle-double', topStyle:'bars-top', topLabel:'Сверху', rememberedCircle:'circle-double', invalidSize:1, clampedSize:1.4 });
        assert.equal(result.standardDropdowns, true, 'visualizer type dropdown markup and Lucide icons');
        for (const styles of result.styleChecks) {
            assert.deepEqual(styles.button, result.referenceButton, 'selector fonts and styles match the visualizer type');
            assert.deepEqual(styles.option, result.referenceOption, 'menu item fonts and styles match the visualizer type');
            assert.deepEqual(styles.menu, result.referenceMenu, 'menu background and borders match the visualizer type');
        }
        for (const [actual, reference] of result.widths) assert.equal(actual, reference, 'every dropdown stretches to the same full width');
        for (const picker of result.pickerChecks) {
            assert.deepEqual(picker.style, result.pickerReference, 'color picker style matches waveform');
            assert.equal(picker.width, '32px'); assert.equal(picker.height, '28px'); assert.equal(picker.labelFont, '12px');
        }
        // Audit the whole settings DOM, including hidden and expanded submenus.
        await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace('</head>', `<style>* { transition:none !important; }</style></head>`).replace(/href="styles\/app.css"/, `href="data:text/css;charset=utf-8,${encodeURIComponent(css)}"`)));
        const layout = await win.webContents.executeJavaScript(`(() => {
            const border = (element, side) => getComputedStyle(element)[side + 'Width'];
            const groups = [...document.querySelectorAll('.settings-option-group')];
            const checks = groups.map(group => {
                const header = group.querySelector(':scope > .settings-row');
                const details = [...group.querySelectorAll(':scope > [data-settings-detail]')];
                const states = [];
                for (const display of ['none', 'block']) {
                    details.forEach(detail => detail.style.display = display);
                    states.push({ headerBottom:border(header, 'borderBottom'), detailTops:details.map(detail => border(detail, 'borderTop')), groupBottom:border(group, 'borderBottom') });
                }
                return states;
            });
            const sample = ['setting-auto-refresh', 'setting-crossfade', 'setting-show-stars', 'setting-glass-opacity'].map(id => {
                const header = document.getElementById(id).closest('.settings-row');
                const group = header.parentElement;
                const next = group.nextElementSibling;
                return { grouped:group.classList.contains('settings-option-group'), nextTop:next && border(next, 'borderTop'), trailing:border(group, 'borderBottom'), final:!next };
            });
            const keys = ['fontFamily','fontSize','fontWeight','textAlign','backgroundColor','padding','borderRadius','border','boxShadow'];
            const appearance = element => { const style = getComputedStyle(element); return Object.fromEntries(keys.map(key => [key, style[key]])); };
            return { groups:groups.length, checks, sample, fpsWidth:getComputedStyle(document.getElementById('effects-fps-dropdown')).width,
                fpsMenu:appearance(document.getElementById('effects-fps-menu')), typeMenu:appearance(document.getElementById('viz-type-dropdown-menu')),
                fpsOption:appearance(document.querySelector('[data-fps="30"]')), typeOption:appearance(document.querySelector('[data-viz="waveform"]')) };
        })()`);
        assert.equal(layout.groups, 32);
        for (const states of layout.checks) for (const state of states) {
            assert.equal(state.headerBottom, '0px', 'no separator between parent and dependent settings');
            assert.ok(state.detailTops.every(width => width === '0px'), 'submenus have no top separator');
            assert.equal(state.groupBottom, '0px', 'no trailing separator after the last group');
        }
        assert.ok(layout.sample.every(sample => sample.grouped));
        assert.equal(layout.sample[1].nextTop, '1px', 'crossfade divider is after all dependent settings');
        assert.equal(layout.sample[2].nextTop, '1px', 'stars divider is after the interactive sky controls');
        assert.equal(layout.sample[3].final, true, 'final expanded option leaves no divider at the bottom of the card');
        assert.equal(layout.fpsWidth, '180px');
        assert.deepEqual(layout.fpsMenu, layout.typeMenu, 'FPS menu uses the common background, borders and fonts');
        assert.deepEqual(layout.fpsOption, layout.typeOption, 'FPS menu items match visualizer types');
        console.log('PASS: real Chromium dropdowns, legacy presets, remembered family options, color visibility, custom colors and keyboard selection.');
    } catch (error) { console.error(error); process.exitCode = 1; }
    finally { win.destroy(); app.exit(process.exitCode || 0); }
});
