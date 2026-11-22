function createMainErrorReporter({ process: runtime = process, ipcMain, getWindow, log = console.error.bind(console) }) {
  const pending = [];
  let readyContents = null;
  function flush() {
    try {
      const win = getWindow();
      if (!win || win.isDestroyed() || win.webContents !== readyContents || readyContents.isDestroyed()) return;
      while (pending.length) {
        readyContents.send('app-errors:report', pending[0]);
        pending.shift();
      }
    } catch (_) { /* Keep startup errors until the main renderer is available. */ }
  }
  function report(reason, origin = 'main') {
    const error = { name: 'Error', message: (globalThis.noctuneI18n?.t("errors.mainProcess.title") ?? "Ошибка основного процесса"), process: 'main', origin };
    try {
      if (reason && typeof reason === 'object') {
        for (const key of ['name','message','stack','code','syscall','address','port']) {
          const value = reason[key];
          if (typeof value === 'string' || typeof value === 'number') error[key] = typeof value === 'string' ? value.slice(0, key === 'stack' ? 32000 : 2000) : value;
        }
      } else error.message = String(reason).slice(0, 2000);
    } catch (_) { /* An arbitrary rejection value must not break error reporting. */ }
    try { log((globalThis.noctuneI18n?.t("errors.mainProcess.prefix") ?? "Основной процесс:"), error); } catch (_) {}
    pending.push(error);
    if (pending.length > 20) pending.shift();
    flush();
  }
  function ready(event) {
    const win = getWindow();
    if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return;
    readyContents = event.sender;
    flush();
  }
  const exception = (error, origin) => report(error, origin || 'uncaughtException');
  const rejection = reason => report(reason, 'unhandledRejection');
  runtime.on('uncaughtException', exception);
  runtime.on('unhandledRejection', rejection);
  ipcMain.on('app-errors:ready', ready);
  return {
    report,
    reset() { readyContents = null; },
    dispose() {
      runtime.removeListener('uncaughtException', exception);
      runtime.removeListener('unhandledRejection', rejection);
      ipcMain.removeListener('app-errors:ready', ready);
      pending.length = 0; readyContents = null;
    },
  };
}
module.exports = { createMainErrorReporter };
