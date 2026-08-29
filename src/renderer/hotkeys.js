        function migrateLegacyCombo(combo) {
            if (!combo) return combo;
            const parts = combo.split('+');
            const last = parts[parts.length - 1];
            if (/^[a-z]$/i.test(last)) parts[parts.length - 1] = 'Key' + last.toUpperCase();
            else if (/^[0-9]$/.test(last)) parts[parts.length - 1] = 'Digit' + last;
            return parts.join('+');
        }

        function loadHotkeyBindings() {
            try {
                const saved = JSON.parse(localStorage.getItem('setting_hotkeys') || 'null');
                const merged = Object.assign({}, DEFAULT_HOTKEYS, saved || {});
                Object.keys(merged).forEach(k => { merged[k] = migrateLegacyCombo(merged[k]); });
                window.hotkeyBindings = merged;
                localStorage.setItem('setting_hotkeys', JSON.stringify(merged));
            } catch (e) {
                window.hotkeyBindings = Object.assign({}, DEFAULT_HOTKEYS);
            }
        }
        loadHotkeyBindings();

        // e.code — это физическое положение клавиши на клавиатуре (KeyK, ArrowUp...),
        // оно не меняется от текущей раскладки/языка ввода, в отличие от e.key,
        // который отдаёт символ, который раскладка сопоставила этой клавише.
        function normalizeKeyCombo(e) {
            const parts = [];
            if (e.ctrlKey) parts.push('ctrl');
            if (e.altKey) parts.push('alt');
            if (e.shiftKey) parts.push('shift');
            if (e.metaKey) parts.push('meta');
            parts.push(e.code);
            return parts.join('+');
        }

        function isHotkeyBlockedTarget(el) {
            if (!el) return false;
            const tag = el.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
            if (el.isContentEditable) return true;
            return false;
        }

        // Перемотка на delta секунд (отрицательное — назад). Полностью повторяет
        // логику клика по полосе прогресса, чтобы поведение совпадало 1:1.
        function seekRelative(delta) {
            if (isRadioMode) return;
            const duration = currentTrackDuration || (localAudioElement ? localAudioElement.duration : 0);
            if (!duration || !isFinite(duration)) return;
            const current = isPlaying && localAudioElement ? localAudioElement.currentTime : pausedAt;
            const targetTime = Math.max(0, Math.min(duration, current + delta));
            if (isPlaying) {
                startSourceAt(targetTime, false);
            } else {
                pausedAt = targetTime;
                if (localAudioElement) localAudioElement.currentTime = targetTime;
                const percentage = duration > 0 ? (targetTime / duration) * 100 : 0;
                progressFill.style.width = `${percentage}%`;
                const miniProgressFill = document.getElementById('mini-progress-fill');
                if (miniProgressFill) miniProgressFill.style.width = `${percentage}%`;
                timeCurrent.textContent = formatTime(targetTime);
            }
        }

        function adjustVolume(delta) {
            const current = parseFloat(volumeSlider.value) || 0;
            const next = Math.max(0, Math.min(1, Math.round((current + delta) * 100) / 100));
            updateVolume(next);
        }

        const HOTKEY_ACTIONS = {
            togglePlay:  () => togglePlayback(),
            seekBack10:  () => seekRelative(-10),
            seekFwd10:   () => seekRelative(10),
            mute:        () => toggleMute(),
            prevTrack:   () => playPrev(),
            nextTrack:   () => playNext(),
            volumeUp:    () => adjustVolume(0.05),
            volumeDown:  () => adjustVolume(-0.05),
            seekBack5:   () => seekRelative(-5),
            seekFwd5:    () => seekRelative(5),
        };

        document.addEventListener('keydown', (e) => {
            if (window._hotkeyCaptureActive) return; // идёт запись нового бинда в настройках
            if (isHotkeyBlockedTarget(e.target)) return;
            const combo = normalizeKeyCombo(e);
            const actionId = Object.keys(window.hotkeyBindings).find(k => window.hotkeyBindings[k] === combo);
            if (!actionId) return;
            const handler = HOTKEY_ACTIONS[actionId];
            if (!handler) return;
            e.preventDefault();
            handler();
        });

