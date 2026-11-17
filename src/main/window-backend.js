function configureWindowBackend({ app, platform = process.platform, env = process.env, argv = process.argv }) {
  if (platform !== 'linux') return { backend: 'native', positioningSupported: true };
  const wayland = env.XDG_SESSION_TYPE === 'wayland' || !!env.WAYLAND_DISPLAY;
  // Electron adds its Wayland default before main.js. Only actual argv denotes
  // the user's explicit override; hasSwitch() also sees Electron's own default.
  const end = argv.indexOf('--'), options = end < 0 ? argv : argv.slice(0, end);
  const explicit = options.some(value => value === '--ozone-platform' || value.startsWith('--ozone-platform='));
  let backend = explicit ? app.commandLine.getSwitchValue('ozone-platform') : '';
  // Native Wayland deliberately exposes no global window positioning. Use the
  // X11 compatibility display for the floating player, unless explicitly overridden.
  const x11 = !!env.DISPLAY?.trim() || !!app.commandLine.getSwitchValue('display');
  if (!explicit && wayland && x11) {
    backend = 'x11';
    // Ozone is initialized before the entry script. Changing the switch here
    // changes reported capabilities but leaves native windows on Wayland.
    const args = argv.slice(1), separator = args.indexOf('--');
    args.splice(separator < 0 ? args.length : separator, 0, '--ozone-platform=x11');
    // Relaunch an AppImage through its outer executable, not a temporary mount.
    // Ignore AppImage variables inherited from an unrelated parent application.
    const appImage = env.APPIMAGE?.startsWith('/') && env.APPDIR?.startsWith('/') &&
      argv[0]?.startsWith(env.APPDIR.replace(/\/+$/, '') + '/');
    app.relaunch({ args, ...(appImage ? { execPath: env.APPIMAGE } : {}) });
    app.exit(0);
  }
  if (!backend || backend === 'auto') backend = wayland ? 'wayland' : 'x11';
  return { backend, positioningSupported: backend !== 'wayland' };
}
module.exports = { configureWindowBackend };
