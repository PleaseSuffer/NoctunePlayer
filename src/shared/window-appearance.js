(() => {
    function apply(value) {
        const root = document.documentElement;
        root.dataset.theme = value.theme === 'light' ? 'light' : 'dark';
        const accent = /^#[a-f0-9]{6}$/i.test(value.accent) ? value.accent : '#ac91ee';
        root.style.setProperty('--accent', accent);
        const channels = color => color.slice(1).match(/../g).map(value => parseInt(value, 16));
        const luminance = rgb => rgb.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
        const rgb = channels(accent), light = root.dataset.theme === 'light';
        root.style.setProperty('--accent-ink', luminance(rgb) > .179 ? '#171220' : '#ffffff');
        // Keep the chosen fill; adjust only small accent text for readable contrast.
        const background = luminance(channels(light ? '#edf0f3' : '#25232f'));
        const target = channels(light ? '#262732' : '#eeeef5');
        let foreground = rgb;
        for (let step = 0; step <= 20; step++) {
            foreground = rgb.map((value, index) => Math.round(value + (target[index] - value) * step / 20));
            const value = luminance(foreground);
            if ((Math.max(value, background) + .05) / (Math.min(value, background) + .05) >= 4.5) break;
        }
        root.style.setProperty('--accent-fg', '#' + foreground.map(value => value.toString(16).padStart(2, '0')).join(''));
    }
    const query = new URLSearchParams(location.search);
    apply({ theme: query.get('theme'), accent: query.get('accent') });
    globalThis.NoctuneWindowAppearance = { apply };
})();
