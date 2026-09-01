        document.querySelectorAll('.radio-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.radio-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.radio-tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById(tab.dataset.target).classList.add('active');
            });
        });

        const tagsContainer = document.getElementById('tags-container');
        const tagInput = document.getElementById('search-radio-tags');
        let searchTags = [];

        function renderTags() {
            document.querySelectorAll('.tag-pill').forEach(el => el.remove());
            searchTags.forEach(tag => {
                const pill = document.createElement('div');
                pill.className = 'tag-pill';
                pill.innerHTML = `${tag} <span data-tag="${tag}"><i data-lucide="x" style="width: 12px; height: 12px;"></i></span>`;
                tagsContainer.insertBefore(pill, tagInput);
            });
            lucide.createIcons();
        }

        tagInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
                e.preventDefault(); 
                
                const val = tagInput.value.trim().toLowerCase();
                if (val && !searchTags.includes(val)) {
                    searchTags.push(val);
                    renderTags();
                }
                tagInput.value = ''; 
            } else if (e.key === 'Backspace' && tagInput.value === '' && searchTags.length > 0) {
                searchTags.pop();
                renderTags();
            }
        });

        tagsContainer.addEventListener('click', (e) => {
            const closeBtn = e.target.closest('span[data-tag]');
            if (closeBtn) {
                searchTags = searchTags.filter(t => t !== closeBtn.dataset.tag);
                renderTags();
            }
        });

        document.getElementById('btn-search-radio-api').addEventListener('click', async () => {
            const btn = document.getElementById('btn-search-radio-api');
            const resultsContainer = document.getElementById('radio-search-results');
            
            const name = document.getElementById('search-radio-name').value.trim();
            const country = document.getElementById('search-radio-country').value.trim();
            
            let queryParts = ['limit=20', 'hidebroken=true', 'order=clickcount', 'reverse=true'];
            if (name) queryParts.push(`name=${encodeURIComponent(name)}`);
            if (country) queryParts.push(`country=${encodeURIComponent(country)}`);
            if (searchTags.length > 0) queryParts.push(`tagList=${encodeURIComponent(searchTags.join(','))}`);
            
            btn.innerHTML = `<i data-lucide="loader" class="lucide-spin"></i> Поиск...`;
            btn.disabled = true;
            lucide.createIcons();
            
            try {
                const res = await fetch(`https://all.api.radio-browser.info/json/stations/search?${queryParts.join('&')}&limit=100`);
                const data = await res.json();
                
                resultsContainer.innerHTML = '';
                if (data.length === 0) {
                    resultsContainer.innerHTML = '<div style="padding: 10px; text-align: center; color: var(--text-muted);">Ничего не найдено</div>';
                } else {
                    data.forEach(station => {
                        const item = document.createElement('div');
                        item.className = 'radio-result-item';
                        // Check if already added
                        const pl = userPlaylists.find(p => p.id === currentPlaylistId);
                        const alreadyAdded = pl && pl.type === 'radio' && pl.stations.some(s => s.url === station.url_resolved);
                        item.innerHTML = `
                            <div style="overflow: hidden;">
                                <div style="font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${station.name}</div>
                                <div style="font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                    ${station.country} ${station.tags ? '• ' + station.tags.split(',').slice(0, 3).join(', ') : ''}
                                </div>
                            </div>
                            <button class="btn btn-icon-only${alreadyAdded ? ' btn-added' : ''}" style="width: 32px; height: 32px;" title="${alreadyAdded ? 'Уже добавлено' : 'Добавить станцию'}">
                                <i data-lucide="${alreadyAdded ? 'check' : 'plus'}" style="width: 14px; height: 14px;"></i>
                            </button>
                        `;
                        
                        item.querySelector('button').addEventListener('click', (e) => {
                            const btn = e.currentTarget;
                            if (btn.classList.contains('btn-added')) return;
                            const plCur = userPlaylists.find(p => p.id === currentPlaylistId);
                            if (plCur && plCur.type === 'radio') {
                                plCur.stations.push({ name: station.name, url: station.url_resolved });
                                savePlaylistsToStorage();
                                loadRadioStations(plCur);
                            }
                            // Mark button as added without closing modal
                            btn.classList.add('btn-added');
                            btn.title = 'Уже добавлено';
                            btn.innerHTML = '<i data-lucide="check" style="width: 14px; height: 14px;"></i>';
                            lucide.createIcons();
                        });
                        
                        resultsContainer.appendChild(item);
                    });
                }
                resultsContainer.style.display = 'block';
            } catch (err) {
                resultsContainer.innerHTML = '<div style="padding: 10px; text-align: center; color: #e74c3c;">Ошибка при поиске</div>';
                resultsContainer.style.display = 'block';
            } finally {
                btn.innerHTML = `<i data-lucide="search"></i> Найти станции`;
                btn.disabled = false;
                lucide.createIcons();
            }
        });

        btnPrev.addEventListener('click', playPrev);
        miniBtnPrev.addEventListener('click', playPrev);
        btnNext.addEventListener('click', playNext);
        miniBtnNext.addEventListener('click', playNext);

        let _volThrottleTimer = null;
        function updateVolumeThrottled(val) {
            // Apply gain immediately (no freeze), throttle only icon re-render
            const volumeValue = parseFloat(val);
            if (volumeValue > 0) isMuted = false;
            volumeSlider.value = volumeValue;
            miniVolumeSlider.value = volumeValue;
            appStorage.setItem('player_volume', volumeValue);
            const gainValue = isMuted ? 0 : volumeSliderToGain(volumeValue);
            if (window.volumeNode) {
                window.volumeNode.gain.cancelScheduledValues(audioCtx.currentTime);
                window.volumeNode.gain.setValueAtTime(gainValue, audioCtx.currentTime);
            }
            // radioAudioElement.volume не трогаем (см. playTrack) — иначе громкость
            // радио ослабляется дважды и на низких значениях слайдера звук
            // получается заметно тише, чем у локальных треков.
            // Icon re-render throttled to 60ms
            if (_volThrottleTimer) return;
            _volThrottleTimer = setTimeout(() => {
                _volThrottleTimer = null;
                updateVolumeIcons(isMuted ? 0 : parseFloat(volumeSlider.value));
            }, 60);
        }

        volumeSlider.addEventListener('input', (e) => updateVolumeThrottled(e.target.value));
        miniVolumeSlider.addEventListener('input', (e) => updateVolumeThrottled(e.target.value));

        // Колёсико мыши над слайдером громкости — шаг 1% за прокрут
        function handleVolumeWheel(e) {
            e.preventDefault();
            adjustVolume(e.deltaY < 0 ? 0.01 : -0.01);
        }
        volumeSlider.addEventListener('wheel', handleVolumeWheel, { passive: false });
        miniVolumeSlider.addEventListener('wheel', handleVolumeWheel, { passive: false });

        progressWrapper.addEventListener('click', (e) => {
            if (isRadioMode) return;
            const duration = currentTrackDuration || (localAudioElement ? localAudioElement.duration : 0);
            if (!duration || !isFinite(duration)) return;
            const rect = progressWrapper.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const percentage = clickX / rect.width;
            const targetTime = percentage * duration;
            
            if (isPlaying) { startSourceAt(targetTime, false); } 
            else {
                pausedAt = targetTime;
                if (localAudioElement) localAudioElement.currentTime = targetTime;
                progressFill.style.width = `${percentage * 100}%`;
                timeCurrent.textContent = formatTime(targetTime);
            }
        });

        // Мягкий «гейт» по громкости: ниже порога эффект полностью выключен (0),
        // выше — линейно растягивается обратно до полного размаха в точке 1,
        // без скачка в момент пересечения порога.
