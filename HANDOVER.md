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

All six planned phases are complete. `docs/implementation-plan.md` holds the original full spec
(present on disk, but `docs/` is gitignored — see Open issues).

**Release history was reset.** Every GitHub release and tag from the original `v0.1.0-beta.1`
through `v1.1.4` (plus an `v1.1.5` tag that never got a release, blocked by the packaging fork
documented below) was deleted, and versioning restarted at `v1.0.0`. None of those releases ever
had a genuinely working GPU sidecar in the packaged app — three or four independent, stacked
packaging bugs, all documented below — and none had any real external downloads, so there was no
upgrade path to preserve. The sections below still reference those old version numbers
(`v1.1.2`, `v1.1.3`, etc.) as historical markers for *when a bug was found or fixed relative to
another*, since that sequence is still useful context — but none of those tags exist on GitHub
anymore. Don't go looking for them.

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
    stale ABI. Fixed by deleting those three DLLs from `dist/sidecar/_internal/` via
    `sidecar/scripts/remove-stale-crt-dlls.ps1`, run immediately after the PyInstaller build (both
    in `build.yml` and manually after any local build), so the loader falls through to the correct
    system copies (part of the Windows 10/11 Universal CRT, safe to assume present). **A local
    `pyinstaller --onedir --name sidecar run.py` without running this script afterward reproduces
    the crash every time** — it's not CI-only behavior, just easy to forget outside CI.
  - **Lesson for next time**: run the actual packaged `.exe` (not just `npm test`/pytest) before
    trusting a release. `nvidia-smi --query-compute-apps` showing no `sidecar.exe`/`python.exe`
    process after launching the app is the tell that the sidecar crashed rather than being merely
    slow to start.

### Every release through v1.1.3 also silently never ran the compiled sidecar at all

A third, independent bug from the two above, found after v1.1.3 shipped: `resolvePythonExecutable()`
in `src/main/index.ts` checked for the packaged binary at `resourcesPath/sidecar/sidecar.exe` and
`resourcesPath/sidecar/sidecar/sidecar.exe`. **Neither path is where PyInstaller's onedir build
lands.** `package.json`'s `extraResources` copies the whole `sidecar/` source tree verbatim
(`"from": "sidecar", "to": "sidecar"`), so the real binary sits at
`resourcesPath/sidecar/dist/sidecar/sidecar.exe`. Both checks always missed, so every packaged
release fell through to a bare `"python"` command resolved via `PATH` — on a machine with no Python
installed this is a `spawn ENOENT`; on a machine that happens to have a system Python (as the dev
machine does) it silently launches the wrong interpreter, missing every dependency, and exits
immediately with an import error.

Neither failure mode was visible: `SidecarProcess.start()` in `src/main/sidecar-process.ts` never
registered an `.on("error", ...)` listener on the spawned child, so a `spawn` failure either threw
an unobserved exception or was invisible entirely, and the health poll just ran out its budget
(~20s by default) before flipping the GPU indicator to "Error" — matching exactly what a user sees
on a stuck "GPU Sidecar: Connecting" pill with no crash dialog and no `sidecar.exe` process ever
appearing. This is why the v1.1.2 crash fix above didn't actually fix GPU support end-to-end: it
fixed the compiled binary so that it *would* run correctly once invoked, but the packaged app was
never invoking it.

Fixed by extracting path resolution into `src/main/sidecar-launch-target.ts` (a pure,
electron-free module, testable the same way `sidecar-client.ts`/`sidecar-process.ts` are) that
checks the correct `dist/sidecar/sidecar.exe` location, and by adding the missing child `"error"`
listener so a future spawn failure surfaces as an immediate `"error"` state instead of a silent
~20s timeout. Verified against a real rebuild (`npm run dist`): launching
`release/win-unpacked/Latent Tools.exe` now spawns `sidecar.exe` as an actual child process, and
`/health` and `/gpu` both respond correctly.

**This was never caught because "run the actual packaged `.exe`" (the lesson from the section
above) was followed by testing `dist/sidecar/sidecar.exe` directly rather than launching the
Electron app itself** — the compiled binary genuinely works when invoked directly, which is exactly
why this bug hid behind the DLL-crash fix for three releases.

### Every packaged release through v1.1.4 shipped a CPU-only torch — captioning and watermark removal never worked

A fourth, independent bug from the three above, found after v1.1.4 shipped (which fixed the sidecar
launch path but not this): the packaged sidecar's `torch` was a CPU-only build
(`torch.__version__ == '2.13.0+cpu'`, `torch.version.cuda is None`, no `torch_cuda.dll`/`cublas*`/
`cudnn*` anywhere in `_internal/`). Both `captioning.py` and `detection.py` hardcode `device="cuda"`,
so the model loads fine (`device_map="auto"` silently falls back to CPU) but fails the instant it
tries to move a tensor to a CUDA device that doesn't exist in this torch build:
`Torch not compiled with CUDA enabled`. Both `/caption` and `/detect` wrap this in a broad
`except Exception` that returns `None`/an empty result instead of surfacing the error, so the user
just sees "Captioning failed or refused" and a watermark mask that never appears — exactly the
symptom reported after v1.1.4.

**Root cause, confirmed empirically** (not just reasoned about — reproduced in a scratch venv):
`.github/workflows/build.yml` (and the documented local setup, same order) ran
`pip install -e .` **before** `pip install torch torchvision --index-url .../cu128`. `-e .` pulls
`torch` in transitively via `iopaint`/`transformers` — an unpinned requirement, so pip resolves it
to the latest PyPI wheel (a plain CPU build, e.g. `2.13.0`). The later cu128 install line is *not*
guaranteed to reinstall: `pip install torch` with no version pin checks whether the **currently
installed** version already satisfies the (unpinned) requirement and, if so, prints
"Requirement already satisfied" and does nothing — regardless of `--index-url`, and regardless of
variant. Whether this bites depends entirely on whether the version number PyPI's default index
resolves to (from `-e .`) happens to also exist at the cu128 index: it didn't in an isolated
`pip install torch` test (index only had up to `2.11.0`, forcing a version-mismatch reinstall down
to `2.11.0+cu128`), but it did with the *real* `sidecar/pyproject.toml` (`-e .` resolved to
`torch-2.13.0`/`torchvision-0.28.0`, both of which are also available at the cu128 index) —
reproduced exactly, "already satisfied" and all, in a clean scratch venv following the real install
sequence. This is why the dev machine's own long-lived venv was unaffected — it happened to have
cu128 torch installed before any `-e .` run in its history — while every *fresh* environment (every
CI runner, every clean clone) hit it on every single build.

**Fix:** swap the order — install cu128 torch first, then `-e .` (verified empirically: with cu128
torch already installed, `-e .`'s resolution of `iopaint`/`transformers`' unpinned `torch`
requirement is satisfied by the existing install and leaves it untouched). Also added a same-line
assertion in `build.yml` right after each `pip install` step
(`python -c "import torch; assert torch.version.cuda is not None, ..."`) so a regression fails the
build loudly instead of shipping silently — this can't check `torch.cuda.is_available()` since CI
runners have no physical GPU, but the installed wheel's build variant (`torch.version.cuda`) is
checkable regardless of hardware. `sidecar/tests/test_environment.py` carries the same assertion as
a permanent pytest regression guard, unmarked (not `gpu`) since it doesn't need real hardware —
just the correct package installed.

### The ~208MB "healthy" v1.1.1 baseline was never real — it never packaged torch at all

A prior investigation here spent four rebuild cycles chasing a "6x size regression" between
`v1.1.1` (~208MB, treated as the healthy baseline) and every build since (~1.2GB). That framing
was wrong, and the two symptoms were never separate: **`v1.1.1`'s `run.py` still had the
`uvicorn.run("app.main:app", ...)` string-import bug** (see the crash writeup above) — PyInstaller
never resolved the `app` package, and `app.main` is the only import path from the entry script to
`app.detection` / `app.inpainting` / `app.captioning`, i.e. to `torch`, `transformers`, `iopaint`,
`diffusers`, and the whole CUDA runtime. Confirmed directly: `grep -i torch` restricted to
`v1.1.1`'s `Build PyInstaller Standalone Sidecar` CI step returns zero matches (all mentions of
`torch`/`iopaint` in that run's log are from the earlier `pip install` step, not PyInstaller's
Analysis phase). Its ~5-second Analysis phase and ~208MB artifact were the correct measurement of
a build that packaged Python, uvicorn, and nothing else — the crash was going to happen (silently,
via `ModuleNotFoundError`) regardless of DLL bloat.

`v1.1.2` fixed `run.py` to import `app.main` directly, which was the *first* build where
PyInstaller ever walked the real dependency graph. ~170–210s to trace `torch`'s module tree and
run binary-dependency analysis over several hundred DLLs, landing around ~600MB per packaged
`.exe`, is unremarkable — that's what actually packaging torch + CUDA + iopaint costs. The
"decisive" control run (`32072694098`, plain CLI + `pyinstaller==6.22.1` pinned, same runner
image as `v1.1.1`) that seemed to disprove every fix attempt wasn't actually controlling for
the one thing that mattered: it ran post-`run.py`-fix, same as every other "bloated" build, while
`v1.1.1` is the only pre-fix data point. Every bloated run in the table below is post-fix; the one
healthy run is pre-fix and broken. One variable, perfect correlation, no non-determinism —
five runs, five internally-consistent results, not a random regression.

| Run (id) | `run.py` state | Result | Correct explanation |
|---|---|---|---|
| v1.1.1 tag build (`32064073840`) | string-import bug (pre-fix) | "Healthy", ~208MB, ~5s Analysis | Never packaged `app`/torch/iopaint at all — the crash bug prevented Analysis from ever reaching them |
| v1.1.2 tag build (`32067102667`) | fixed | ~1.23GB (installer+portable, ~616MB each) | First build to actually walk the real graph |
| v1.1.3 tag build (`32071440583`) and later validation runs | fixed | Same ~616MB per `.exe` regardless of `.spec`-vs-CLI or PyInstaller 6.22.1-vs-6.22.2 | Consistent — none of those variables ever mattered |

**What this means for the `pyinstaller==6.22.1` pin, the dropped `sidecar.spec`, and the
`TOC.remove()` fix**: none of those changes were wrong to make (the `.spec`-file and PyInstaller
6.22.2 avenues are still reasonable things to have ruled out in principle), but none of them were
*fixing* anything — the size was never a regression to fix, it's the real, correct cost of
packaging this dependency set. The `pyinstaller==6.22.1` pin can stay (harmless, keeps the build
reproducible) or be dropped; it was never load-bearing for size.

**~200MB is not a reachable target for this dependency set.** ~400–700MB compressed is realistic
if the following pruning is done — this is scoped, incremental work, not a bug hunt:

1. ~~Measure correctly first~~ **Done.** "~1.23GB total" was the *combined* NSIS installer +
   portable `.exe`, each ~616MB, not one bloated file — measure per-artifact, not combined.
2. ~~Stop installing dev extras in the packaging job~~ **Done.** `pytest`/`httpx` (the `[dev]`
   extra) are pure test tooling — neither is imported anywhere under `app/`. `build.yml` now
   installs plain `-e .` before the PyInstaller build and `-e ".[dev]"` afterward, right before the
   pytest step, so PyInstaller's Analysis phase never sees them. (This turned out to be a
   negligible size win in practice — `pytest`/`httpx` are tiny next to `torch` — but it's correct
   hygiene regardless: the packaging environment shouldn't contain packages the shipped app
   doesn't use.)
3. ~~`iopaint.model_manager` eagerly imports every model backend~~ **Investigated, turned out to be
   a dead end — don't repeat this.** A local (torch-2.11.0) onedir build was inspected directly:
   `gradio` is not collected at all (confirmed absent from `dist/sidecar/_internal/`), and
   `diffusers` contributes only an empty `.dist-info` metadata folder, no actual package code. The
   `from iopaint.model import ... SD, SDXL` import in `model_manager.py` does not appear to pull
   meaningful bundled weight in practice, whatever it does at the Python level. Nothing to cut here.
4. **The actual finding: it's almost entirely `torch/lib/`'s CUDA runtime DLLs, and that's the
   real remaining lever.** A clean local onedir build (contaminated leftover `~ib`/`~orchvision`
   temp directories from an earlier failed `pip --force-reinstall` were cleaned from the dev venv
   first — see the "local testing unreliable" note above, this was a second instance of the same
   class of problem) measured `torch/` at 4.0GB uncompressed, everything else combined under 400MB.
   Largest individual DLLs: `torch_cuda.dll` 774M, `cublasLt64_12.dll` 644M, four `cudnn_*.dll`
   files ~844M combined, `cusparse64_12.dll` 362M, `cufft64_11.dll` 264M, `torch_cpu.dll` 254M,
   `cusolver64_11.dll` + `cusolverMg64_11.dll` 366M, `cublas64_12.dll` 109M, `nvrtc64_120_0.dll` (+
   an `.alt.dll` twin) 166M combined, `curand64_10.dll` 69M, `nvperf_host.dll` 21M (profiling only,
   the safest single cut). `cusparse`/`cufft`/`cusolver`/`nvperf_host` together are a plausible
   ~1GB cut for a Florence-2 + LaMa + Qwen2-VL workload (no sparse ops, no FFT ops, no linear
   solvers, no profiling needed at runtime) — but `cuDNN` and `cuBLAS` must stay (convolution-heavy
   models), and `curand`/`nvrtc` are unclear (dropout kernels; `torch.compile`/dynamo respectively)
   without testing. **This needs real GPU inference testing per cut** (`--exclude-module` or a
   post-build `Remove-Item`, cut one DLL at a time, run the sidecar's `-m gpu` pytest marker plus
   an actual Detect/Inpaint/Caption pass against the packaged `.exe` after each) — a wrong cut is a
   lazy-load failure that only surfaces at inference time, not at import or startup time. Deferred
   as of this writing; picking it up needs someone at the keyboard with the GPU free to validate
   each cut, not something to batch blindly. **Superseded — not the active plan.** See "MSI/zip
   fixed the mmap crash but hit a second wall" further down: the sidecar isn't going to be bundled
   (pruned or not) at all going forward, it's downloaded on demand. This DLL breakdown stays here
   because the measurements are still accurate and useful background, not because pruning is still
   the plan.
5. **A pinned dependency lockfile** (`pip freeze` / `pip-compile`-style) is still worth doing for
   build reproducibility, independent of size — just not a size fix in itself.

### The initial sidecar-state broadcast races the renderer's IPC listener registration

A fifth, independent bug from the packaging ones above, found after the on-demand download
architecture shipped: every fresh packaged install got stuck showing the static HTML default
`"GPU Sidecar: Starting..."` forever, with no clickable download affordance and
`nvidia-smi`/`tasklist` showing no `sidecar.exe` — indistinguishable at a glance from the earlier
spawn-path bugs, but with a different cause.

`createWindow()` in `src/main/index.ts` called `void window.loadFile(...)` (fire-and-forget) and
then, in the same synchronous tick, called `broadcastSidecarState("not_installed")` (or
`startSidecar()`, which itself calls `setState("starting")` synchronously as its first line).
`window.webContents.send("sidecar:state", ...)` only reaches a listener once the renderer has
actually executed `window.api.onSidecarStateChange(callback)` — the preload script exposes the
*function*, but the `ipcRenderer.on("sidecar:state", ...)` registration inside it only runs when
the renderer's own page script calls it, which happens asynchronously relative to `loadFile`. On a
fresh install the `"not_installed"` broadcast is a **single** message with no follow-up, so losing
that race left the UI with no further updates, ever.

This was masked in local dev: `startSidecar()`'s *later* `"ready"` update (after the ~500ms health
poll) had time to land after the page had loaded, so dev testing looked fine. It only reproduces on
a genuinely fresh `userData` (no prior `sidecar-runtime` install) — reusing a dev machine's existing
`%APPDATA%\Latent Tools` masks it too, since `isSidecarRuntimeInstalled` short-circuits to
`startSidecar()`, which is slow enough to usually win the race by luck.

Fixed by awaiting `window.loadFile(...)` before sending any sidecar state, so the renderer's
listener is always registered first. Verified against a real `npm run dist` build launched with no
pre-existing `userData` directory: the status pill now correctly shows "Click to Download AI
Components" instead of hanging on "Starting...".

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
suites, and publishes the MSI installer plus a portable `.zip`. It is expensive and only
meaningful when cutting a release.

### Packaging architecture: On-demand sidecar download via Hugging Face Hub

Rather than bundling the multi-gigabyte PyInstaller CUDA payload (~4.5GB uncompressed) inside the installer (which previously hit 32-bit `makensis` mmap limits and GitHub Releases' 2GB per-asset upload cap), the packaged app ships as a lightweight installer and downloads the sidecar runtime on demand:

- **Thin Electron package:** `package.json` does not bundle `sidecar/` via `extraResources`. The MSI installer and portable `.zip` are lightweight packages (tens of MB).
- **On-demand download:** On first launch, the packaged app checks for a runtime at `app.getPath("userData")/sidecar-runtime/dist/sidecar/sidecar.exe`. If missing, the status pill shows "Click to Download AI Components".
- **Hugging Face Hub hosting:** When triggered by the user, the app streams `sidecar-cuda-win-x64-{version}.zip` from `https://huggingface.co/datasets/erroralex/latent-tools-sidecar/resolve/main/`, verifies its SHA256 against `sidecar-cuda-win-x64-{version}.zip.sha256`, and extracts it into `userData/sidecar-runtime/`. Once extracted, the main process launches `sidecar.exe` from `userData`.
- **CI automation & `HF_TOKEN`:** On tagged releases (`v*`), `.github/workflows/build.yml` compiles the PyInstaller standalone sidecar, compresses it, generates the `.sha256` checksum, and uploads both to `erroralex/latent-tools-sidecar` using the `HF_TOKEN` GitHub Actions secret. Note that the dataset repo must exist and the `HF_TOKEN` write secret must be configured in GitHub repo settings.
- **Local dev remains unchanged:** In unpackaged dev mode (`npm start`), `sidecar-launch-target.ts` resolves against the local source tree venv (`sidecar/.venv/Scripts/python.exe`), unaffected by `userData`.

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
- **On-demand sidecar download is implemented; tagged releases require the `HF_TOKEN` secret:**
  The packaged installer is now lightweight and downloads the compiled CUDA sidecar from Hugging Face Hub on first launch. For tagged release builds in CI to successfully upload `sidecar-cuda-win-x64-{version}.zip` and `.sha256`, the `erroralex/latent-tools-sidecar` dataset repo must exist on Hugging Face and a write token must be configured as `HF_TOKEN` in GitHub repository secrets.
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
# cu128 torch MUST come before -e ".[dev]" — see "Every packaged release
# through v1.1.4 shipped a CPU-only torch" below for why the reverse order
# silently ships a CPU build.
.venv/Scripts/python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
.venv/Scripts/python -m pip install -e ".[dev]"

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
| Standalone build | `npm run dist` (MSI installer + portable `.zip`) |

Before claiming a change works: run both suites and show the output.
