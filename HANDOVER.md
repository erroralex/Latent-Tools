# Handover — where the project stands

_Last updated: 2026-07-30_

## What this project is

Latent Tools: a local-first Electron desktop app for **bulk image-dataset
prep** — watermark removal (AI detection + inpainting), format conversion
(JPEG/PNG/WEBP), and NSFW/mature-content-tolerant image captioning. Bulk
(folder) processing is first-class, not an afterthought; it exists as much
to prepare training datasets (e.g. LoRA) as for one-off cleanup.

Full spec: [`docs/implementation-plan.md`](docs/implementation-plan.md) —
architecture, component breakdown, IPC/HTTP contract, error handling, UI/UX
flow, testing strategy, and 6 phased milestones.

## Where we are: Phase 1 done, manually verified, plus one add-on

**Phase 1** ("sidecar + single-image round trip, one format") is complete —
plan at
[`docs/superpowers/plans/2026-07-30-phase1-sidecar-round-trip.md`](docs/superpowers/plans/2026-07-30-phase1-sidecar-round-trip.md),
built via 8 subagent-driven tasks, each independently reviewed, plus a final
whole-branch review that caught and fixed 3 cross-file bugs no single task's
review could see (renderer module-format crash, missing `dist/renderer/index.html`,
`Uint8Array`/`Buffer` corruption at the IPC boundary). Merged to `main`.

**Manually verified working on real hardware** (RTX 5080) after merge:
`npm start` → drag in a real watermarked PNG → Detect → Remove watermark →
the result visibly had the watermark removed, LaMa ran the crop strategy,
no artifacts. One post-merge bug found and fixed during that manual pass:
the sidecar was being spawned via bare `"python"` on PATH (which has none of
the sidecar's dependencies) instead of `sidecar/.venv`'s interpreter —
fixed in `src/main/index.ts`'s `resolvePythonExecutable()`.

**One small add-on since then**: a Save button (`image:save` IPC channel +
native save dialog) — before this, results only ever existed as a `data:`
URL in the preview `<img>`, no way to get them onto disk.

## What's built right now

- **Sidecar** (`sidecar/`, FastAPI): `/health`, `/detect` (Florence-2
  open-vocabulary detection, prompted with "watermark"), `/inpaint`
  (IOPaint/LaMa). Protocol + dependency-injection pattern throughout
  (`detection.py`, `inpainting.py`) — fake-backed tests run without a GPU;
  real-model tests are `@pytest.mark.gpu`-marked and excluded by default.
- **Electron main** (`src/main/`): `SidecarClient` (HTTP wrapper),
  `SidecarProcess` (spawn/health-poll/shutdown state machine),
  `ipc-handlers.ts` (`image:import`/`detect`/`inpaint`/`save`), wired in
  `index.ts`.
- **Renderer**: minimal vanilla HTML/TS — file input, Detect button, Remove
  watermark button, Save button. No mask visualization, no multi-image/batch,
  no format options yet (all later phases).
- **IntelliJ tooling**: `.idea/runConfigurations/` has a `Sidecar` (Python)
  config, an `Electron App` (npm) config, and a `Latent Tools (Full Stack)`
  compound combining both. **Caveat:** `Electron App` already spawns its own
  sidecar internally, so running the compound launches a second sidecar
  process too — it fails to bind the port and exits, but the health check
  still passes against the first instance. Works, isn't clean. The `Sidecar`
  config needs a Python SDK registered pointing at `sidecar/.venv/Scripts/python.exe`
  (Settings → Project Structure → SDKs → Add Python SDK from disk) before
  IntelliJ will accept it — this is a one-time per-machine step, not
  committed anywhere (`.idea/` is gitignored in this repo).

## Known gaps (not bugs — deliberately out of Phase 1's scope)

- **Only one watermark detected/removed per image** — untested against an
  image with multiple watermarks. Florence-2's `<OPEN_VOCABULARY_DETECTION>`
  *can* return multiple boxes; whether it actually does for repeated
  instances of the same "watermark" prompt hasn't been checked yet.
- **No visual mask overlay** — the renderer computes a mask but never shows
  it to the user. That's Phase 4 ("Manual mask adjustment UI").
- **No format/quality export options** — Save always writes whatever the
  sidecar returns (PNG). Format conversion (JPEG/PNG/WEBP, quality, metadata
  handling) is Phase 2.
- **No captioning yet** (Phase 3) and **no bulk/batch mode yet** (Phase 5).

## Verified technical facts worth not re-discovering

(These cost real GPU/network time to verify during Phase 1 planning — see
the plan doc's "Verified facts" section for full detail.)

- Plain `pip install torch` gives a **CPU-only** wheel on this machine even
  with the RTX 5080 driver present. Use
  `pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128`.
- IOPaint's `ModelManager.__call__` docstring says the mask should be
  `[H, W, 1]` — **this is wrong**; it must be `[H, W]` (2D), or the call
  silently returns a corrupted 4D array instead of erroring.
- `iopaint` transitively pins `fastapi==0.108.0` and `pillow==9.5.0` exactly
  (via `gradio==4.21.0`), and needs `numpy<2.0`. `fastapi==0.108.0`'s
  `TestClient` further needs `httpx<0.28`. These are already correctly
  pinned in `sidecar/pyproject.toml` — don't loosen them without re-checking
  resolution.
- Florence-2's open-vocabulary detection (`task="<OPEN_VOCABULARY_DETECTION>"`,
  prompt = task + text like `"watermark"`) returns
  `parsed[task] == {"bboxes": [[x1,y1,x2,y2],...], "bboxes_labels": [...], "polygons": [], "polygons_labels": []}`
  with bboxes in absolute pixel coordinates.

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

## Suggested next step

Per the plan's phase order: **Phase 2 (multi-format conversion)** is next,
or address one of the known gaps above first (multi-watermark detection is
probably worth a quick investigation before building more UI on top of
detection). Ask before assuming which — this hasn't been decided yet.
