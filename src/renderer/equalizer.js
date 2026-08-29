        function loadUserPresets() {
            const saved = localStorage.getItem('player_custom_presets');
            if (saved) {
                try {
                    const parsed = JSON.parse(saved);
                    Object.keys(parsed).forEach(key => {
                        if (parsed[key].length === 12) {
                            parsed[key].unshift(0);
                        }
                    });
                    Object.assign(presets, parsed);
                } catch(e) { console.error("Ошибка загрузки пресетов", e); }
            }
        }
        loadUserPresets();

        function generateSliders() {
            slidersWrapper.innerHTML = '';
            
            const preampBox = document.createElement('div');
            preampBox.className = 'slider-box';
            preampBox.innerHTML = `
                <span class="slider-label" id="v-preamp">0dB</span>
                <input type="range" class="eq-slider" data-index="preamp" min="-12" max="12" step="1" value="0">
                <span class="slider-label">Preamp</span>
            `;
            slidersWrapper.appendChild(preampBox);

            const separator = document.createElement('div');
            separator.className = 'eq-separator';
            slidersWrapper.appendChild(separator);

            frequencies.forEach((freq, idx) => {
                const labelStr = freq >= 1000 ? `${freq/1000}kHz` : `${freq}Hz`;
                const box = document.createElement('div');
                box.className = 'slider-box';
                box.innerHTML = `
                    <span class="slider-label" id="v-${idx}">0dB</span>
                    <input type="range" class="eq-slider" data-index="${idx}" min="-12" max="12" step="1" value="0">
                    <span class="slider-label">${labelStr}</span>
                `;
                slidersWrapper.appendChild(box);
            });
        }
        generateSliders();

        const SYSTEM_PRESETS = ['Обычный', 'Супер Бас', 'Поп', 'Рок', 'Акустика'];
        let _presetsPage = 0;

        function renderPresetButtons() {
            presetsContainer.innerHTML = '';

            // Sort: system presets first (in defined order), then user presets alphabetically
            const systemNames = SYSTEM_PRESETS.filter(n => presets[n] !== undefined);
            const userNames = Object.keys(presets)
                .filter(n => !SYSTEM_PRESETS.includes(n))
                .sort((a, b) => a.localeCompare(b));
            const allNames = [...systemNames, ...userNames];

            const savedState = JSON.parse(localStorage.getItem('player_eq_state'));
            allNames.forEach(name => {
                const btn = document.createElement('button');
                btn.className = 'preset-btn';
                if (savedState && savedState.selectedPreset === name) btn.classList.add('active');

                const isSystem = SYSTEM_PRESETS.includes(name);
                btn.innerHTML = `<span>${name}</span>${!isSystem ? '<i data-lucide="x"></i>' : ''}`;

                btn.addEventListener('click', (e) => {
                    if (e.target.closest('[data-lucide="x"]')) {
                        deletePreset(name);
                    } else {
                        applyPreset(name);
                        const state = { enabled: eqToggle.checked, selectedPreset: name };
                        localStorage.setItem('player_eq_state', JSON.stringify(state));
                        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                    }
                });
                presetsContainer.appendChild(btn);
            });

            lucide.createIcons();
            _presetsPage = 0;
            // Даём браузеру отрисовать кнопки перед замером offsetWidth
            requestAnimationFrame(() => _updatePresetsCarousel());
        }
        renderPresetButtons();

        function _updatePresetsCarousel() {
            const viewport = document.getElementById('presets-viewport');
            const navPrev  = document.getElementById('presets-nav-prev');
            const navNext  = document.getElementById('presets-nav-next');
            const dotsEl   = document.getElementById('presets-page-dots');
            if (!viewport || !navPrev || !navNext || !dotsEl) return;

            const vw = viewport.offsetWidth;
            if (!vw) { requestAnimationFrame(() => _updatePresetsCarousel()); return; }

            const btns = Array.from(presetsContainer.querySelectorAll('.preset-btn'));
            dotsEl.innerHTML = '';

            if (btns.length === 0) {
                navPrev.style.display = 'none';
                navNext.style.display = 'none';
                presetsContainer.style.cssText = '';
                return;
            }

            // ── Раскладываем кнопки по страницам (макс 2 строки на страницу) ──
            // Каждая страница — отдельный div.eq-preset-page с flex-wrap и
            // фиксированной шириной = vw. Viewport показывает один такой блок.
            // Убираем старые страницы, возвращаем кнопки в контейнер
            const oldPages = presetsContainer.querySelectorAll('.eq-preset-page');
            oldPages.forEach(pg => {
                Array.from(pg.children).forEach(c => presetsContainer.appendChild(c));
                pg.remove();
            });

            // Снова собираем страницы
            const allBtns = Array.from(presetsContainer.querySelectorAll('.preset-btn'));
            const ROW_H = 28, GAP = 6, ROWS = 2;
            const pageH = ROW_H * ROWS + GAP * (ROWS - 1); // 62px

            const pageGroups = [[]]; // массив массивов кнопок
            let rowIdx = 0, rowW = 0;

            allBtns.forEach(btn => {
                const bw = btn.offsetWidth || 80;
                const needed = rowW === 0 ? bw : rowW + GAP + bw;
                if (needed > vw + 1 && rowW > 0) {
                    rowIdx++;
                    rowW = bw;
                    if (rowIdx >= ROWS) {
                        // Новая страница
                        pageGroups.push([]);
                        rowIdx = 0;
                        rowW = bw;
                    }
                } else {
                    rowW = needed;
                }
                pageGroups[pageGroups.length - 1].push(btn);
            });

            const totalPages = pageGroups.length;
            _presetsPage = Math.min(_presetsPage, totalPages - 1);

            // Оборачиваем каждую группу в .eq-preset-page
            presetsContainer.innerHTML = '';
            presetsContainer.style.cssText =
                `display:flex; flex-direction:row; gap:0; width:${totalPages * vw}px;` +
                `transition:transform 0.28s cubic-bezier(.4,0,.2,1); will-change:transform;`;

            pageGroups.forEach(group => {
                const pg = document.createElement('div');
                pg.className = 'eq-preset-page';
                pg.style.cssText =
                    `display:flex; flex-wrap:wrap; align-content:flex-start;` +
                    `gap:${GAP}px; width:${vw}px; height:${pageH}px;` +
                    `flex-shrink:0; overflow:hidden; box-sizing:border-box;`;
                group.forEach(btn => pg.appendChild(btn));
                presetsContainer.appendChild(pg);
            });

            // Сдвигаем на текущую страницу
            presetsContainer.style.transform = `translateX(-${_presetsPage * vw}px)`;

            // Nav
            const showNav = totalPages > 1;
            navPrev.style.display = showNav ? '' : 'none';
            navNext.style.display = showNav ? '' : 'none';
            navPrev.disabled = _presetsPage === 0;
            navNext.disabled = _presetsPage >= totalPages - 1;

            // Dots
            if (totalPages > 1) {
                for (let i = 0; i < totalPages; i++) {
                    const dot = document.createElement('div');
                    dot.className = 'eq-presets-page-dot' + (i === _presetsPage ? ' active' : '');
                    dot.addEventListener('click', () => { _presetsPage = i; _updatePresetsCarousel(); });
                    dotsEl.appendChild(dot);
                }
            }
        }

        document.getElementById('presets-nav-prev').addEventListener('click', () => {
            if (_presetsPage > 0) { _presetsPage--; _updatePresetsCarousel(); }
        });
        document.getElementById('presets-nav-next').addEventListener('click', () => {
            _presetsPage++; _updatePresetsCarousel();
        });

        function deletePreset(name) {
            delete presets[name];
            const saved = localStorage.getItem('player_custom_presets');
            if (saved) {
                let toSave = JSON.parse(saved);
                if (toSave[name]) {
                    delete toSave[name];
                    localStorage.setItem('player_custom_presets', JSON.stringify(toSave));
                }
            }
            renderPresetButtons();
            const activeBtn = document.querySelector('.preset-btn.active');
            if (!activeBtn || activeBtn.textContent.trim() === name) {
                applyPreset("Обычный");
            }
        }

        function saveEqState() {
            const state = { enabled: eqToggle.checked, selectedPreset: currentSelectedPresetName };
            localStorage.setItem('player_eq_state', JSON.stringify(state));
        }

        themeToggle.addEventListener('click', () => {
            const isDark = document.body.getAttribute('data-theme') === 'dark';
            const newTheme = isDark ? 'light' : 'dark';
            document.body.setAttribute('data-theme', newTheme);
            localStorage.setItem('player_theme', newTheme);
            themeToggle.innerHTML = isDark ? '<i data-lucide="moon"></i>' : '<i data-lucide="sun"></i>';
            lucide.createIcons();
        });

        openEqBtn.addEventListener('click', () => eqModal.style.display = 'flex');
        closeEqBtn.addEventListener('click', () => eqModal.style.display = 'none');


        document.querySelector('.mini-volume-zone button').addEventListener('click', toggleMute);

        async function parseAudioTags(file, fileName = "") {
            let title = "";
            let artist = "";
            let album = "";
            let coverDataUrl = null;
            
            let targetName = fileName || (file ? (file.name || file.path || "") : "");

            if (targetName.includes('\\') || targetName.includes('/')) {
                targetName = targetName.split(/[/\\]/).pop();
            }

            try {
                const arrayBuffer = await file.arrayBuffer();
                const fullBuffer = new Uint8Array(arrayBuffer);
                const startBuffer = fullBuffer.subarray(0, 4096);

                if (startBuffer[0] === 0x49 && startBuffer[1] === 0x44 && startBuffer[2] === 0x33) {
                    let offset = 10;
                    const decoder = new TextDecoder("utf-8");
                    const winDecoder = new TextDecoder("windows-1251");

                    while (offset < startBuffer.length - 10) {
                        let frameID = String.fromCharCode(startBuffer[offset], startBuffer[offset+1], startBuffer[offset+2], startBuffer[offset+3]);
                        if (!/^[A-Z0-9]{4}$/.test(frameID)) break;
                        
                        let frameSize = (startBuffer[offset+4] << 24) | (startBuffer[offset+5] << 16) | (startBuffer[offset+6] << 8) | startBuffer[offset+7];
                        if (frameSize <= 0 || offset + 10 + frameSize > startBuffer.length) break;
                        
                        let frameData = startBuffer.slice(offset + 10, offset + 10 + frameSize);
                        if (frameID === "APIC" && !coverDataUrl) {
                            // Picture frame: encoding(1) + mime(null-terminated) + pictureType(1) + description(null-terminated) + data
                            try {
                                let fi = 1; // skip encoding byte
                                while (fi < frameData.length && frameData[fi] !== 0) fi++;
                                const mimeType = decoder.decode(frameData.slice(1, fi)) || 'image/jpeg';
                                fi++; // skip null
                                fi++; // skip picture type byte
                                while (fi < frameData.length && frameData[fi] !== 0) fi++;
                                fi++; // skip null after description
                                const imgBytes = frameData.slice(fi);
                                if (imgBytes.length > 0) {
                                    const blob = new Blob([imgBytes], { type: mimeType });
                                    coverDataUrl = URL.createObjectURL(blob);
                                }
                            } catch(e) {}
                        } else if (frameData.length > 1) {
                            let encoding = frameData[0];
                            let textBlob = frameData.slice(1);
                            let decodedText = "";
                            try {
                                if (encoding === 1 || encoding === 2) {
                                    decodedText = new TextDecoder("utf-16").decode(textBlob);
                                } else if (encoding === 3) {
                                    decodedText = decoder.decode(textBlob);
                                } else {
                                    decodedText = winDecoder.decode(textBlob);
                                }
                                decodedText = decodedText.replace(/\0/g, '').trim();
                            } catch(e) {}

                            if (decodedText) {
                                if (frameID === "TIT2") title = decodedText;
                                if (frameID === "TPE1") artist = decodedText;
                                if (frameID === "TALB") album = decodedText;
                            }
                        }
                        offset += 10 + frameSize;
                    }
                }
            } catch (e) {
                console.error("Ошибка при чтении ID3-тегов:", e);
            }

            if ((!title || !artist) && targetName) {
                let cleanName = targetName.replace(/\.[^/.]+$/, "");
                
                let separator = null;
                if (cleanName.includes(" - ")) separator = " - ";
                else if (cleanName.includes(" — ")) separator = " — ";
                else if (cleanName.includes(" – ")) separator = " – ";

                if (separator) {
                    let parts = cleanName.split(separator);
                    let fallbackArtist = parts[0].trim();
                    let fallbackTitle = parts.slice(1).join(separator).trim(); 

                    if (!artist && fallbackArtist) artist = fallbackArtist;
                    if (!title && fallbackTitle) title = fallbackTitle;
                } else {
                    if (!title) title = cleanName.trim();
                }
            }

            if (!title) title = "Без названия";
            if (!artist) artist = "Неизвестный исполнитель";

            return { title, artist, album, coverDataUrl };
        }

        function isAudioFile(filename) {
            const ext = filename.split('.').pop().toLowerCase();
            return ['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext);
        }

