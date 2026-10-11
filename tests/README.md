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
.\node_modules\.bin\electron.cmd tests/native-thumbnail-probe.cjs
.\node_modules\.bin\electron.cmd tests/native-image-effects-probe.cjs
.\node_modules\.bin\electron.cmd tests/native-image-effects-probe.cjs --fallback
.\node_modules\.bin\electron.cmd tests/native-visualizer-settings-probe.cjs
```

| Test | Regression covered |
| --- | --- |
| Scene themes | Real Canvas output, sandbox isolation, palette and selection lifecycle, full-app integration |
| Scene performance | Worker execution, panel frame budget, idle/tray suspension, resume and DOM fallback; no machine-specific FPS target or historical baseline |
| Rain window mask | Glass alpha boundary, foreground occlusion, spectrum baseline and fade to silence |
| Theme opening | Separate installer, metadata, cancel, install/update states, toasts and repeated file-open |
| Playback keep-awake | Actual audio playback, pause/resume/end, native sleep blocker and background gallery layout |
| Memory and thumbnails | Native audio decode serialization, bounded waveform/artwork storage and image loading |
| Image effects and visualizers | Real GPU/Canvas output, fallback rendering, controls and persistence |

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

`installed-build-probe.cjs` is the optional post-installation smoke test. Pass the
installed `Noctune.exe` path after closing the application. It uses a local debug
connection and temporarily changes settings, then restores them. It is excluded
from `npm test`; its purpose is to detect packaging/preload failures that source
tests cannot catch.

Historical algorithm comparisons and duplicate installed-app diagnostics are
not part of the test suite. Keep reusable behavioral assertions instead of
adding release-specific snapshots or tests requiring the developer's profile.
