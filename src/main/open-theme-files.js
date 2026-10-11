const { filesFromArgv, createAudioOpenQueue } = require('./open-audio-files');
const THEME_EXTENSIONS = new Set(['noctheme']);
function themeFilesFromArgv(argv, options) { return filesFromArgv(argv, THEME_EXTENSIONS, options); }

function createThemeOpenQueue(importFile, report) {
  let task = Promise.resolve();
  const queue = createAudioOpenQueue(files => {
    task = task.then(async () => {
      for (const file of files) {
        let result;
        try {
          const theme = await importFile(file);
          if (!theme) continue;
          result = { theme };
        }
        catch (error) { result = { error: `Не удалось добавить тему: ${error.message}` }; }
        report(result);
      }
    });
  });
  return { enqueue: queue.enqueue, setReady: queue.setReady, whenIdle: () => task };
}
module.exports = { themeFilesFromArgv, createThemeOpenQueue };
