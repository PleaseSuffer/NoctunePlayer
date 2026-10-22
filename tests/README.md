# Tests

Run the repeatable Node.js suite with `npm test`. The runner discovers `.cjs`
files in `main/`, `renderer/`, and `structure/` and stops on the first failure.
These tests cover behavior, validation, storage, cancellation, and renderer syntax.

## Electron regressions

Native tests exercise browser rendering, audio, preload IPC, and Electron APIs
that Node.js fixtures cannot verify. Run them explicitly with the project's
Electron executable; on Windows:

```powershell
.\node_modules\.bin\electron.cmd tests/native-scene-themes-probe.cjs
.\node_modules\.bin\electron.cmd tests/native-scene-themes-probe.cjs --full-app
.\node_modules\.bin\electron.cmd tests/native-scene-performance-probe.cjs
.\node_modules\.bin\electron.cmd tests/native-rain-window-mask-probe.cjs
.\node_modules\.bin\electron.cmd tests/native-open-theme-probe.cjs
.\node_modules\.bin\electron.cmd tests/native-playback-keep-awake-probe.cjs
.\node_modules\.bin\electron.cmd tests/native-memory-probe.cjs
.\node_modules\.bin\electron.cmd tests/native-image-effects-probe.cjs
.\node_modules\.bin\electron.cmd tests/native-image-effects-probe.cjs --fallback
.\node_modules\.bin\electron.cmd tests/native-addons-probe.cjs
.\node_modules\.bin\electron.cmd tests/native-addon-store-probe.cjs
.\node_modules\.bin\electron.cmd tests/native-official-extensions-probe.cjs
```

| Test | Regression covered |
| --- | --- |
| Scene themes | Real Canvas output, sandbox isolation, palette and selection lifecycle, full-app integration |
| Scene performance | Worker execution, panel frame budget, idle/tray suspension, resume and DOM fallback; API v2 in Worker/iframe, mask/inverse pixels, callback cleanup, typed settings and persistence, diagnostics and the packaged v2 demo; no machine-specific FPS target or historical baseline |
| Rain window mask | Glass alpha boundary, foreground occlusion, spectrum baseline and fade to silence |
| Theme opening | Separate installer, metadata, cancel, install/update states, toasts and repeated file-open |
| Playback keep-awake | Actual audio playback, pause/resume/end, native sleep blocker and background gallery layout |
| Memory | Native audio decode serialization and bounded waveform/artwork storage |
| Image effects | Real GPU/Canvas output and fallback rendering; visualizer settings and modes are covered by the Node.js renderer suite |
| Addons | Separate installer, consent/cancel, grouped permissions and artwork, opaque iframe/Worker and CSP, SDK permissions, persistent data, cleanup, typed settings and audio-provider playback |
| Extension store | Separate sandboxed window, signed catalog, search and tabs, both themes and sizes, install/cancel, main-window refresh and offline fallback; uses an ephemeral test key and no network |
| Official extensions | Sleep gain automation and cleanup; Shades scheme registration; Dusk live source dropdowns, provider removal/recovery, temporary wallpaper and interactive scene restoration. Add `--official-packages=addons/packages` to verify signed local release packages; `--app-asar=dist/linux-unpacked/resources/app.asar` checks packaged SDK code. |

Run full-app tests sequentially: development theme storage is shared. Tests use
fixture profiles and generated data; retained screenshots and profiles belong in
the ignored `.artifacts/` directory. `native-memory-renderer.js` is a helper used
by the memory test, not a standalone test. Run scene rendering tests without asset
generation flags when validating a change.

## Windows packaging

```powershell
node tests/native-installer-policy-probe.cjs
node tests/native-theme-associations-probe.cjs
```

These tests require the NSIS toolchain from electron-builder. They validate
installer policy and compile association macros using fixtures; they do not
install the application or modify the registry.

Historical algorithm comparisons and duplicate installed-app diagnostics are
not part of the test suite. Keep reusable behavioral assertions instead of
adding release-specific snapshots or tests requiring the developer's profile.

Проверки SDK 1: `main/addon-sdk.cjs` (права, настройки, vault, OAuth PKCE/state/refresh),
`main/addon-services.cjs` (file handles, подмена симлинком, clipboard, HTTPS),
`renderer/addon-player.cjs` (сеансы, устаревшие события, очередь).
`native-addons-probe.cjs` дополнительно проверяет API 1, все типы настроек,
реальный поток через Web Audio, истёкшую ссылку HTTP 403 и один refresh,
события/PCM/анализатор и освобождение ресурсов. Профиль теста временный,
HTTPS-аудиосервер заменён локальным детерминированным mock; реальный вход
в сторонние сервисы этим тестом не проверяется.

`main/addon-assets.cjs` проверяет упаковку и лимиты двоичных ресурсов,
канонический base64, подпись ресурсов, artwork в снимке установки и группировку
полных/частичных разрешений. Native probe проверяет чтение ресурсов из Worker,
logo/banner и вложенные списки реальных разрешений в установщике.


## Проверка собранного приложения

`npm run audit:package -- dist/linux-unpacked/resources/app.asar` проверяет
реальный состав архива, ссылки интерфейса и модулей, ресурсы тем и обоев.
С флагом `--app-asar=dist/linux-unpacked/resources/app.asar` native addon probe
загружает main/preload/renderer из сборки; дополнительно проверяет метаданные
локального WAV и активацию встроенной темы. Используются временный профиль
и тестовый поток, запрос обновлений приложения отключён.
