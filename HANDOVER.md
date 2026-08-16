# Handover — Latent Tools

Current state of the project, the traps that will bite you, and what is still open.

**This document is not a changelog.** Per-change narrative lives in git history (`git log`) and in
`RELEASENOTE.md`. What belongs here is only what a newcomer cannot derive from reading the code:
non-obvious constraints, hard-won measurements, and open work.

---

## What this is

A local-first Electron desktop app for **bulk image-dataset prep**: watermark removal (AI detection
plus inpainting), format conversion (JPEG/PNG/WEBP), and uncensored captioning. Everything runs
on-device. Bulk folder processing is first-class, not an afterthought — the app exists as much to
prepare LoRA training datasets as for one-off cleanup.

All six planned phases are complete and `v1.0.0` shipped as a standalone Windows release.
`docs/implementation-plan.md` holds the original full spec (present on disk, but `docs/` is
gitignored — see Open issues).

### Two processes, one localhost hop

| Piece | Stack | Location |
|---|---|---|
| Electron main | TypeScript (strict), Electron 33 | `src/main/` |
| Preload bridge | TypeScript, `contextIsolation` on | `src/preload/` |
| Renderer | **Plain TypeScript, no bundler, no framework** | `src/renderer/` |
| Sidecar | Python, FastAPI + Uvicorn | `sidecar/` |

The Electron main process spawns the Python sidecar and talks to it over loopback HTTP. The
renderer never talks to the sidecar directly — everything goes through IPC to main, which owns
`SidecarClient` and `SidecarProcess`.

Target hardware is a discrete NVIDIA GPU. There is no CPU fallback path for the models.

### Sidecar API

`GET /health`, `/gpu` (live GPU name, VRAM, temperature) · `POST /normalize`, `/detect`
(Florence-2 open-vocabulary + adaptive Canny contouring), `/inpaint` (IOPaint/LaMa), `/caption`
(Qwen2-VL 2B/7B or a local model folder, selectable per request), `/convert`, `/process`,
`/shutdown`.

**`/process` is the bulk path**: it runs normalize → detect → inpaint → caption → convert against
one in-memory `PIL.Image` and returns the final bytes in a single call. The single-image editor
deliberately still makes separate calls, because the interactive mask-editing UI needs the
intermediate results. Do not "unify" them.

### Repository map

- `src/main/` — `index.ts` (window, tray), `ipc-handlers.ts` (the full IPC surface),
  `sidecar-client.ts`, `sidecar-process.ts`.
- `src/renderer/` — `index.html`, `renderer.ts`, `styles/` (Latent Design System tokens under
  `styles/latent/`). Assets live in `src/renderer/assets/`.
- `sidecar/app/` — `main.py` (routes), `detection.py`, `inpainting.py`, `captioning.py`,
  `schemas.py`, `logger.py`.
- `scripts/copy-renderer-html.js` — the non-TypeScript half of the build; see below.
- `tests/` — Vitest (Electron/TS). `sidecar/tests/` — pytest.

---

## Invariants and traps

### The renderer has no bundler

`renderer.ts` compiles with plain `tsc` to **CommonJS** and is loaded by a bare `<script>` tag
under Electron's default `contextIsolation`. There is no Vite, no webpack, no module resolution at
runtime. Consequences:

- **You cannot `import` or `require` an npm package from renderer code.** It will typecheck, emit a
  `require()` call, and throw at runtime in the browser context.
- Third-party browser libraries must ship a prebuilt UMD/IIFE bundle, be copied into
  `dist/renderer/`, and be loaded by their own `<script>` tag before `renderer.js`. That is exactly
  how `lucide` works here: `scripts/copy-renderer-html.js` copies
  `node_modules/lucide/dist/umd/lucide.min.js` into `dist/renderer/`, the HTML loads it, and
  `renderer.ts` calls `lucide.createIcons(...)` against the `window.lucide` global declared in
  `src/renderer/window.d.ts`. Icons are `<i data-lucide="name">` placeholders.
- `npm run build` is therefore **two steps**: `tsc` plus `node scripts/copy-renderer-html.js`.
  Running `tsc` alone produces a renderer with no HTML, no CSS, no assets and no icons.

**Trap in that copy script**: the Lucide copy is guarded by `if (fs.existsSync(...))`. If the
package is missing from `node_modules`, the build succeeds silently and ships a renderer where
every icon is an empty `<i>`. If icons vanish, check that file before suspecting the markup.

### GPU and model constraints

These are measured facts, not guesses:

- **Plain `pip install torch` gives a CPU-only wheel on Windows**, even with a discrete GPU and
  current drivers. You must use
  `pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128`.
- **Importing `iopaint` makes Florence-2 detection ~10x slower** as a process-wide side effect,
  unless `TORCH_CUDNN_V8_API_LRU_CACHE_LIMIT` is restored immediately after the import in
  `sidecar/app/inpainting.py`. Fixing this took `/detect` from **2.9s to 0.47s**.
- **Two model-loading processes do not fit on a 16 GiB card.** Spilling to host memory costs
  10–100x. Check `nvidia-smi` before debugging any slowdown.
- **Qwen2-VL execution must be wrapped in `with torch.inference_mode():`** and followed by
  `torch.cuda.empty_cache()`. Florence-2 detection is likewise wrapped in `torch.inference_mode()`.
- **Image resolution is preserved 1:1** through normalize → detect → inpaint → convert → caption.
  If output dimensions change, that is a bug, not a design tradeoff.

### Do not eagerly resolve models in `/process`

`/process` must resolve the detector and inpainter **lazily, inside the
`if body.auto_remove_watermark:` branch** — not as FastAPI `Depends(...)` parameters. Taking them
as dependencies constructs the real Florence-2 and LaMa models on *every* call, including
convert-only ones. That passes on a GPU dev machine and fails on CI's CPU-only Windows runner with
`AssertionError: Torch not compiled with CUDA enabled`. The captioner already used lazy
resolution; the others now match it.

### Sidecar process and packaging

- **Uvicorn must bind `127.0.0.1` explicitly.** Binding `0.0.0.0` triggers a Windows Firewall
  prompt on end-user machines. The port is configurable via `--port` and `LATENT_SIDECAR_PORT`.
- **Packaged Electron loads the sidecar from `process.resourcesPath/sidecar`, not from inside
  `app.asar`.** Binaries cannot execute from the asar archive, so path resolution branches on
  `app.isPackaged`.
- **A stale icon in Windows Explorer or the Start Menu is not a packaging bug.** The shell icon
  cache holds the old icon after a rebuild even when the exe's resource is correct. Do not chase it.

### Renderer UI gotchas

- **`display: none` kills pointer events.** The mask overlay canvas owns every brush
  `pointerdown`/`pointermove`/`pointerup` listener, so hiding it after an inpaint made the brush
  silently no-op until the next Detect. Clear the mask instead of hiding the canvas — the overlay
  goes visually empty but stays interactive.
- **Hide the empty-state dropzone in the image's `load` handler**, not when `importImage()`
  resolves. Doing it on resolve let the dropzone and a still-loading `<img>` render on top of each
  other. `#preview` defaults to `display: none` in CSS and is revealed in the same `load` handler.

### Tests

- **Vitest** (repo root, `npm test`): 30 tests across 4 files, covering the IPC handlers, the
  sidecar client and the sidecar process.
- **pytest** (`sidecar/`): 25 tests run by default. **Two GPU tests are deselected automatically** —
  `pyproject.toml` sets `addopts = "-m 'not gpu'"` and `tests/test_real_models.py` carries
  `@pytest.mark.gpu`. Run them deliberately with `-m gpu` when you have the card free; they load
  real Florence-2 and LaMa weights.

So "all tests pass" out of the box means 55 tests, with 2 real-model tests never having run.

### Release builds only fire on tags

`.github/workflows/build.yml` triggers on `v*` tag pushes, GitHub releases, or manual dispatch —
not on every push to `main`. The pipeline compiles the PyInstaller sidecar binary, runs both test
suites, and publishes the NSIS installer plus the portable `.exe`. It is expensive and only
meaningful when cutting a release.

---

## Performance baseline

Measured on an RTX 5080 with warm model state, so treat these as the reference numbers:

- `/detect`: **0.47s** average (was 2.9s before the `iopaint` import fix).
- Bulk pipeline: **3.32s/image** (25 warm items in 83s), down from 6.0s/image before `/process`
  collapsed five HTTP round-trips into one — a 45% reduction.

Detect (0.3–0.5s) and caption (2.0–3.4s) now dominate per-image cost. **There is no remaining
transport-layer win**; further gains mean optimising the model calls themselves, for example
offering a smaller/faster caption model. Do not spend time on the IPC or HTTP layer looking for
speed.

---

## Open issues

- **`docs/`, `.agents/`, and `.claude/` (except `settings.json`) are gitignored and untracked.**
  `docs/implementation-plan.md` and the `.agents/skills/*` files still exist on disk and are still
  the current reference material — they're just no longer version-controlled, so a fresh clone
  won't have them. `.claude/settings.json` (the permission deny-list for `.env`/`secrets/**`)
  stays tracked deliberately. The three superseded design-direction plans
  (`deep-neon-implementation-plan.md`, `modernized-neon-implementation-plan.md`,
  `ui-rework-implementation-plan.md`) and the `Latent Tools.dc.html` artifact that used to clutter
  `docs/` have been deleted outright, not just untracked.
- **Coherency-check items from `docs/Latent Suite coherency check.md` are still open**, per the
  most recent internal review (`docs/code-review-2026-08-16.md`, itself untracked): the titlebar
  logo in `src/renderer/index.html` is still a hand-inlined gradient SVG instead of the vendored
  `latent-mark.svg`; the Google Fonts `<link>` in `index.html` still double-loads fonts already
  pulled by `tokens/fonts.css` and requests the wrong JetBrains Mono weight range; the sidebar
  width token is `222px` against the Latent Design System's `224px`; `package.json`'s `appId` is
  `com.latenttools.app` rather than the suite-wide `com.nilsson.latent.*` convention; and there is
  no `lint` script in `package.json` at all, so the Design System's `_adherence.oxlintrc.json`
  can't be wired in yet. None of these are functional bugs — they're suite-consistency debt.
- **The GPU tests have no CI coverage by design.** CI runs on a CPU-only Windows runner, so
  `test_real_models.py` never executes anywhere automatic. Real-model regressions can only be
  caught by running `-m gpu` locally before a release.

---

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
```

| Task | Command |
|---|---|
| Build | `npm run build` (root) — `tsc` **and** the renderer copy step |
| Electron tests | `npm test` |
| Sidecar tests | `cd sidecar && .venv/Scripts/python -m pytest tests/ -v` |
| Sidecar GPU tests | `cd sidecar && .venv/Scripts/python -m pytest tests/ -v -m gpu` |
| Standalone build | `npm run dist` (NSIS installer + portable `.exe`) |

Before claiming a change works: run both suites and show the output.
