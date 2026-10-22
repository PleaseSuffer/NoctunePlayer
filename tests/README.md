# Tests

Run `npm test` from the project root. The runner executes `.cjs` files in
`main/`, `renderer/`, and `structure/` and stops on the first failure.
The suite requires Node.js and the project dependencies; it does not need a
graphical display or real service credentials.

| Group | Coverage |
| --- | --- |
| `main/` | Package validation and signatures, extension permissions and isolation, OAuth and secret storage, network restrictions, caches, theme installation, file opening, system integration and updates |
| `renderer/` | Playback and seeking, queues, lyrics, waveform, effect scheduling, settings persistence, extension SDK lifecycle and official extension behavior |
| `structure/` | Entry point, local imports, HTML resources and JavaScript syntax |

## Electron integration tests

These tests exercise real main/preload/renderer communication, browser isolation
and APIs that Node.js fixtures cannot verify. Run them sequentially from the
project root, with a graphical display:

```sh
./node_modules/.bin/electron tests/native-addons-probe.cjs
./node_modules/.bin/electron tests/native-addon-store-probe.cjs
./node_modules/.bin/electron tests/native-official-extensions-probe.cjs
./node_modules/.bin/electron tests/native-open-theme-probe.cjs
./node_modules/.bin/electron tests/native-scene-themes-probe.cjs
./node_modules/.bin/electron tests/native-scene-themes-probe.cjs --full-app
./node_modules/.bin/electron tests/native-playback-keep-awake-probe.cjs
```

On Windows, use `.\node_modules\.bin\electron.cmd` instead.

| Test | Coverage |
| --- | --- |
| `native-addons-probe.cjs` | Installer consent, artwork and grouped permissions, sandbox/CSP, SDK settings, audio-provider playback, expired streams and cleanup |
| `native-addon-store-probe.cjs` | Sandboxed store, signed catalog, install/cancel, search, tabs, main-window refresh and offline fallback |
| `native-official-extensions-probe.cjs` | Sleep audio gain, all six Shades selections, Dusk schemes and wallpaper restoration, dropdown interaction and scroll preservation |
| `native-open-theme-probe.cjs` | Theme installer, cancel, install/update, feedback and repeated file opening |
| `native-scene-themes-probe.cjs` | Canvas rendering, sandbox isolation, palette lifecycle and full-app theme activation |
| `native-playback-keep-awake-probe.cjs` | Actual playback, pause/resume/end and the native sleep blocker |

Tests use fixture profiles and generated data. Screenshots and retained profiles
are ignored under `tests/.artifacts/`. Extension tests use temporary keys and mock
responses; they do not verify real third-party login.

## Windows installer tests

```sh
node tests/native-installer-policy-probe.cjs
node tests/native-theme-associations-probe.cjs
```

These tests require the NSIS toolchain supplied by electron-builder. They compile
and execute fixtures without installing the application or changing the registry.

## Packaged application

`npm run audit:package -- dist/linux-unpacked/resources/app.asar` validates archive
contents, runtime imports, interface resources, themes and wallpapers.

The native extension tests accept
`--app-asar=dist/linux-unpacked/resources/app.asar` to exercise packaged code.
The official extension test additionally accepts
`--official-packages=addons/packages` to verify locally built signed packages.

## Adding regression tests

Keep repeatable checks of observable behavior, public contracts, error handling
and resource cleanup. A permanent test should have an independent expected
result, isolate its data and reproduce a meaningful failure. Avoid duplicating
existing assertions, mirroring implementation details or committing profiling
sessions, historical comparisons and release-specific screenshots.
