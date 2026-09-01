        function toggleShuffle() {
            isShuffle = !isShuffle;
            if (isShuffle) buildShuffleList();
            else { shuffleList = []; currentShufflePos = -1; }
            btnShuffle.classList.toggle('active', isShuffle);
            miniBtnShuffle.classList.toggle('active', isShuffle);
            appStorage.setItem('player_shuffle', isShuffle ? '1' : '0');
        }

        function updateRepeatUI() {
            const icons   = ['repeat-off', 'repeat-1', 'repeat'];
            const titles  = ['Повтор выключен', 'Повторять этот трек', 'Повторять плейлист'];
            const active  = repeatMode > 0;
            const iconName = icons[repeatMode];

            [btnRepeat, miniBtnRepeat].forEach(btn => {
                btn.innerHTML = `<i data-lucide="${iconName}"></i>`;
                btn.classList.toggle('active', active);
                btn.title = titles[repeatMode];
            });
            lucide.createIcons();
        }

        function toggleRepeat() {
            repeatMode = (repeatMode + 1) % 3;
            updateRepeatUI();
            appStorage.setItem('player_repeat', String(repeatMode));
        }

        // ========================
        // VIRTUAL SHUFFLE PLAYLIST
        // ========================

        /** Создаёт виртуальный перемешанный плейлист (алгоритм Фишера-Йейтса).
         *  Если currentIndex >= 0, текущий трек ставится на позицию 0 (уже «сыгран»),
         *  остальные треки идут в случайном порядке — курсор встаёт на 0. */
        function buildShuffleList() {
            const len = playlistOrder.length;
            shuffleList = Array.from({ length: len }, (_, i) => i); // orderIndex-ы
            // Фишер-Йейтс
            for (let i = len - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffleList[i], shuffleList[j]] = [shuffleList[j], shuffleList[i]];
            }
            // Ставим текущий трек первым, чтобы курсор 0 = «мы здесь»
            if (currentIndex >= 0) {
                const pos = shuffleList.indexOf(currentIndex);
                if (pos > 0) {
                    shuffleList.splice(pos, 1);
                    shuffleList.unshift(currentIndex);
                }
                currentShufflePos = 0;
            } else {
                currentShufflePos = -1;
            }
        }

        /** Обновляет currentShufflePos при переходе к треку с orderIndex = orderIdx в shuffle-режиме.
         *  Если трек не найден в shuffleList — перестраиваем список. */
        function syncShufflePos(orderIdx) {
            const pos = shuffleList.indexOf(orderIdx);
            if (pos !== -1) {
                currentShufflePos = pos;
            } else {
                buildShuffleList();
            }
        }

        /** Возвращает следующий orderIndex с учётом isShuffle и repeatMode.
         *  @param {boolean} [forward=true]
         *  @returns {number} orderIndex или -1 если нет следующего трека */
        function getNextTrackIndex(forward = true) {
            if (playlistOrder.length === 0) return -1;
            if (repeatMode === 1) return currentIndex;

            if (isShuffle) {
                if (shuffleList.length === 0) buildShuffleList();
                const pos = forward ? currentShufflePos + 1 : currentShufflePos - 1;
                if (pos >= 0 && pos < shuffleList.length) return shuffleList[pos];
                // Вышли за границы
                if (repeatMode === 2) {
                    // При повторе плейлиста оборачиваем
                    const wrappedPos = ((pos % shuffleList.length) + shuffleList.length) % shuffleList.length;
                    return shuffleList[wrappedPos];
                }
                return -1;
            }

            // Линейный режим
            const next = forward ? currentIndex + 1 : currentIndex - 1;
            if (next >= 0 && next < playlistOrder.length) return next;
            if (repeatMode === 2) return forward ? 0 : playlistOrder.length - 1;
            return -1;
        }

        function toggleMute() {
            isMuted = !isMuted;
            if (isMuted) {
                savedVolumeMute = parseFloat(volumeSlider.value);
                if (window.volumeNode) {
                    window.volumeNode.gain.cancelScheduledValues(audioCtx.currentTime);
                    window.volumeNode.gain.setValueAtTime(0, audioCtx.currentTime);
                }
                // radioAudioElement.volume НЕ трогаем — звук радио идёт через тот же
                // window.volumeNode, что и локальные треки; элемент остаётся на 1 (unity),
                // иначе громкость уйдёт в ноль вдвойне (см. updateVolume ниже).
                updateVolumeIcons(0);
                volumeSlider.value = 0;
                miniVolumeSlider.value = 0;
            } else {
                const volToRestore = savedVolumeMute > 0 ? savedVolumeMute : 0.8;
                updateVolume(volToRestore);
            }
        }

        btnShuffle.addEventListener('click', toggleShuffle);
        miniBtnShuffle.addEventListener('click', toggleShuffle);
        btnRepeat.addEventListener('click', toggleRepeat);
        miniBtnRepeat.addEventListener('click', toggleRepeat);

