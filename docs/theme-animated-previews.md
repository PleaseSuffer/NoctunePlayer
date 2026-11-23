# Optional animated store previews

Theme videos are optional. A theme without a video keeps its ordinary static
banner. Browsing the store never executes a theme script or captures user audio.

The store waits 320 ms before downloading a hovered preview. Keyboard focus and
a tap on the image also start previews; there are no play/pause buttons on cards.
Only one video plays at a time. The poster
stays visible while loading; a 220 ms fade reveals the decoded first frame.
Network, verification and decoding failures retain the poster. Leaving a card,
changing results, hiding/closing the window or disabling animations releases
the video and its blob URL. Reduced motion always uses static previews.

The player-style **Animated previews** switch in the header persists locally.
The adjacent cache button shows current usage in MB, always with one decimal
place (including zero), and fills from 0 to 100% relative to the **50 MB** limit.
It updates after downloads and manual clearing, and when the window regains focus.
Clicking it clears videos on demand; the limit remains in the tooltip.
The disk cache is bounded to 50,000,000 bytes, trims on startup and after new
downloads, and automatically removes the least recently used clips first.
SHA-256 filenames isolate versions; decoded videos are not cached by the app.

## Delivery and compatibility

`addons/catalog/previews.json` is a separate, signed optional index. The existing
marketplace catalog and theme packages are unchanged, so older players continue
to load them. Entries match the exact theme ID, version, kind and channel.
An absent index or entry is normal and leaves static cards working.

Videos are silent WebM/VP9, normally 960×540, 4 seconds, 20 FPS. Limits are
8 MiB per file, 1280×720 and 6 seconds. The trusted main process downloads on
demand, validates public HTTPS/DNS, forbids URL changes, bounds time and bytes,
and verifies the signed hash and WebM header. The renderer checks decoded
dimensions and duration. CSP permits blob media, with no remote media sources.

Only the small index is bundled in the application. Video files remain external
under `addons/previews/<id>/<version>/preview.webm`. A video is not required to
install or use a theme. Demonstrations are available for Rhodes Island Dark and
Light 1.2.7 and Endfield Dark and Light 1.5.3. Other themes use the static fallback.
Endfield clips use the 60–64 second analysis fragment of a locally supplied track.

## Authoring

FFmpeg is a development tool supplied separately, not an application dependency.
Generate a clip from a published theme package. Without `--audio` the spectrum
is synthetic; with a local audio file, a four-second segment near its midpoint
is decoded into memory and analysed with the player's Web Audio settings
(8192 FFT, smoothing .35, -90 to -10 dB). The song is never changed or copied
to the output; videos have no audio track. `--compare` additionally writes
MP4 and GIF encodes of identical frames to the ignored development directory.

```powershell
.\node_modules\electron\dist\electron.exe scripts/render-theme-preview.cjs rhodes-island-dark C:/tools/ffmpeg.exe
.\node_modules\electron\dist\electron.exe scripts/render-theme-preview.cjs rhodes-island-light C:/tools/ffmpeg.exe --audio C:/Music/sample.mp3 --compare
.\node_modules\electron\dist\electron.exe scripts/render-theme-preview.cjs endfield-dark C:/tools/ffmpeg.exe --audio C:/Music/sample.mp3 --start 60
node scripts/publish-previews.cjs C:/path/outside/repository/publisher.pem
```

The renderer creates `preview.webm` and `metadata.json`. The publisher validates
the existing pinned identity, computes sizes/hashes and signs the separate index.
Published bytes must remain immutable; changed clips require a new theme version.
Keep private keys outside the repository. Publish index and referenced files
together; do not put videos/base64 into the marketplace catalog or theme assets.

## Measured file sizes (previous 640×360 profile)

Same 80 frames, 640×360, four seconds at 20 FPS; audio-driven Rhodes Island 1.2.5.
VP9 CRF 36, H.264 CRF 26, GIF with a generated palette and dithering. These are
size measurements for the selected encoding profiles, not a perceptual-quality
or CPU/memory benchmark. The audio analysis fragment was 52.88–56.88 seconds.

| Theme | WebM bytes | MP4 bytes | GIF bytes |
| --- | ---: | ---: | ---: |
| Dark | 116,401 | 112,487 | 3,124,072 |
| Light | 111,179 | 115,244 | 3,362,558 |

The two video formats are nearly equal in combined size; GIF is about 28.5
times larger than WebM in this sample. WebM remains the first supported profile.

## Validation

```powershell
node tests/main/animated-previews.cjs
.\node_modules\electron\dist\electron.exe tests/native-animated-previews-probe.cjs
```

The native probe uses an isolated profile and local media, with no network or
user library access. It checks real sandboxed IPC, playback, the fade, optional
static cards, hover cancellation, late replies, failure fallback, keyboard,
reduced motion and cleanup. Screenshots are in the ignored
`tests/.artifacts/animated-previews/` directory.

## Previous HD profile

The HD comparison clips render natively at 1280×720, VP9 CRF 24 (previously 36),
20 FPS, four seconds, without audio. Rhodes Island keeps the same midpoint
fragment (52.88–56.88 seconds); Endfield keeps 60–64 seconds.

| Theme | Version | WebM bytes |
| --- | --- | ---: |
| Rhodes Island Dark | 1.2.6 | 541,706 |
| Rhodes Island Light | 1.2.6 | 547,295 |
| Endfield Dark | 1.5.2 | 916,007 |
| Endfield Light | 1.5.2 | 838,377 |

Earlier packages and clips remain immutable. The signed preview index selects
the HD assets for the new theme versions.

## Resolution comparison at VP9 CRF 24

All clips use the same tracks, analysis fragments, four-second duration and
20 FPS. Sizes are separate: the preview is not embedded in the theme package.

| Theme | Theme package bytes | 1280×720 WebM | 960×540 WebM | 640×360 WebM |
| --- | ---: | ---: | ---: | ---: |
| Rhodes Island Dark | 1,301,996 | 541,706 | 368,233 | 217,223 |
| Rhodes Island Light | 1,303,184 | 547,295 | 370,817 | 214,213 |
| Endfield Dark | 1,544,008 | 916,007 | 612,782 | 342,362 |
| Endfield Light | 1,555,807 | 838,377 | 552,636 | 309,257 |

Current profile: **960×540, VP9 CRF 24**, about 32–34% smaller than HD.
The current theme versions are Rhodes Island 1.2.7 and Endfield 1.5.3.
The 640×360 variant is roughly 60–63% smaller than HD, but has less resolution
for enlarged cards and high-DPI displays. Theme packages are 1.30–1.56 MB;
the old HD previews were 42–59% of their package sizes, not equal in size.

Use `--width 640|960|1280` to select resolution. `--draft` places candidates
in ignored `.development/preview-candidates` directories for comparison without
replacing versioned published assets.
