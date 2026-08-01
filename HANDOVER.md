# Handover — where the project stands

_Last updated: 2026-08-01_

## What this project is

Latent Tools: a local-first Electron desktop app for **bulk image-dataset
prep** — watermark removal (AI detection + inpainting), format conversion
(JPEG/PNG/WEBP), and uncensored image captioning. Bulk
(folder) processing is first-class, not an afterthought; it exists as much
to prepare training datasets (e.g. LoRA) as for one-off cleanup.

Full spec: [`docs/implementation-plan.md`](docs/implementation-plan.md) —
architecture, component breakdown, IPC/HTTP contract, error handling, UI/UX
flow, testing strategy, and 6 phased milestones.

## Where we are: All 6 Phases Complete & Standalone Release Ready

**Phase 1** ("sidecar + single-image round trip, one format") is complete.  
**Phase 2** ("multi-format conversion") is complete.  
**Phase 3** ("captioning") is complete.  
**Phase 4** ("manual mask adjustment UI") is complete.  
**Phase 5** ("bulk / batch dataset processing") is complete.  
**Phase 6** ("polish, telemetry, user experience & edge-case robustness") is complete — Deep Neon visual theme, standalone `.exe` release packaging, loopback firewall isolation, UI scale zoom, and dark select popups.

## What's built right now

- **Sidecar** (`sidecar/`, FastAPI): `/health`, `/gpu` (real-time GPU Name, VRAM usage & Temp telemetry), `/normalize`, `/detect` (Florence-2 open-vocabulary detection + adaptive Canny stroke contouring), `/inpaint` (IOPaint/LaMa), `/convert` (JPEG/PNG/WEBP export), `/caption` (Qwen2-VL-2B-Instruct / Qwen2-VL-7B-Instruct or a custom local model folder, selectable per-request via `model_id`, with custom system prompts & trigger words), `/shutdown`. Hardened Uvicorn engine to `127.0.0.1` loopback with `--port` CLI flag and `LATENT_SIDECAR_PORT` environment variable to prevent Windows Firewall prompts. PyInstaller support (`sidecar.exe`) for single-binary packaging.
- **Electron main** (`src/main/`): `SidecarClient`, `SidecarProcess`, `ipc-handlers.ts` (`image:import`/`detect`/`inpaint`/`caption`/`save`/`export`/`gpu:status`/`mask:update`/`folder:select`/`folder:list-images`/`bulk:process-item`/window controls), default window dimensions `1440x900` centered in windowed mode. Dynamic `app.isPackaged` sidecar path resolution (`process.resourcesPath/sidecar/sidecar.exe`). System tray icon (`assets/lt_icon.png`) with a Show/Quit context menu; `BrowserWindow` and packaged `.exe` both carry the same icon.
- **Renderer UI** (Deep Neon design system — pure black ground `#000000`, cyan `#66fcf1`, purple `#d870ff`, glass blurs, hover glow shadows):
  - **App shell**: frameless glass titlebar (window controls, `lt_icon.png` app logo, live GPU Sidecar status pill) + left sidebar (Single/Bulk nav, shared captioning model selector, GPU mini-widget with VRAM bar, ALK developer logo linked to GitHub profile).
  - **UI Zooming & Scaling**: `Ctrl` + mousewheel zooming (50%–250%) and `Ctrl+0` reset shortcut via `webFrame`. Default base text sizes increased by +2px across all components.
  - **Dark Dropdown Styling**: `color-scheme: dark` enforced across all `<select>` and `<option>` elements (Captioning Model, Export Presets, Formats, Compression Levels, Metadata settings).
  - **Single Image Editor**: pipeline stepper (Detect → Remove → Caption) above a preview/inspector grid. Full-featured canvas mask overlay with adaptive brush editing, undo/redo history, mousewheel zoom, and click & drag panning. Inspector Caption/Export tabs with presets (LoRA/Archive/Web + `localStorage`-backed custom presets).
  - **Bulk Dataset Processor**: single scrolling column card layout containing disclaimer banner, Setup (input/output dropzones + thumbnail grid), Export Settings, and Progress & Real-time Logs terminal.
- **Packaging & CI/CD**: `package.json` configured with `electron-builder` for Windows NSIS installer (`.exe`) and Portable standalone (`.exe`), both carrying `assets/lt_icon.png` as the `.exe` icon. GitHub Actions workflow ([`.github/workflows/build.yml`](.github/workflows/build.yml)) compiles the PyInstaller sidecar binary, runs Vitest & Pytest test suites, and publishes standalone release installers — it now triggers only on `v*` tag pushes, GitHub releases, or manual dispatch, **not** on every commit to `main`. First beta tags: `v0.1.0-beta.1`, `v0.1.0-beta.2`.

## TODO
- No open items on the bulk-pipeline speed track. Detect (0.3-0.5s) and caption
  (2.0-3.4s) now dominate the per-image cost — further gains would mean optimizing
  those model calls themselves (e.g. a smaller/faster caption model option), not
  the transport layer.

## Completed Improvements
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
