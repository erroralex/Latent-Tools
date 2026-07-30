# Handover — where the project stands

_Last updated: 2026-07-30_

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
- **Renderer UI**:
  - **Frameless Custom Titlebar**: Windows window controls, brand logo, and live GPU Sidecar status pill.
  - **Captioning Model Selector**: shared dropdown (visible in both views) for Qwen2-VL-2B-Instruct (recommended), Qwen2-VL-7B-Instruct, or a custom local model folder via file explorer.
  - **Single Image Editor**: Full-featured canvas mask overlay with adaptive brush editing (live brush-size cursor circle that scales with zoom) — the brush is paintable immediately after import, no AI detection required first, for fully manual/custom masking — plus undo/redo history, **mousewheel zoom (`0.5x`–`5.0x`)**, **click & drag panning**, system prompt & trigger word editor, generated dataset caption viewer, and export options.
  - **Bulk Dataset Processor**: Disclaimer banner noting batch watermark removal may miss some watermarks and recommending manual cleanup in Single Image Editor. Full-width stacked layout for Folder Configuration, Batch Processing Options (watermark removal, caption generation with custom trigger words, target format selection for PNG/JPEG/WEBP with quality/compression/flattening/metadata options), **live GPU Telemetry Box (with green/orange/red color-coded VRAM % and Temp °C)**, progress bar, and a scrollable real-time terminal log viewer.
- **IntelliJ tooling**: `.idea/runConfigurations/` has a `Sidecar` (Python) config, an `Electron App` (npm) config, and a `Latent Tools (Full Stack)` compound combining both.

## TODO
- **Speed and optimizations** Currently, it takes minutes per image to remove watermark and caption. We need to improve this while still keeping original image resolution intact
- **Logs** Logs should be better utilized in dev/intellij instead of using the just /health checks. Write out starting detetection/removing watermark etc.

## UI rework: implemented (on `ui-rework` branch, not yet merged)

The renderer visual rework described in
[`docs/ui-rework-implementation-plan.md`](docs/ui-rework-implementation-plan.md)
(Nocturne design system, source mockup `docs/Latent Tools.dc.html`) is
implemented: `src/renderer/styles/{tokens,components,app}.css` (new),
`src/renderer/index.html` and `renderer.ts` rewritten in place, and
`scripts/copy-renderer-html.js` updated to also copy `styles/` into
`dist/renderer`. Left sidebar app shell replaces the top tab bar; Single
editor inspector is now a Caption/Export tab pair; Bulk view is a
Setup/Export Settings/Progress & Logs 3-tab flow with a dataset thumbnail
grid and export presets (`localStorage`-backed custom presets). Scoped to
`src/renderer/` only, per plan — no IPC/main/sidecar changes; every id
`renderer.ts` used is preserved (cross-checked against the markup).

Two deliberate deviations from the plan text:
- **Fonts**: system font stack instead of vendoring Inter — avoids adding
  binary font assets and keeps the offline guarantee trivially true.
- **Dropzones** (`bulk-input-dropzone`/`bulk-output-dropzone`): drag-over
  visual highlight only. Resolving a dropped folder to an absolute path
  needs `webUtils.getPathForFile` bridged through the preload script,
  which conflicts with the plan's own "renderer-only, no preload changes"
  scope constraint — click-to-browse (existing `folder:select` IPC) is
  the only working path-selection method for now.

Verified: `npm run build` and `npm test` both pass; launched the app and
confirmed no renderer console errors (temporary `console-message`
forwarding, reverted after checking). Full manual visual QA (§7 point 6
of the plan) was not performed in this session — no way to screenshot the
Electron window without capturing the rest of the desktop, so do a visual
pass before merging.

## Verified technical facts worth not re-discovering

(These cost real GPU/network time to verify during Phase 1–6 development — see the plan doc's "Verified facts" section for full detail.)

- Plain `pip install torch` gives a **CPU-only** wheel on Windows even with a discrete GPU driver present. Use `pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128`.
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






