const assert = require('node:assert/strict');
const { validatePackage, packDirectory } = require('../../src/main/scene-themes');
const path = require('node:path');
(async () => {
    const v1 = await packDirectory(path.resolve(__dirname, '../../themes/builtin/02-night-hill'));
    const demo=await packDirectory(path.resolve(__dirname,'../../themes/examples/api-v2'));
    assert.equal(demo.apiVersion,2);assert.equal(demo.manifest.runtimeRequirements.dom,false);assert.equal(Object.keys(demo.assets).length,3);
    const v2 = structuredClone(v1); v2.apiVersion = v2.manifest.apiVersion = 2;
    Object.assign(v2.manifest, {
        runtimeRequirements: { dom: false }, quality: 'high',
        parameterSchema: {
            waves: { type: 'slider', label: { ru: 'Волны', en: 'Waves' }, min: 0, max: 2, step: .1, default: 1 },
            crown: { type: 'toggle', label: 'Корона', default: true },
            reflection: { type: 'select', label: 'Отражение', default: 'water', options: [{ value: 'water', label: 'Вода' }, { value: 'none', label: 'Нет' }] },
        },
    });
    v2.manifest.capabilities.visualizers = ['bars', 'line', 'radial'];
    const result = validatePackage(v2);
    assert.equal(result.apiVersion, 2); assert.equal(result.manifest.apiVersion, 2);
    assert.deepEqual(result.manifest.parameterSchema, v2.manifest.parameterSchema);
    assert.equal(validatePackage(v1).apiVersion, 1);
    for (const mutate of [
        p => p.manifest.apiVersion = 1,
        p => p.manifest.runtimeRequirements.dom = 'true',
        p => p.manifest.runtimeRequirements.network = true,
        p => p.manifest.quality = 'auto',
        p => p.manifest.parameterSchema.waves.step = 0,
        p => p.manifest.parameterSchema.waves.default = Infinity,
        p => p.manifest.parameterSchema.waves.min = 5,
        p => p.manifest.parameterSchema.waves.onChange = 'fetch()',
        p => p.manifest.parameterSchema.crown.label = '<script>',
        p => p.manifest.parameterSchema.crown.default = 1,
        p => p.manifest.parameterSchema.reflection.default = 'unknown',
        p => p.manifest.parameterSchema.constructor = { type: 'toggle', label: 'x', default: true },
        p => p.manifest.capabilities.visualizers = ['webgl'],
    ]) { const bad = structuredClone(v2); mutate(bad); assert.throws(() => validatePackage(bad)); }
    assert.throws(() => validatePackage({ ...v2, apiVersion: 99 }), /99/);
    console.log('PASS: API v2 manifest, typed/localized parameters, runtime/quality validation, injection rejection and v1 compatibility.');
})().catch(error => { console.error(error); process.exitCode = 1; });
