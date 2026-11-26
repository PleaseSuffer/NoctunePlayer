// Commit palette changes without spawning a transition on every descendant.
// Only paint/color transitions are suppressed; movement and opacity keep working.
(() => {
    const root = document.documentElement;
    let frame = null;
    window.beginAppearanceUpdate = () => {
        if (!root.classList.contains('appearance-updating')) root.classList.add('appearance-updating');
        if (frame !== null) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
            frame = requestAnimationFrame(() => {
                frame = null;
                root.classList.remove('appearance-updating');
            });
        });
    };
})();
