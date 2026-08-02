# Handover — where the project stands

_Last updated: 2026-08-02_

## What this project is

Latent Tools: a local-first Electron desktop app for **bulk image-dataset
prep** — watermark removal (AI detection + inpainting), format conversion
(JPEG/PNG/WEBP), and uncensored image captioning. Bulk
(folder) processing is first-class, not an afterthought; it exists as much
to prepare training datasets (e.g. LoRA) as for one-off cleanup.

Full spec: [`docs/implementation-plan.md`](docs/implementation-plan.md) —
architecture, component breakdown, IPC/HTTP contract, error handling, UI/UX
flow, testing strategy, and 6 phased milestones.

## Where we are: All 6 Phases Complete & v1.0.0 Standalone Release Published

**Phase 1** ("sidecar + single-image round trip, one format") is complete.  
**Phase 2** ("multi-format conversion") is complete.  
**Phase 3** ("captioning") is complete.  
**Phase 4** ("manual mask adjustment UI") is complete.  
**Phase 5** ("bulk / batch dataset processing") is complete.  
**Phase 6** ("polish, telemetry, user experience & edge-case robustness") is complete — Unified Latent Design System visual theme, standalone `.exe` release packaging, loopback firewall isolation, UI scale zoom, and dark select popups.

## What's built right now

- **Sidecar** (`sidecar/`, FastAPI): `/health`, `/gpu` (real-time GPU Name, VRAM usage & Temp telemetry), `/normalize`, `/detect` (Florence-2 open-vocabulary detection + adaptive Canny stroke contouring), `/inpaint` (IOPaint/LaMa), `/convert` (JPEG/PNG/WEBP export), `/caption` (Qwen2-VL-2B-Instruct / Qwen2-VL-7B-Instruct or a custom local model folder, selectable per-request via `model_id`, with custom system prompts & trigger words), `/shutdown`. Hardened Uvicorn engine to `127.0.0.1` loopback with `--port` CLI flag and `LATENT_SIDECAR_PORT` environment variable to prevent Windows Firewall prompts. PyInstaller support (`sidecar.exe`) for single-binary packaging.
- **Electron main** (`src/main/`): `SidecarClient`, `SidecarProcess`, `ipc-handlers.ts` (`image:import`/`detect`/`inpaint`/`caption`/`save`/`export`/`gpu:status`/`mask:update`/`folder:select`/`folder:list-images`/`bulk:process-item`/`shell:open-external`/window controls), default window dimensions `1440x900` centered in windowed mode. Dynamic `app.isPackaged` sidecar path resolution (`process.resourcesPath/sidecar/sidecar.exe`). System tray icon (`assets/lt_icon.png`) with a Show/Quit context menu; `BrowserWindow` and packaged `.exe` both carry the same icon.
- **Renderer UI** (Unified Latent Design System — near-black graphite canvas `#0A0A0D`, step-up flat surfaces `#14151B` / `#23252F`, Latent Cyan `#4FD8D0`, Latent Violet `#9B7EF5`, brand gradient, `Inter` typography, `JetBrains Mono` telemetry):
  - **App shell**: frameless titlebar (window controls, Latent brand gradient rounded square logo, live GPU Sidecar status pill) + left sidebar (Single/Bulk nav with 2.5px brand indicator bar, shared captioning model selector, GPU mini-widget with VRAM bar, ALK developer logo linked to GitHub profile).
  - **UI Zooming & Scaling**: `Ctrl` + mousewheel zooming (50%–250%) and `Ctrl+0` reset shortcut via `webFrame`. Default base text sizes increased by +2px across all components.
  - **Dark Dropdown Styling**: `color-scheme: dark` enforced across all `<select>` and `<option>` elements (Captioning Model, Export Presets, Formats, Compression Levels, Metadata settings).
  - **Single Image Editor**: Detect/Remove Watermark action buttons (brand-gradient, icon-led — not a numbered step tracker) above a preview/inspector grid. Full-featured canvas mask overlay with adaptive brush editing, undo/redo history, mousewheel zoom (+ working zoom-in/out buttons), click & drag panning, drag-and-drop or click-to-browse image import directly on the canvas (empty-state dropzone shown until an image loads), and a matching brand-gradient "Select Image" button. Inspector column: Dataset Caption card (Generate Caption button, `.txt`-sidecar disclaimer) always visible above an Export Settings card whose fields collapse into a closed-by-default `<details>` disclosure (Export Image button stays visible either way) — replaced the old Caption/Export tab switcher.
  - **Bulk Dataset Processor**: single scrolling column card layout containing disclaimer banner, Setup (input/output drag-and-drop folder dropzones with native `webUtils.getPathForFile` resolution & helper text + thumbnail grid), Export Settings, and Progress & Real-time Logs terminal.
- **Packaging & CI/CD**: `package.json` configured with `electron-builder` for Windows NSIS installer (`.exe`) and Portable standalone (`.exe`), both carrying `assets/lt_icon.png` as the `.exe` icon. GitHub Actions workflow ([`.github/workflows/build.yml`](.github/workflows/build.yml)) compiles the PyInstaller sidecar binary, runs Vitest & Pytest test suites, and publishes standalone release installers on `v*` tag pushes or GitHub releases. First full release tag: `v1.0.0`.

## TODO
- No open items on the bulk-pipeline speed track. Detect (0.3-0.5s) and caption
  (2.0-3.4s) now dominate the per-image cost — further gains would mean optimizing
  those model calls themselves (e.g. a smaller/faster caption model option), not
  the transport layer.

## Completed Improvements
- **README interface screenshots (Completed 2026-08-02)** — Added a
  "📸 Interface" section to `README.md` (`assets/single.jpg`,
  `assets/bulk.png`), matching the centered-screenshot-with-caption layout
  Latent Library's README already uses. Removed the now-unused
  `assets/ALX Logo Neon.png` in the same commit (unreferenced anywhere in
  code).
- **Single Image Editor UX pass: dead caption button, zoom buttons, canvas
  import (Completed 2026-08-02)** — Several related bugs/gaps found and
  fixed together in `src/renderer/`:
  - The Caption panel's own "Generate Caption" button (`single-gen-caption-btn`)
    had no click handler at all — only the separate pipeline-bar button did.
    Removed the duplicate pipeline-bar button (it read as a numbered step
    tracker, not an actionable control) and wired the panel button instead,
    plus added a "saved as .txt on export" disclaimer under the caption
    textarea.
  - Merged the Caption/Export tab switcher into one always-visible column:
    Export Settings' fields now live in a closed-by-default `<details>`
    disclosure inside the same panel as Caption, with Export Image staying
    visible outside the disclosure regardless of collapse state.
  - `#zoom-in-btn`/`#zoom-out-btn` existed in the DOM with no click
    listeners — only mousewheel zoom worked. Added a shared `stepZoom()`
    handler.
  - Added drag-and-drop and click-to-browse image import directly on the
    canvas via an empty-state dropzone button, extracting the shared
    `loadImageFile()` used by both the file input and the drop handler.
  - Fixed a rendering race where the empty-state dropzone and a
    broken/loading `<img>` could render on top of each other: the dropzone
    was hidden as soon as `importImage()` resolved rather than when the
    image actually finished rendering. `#preview` now defaults to
    `display: none` in CSS and both the dropzone-hide and image-reveal now
    happen together in the image's `load` event handler.
  - Restyled Detect/Remove Watermark and Select Image as `btn-cta`
    (brand-gradient, icon-led) buttons instead of muted step-badge styling,
    per user feedback that they read as static tabs/instructions rather
    than clickable controls.
- **License/docs coherence pass against Latent Library (Completed 2026-08-02)** —
  Auditing this repo's LICENSE/README/BUILDING/CONTRIBUTING against Latent Library
  (the reference app for this pass, since it also went through this same audit
  earlier) found this repo's license was plain MIT — missing the Commons Clause
  condition (no reselling/hosting as a paid service) that Library and Model
  Organizer both carry. That was an oversight, not an intentional divergence for
  this app. Renamed `LICENSE.md` → `LICENSE` and added the Commons Clause block,
  matching the other two byte-for-byte. Updated `package.json`'s `license` field
  from `"MIT"` to `"SEE LICENSE IN LICENSE"` and fixed the two license references
  in `README.md` (the third-party-models section and the License section) to match.
  Also added `BUILDING.md` (this repo didn't have one, unlike Library/Organizer),
  extracted from README's "Developer Guide"/"Running Tests"/"Packaging" sections —
  those sections were removed from README, matching how Library/Organizer keep
  build-from-source detail out of the README and in BUILDING.md instead. Verified
  `npm run build` and `npm test` still pass after the `package.json` edit.
- **Dev-credit logo sized to match sibling apps (Completed 2026-08-02)** —
  `.sidebar-footer-logo img` (`src/renderer/styles/app.css`) used a plain
  `width: 64px`, matching Latent Model Organizer but not Latent Library
  (`max-width: 120px; max-height: 44px`). The 64px size read as too small once
  compared side-by-side, so all three apps now share Library's larger sizing:
  `max-width: 120px; height: auto; max-height: 44px; object-fit: contain;`.
- **Titlebar wordmark aligned with sibling apps (Completed 2026-08-02)** —
  Follow-up from the icon migration below, found via a user screenshot comparison
  against Latent Model Organizer and Latent Library. `.titlebar-wordmark`
  (`src/renderer/styles/app.css`) rendered "Latent Tools" as flat
  `var(--color-text-primary)` at 14px, while both sibling apps use a gradient
  treatment. Changed to `font-size: var(--text-body-lg, 16px)`,
  `font-weight: var(--weight-bold, 700)`, gradient text via
  `background: var(--gradient-brand-text)` + `-webkit-background-clip: text` +
  `-webkit-text-fill-color: transparent`, `letter-spacing: var(--tracking-tight,
  -0.01em)` — all tokens already existed in `styles/latent/tokens/`, no token
  changes needed.
- **Icon system standardized on real Lucide glyphs (Completed 2026-08-02)** —
  This app's hand-rolled inline `<svg>` icons (already visually close to Lucide's
  stroke style) were replaced with real Lucide icons across a cross-app pass that
  also standardized Latent Library and Latent Model Organizer on
  `lucide-vue-next`. This app has **no bundler** for the renderer (`renderer.ts`
  compiles with plain `tsc` to CommonJS, loaded via a bare `<script>` tag under
  Electron's default `contextIsolation`), so the usual `import { createIcons }
  from 'lucide'` approach would compile to a `require()` call and break at
  runtime — the standard vanilla-JS integration doesn't apply here. Instead,
  `lucide`'s prebuilt UMD bundle (`node_modules/lucide/dist/umd/lucide.min.js`,
  exposing `window.lucide`) is now copied into `dist/renderer/` alongside
  `styles/`/`assets/` (`scripts/copy-renderer-html.js`) and loaded via a plain
  `<script>` tag before `renderer.js`; `renderer.ts` calls
  `lucide.createIcons({ attrs: { "stroke-width": "1.8" } })` on load (global
  declared in `src/renderer/window.d.ts`). 16 of 18 inline SVGs in
  `src/renderer/index.html` became `<i data-lucide="...">` placeholders:
  `image`, `layers`, `cpu`, `settings` (×2), `arrow-right` (×2), `paintbrush`,
  `eraser`, `search`, `upload`, `sparkles`, `save` (×2), `play`, `folder` (×2),
  `palette`, `heart`. The app's own two-tone "L" brand mark and the Ko-fi
  button's third-party mascot logo were deliberately left as inline SVG (not
  generic UI icons, no Lucide equivalent). One mapping is a judgment call worth
  a visual spot-check: `sparkles` for the "Generate Caption" button — the
  original custom 8-ray asterisk-burst glyph has no exact Lucide match; confirmed
  via a CSS grep that it is not a loading spinner (unrelated `@keyframes
  lt-spin` exists separately) before picking `sparkles` as the closest semantic
  "AI generate" icon. `package.json` gained `"lucide": "^0.400.0"` under a new
  `dependencies` block (this app previously had none). Verified via `npx tsc
  --noEmit`, `npm run build`, and `npx vitest run` (27 tests passed); all 15
  icon names confirmed to exist in the installed `lucide@0.400.0` package.
- **v1.0.0 Release & Unified Latent Design System Migration (Completed 2026-08-01)** —
  Migrated `Latent Tools` to the official unified **Latent Design System** (`https://github.com/erroralex/Latent-Design-System.git`), standardizing tokens (`src/renderer/styles/latent/`), colors (near-black graphite `#0A0A0D`, Latent Cyan `#4FD8D0`, Latent Violet `#9B7EF5`, brand gradient), typography (`Inter` + `JetBrains Mono`), titlebar with official Latent `BrandMark` SVG icon (`assets/latent-mark.svg`), white active/hover sidebar icon strokes, action button glow rings, sidebar Settings button and modal dialog (`#settings-modal`) with appearance details & Ko-fi support link (routed via IPC `shell:open-external`), and drag-and-drop folder support on bulk input/output dropzones with helper text. Tagged `v1.0.0` and published first full release via GitHub Actions. Updated developer mark asset to `alx_logo.png` across renderer sidebar and `README.md`.
- **README overhaul, LICENSE.md, and CONTRIBUTING.md added (Completed 2026-08-01)** —
  `README.md` now documents bulk dataset processing, the `/process`
  single-round-trip sidecar endpoint, the 2B/7B/custom captioning model
  selector, export presets, the Deep Neon UI, and prebuilt-release
  downloads — all previously undocumented — plus a disclaimer that the
  tool is for removing watermarks users have the rights to remove, not
  for stripping copyright from others' work. Added `LICENSE.md` (MIT,
  matching `package.json`'s new `license`/`author` fields) and
  `CONTRIBUTING.md` (setup, AGENTS.md-derived workflow rules, GPU
  exclusivity note, commit/PR conventions, and the same responsible-use
  scope statement), neither of which existed before.
- **Fix: brush unusable after Remove Watermark until Detect → Clear (Completed 2026-08-01)** —
  `src/renderer/renderer.ts`'s `inpaintBtn` handler set `maskCanvas.style.display
  = "none"` after a successful inpaint. That overlay canvas owns every brush
  `pointerdown`/`pointermove`/`pointerup` listener, and a `display: none`
  element receives no pointer events at all, so brush strokes silently
  no-oped until Detect (or importing a new image) set `display` back to
  `"block"`. Fixed by clearing the stale mask (`offscreenCtx.clearRect` →
  `syncVisibleCanvas` → `exportOffscreenMask` → `clearHistory` →
  `saveHistoryState`, the same sequence the Clear Mask button already uses)
  instead of hiding the canvas, so the overlay goes visually empty but stays
  interactive for immediate touch-up masking.
- **App icon in titlebar, tray, and `.exe` (Completed 2026-07-31)** — Added
  `assets/lt_icon.png` and wired it in three places: the renderer's custom
  titlebar logo (`src/renderer/index.html`, replacing the CSS gradient-text
  "LT"), a new system tray icon with a Show/Quit menu (`src/main/index.ts`,
  also sets the `BrowserWindow` icon), and `electron-builder`'s `win.icon` in
  `package.json` for the packaged installer/portable `.exe`. Note: Windows
  Explorer/Start Menu can keep showing a stale generic icon from its shell
  icon cache after a rebuild even when the exe's icon resource is correct —
  not a packaging bug, don't chase it.
- **Release build workflow restricted to version tags (Completed 2026-07-31)** —
  `.github/workflows/build.yml` previously ran the full PyInstaller +
  electron-builder packaging pipeline on every push to `main`. Now it only
  triggers on `v*` tag pushes, GitHub releases, or manual dispatch, since
  that pipeline is expensive and only meaningful when cutting a release.
- **CI fix: `/process` no longer eagerly loads CUDA-only models (Completed 2026-07-31)** —
  `sidecar/app/main.py`'s `/process` endpoint took `detector`/`inpainter` as
  `Depends(get_detector)`/`Depends(get_inpainter)`, so FastAPI constructed the
  real Florence-2 detector and LaMa inpainter on *every* call, even when
  `auto_remove_watermark` was `False`. That passed on GPU dev machines but
  failed on GitHub Actions' CPU-only Windows runner with
  `AssertionError: Torch not compiled with CUDA enabled`
  (`test_process_convert_only_skips_detect_inpaint_and_caption`,
  `test_process_rejects_unsupported_format`,
  `test_process_uses_model_specific_captioner`). Fixed by resolving the
  detector/inpainter lazily inside the `if body.auto_remove_watermark:` branch,
  mirroring the lazy-resolution pattern already used for the captioner.
- **Single-round-trip `/process` endpoint for bulk processing (Completed 2026-07-31)** —
  Added `POST /process` to the sidecar (`sidecar/app/main.py`), which runs
  normalize → detect → inpaint → caption → convert on one in-memory `PIL.Image`
  and returns the final bytes in a single HTTP call. `bulk:process-item` in
  `src/main/ipc-handlers.ts` now calls `SidecarClient.process()` once instead of
  five separate `normalize`/`detect`/`inpaint`/`caption`/`convert` round-trips,
  eliminating the five extra full-resolution PNG encode/decode/base64 round-trips
  the old bulk path paid per image. The single-image editor path (`image:detect`,
  `image:inpaint`, `image:caption`, `image:export`) is unchanged — it still needs
  the intermediate results for the interactive mask-editing UI. Convert-format
  logic was factored into a shared `_encode_image` helper used by both `/convert`
  and `/process` to avoid duplicating the JPEG-flatten/metadata-keep logic.
  **Verified on real hardware (RTX 5080, 26-image bulk run, warm model state):
  6.0s/image → 3.32s/image (25 warm items in 83s), a 45% reduction** — beating the
  ~4s estimate. Confirms the per-item overhead beyond detect/inpaint/caption was
  almost entirely the now-eliminated HTTP/base64 round-trip cost.
- **Standalone Windows Executable Release Pipeline (Completed 2026-07-31)** — Configured `electron-builder` in `package.json` (`npm run dist`) and created `.github/workflows/build.yml` for automated GitHub Actions builds. Hardened FastAPI Uvicorn sidecar to `127.0.0.1` loopback binding to prevent Windows Firewall prompts.
- **Deep Neon Visual Design & UI Scale Zooming (Completed 2026-07-31)** — Replaced visual design system with Deep Neon tokens, added `Ctrl` + mousewheel zooming (50%–250%), increased default base font sizes by +2px, styled native select/option dropdowns in dark theme, and updated default window size to `1440x900` centered.
- **Detection speed (Completed 2026-07-31)** — Root cause was process-wide side effect of importing IOPaint. Fix in `sidecar/app/inpainting.py`. `/detect` went from **2.9s to 0.47s avg (~6x faster)**.
- **Structured Logging (Completed 2026-07-31)** — Implemented `[Detect]`, `[Inpaint]`, `[Caption]`, `[Convert]`, `[Normalize]` structured logging piped from sidecar stdout/stderr to main and renderer log consoles.

## Verified technical facts worth not re-discovering

- Plain `pip install torch` gives a **CPU-only** wheel on Windows even with a discrete GPU driver present. Use `pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128`.
- **Importing `iopaint` makes Florence-2 detection ~10x slower** unless `TORCH_CUDNN_V8_API_LRU_CACHE_LIMIT` is restored immediately after import in `sidecar/app/inpainting.py`.
- **Two model-loading processes do not fit on a 16 GiB card.** Spilling to host memory degrades performance by 10–100x. Check `nvidia-smi` before debugging slowdowns.
- Explicit Uvicorn `host="127.0.0.1"` binding prevents Windows Firewall security popups on end-user machines.
- Packaged Electron apps (`app.isPackaged === true`) must load external binaries from `process.resourcesPath/sidecar` rather than inside `app.asar`.
- Qwen2-VL model execution MUST be wrapped in `with torch.inference_mode():` and followed by `torch.cuda.empty_cache()`.
- Image resolution is 100% preserved 1:1 across normalization, Florence-2 detection, LaMa inpainting, format conversion, and Qwen2-VL dataset captioning.

## Setup from a clean checkout

```bash
# Sidecar (one-time)
cd sidecar
python -m venv .venv
.venv/Scripts/python -m pip install -e ".[dev]"
.venv/Scripts/python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128

# Electron app
cd ..
npm install
npm run build
npm start

# Build standalone Windows installer & portable binary
npm run dist
```

Tests: `npm test` (Electron TS Vitest) and, from `sidecar/`, `.venv/Scripts/python -m pytest tests/ -v` (Python Pytest).
