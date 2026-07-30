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

## Where we are: All 6 Phases Complete

**Phase 1** ("sidecar + single-image round trip, one format") is complete.
**Phase 2** ("multi-format conversion") is complete.
**Phase 3** ("captioning") is complete.
**Phase 4** ("manual mask adjustment UI") is complete.
**Phase 5** ("bulk / batch dataset processing") is complete.
**Phase 6** ("polish, packaging, edge-case robustness, install docs") is complete — added sidecar health status pill in titlebar, IPC error boundaries, comprehensive `README.md`, and test suite verification.

## What's built right now

- **Sidecar** (`sidecar/`, FastAPI): `/health`, `/normalize`, `/detect` (Florence-2), `/inpaint` (IOPaint/LaMa), `/convert` (JPEG/PNG/WEBP export), `/caption` (Qwen2-VL-7B-Instruct).
- **Electron main** (`src/main/`): `SidecarClient`, `SidecarProcess`, `ipc-handlers.ts` (`image:import`/`detect`/`inpaint`/`caption`/`save`/`export`/`mask:update`/`folder:select`/`folder:list-images`/`bulk:process-item`/window controls), custom frameless window starting maximized by default.
- **Renderer**: modern HTML/TS UI with custom drag titlebar, live GPU sidecar health status pill, Single Image Editor view, Bulk Dataset Processor view, interactive canvas mask overlay with brush editing & undo/redo, watermark detection/inpainting, caption generation & editing, and Export Settings panel.
- **IntelliJ tooling**: `.idea/runConfigurations/` has a `Sidecar` (Python) config, an `Electron App` (npm) config, and a `Latent Tools (Full Stack)` compound combining both.

## Verified technical facts worth not re-discovering

(These cost real GPU/network time to verify during Phase 1 planning — see the plan doc's "Verified facts" section for full detail.)

- Plain `pip install torch` gives a **CPU-only** wheel on this machine even with a discrete GPU driver present. Use `pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128`.

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





