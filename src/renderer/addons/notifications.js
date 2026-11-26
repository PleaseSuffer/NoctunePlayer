(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory;
    else root.addonNotifications = factory(root.notificationCenter);
})(globalThis, function(center) {
    const validKey = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
    return function(manifest, method, args, grants, command) {
        const invalid = () => { throw new Error(globalThis.noctuneI18n?.t('notifications.invalidRequest') ?? 'Invalid notification request'); };
        if (!grants.has('notifications.show')) invalid();
        if (args.key !== undefined && !validKey(args.key)) invalid();
        if (method === 'notifications.update' && !validKey(args.key)) invalid();
        for (const [field, limit] of [['message', 500], ['title', 120], ['progressLabel', 160], ['copyText', 16000]]) {
            if (args[field] !== undefined && (typeof args[field] !== 'string' || args[field].length > limit)) invalid();
        }
        if (method === 'notify' && typeof args.message !== 'string') invalid();
        if (args.type !== undefined && !['info', 'warning', 'error', 'success'].includes(args.type)) invalid();
        for (const field of ['important', 'pinned']) if (args[field] !== undefined && typeof args[field] !== 'boolean') invalid();
        if (args.progress !== undefined && args.progress !== null && (!Number.isFinite(args.progress) || args.progress < 0 || args.progress > 1)) invalid();
        if (args.duration !== undefined && (!Number.isFinite(args.duration) || args.duration !== 0 && (args.duration < 3000 || args.duration > 60000))) invalid();
        const options = {};
        for (const field of ['title', 'type', 'important', 'pinned', 'progress', 'progressLabel', 'copyText', 'duration']) if (args[field] !== undefined) options[field] = args[field];
        if (args.actions !== undefined) {
            if (!Array.isArray(args.actions) || args.actions.length > 3) invalid();
            options.actions = args.actions.map(action => {
                if (!action || typeof action.label !== 'string' || !action.label.trim() || action.label.length > 80 || !manifest.commands.some(item => item.id === action.command)) invalid();
                for (const field of ['primary', 'dismissOnClick']) if (action[field] !== undefined && typeof action[field] !== 'boolean') invalid();
                return { label: action.label, primary: action.primary, dismissOnClick: action.dismissOnClick, onClick: () => command(manifest.id, action.command) };
            });
        }
        const key = args.key === undefined ? undefined : manifest.id + ':' + args.key;
        if (method === 'notifications.update') {
            const id = center.find(key);
            return id ? center.update(id, { ...options, ...(args.message !== undefined ? { message: args.message } : {}) }) : false;
        }
        center.show(args.message, args.type || 'info', args.title || manifest.name, null, { ...options, owner: manifest.id, source: manifest.name, replaceKey: key });
        return null;
    };
});
