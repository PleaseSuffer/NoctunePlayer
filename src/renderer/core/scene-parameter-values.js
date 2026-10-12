// Shared by host validation and settings presentation; no scene sandbox dependencies.
(() => {
    'use strict';
    function decimalPlaces(value) {
        const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e');
        return Math.max(0, (mantissa.split('.')[1] || '').length - Number(exponent));
    }
    function normalizeSlider(value, schema) {
        const candidate = Number.isFinite(value) ? value : schema.default;
        const bounded = Math.max(schema.min, Math.min(schema.max, candidate));
        const steps = (schema.max - schema.min) / schema.step;
        const lastStep = Math.floor(steps + Number.EPSILON * Math.max(1, steps) * 4);
        const index = Math.max(0, Math.min(lastStep, Math.round((bounded - schema.min) / schema.step)));
        const snapped = Math.max(schema.min, Math.min(schema.max, schema.min + index * schema.step));
        // Multiplication by a decimal step introduces IEEE-754 tails (12 * .1).
        // Keep the precision of the grid and endpoints, including nonzero min.
        const precision = Math.max(...[schema.min, schema.max, schema.step].map(decimalPlaces));
        const rounded = Number(precision <= 100 ? snapped.toFixed(precision) : snapped.toPrecision(15));
        return Object.is(rounded, -0) ? 0 : rounded;
    }
    const values = { normalizeSlider, formatSlider: (value, schema) => String(normalizeSlider(value, schema)) };
    if (typeof module !== 'undefined' && module.exports) module.exports = values;
    else window.sceneParameterValues = values;
})();
