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
- **Every standalone release through v1.1.1 shipped a sidecar that crashes on startup.** Nobody had
  actually run the packaged `.exe` and checked the GPU status since v1.0.0 first shipped — CI only
  ran the unpackaged pytest suite, which never exercises the frozen binary. Two independent bugs,
  fixed together in v1.1.2:
  - `run.py` called `uvicorn.run("app.main:app", ...)` — the `"module:attr"` string form. PyInstaller's
    static analysis can't see an import inside a string, so it silently dropped the `app` package
    from the bundle and the packaged sidecar crashed instantly with
    `ModuleNotFoundError: No module named 'app'`. Fixed by importing `app.main` directly and passing
    the app object to `uvicorn.run()` — safe since nothing here uses `--reload`, which is the only
    reason the string form exists.
  - Even past that, the packaged sidecar crashed with `OSError: [WinError 1114] ... c10.dll`. The
    real error (only visible via Windows Event Viewer — `Get-WinEvent -FilterHashtable
    @{LogName='Application'; Id=1000}` — the Python traceback just reports the symptom) was an
    access violation *inside* `msvcp140.dll`: PyInstaller auto-collects its own copy of
    `msvcp140.dll`/`vcruntime140.dll`/`vcruntime140_1.dll` into `_internal/`, and the onedir
    bootloader searches `_internal/` before `System32`. The bundled copy (v14.31.31103.0 on the dev
    machine) is far older than the real system one (`C:\Windows\System32\msvcp140.dll`,
    v14.51.36247.0), and torch's `c10.dll` — built against a newer CRT — crashes calling into the
    stale ABI. Fixed by deleting those three DLLs from `dist/sidecar/_internal/` in a `build.yml`
    step immediately after the PyInstaller build, so the loader falls through to the correct system
    copies (part of the Windows 10/11 Universal CRT, safe to assume present).
  - **Two independent, unrelated causes turned out to inflate the onedir bundle ~6x (~200MB ->
    ~1.2GB), both discovered the hard way across v1.1.2 and v1.1.3:**
    1. **Don't filter `a.binaries` via a checked-in `.spec` file — invoke PyInstaller via the plain
       CLI form and post-process `dist/` instead.** A `sidecar.spec` that filtered the same three
       DLLs out of `Analysis().binaries` excludes them correctly, but invoking PyInstaller via
       `pyinstaller sidecar.spec` instead of `pyinstaller --onedir --name sidecar run.py` made its
       Analysis phase collect roughly 6x more data, holding the PyInstaller version constant
       (confirmed: same `pyinstaller==6.22.1`, CLI healthy at ~208MB total, spec bloated to
       ~1.23GB, byte-identical pip dependency resolutions otherwise). Root cause not identified;
       not worth chasing further since it's avoidable. `sidecar.spec` was deleted; DLL removal now
       happens via a plain `Remove-Item` step in `build.yml` after a CLI-invoked build.
    2. **PyInstaller 6.22.2 regresses independently of the above.** After switching back to the
       CLI form, v1.1.3 was *still* ~1.2GB — an unpinned `pip install pyinstaller` had picked up
       6.22.2 (released between the v1.1.2 and v1.1.3 builds) instead of the 6.22.1 every healthy
       build had used. Holding the CLI invocation constant and only varying the PyInstaller
       version reproduced the same ~6x bloat. `build.yml` now pins `pyinstaller==6.22.1`
       explicitly. Re-evaluate this pin (and re-measure onedir size before trusting a new version)
       next time PyInstaller ships a release.
    Lesson: with no dependency in this pipeline pinned beyond `>=`, an ordinary `pip install`
    silently drifting to a newer package version is a live risk for this project, not a one-off —
    check `Successfully installed` lines in CI logs when a build's behavior changes unexpectedly
    with no corresponding code change.
  - **Lesson for next time**: run the actual packaged `.exe` (not just `npm test`/pytest) before
    trusting a release. `nvidia-smi --query-compute-apps` showing no `sidecar.exe`/`python.exe`
    process after launching the app is the tell that the sidecar crashed rather than being merely
    slow to start.

### The app icon exists in two separate locations

`lt_icon.png` and `latent-mark.svg` are duplicated at repo root (`assets/`) and again under
`src/renderer/assets/`. electron-builder's `win.icon` (`package.json`) reads the **root** copy;
`getAppIconPath()` in `src/main/index.ts` (BrowserWindow/Tray icon) and the renderer's favicon and
titlebar `<img>` all resolve to the **`src/renderer/assets/`** copy instead. A brand-mark update
that only touches one location ships an installer icon and an in-app mark that disagree.

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
- **Four of the five coherency-check items from `docs/Latent Suite coherency check.md`
  are fixed** (titlebar now uses the vendored `latent-mark.svg` instead of an inlined
  copy, the redundant Google Fonts `<link>` is gone, `--sidebar-width` is `224px`, and
  `appId` is `com.nilsson.latent.tools`). **Still open:** there is no `lint` script in
  `package.json` at all, so the Design System's `_adherence.oxlintrc.json` can't be
  wired into the build yet — that's a precondition gap, not just an unwired config.
  Renaming `appId` is a breaking change for existing installs: electron-builder/NSIS
  key the uninstall registry entry off `appId`, so a `v1.0.0` user upgrading in place
  via the new installer may end up with two Start Menu/uninstall entries instead of
  one being replaced. Worth a release note when this ships.
- **The GPU tests have no CI coverage by design.** CI runs on a CPU-only Windows runner, so
  `test_real_models.py` never executes anywhere automatic. Real-model regressions can only be
  caught by running `-m gpu` locally before a release.
- **`package-lock.json` had drifted out of sync with `package.json`** (missing the `lucide`
  entry since it was added), which failed `npm ci` in CI on the first `v1.1.0` tag push. Fixed by
  regenerating the lock file and force-moving the `v1.1.0` tag onto the fix commit — no release
  had been published from the failed run, so nothing was lost. If `npm ci` ever fails in CI with a
  "not in sync" error again, this is the same class of bug: someone ran `npm install <pkg>`
  without committing the resulting `package-lock.json` change.
- **v1.0.0 shipped as `v1.0.0` in `package.json` but the GitHub tag actually predates the Latent
  Design System redesign** — the tag sits on the pre-redesign commit, and the entire LDS
  migration, the Settings modal, the security/memory fixes, and the coherency fixes all landed
  *after* that tag, unreleased, until `v1.1.0`. If you're diffing "what changed since v1.0.0",
  that's a much bigger diff than the version number implies.
- **GitHub's repo homepage lists "claude" as a second contributor.** This is not an AI-attributed
  commit — verified exhaustively (`git log --all`, GitHub's commits/PRs/reviews/stats APIs) that
  every one of the repo's 127 commits is authored by Alexander Nilsson only, so the git history is
  clean per this file's own no-AI-attribution rule. The listing traces to the **"Claude Design
  Import" GitHub App** (published by `anthropics`) being installed with access to this repo
  (visible under the account's Settings → Installed GitHub Apps, alongside a Cursor app) — an
  installed app with write access can surface in that widget independent of actual commit
  authorship. Not a bug to fix in code; remove the app's repo access there if it's unwanted.

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
