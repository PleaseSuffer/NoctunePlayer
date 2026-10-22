(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.AddonSettings = api;
})(globalThis, function () {
    const key = value => /^[a-z][a-zA-Z0-9_-]{0,47}$/.test(value) && !['constructor','prototype'].includes(value);
    function normalize(schema, input = {}) {
        const result = {};
        for (const [name, field] of Object.entries(schema || {})) {
            let value = Object.hasOwn(input, name) ? input[name] : field.default;
            if (field.type === 'toggle') { if (typeof value !== 'boolean') throw new Error('Требуется переключатель: ' + name); }
            else if (['slider','number'].includes(field.type)) {
                if (!Number.isFinite(value) || value < field.min || value > field.max) throw new Error('Число вне диапазона: ' + name);
                value = Number((field.min + Math.round((value - field.min) / field.step) * field.step).toPrecision(12));
                value = Math.max(field.min, Math.min(field.max, value));
            } else if (field.type === 'select') { if (!field.options.some(option => option.value === value)) throw new Error('Неизвестное значение: ' + name); }
            else if (typeof value !== 'string' || value.length > (field.maxLength || 500)) throw new Error('Некорректный текст: ' + name);
            result[name] = value;
        }
        return result;
    }
    function validate(schema) {
        if (!schema || typeof schema !== 'object' || Array.isArray(schema) || Object.keys(schema).length > 32) throw new Error('Некорректная схема настроек');
        for (const [name, field] of Object.entries(schema)) {
            if (!key(name) || !field || typeof field !== 'object' || !['toggle','text','number','slider','select'].includes(field.type)) throw new Error('Неизвестный тип настройки');
            const allowed = ['type','label','description','default', 'visibleWhen', ...(['number','slider'].includes(field.type) ? ['min','max','step'] : field.type === 'select' ? ['options'] : field.type === 'text' ? ['maxLength'] : [])];
            if (Object.keys(field).some(k => !allowed.includes(k)) || typeof field.label !== 'string' || !field.label.trim() || field.label.length > 120 || (field.description !== undefined && (typeof field.description !== 'string' || field.description.length > 500))) throw new Error('Некорректное описание настройки');
            if (['slider','number'].includes(field.type) && (![field.min,field.max,field.step].every(Number.isFinite) || field.min >= field.max || field.step <= 0 || field.step > field.max - field.min)) throw new Error('Некорректный диапазон');
            if (field.type === 'text' && field.maxLength !== undefined && (!Number.isInteger(field.maxLength) || field.maxLength < 1 || field.maxLength > 4000)) throw new Error('Некорректная длина текста');
            if (field.type === 'select' && (!Array.isArray(field.options) || !field.options.length || field.options.length > 32 || new Set(field.options.map(o => o?.value)).size !== field.options.length || !field.options.every(o => o && Object.keys(o).every(k => ['value','label'].includes(k)) && typeof o.value === 'string' && o.value.length < 100 && typeof o.label === 'string' && o.label.length <= 120))) throw new Error('Некорректные варианты выбора');
        }
        for (const [name, field] of Object.entries(schema)) if (field.visibleWhen !== undefined) {
            const condition = field.visibleWhen;
            if (!condition || typeof condition !== 'object' || Object.keys(condition).some(key => !['field','equals'].includes(key)) || !Object.hasOwn(schema, condition.field) || condition.field === name || !['string','number','boolean'].includes(typeof condition.equals)) throw new Error('Некорректное условие видимости');
        }
        normalize(schema);
        return schema;
    }
    return { validate, normalize, key };
});
