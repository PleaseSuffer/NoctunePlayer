const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: process.argv.includes('--preview'), width: 900, height: 850, webPreferences:{backgroundThrottling:false} });
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
            const visible = id => document.getElementById(id).checkVisibility();
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
            const defaultGeometry = Object.fromEntries(vizGeometryControls.map(([, key]) => [key, window[key]]));
            const rotation = document.getElementById('setting-viz-circle-rotation');
            rotation.value = '135'; rotation.dispatchEvent(new Event('input'));
            const mirror = document.getElementById('setting-viz-circle-mirror');
            mirror.checked = true; mirror.dispatchEvent(new Event('change'));
            const offset = document.getElementById('setting-viz-bars-offset');
            offset.value = '-60'; offset.dispatchEvent(new Event('input'));
            const reflected = document.getElementById('setting-viz-bars-reflect');
            reflected.checked = true; reflected.dispatchEvent(new Event('change'));
            const storedGeometry = { rotation:appStorage.getItem('setting_viz_circle_rotation'), offset:appStorage.getItem('setting_viz_bars_offset'), mirror:appStorage.getItem('setting_viz_circle_mirror'), reflect:appStorage.getItem('setting_viz_bars_reflect') };
            const themeGeometry = Object.fromEntries(vizGeometryControls.map(([, key]) => [key, window[key]]));
            applyVizGeometry({}); const legacyGeometry = window.vizCircleRotation === 0 && !window.vizCircleMirror && window.vizBarsOffset === 0 && !window.vizBarsReflect;
            applyVizGeometry(themeGeometry);
            const restoredGeometry = window.vizCircleRotation === 135 && window.vizCircleMirror && window.vizBarsOffset === -60 && window.vizBarsReflect;
            applyVizGeometry({ vizCircleRotation:999, vizBarsOffset:-999 });
            const clampedGeometry = window.vizCircleRotation === 180 && window.vizBarsOffset === -100;
            applyVizGeometry({ vizCircleRotation:'bad', vizBarsOffset:'bad' });
            const invalidGeometry = window.vizCircleRotation === 0 && window.vizBarsOffset === 0;
            applyVizGeometry({ vizCircleRotation:270 });
            const legacyRotation = window.vizCircleRotation === -90;
            const resetSettings = [];
            for (const [id, property, changed, expected] of [
                ['circle-rotation', 'vizCircleRotation', -90, 0],
                ['bars-offset', 'vizBarsOffset', 40, 0],
                ['ribbon-offset', 'vizRibbonOffset', -40, 0],
                ['orbit-spacing', 'vizOrbitSpacing', 55, 30],
            ]) {
                const slider = document.getElementById('setting-viz-' + id);
                slider.value = changed; slider.dispatchEvent(new Event('input'));
                slider.dispatchEvent(new MouseEvent('mousedown', { button:1, cancelable:true }));
                const middleClickUnchanged = window[property] === changed;
                const reset = new MouseEvent('contextmenu', {button:2, cancelable:true});
                slider.dispatchEvent(reset);
                resetSettings.push(middleClickUnchanged && window[property] === expected && slider.value === String(expected) && reset.defaultPrevented && appStorage.getItem('setting_viz_' + id.replaceAll('-', '_')) === String(expected));
            }
            const centeredRotation = rotation.min === '-180' && rotation.max === '180' && rotation.value === '0';
            const geometry = { resetSettings, legacyRotation, centeredRotation, defaultGeometry, storedGeometry, legacyGeometry, restoredGeometry, clampedGeometry, invalidGeometry };
            selectVizType('orbits');
            const orbits = { label:vizTypeLabel.textContent, circles:visible('viz-settings-circles'), pattern:visible('viz-circle-mode'), bars:visible('viz-settings-bars') };
            document.querySelector('#viz-orbit-mode [data-value="dots"]').click();
            const orbitDots = window.vizOrbitMode === 'dots' && window.vizStyle === 'orbits' && appStorage.getItem('setting_viz_orbit_mode') === 'dots';
            document.querySelector('#viz-orbit-mode [data-value="dashes"]').click();
            const orbitDashes = window.vizOrbitMode === 'dashes' && window.vizStyle === 'orbits';
            const spacingSlider = document.getElementById('setting-viz-orbit-spacing');
            spacingSlider.value = '45'; spacingSlider.dispatchEvent(new Event('input'));
            const savedOrbitGeometry = Object.fromEntries(vizGeometryControls.map(([, key]) => [key, window[key]]));
            applyVizGeometry({}); applyVizGeometry(savedOrbitGeometry);
            const orbitSpacing = window.vizOrbitSpacing === 45 && appStorage.getItem('setting_viz_orbit_spacing') === '45';
            selectVizType('ribbon');
            const ribbonDefault = window.vizStyle;
            document.querySelector('[data-value="ribbon-top"]').click();
            const ribbonTop = window.vizStyle;
            const ribbonOffset = document.getElementById('setting-viz-ribbon-offset');
            ribbonOffset.value = '35'; ribbonOffset.dispatchEvent(new Event('input'));
            const ribbonMirror = document.getElementById('setting-viz-ribbon-mirror');
            ribbonMirror.checked = true; ribbonMirror.dispatchEvent(new Event('change'));
            selectVizType('bars'); selectVizType('ribbon');
            const ribbonRestored = { style:window.vizStyle, offset:window.vizRibbonOffset, mirror:window.vizRibbonMirror, visible:visible('viz-settings-ribbon'), bars:visible('viz-settings-bars') };
            selectVizColorMode('custom');
            const ribbonAnimationHidden = !visible('setting-viz-ribbon-scroll-grad');
            selectVizColorMode('gradient');
            const ribbonAnimationVisible = visible('setting-viz-ribbon-scroll-grad');
            const variants = { orbitDots, orbitDashes, orbitSpacing, orbits, ribbonDefault, ribbonTop, ribbonRestored, ribbonAnimationHidden, ribbonAnimationVisible };
            const standardDropdowns = [...document.querySelectorAll('[data-viz-option]')].every(root => root.className === 'viz-type-dropdown-wrapper' && root.querySelector('.pd-icon [data-lucide]') && [...root.querySelectorAll('[role="option"]')].every(option => option.tagName === 'DIV' && option.querySelector('[data-lucide]')));
            function appearance(element) {
                const css = getComputedStyle(element);
                return Object.fromEntries(['fontFamily', 'fontSize', 'fontWeight', 'textAlign', 'backgroundColor', 'padding', 'borderRadius', 'border', 'boxShadow'].map(key => [key, css[key]]));
            }
            const reference = document.querySelector('#viz-type-dropdown-menu [data-viz="waveform"]');
            const referenceButton = document.getElementById('viz-type-dropdown-btn');
            const styleChecks = [], widths = [];
            for (const id of ['viz-circle-mode', 'viz-orbit-mode', 'viz-bars-position', 'viz-ribbon-position', 'viz-color-mode']) {
                selectVizType(id === 'viz-bars-position' ? 'bars' : id === 'viz-ribbon-position' ? 'ribbon' : id === 'viz-orbit-mode' ? 'orbits' : 'circle');
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
            return { variants, geometry, legacyBars, retainedBars, retainedCircle, accent, custom, gradient, expanded, keyboardChoice, escaped, fireworksColor, newVariants, standardDropdowns, styleChecks, widths, referenceOption:appearance(reference), referenceButton:appearance(referenceButton), referenceMenu:appearance(document.getElementById('viz-type-dropdown-menu')), pickerReference, pickerChecks, types: document.querySelectorAll('#viz-type-dropdown-menu [data-viz]').length };
        })()`);
        assert.deepEqual(result.variants, {
            orbitDots:true, orbitDashes:true, orbitSpacing:true,
            orbits:{ label:'Орбиты', circles:true, pattern:false, bars:false },
            ribbonDefault:'ribbon-center', ribbonTop:'ribbon-top',
            ribbonRestored:{ style:'ribbon-top', offset:35, mirror:true, visible:true, bars:false },
            ribbonAnimationHidden:true, ribbonAnimationVisible:true,
        });
        assert.deepEqual(result.geometry.defaultGeometry, { vizCircleRotation:0, vizBarsOffset:0, vizCircleMirror:false, vizBarsReflect:false, vizBarsMirror:false, vizRibbonOffset:0, vizRibbonMirror:false, vizRibbonScrollGrad:false, vizOrbitSpacing:30 });
        assert.ok(result.geometry.resetSettings.every(Boolean), 'right click restores persisted slider defaults and suppresses the context menu without affecting middle click');
        assert.deepEqual(result.geometry.storedGeometry, { rotation:'135', offset:'-60', mirror:'1', reflect:'1' });
        for (const key of ['legacyGeometry', 'restoredGeometry', 'clampedGeometry', 'invalidGeometry', 'legacyRotation', 'centeredRotation']) assert.equal(result.geometry[key], true, key);
        assert.deepEqual(result.legacyBars, { label: 'Полосы', position: 'По центру', style: 'bars-center' });
        assert.equal(result.retainedBars, 'bars-center'); assert.equal(result.retainedCircle, 'circle-lines');
        assert.deepEqual(result.accent, { gradient:false, custom:false, animation:false });
        assert.deepEqual(result.custom, { visible:true, color:'#123456' });
        assert.equal(result.gradient, true); assert.equal(result.expanded, 'true');
        assert.equal(result.keyboardChoice, 'accent'); assert.equal(result.escaped, true);
        assert.equal(result.fireworksColor, false); assert.equal(result.types, 6);
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
        for (const width of [640, 1000]) {
            win.setSize(width, 850);
            for (const theme of ['light', 'dark']) {
                const checks = await win.webContents.executeJavaScript(`(() => {
                    document.body.setAttribute('data-theme', '${theme}');
                    selectVizType('circle');
                    const circle = document.getElementById('setting-viz-circle-rotation').getBoundingClientRect();
                    selectVizType('bars-center');
                    const reflected = document.getElementById('setting-viz-bars-reflect');
                    const fixed = reflected.disabled && reflected.checked;
                    selectVizType('bars-bottom');
                    const enabled = !reflected.disabled;
                    const bars = document.getElementById('setting-viz-bars-offset').getBoundingClientRect();
                    return { fixed, enabled, widths:[circle.width, bars.width], rightEdges:[circle.right, bars.right], viewport:innerWidth };
                })()`);
                assert.ok(checks.fixed && checks.enabled, 'center reflection is fixed; edge layouts remain configurable');
                assert.ok(checks.widths.every(value => value > 0));
                assert.ok(checks.rightEdges.every(value => value <= checks.viewport), 'geometry sliders fit both themes and window sizes');
            }
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
        assert.equal(layout.groups, 38);
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
        // Exercise the actual canvas renderer in Chromium, with deterministic audio data.
        const visualizer = fs.readFileSync(path.join(__dirname, '../src/renderer/effects/visualizer.js'), 'utf8');
        const drawSource = visualizer.slice(visualizer.indexOf('            ctx.clearRect(0, 0, canvas.clientWidth'), visualizer.indexOf("            } else if (style === 'fireworks')")) + '\n}\n';
        win.setSize(1000, 760);
        await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<html><body style="margin:0;display:grid;grid-template-columns:1fr 1fr;font:16px sans-serif;">${['Орбиты · тёмная тема', 'Лента · тёмная тема', 'Орбиты · светлая тема', 'Лента · светлая тема'].map((label, i) => `<div style="background:${i < 2 ? '#101018' : '#f4f4f8'};color:${i < 2 ? '#eee' : '#222'};padding:12px;">${label}<canvas width="460" height="300" style="width:460px;height:300px;display:block;"></canvas></div>`).join('')}</body></html>`));
        const pixels = await win.webContents.executeJavaScript(`(() => {
            const result = [];
            let index = 0;
            for (const canvas of document.querySelectorAll('canvas')) {
                const ctx = canvas.getContext('2d');
                const bufferLength = 256;
                const dataArray = Uint8Array.from({length:bufferLength}, (_, i) => Math.round(70 + 150 * Math.pow(Math.sin(i * 0.12), 2)));
                const analyzer = { context:{sampleRate:44100} };
                window.vizStyle = index % 2 ? 'ribbon-center' : 'orbits';
                window.vizColorMode = 'gradient';
                window.vizCircleSize = 1;
                window.vizCircleRotation = 35;
                window.vizCircleMirror = true;
                window.vizRibbonOffset = 0;
                window.vizRibbonMirror = true;
                window.vizRibbonScrollGrad = false;
                window.vizShowInner = true;
                window._orbitFall = undefined;
                for (let frame = 0; frame < 20; frame++) { (function() { ${drawSource} })(); }
                if (window.vizStyle === 'orbits') {
                    const filledAlpha = ctx.getImageData(canvas.width / 2,canvas.height / 2,1,1).data[3];
                    window.vizShowInner = false;
                    (function() { ${drawSource} })();
                    const emptyAlpha = ctx.getImageData(canvas.width / 2,canvas.height / 2,1,1).data[3];
                    if (filledAlpha - emptyAlpha < 80) throw new Error('Orbit filling must be visibly different from the unfilled view');
                    for (const mode of ['dots', 'dashes']) {
                        window.vizOrbitMode = mode;
                        (function() { ${drawSource} })();
                        const rgbaMode = ctx.getImageData(0,0,canvas.width,canvas.height).data;
                        let count = 0;
                        for (let i = 3; i < rgbaMode.length; i += 4) if (rgbaMode[i] > 0) count++;
                        if (count < 1000) throw new Error('Orbit pattern failed to render: ' + mode);
                    }
                    window.vizOrbitMode = 'lines';
                    window.vizShowInner = true;
                    (function() { ${drawSource} })();
                }
                const rgba = ctx.getImageData(0,0,canvas.width,canvas.height).data;
                let painted = 0;
                for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > 0) painted++;
                result.push(painted);
                index++;
            }
            return result;
        })()`);
        assert.ok(pixels.every(count => count > 1000), 'both new modes paint visible finite geometry on a real canvas');
        if (process.argv.includes('--preview')) fs.writeFileSync('/tmp/noctune-visualizers-preview.png', (await win.webContents.capturePage()).toPNG());
        console.log('PASS: real Chromium dropdowns, legacy presets, remembered family options, color visibility, custom colors and keyboard selection.');
    } catch (error) { console.error(error); process.exitCode = 1; }
    finally { win.destroy(); app.exit(process.exitCode || 0); }
});
