# Handover — where the project stands

_Last updated: 2026-07-31_

## What this project is

Latent Tools: a local-first Electron desktop app for **bulk image-dataset
prep** — watermark removal (AI detection + inpainting), format conversion
(JPEG/PNG/WEBP), and uncensored image captioning. Bulk
(folder) processing is first-class, not an afterthought; it exists as much
to prepare training datasets (e.g. LoRA) as for one-off cleanup.

Full spec: [`docs/implementation-plan.md`](docs/implementation-plan.md) —
architecture, component breakdown, IPC/HTTP contract, error handling, UI/UX
flow, testing strategy, and 6 phased milestones.

## Where we are: All 6 Phases Complete & Fully Polish-Verified

**Phase 1** ("sidecar + single-image round trip, one format") is complete.
**Phase 2** ("multi-format conversion") is complete.
**Phase 3** ("captioning") is complete.
**Phase 4** ("manual mask adjustment UI") is complete.
**Phase 5** ("bulk / batch dataset processing") is complete.
**Phase 6** ("polish, telemetry, user experience & edge-case robustness") is complete — added live GPU telemetry, mousewheel zoom & pan controls, custom system prompt & trigger word fields, adaptive text-stroke masking, full-width bulk dataset control cards, and 1:1 image resolution preservation.

## What's built right now

- **Sidecar** (`sidecar/`, FastAPI): `/health`, `/gpu` (real-time GPU Name, VRAM usage & Temp telemetry), `/normalize`, `/detect` (Florence-2 open-vocabulary detection + adaptive Canny stroke contouring), `/inpaint` (IOPaint/LaMa), `/convert` (JPEG/PNG/WEBP export), `/caption` (Qwen2-VL-2B-Instruct / Qwen2-VL-7B-Instruct or a custom local model folder, selectable per-request via `model_id`, with custom system prompts & trigger words), `/shutdown` (graceful termination, reachable regardless of who started the process).
- **Electron main** (`src/main/`): `SidecarClient`, `SidecarProcess`, `ipc-handlers.ts` (`image:import`/`detect`/`inpaint`/`caption`/`save`/`export`/`gpu:status`/`mask:update`/`folder:select`/`folder:list-images`/`bulk:process-item`/window controls), custom frameless window starting maximized by default. `SidecarProcess` skips spawning a duplicate sidecar if one is already reachable (e.g. started via the IntelliJ "Sidecar" run config), and on app quit calls the sidecar's `/shutdown` endpoint before exiting so no orphaned process (or stuck IntelliJ run config) is left behind.
- **Renderer UI** (Nocturne design system — dark ground, violet accent, `src/renderer/styles/{tokens,components,app}.css`):
  - **App shell**: frameless custom titlebar (window controls, brand logo, live GPU Sidecar status pill, disabled dark-only theme toggle stub) + left sidebar (Single/Bulk nav, shared captioning model selector, GPU mini-widget with VRAM bar).
  - **Captioning Model Selector**: Qwen2-VL-2B-Instruct (recommended), Qwen2-VL-7B-Instruct, or a custom local model folder via file explorer.
  - **Single Image Editor**: pipeline stepper (Detect → Remove → Caption) above a preview/inspector grid. Preview side has the full-featured canvas mask overlay with adaptive brush editing (live brush-size cursor circle that scales with zoom, paintable immediately after import with no AI detection required), undo/redo history, mousewheel zoom (`0.5x`–`5.0x`), and click & drag panning. Inspector is a Caption/Export tab pair — Caption has the system prompt & trigger word editor plus generated caption viewer; Export has format/quality/compression/metadata options and export presets (LoRA/Archive/Web, plus `localStorage`-backed custom presets).
  - **Bulk Dataset Processor**: disclaimer banner, then a Setup/Export Settings/Progress & Logs 3-tab flow. Setup has input/output folder drop-tiles (drag-over highlight; click-to-browse is the only working path-selection method — see below), watermark removal & captioning toggle switches, and a dataset thumbnail grid. Export Settings mirrors the Single editor's export options + presets. Progress & Logs has the progress bar, live GPU Telemetry (green/orange/red color-coded VRAM % and Temp °C), and a scrollable real-time terminal log viewer.
- **IntelliJ tooling**: `.idea/runConfigurations/` has a `Sidecar` (Python) config, an `Electron App` (npm) config, and a `Latent Tools (Full Stack)` compound combining both.

## TODO
- **Speed and optimizations.** Measured on an RTX 5080 (16 GiB) against
  `tests/images/`, a bulk run is **~8.6s per image** end-to-end (24 items in 207s),
  *not* the "minutes per image" this doc previously claimed — that figure came from
  runs where a second process was competing for VRAM (see the VRAM note below).
  After the cuDNN fix landed, the remaining per-image budget is roughly:
  - **Caption ~2.1s** — now the largest single stage. Untouched by the cuDNN fix
    (Qwen2-VL is matmul-heavy, not convolutional). Next target.
  - **normalize + convert ~1–2s** at 2560×3264 — six full-resolution PNG
    encode/decode + base64 hops per bulk item. A single `/process` endpoint for
    the bulk path (Single editor still needs the intermediate mask) would collapse
    these into one.
  - **Inpaint 0.1–4.8s**, already using IOPaint's crop strategy.
  - **Detect ~0.3s** — done, see below.

  Two things measured and rejected as *not* worth doing: deduplicating Florence-2's
  three `_encode_image` calls (~0.1s once cuDNN is healthy), and cutting detection's
  `max_new_tokens` 1024→64 (bit-identical boxes, but marginal now).

## Completed Improvements
- **Detection speed (Completed 2026-07-31)** — `/detect` went from **2.5–2.9s to
  0.27–0.36s per image (~9x)**, verified end-to-end over HTTP against the real
  sidecar, with bounding-box counts unchanged. Root cause was a one-line
  process-wide side effect of importing IOPaint; see the verified-facts note below.
  Fix and regression test in `sidecar/app/inpainting.py` / `tests/test_inpaint.py`.
- **Logs (Completed 2026-07-31)** Structured logging implemented in Python sidecar (`[Detect]`, `[Inpaint]`, `[Caption]`, `[Convert]`, `[Normalize]`) and stdout/stderr stream piping added to Electron `SidecarProcess`. Processing milestones and timing are now logged to Dev and IntelliJ run consoles.

## UI rework: shipped

The renderer visual rework described in
[`docs/ui-rework-implementation-plan.md`](docs/ui-rework-implementation-plan.md)
(Nocturne design system, source mockup `docs/Latent Tools.dc.html`) is
merged to `main`: `src/renderer/styles/{tokens,components,app}.css` (new),
`src/renderer/index.html` and `renderer.ts` rewritten in place, and
`scripts/copy-renderer-html.js` updated to also copy `styles/` into
`dist/renderer`. Left sidebar app shell replaces the top tab bar; Single
editor inspector is now a Caption/Export tab pair; Bulk view is a
Setup/Export Settings/Progress & Logs 3-tab flow with a dataset thumbnail
grid and export presets (`localStorage`-backed custom presets). Scoped to
`src/renderer/` only, per plan — no IPC/main/sidecar changes; every id
`renderer.ts` used is preserved (cross-checked against the markup).
Manually QA'd and confirmed working.

Two deliberate deviations from the plan text:
- **Fonts**: system font stack instead of vendoring Inter — avoids adding
  binary font assets and keeps the offline guarantee trivially true.
- **Dropzones** (`bulk-input-dropzone`/`bulk-output-dropzone`): drag-over
  visual highlight only. Resolving a dropped folder to an absolute path
  needs `webUtils.getPathForFile` bridged through the preload script,
  which conflicts with the plan's own "renderer-only, no preload changes"
  scope constraint — click-to-browse (existing `folder:select` IPC) is
  the only working path-selection method for now.

## Verified technical facts worth not re-discovering

(These cost real GPU/network time to verify during Phase 1–6 development — see the plan doc's "Verified facts" section for full detail.)

- Plain `pip install torch` gives a **CPU-only** wheel on Windows even with a discrete GPU driver present. Use `pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128`.
- **Importing `iopaint` makes Florence-2 detection ~10x slower.** Its `__init__.py`
  sets `TORCH_CUDNN_V8_API_LRU_CACHE_LIMIT=1` process-wide (to avoid a CPU memory
  leak in its own long-running jobs), which caps cuDNN's execution-plan cache at a
  single entry. Florence-2's vision encoder issues 156 convolutions across many
  shapes, so nearly every call re-runs cuDNN plan selection: **2.74s → 0.28s per
  image** when reverted. `sidecar/app/inpainting.py` restores the limit right after
  the iopaint import; PyTorch reads the variable lazily on first cuDNN use, so
  setting it there still takes effect. Captioning is unaffected (matmul/cuBLAS, not
  conv), and iopaint's other two env mitigations are deliberately left alone —
  restoring only the cuDNN one is sufficient. Guarded by
  `test_iopaint_cudnn_plan_cache_clamp_is_reverted`.
- **Two model-loading processes do not fit on a 16 GiB card.** The sidecar's three
  models total ~8 GiB resident; a second process with its own set drives the card to
  ~96% and the driver spills to host memory, at which point *everything* degrades
  catastrophically (captioning observed at 377s, detection at 64s) until one process
  exits. If the app appears to hang mid-run, check `nvidia-smi` for a second Python
  process before debugging anything else. Nothing in the app currently guards
  against this.
- Diagnosed and **rejected** as causes of pipeline slowness, so they need not be
  re-investigated: model co-residency in one process (no effect on a clean card),
  allocator fragmentation / `expandable_segments`, `torch.cuda.empty_cache()` policy
  (it works — VRAM settles at 8.05 GiB), the OpenCV mask-building step (0.002s),
  HTTP/serialization/payload size, anyio worker threads, which thread loads the
  model, an asyncio event loop on the main thread, and GPU power state (detection is
  0.29s at P3 and 0.288s at P1 — clocks are irrelevant here).
- Qwen2-VL model execution MUST be wrapped in `with torch.inference_mode():` and followed by `torch.cuda.empty_cache()` after inference to prevent VRAM memory accumulation across bulk dataset runs.
- Hugging Face `from_pretrained` automatically checks local `.cache/huggingface/hub/` model directories (`models--Qwen--Qwen2-VL-2B-Instruct` / `7B`) before connecting online, bypassing remote download hangs.
- Image resolution is 100% preserved 1:1 across normalization, Florence-2 detection, LaMa inpainting, format conversion, and Qwen2-VL dataset captioning.
- IOPaint's `ModelManager.__call__` docstring says the mask should be `[H, W, 1]` — **this is wrong**; it must be `[H, W]` (2D), or the call silently returns a corrupted 4D array instead of erroring.
- `iopaint` transitively pins `fastapi==0.108.0` and `pillow==9.5.0` exactly (via `gradio==4.21.0`), and needs `numpy<2.0`. `fastapi==0.108.0`'s `TestClient` further needs `httpx<0.28`. These are already correctly pinned in `sidecar/pyproject.toml` — don't loosen them without re-checking resolution.
- Florence-2's open-vocabulary detection (`task="<OPEN_VOCABULARY_DETECTION>"`, prompt = task + text like `"watermark"`) returns `parsed[task] == {"bboxes": [[x1,y1,x2,y2],...], "bboxes_labels": [...], "polygons": [], "polygons_labels": []}` with bboxes in absolute pixel coordinates.

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
npm start
```

Tests: `npm test` (TS) and, from `sidecar/`, `.venv/Scripts/python -m pytest tests/ -v` (Python).






