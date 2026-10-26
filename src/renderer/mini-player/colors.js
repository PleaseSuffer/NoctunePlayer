// Shared with the palette tests; keep the regular theme intact in theme mode.
(function (root) {
    function palette(settings, colors) {
        if (!['custom', 'accent'].includes(settings.colorMode)) return { ...colors };
        const color = (settings.colorMode === 'custom' ? settings.customColor : colors['--accent-color']) || '#4a90e2';
        let rgb;
        if (/^#[\da-f]{3}$/i.test(color)) rgb = [...color.slice(1)].map(c => parseInt(c + c, 16));
        else if (/^#[\da-f]{6}$/i.test(color)) rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
        else {
            const match = color.match(/^rgba?\(\s*(\d+(?:\.\d+)?)(%)?\s*,\s*(\d+(?:\.\d+)?)(%)?\s*,\s*(\d+(?:\.\d+)?)(%)?/i);
            rgb = match ? [1, 3, 5].map(i => Math.round(Math.max(0, Math.min(255, Number(match[i]) * (match[i + 1] ? 2.55 : 1))))) : [74, 144, 226];
        }
        const linear = rgb.map(c => c / 255 <= .04045 ? c / 255 / 12.92 : ((c / 255 + .055) / 1.055) ** 2.4);
        const light = linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722 > .179;
        const ink = light ? '0, 0, 0' : '255, 255, 255';
        const background = `rgb(${rgb.join(', ')})`, foreground = `rgb(${ink})`;
        return { ...colors, '--bg-color': background, '--container-bg': background, '--text-color': foreground,
            '--text-muted': `rgba(${ink}, .72)`, '--accent-color': foreground, '--accent-fg': foreground,
            '--border-color': `rgba(${ink}, .25)`, '--track-hover': `rgba(${ink}, .12)`, '--mini-play-fg': background };
    }
    if (typeof module !== 'undefined') module.exports = palette;
    else root.miniPlayerColors = palette;
})(typeof window === 'undefined' ? globalThis : window);
