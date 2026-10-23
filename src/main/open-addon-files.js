const { filesFromArgv } = require('./open-audio-files');
const ADDON_EXTENSIONS = new Set(['noctaddon']);
const addonFilesFromArgv = (argv, options) => filesFromArgv(argv, ADDON_EXTENSIONS, options);

function createAddonOpenQueue(open, report, focus = () => {}) {
  const pending = new Set();
  let ready = false, active = null, task = Promise.resolve(), busy = false;
  function flush() {
    if (!ready || busy || !pending.size) return;
    busy = true;
    task = (async () => {
      while (ready && pending.size) {
        active = pending.values().next().value; pending.delete(active);
        try { await open(active); } catch (error) { report(error); }
        finally { active = null; }
      }
    })().finally(() => { busy = false; flush(); });
  }
  return {
    enqueue(files) { for (const file of files) { if (file === active) focus(file); else pending.add(file); } flush(); },
    setReady(value) { ready = value; flush(); },
    whenIdle: () => task,
  };
}
module.exports = { addonFilesFromArgv, createAddonOpenQueue };
