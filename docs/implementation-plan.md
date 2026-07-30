# Watermark Removal Desktop App — Implementation Plan

## Product summary

A local-first Electron desktop app for bulk dataset prep on images: watermark
removal (AI detection + inpainting), format conversion, and NSFW/mature-content-
tolerant image captioning, running entirely on-device (target hardware: RTX
5080, 9800X3D). No cloud calls, no telemetry by default, no size limits, no
signup. Bulk (folder-of-images) processing is a first-class mode, not an
afterthought — this exists to prepare image datasets (e.g. for LoRA/model
training) as much as it does one-off single-image cleanup.

## Architecture overview

Three processes, one machine:

```
┌─────────────────────────┐      IPC      ┌──────────────────────────┐      localhost HTTP      ┌───────────────────────────────┐
│  Renderer (UI)           │ <───────────> │  Main process             │ <──────────────────────> │  Python sidecar                │
│  drag/drop (file or       │               │  spawns/manages sidecar,  │                           │  detection + inpainting (IOPaint)│
│  folder), preview, mask   │               │  health checks, lifecycle,│                           │  + captioning (Qwen2-VL)        │
│  adjustment, export,      │               │  bulk job orchestration   │                           │  models on GPU                  │
│  bulk queue view          │               │                          │                           │                                 │
└─────────────────────────┘               └──────────────────────────┘                           └───────────────────────────────┘
```

- **Renderer**: UI, drag-and-drop image *or folder* input, preview, manual
  mask-adjustment fallback for missed detections (single-image mode only —
  see Bulk processing), bulk queue/progress view.
- **Main process**: spawns and manages the Python sidecar's lifecycle (start on
  launch or first use, health-check before sending requests, clean shutdown on
  quit). Owns all sidecar HTTP calls — the renderer never talks to the sidecar
  directly, only to the main process via IPC. Orchestrates bulk jobs: iterates
  a folder's images, drives each through detect → inpaint → caption → convert,
  and tracks per-item status.
- **Python sidecar**: bundled local HTTP server exposing detection, inpainting,
  captioning, and format-conversion endpoints.
  - Watermark detection/mask generation: Florence-2 (or a fine-tuned YOLO).
  - Inpainting: IOPaint (LaMa or another IOPaint-supported model).
  - Captioning: Qwen2-VL-7B-Instruct with a system prompt permitting factual
    description of NSFW/mature content (mainstream captioning models often
    refuse or sanitize this) — see Captioning below.
  - Runs on the RTX 5080.

This plan assumes the architecture above is fixed and does not re-litigate it.
It is framework-agnostic on renderer UI choice (no specific component
framework assumed) except where Electron itself dictates structure.

## Component breakdown

### Renderer

Responsibilities:
- Accept image input via drag-and-drop and file picker: a single image
  (JPEG, JPG, PNG, WEBP) for single-image mode, or a folder for bulk mode.
- Render the working preview and the detected/adjustable mask overlay
  (single-image mode).
- Provide manual mask-adjustment tools (brush add/remove) for missed or
  over-detected regions, used as a fallback before inpainting — **single-image
  mode only**; bulk mode runs fully automatic with no per-item pause (see
  Bulk processing).
- Surface sidecar/app state (loading, detecting, awaiting adjustment,
  inpainting, done, error) — see UI/UX flow.
- Surface a bulk queue view: per-item status (pending/processing/done/error),
  overall progress, and a way to retry just the failed items.
- Expose export options: output format (JPEG/PNG/WEBP), quality/compression
  setting, metadata handling choice — applies to both modes.
- Never touches the filesystem or the sidecar directly — all of that is
  requested through IPC and fulfilled by the main process, which returns
  results (buffers, file paths, or object URLs) back to the renderer.

### Main process

Responsibilities:
- Spawn the Python sidecar process (or frozen binary) on app launch or lazily
  on first use — see Sidecar lifecycle management for the tradeoff.
- Perform health checks before forwarding any request to the sidecar.
- Own the HTTP client to the sidecar; translate renderer IPC calls into
  sidecar HTTP calls and back.
- Manage file I/O: reading dropped/selected files and folders, writing
  exported output (and caption `.txt` sidecar files), temp file cleanup.
- Orchestrate bulk jobs: enumerate a folder's images, run each through
  detect → inpaint → caption → convert sequentially (GPU work doesn't
  parallelize usefully across one card), update per-item status, and
  continue past a single item's failure rather than aborting the batch.
- Handle crash detection and restart of the sidecar; surface sidecar state
  changes to the renderer over IPC.
- Clean sidecar shutdown on app quit (including forced-quit paths).

### Python sidecar

Responsibilities:
- Expose a local-only HTTP server (bind to `127.0.0.1`, not `0.0.0.0`) with
  endpoints for: health check, detection (image → mask), inpainting
  (image + mask → result), captioning (image → text), and combined format
  conversion (see below).
- Load detection, inpainting, and captioning models once at startup (or
  lazily on first request) and keep them resident on the GPU for the process
  lifetime to avoid per-request reload cost.
- Report GPU availability/status at health-check time so the main process can
  surface a graceful fallback/error state if no capable GPU is present.
- Perform image format conversion in this layer (via Pillow), not in the
  renderer or main process — see Image format handling.

### Captioning

- **Model**: Qwen2-VL-7B-Instruct (via `transformers`), loaded once at sidecar
  startup alongside the detection/inpainting models.
- **Permissiveness**: mainstream instruction-tuned VLMs refuse or sanitize
  descriptions of nudity/sexual content/violence. This tool needs factual
  captions regardless, since it's preparing training data. Achieve this with
  a system prompt that explicitly instructs the model to describe image
  content factually and completely, including mature/NSFW subject matter,
  without moralizing or refusing — not by using an abliterated/uncensored
  fine-tuned checkpoint (that's a fallback if the base instruct model still
  refuses in practice once this is implemented and tested against real
  fixture images).
- **Input**: the working-format image (post-inpaint in the pipeline, so
  captions describe the cleaned image, not the watermarked original).
- **Output**: a single caption string per image, written by the main process
  as a sidecar `.txt` file next to the exported image (e.g. `photo.png` +
  `photo.txt`) — the standard layout for ML/LoRA dataset prep tooling
  (Kohya-style). No JSON manifest; one text file per image keeps the dataset
  directly consumable by training tools that expect this convention.
- **Failure handling**: if the model produces an empty string or an explicit
  refusal (e.g. output starts with "I cannot" / "I'm not able to"), treat it
  as a captioning failure for that item — write no `.txt` file, mark the item
  `error` in the bulk queue (see Error handling and edge cases), and continue
  the batch. Don't silently write a refusal string as if it were a caption.

## Bulk processing

Bulk mode processes a folder of images through the same underlying pipeline
as single-image mode, with two differences: it runs fully automatic (no
manual mask-adjustment pause per item — that stays a single-image-mode-only
tool for touch-ups) and it produces a caption `.txt` file alongside each
exported image.

Per-item pipeline: import → detect → inpaint (using the detected mask
as-is, no review step) → caption → convert/export. Each stage's failure
(per Error handling and edge cases) marks that item `error` and the batch
continues with the next image — one bad file never blocks the rest of the
folder. The renderer's bulk queue view reflects per-item status live and
offers a "retry failed items" action once the batch finishes.

### Image format handling

- **Where conversion happens**: normalize all inputs to a single internal
  working format (RGBA PNG in memory, since it's lossless and supports alpha)
  immediately on ingest in the sidecar, before detection/inpainting run. Only
  convert to the user's requested output format as the final export step,
  after inpainting completes. This keeps the detection/inpainting models
  working against one consistent representation regardless of what the user
  dropped in.
- **Transparency handling**: JPEG has no alpha channel. If the working image
  has an alpha channel (from PNG/WEBP input) and the user's chosen output
  format is JPEG, flatten the image onto a solid background before export —
  default to white, but expose the flatten color as an option. If the output
  format is PNG or WEBP, preserve alpha through the full pipeline unchanged.
  If the *input* was JPEG (no alpha) the working image simply has no alpha
  channel to preserve.
- **Quality/compression on export**:
  - JPEG: quality slider (1–100), default 90.
  - WEBP: quality slider (1–100) with a lossless toggle, default 90 lossy.
  - PNG: no quality slider (lossless by definition); expose a compression
    level control (affects encode time/file size, not visual quality),
    default a middle setting (e.g. 6 of 9 in Pillow's `compress_level`).
- **Where conversion runs and why**: in the Python sidecar (Pillow), not in
  Electron/Node. Rationale: the sidecar already loads and decodes every image
  for detection/inpainting, so performing the final format/quality conversion
  there avoids a second decode/encode round trip through a different image
  library, and keeps all image-format logic (and its dependency, Pillow) in
  one place instead of duplicating format handling in Node.
- **EXIF/metadata handling**: make it a user-facing export option with three
  states — *keep* (copy EXIF/ICC profile from source to output where the
  target format supports it), *strip* (default — smaller files, avoids
  leaking camera/location metadata), or *strip except orientation* (apply the
  EXIF orientation tag during conversion so images don't appear rotated, then
  discard the rest). Default to **strip** for privacy-by-default in a
  local-first tool.

## IPC and HTTP contract

### IPC channels (renderer ↔ main process)

| Channel | Direction | Payload | Purpose |
|---|---|---|---|
| `image:import` | renderer → main | `{ path? , buffer? }` | User dropped/selected a file |
| `image:detect` | renderer → main | `{ imageId }` | Request watermark detection on an imported image |
| `mask:update` | renderer → main | `{ imageId, maskPatch }` | Push manual brush edits to the current mask |
| `image:inpaint` | renderer → main | `{ imageId, maskId }` | Request inpainting using the current (possibly edited) mask |
| `image:export` | renderer → main | `{ imageId, format, quality, metadataMode, flattenColor? }` | Request final conversion + write to disk |
| `sidecar:state` | main → renderer | `{ state: 'starting'\|'ready'\|'error', detail? }` | Sidecar lifecycle updates, pushed |
| `job:progress` | main → renderer | `{ imageId, stage, progress? }` | Progress updates for detect/inpaint/export |
| `job:error` | main → renderer | `{ imageId, stage, message, code }` | Surfaced failure for a specific step |
| `batch:import` | renderer → main | `{ folderPath }` | User dropped/selected a folder for bulk mode |
| `batch:start` | renderer → main | `{ batchId, format, quality, metadataMode, flattenColor? }` | Begin fully-automatic processing of an imported batch |
| `batch:item-progress` | main → renderer | `{ batchId, itemId, stage }` | One item advanced a pipeline stage (detect/inpaint/caption/convert) |
| `batch:item-done` | main → renderer | `{ batchId, itemId, outputPath, captionPath }` | One item finished successfully |
| `batch:item-error` | main → renderer | `{ batchId, itemId, stage, message, code }` | One item failed at a specific stage; batch continues |
| `batch:complete` | main → renderer | `{ batchId, succeeded, failed }` | Whole batch finished; counts for the summary |
| `batch:retry-failed` | renderer → main | `{ batchId }` | Re-run only the items currently in `error` status |

The main process assigns and tracks an `imageId` per imported image and a
`maskId` per mask revision, so multiple images (batch mode) can be in flight
without the renderer needing to track sidecar-side state itself. Bulk mode
similarly assigns a `batchId` per imported folder and an `itemId` per file
within it.

### HTTP contract (main process ↔ sidecar)

| Endpoint | Method | Request | Response |
|---|---|---|---|
| `/health` | GET | — | `{ status: 'ok', gpu: { available: bool, name?, vramFreeMb? }, modelsLoaded: bool }` |
| `/detect` | POST | multipart image (working format) | `{ maskPng: base64, detections: [{ bbox, confidence }] }` |
| `/inpaint` | POST | `{ imageBase64, maskBase64 }` | `{ resultBase64 }` (working format, alpha-preserving) |
| `/caption` | POST | `{ imageBase64 }` | `{ caption: string \| null }` — `null` means the model produced an empty output or a detected refusal; the caller treats that as a captioning failure |
| `/convert` | POST | `{ imageBase64 (working format), format, quality, metadataMode, flattenColor? }` | `{ resultBase64, contentType }` |
| `/shutdown` | POST | — | `204` — graceful in-process shutdown, used by main process on quit if the process doesn't exit promptly on signal |

### Full round trip for one image

1. Renderer: user drops `photo.webp` → `image:import`.
2. Main: reads file, converts to working format via `/convert`-adjacent
   internal call (or a dedicated `/normalize` endpoint if conversion-on-load
   proves more consistent than reusing `/convert` — decide during Phase 1),
   stores in-memory/temp, assigns `imageId`, replies with a preview data URL.
3. Renderer: shows preview, user clicks "Remove watermark" → `image:detect`.
4. Main: calls sidecar `/detect` with the working-format image → gets mask +
   detections → forwards mask to renderer as a preview overlay, replies via
   `job:progress`/completion.
5. Renderer: user reviews mask; if detection missed a region, brush-edits it
   → `mask:update` events accumulate client-side (or round-trip through main
   for persistence — decide based on how large masks get) → user confirms →
   `image:inpaint`.
6. Main: calls sidecar `/inpaint` with image + final mask → gets inpainted
   result (working format, alpha intact) → replies to renderer with updated
   preview.
7. Renderer: user picks export format/quality/metadata mode → `image:export`.
8. Main: calls sidecar `/convert` with the inpainted working-format image and
   the export options → gets final bytes → writes to the user-chosen path →
   confirms success to renderer (or surfaces `job:error`).

## Sidecar lifecycle management

- **Startup**: prefer starting the sidecar on app launch (not lazily on first
  use) so the first user action isn't blocked on multi-second model load —
  show a "warming up" state in the renderer in the meantime. Revisit if
  startup cost proves to make app launch itself feel broken; a hybrid
  (start immediately but don't block the UI shell) is the fallback.
- **Health checks**: main process polls `/health` on an interval after spawn
  until `modelsLoaded: true`, then switches to on-demand health checks before
  each detect/inpaint request (cheap GET, short timeout) rather than
  continuous polling, to avoid needless overhead while idle.
- **Crash recovery**: if a sidecar request fails with a connection error (not
  an application-level error response), the main process treats this as a
  crash: surface `sidecar:state: 'error'`, attempt one automatic respawn, and
  re-run health checks. If respawn also fails, surface a persistent error
  state with a manual "retry" action in the UI rather than looping silently.
- **Shutdown**: on app quit, main process sends a shutdown signal
  (POST `/shutdown` or process signal) and waits briefly for graceful exit;
  force-kills the process if it doesn't exit within a timeout, so quitting
  the app never leaves an orphaned GPU-holding process behind.
- **State surfaced to renderer**: `starting` (spawned, not yet healthy),
  `ready` (health check passing, models loaded), `error` (crashed / GPU
  unavailable / failed to spawn), each pushed via `sidecar:state`.

## Packaging and distribution

- **Bundling the sidecar**: freeze the Python sidecar into a standalone
  executable (e.g. PyInstaller) rather than requiring a system Python
  install, and ship it as an Electron extra resource (`extraResources` in
  electron-builder config) so it's present in the packaged app but outside
  the ASAR archive (native/binary resources shouldn't live inside ASAR).
- **Model weights**: decide whether model weights ship inside the installer
  (larger download, works fully offline immediately) or are downloaded on
  first run (smaller installer, requires one-time internet access). Given
  the "no cloud calls" / local-first framing, shipping weights bundled is
  the more consistent choice with the product's positioning — plan for a
  large installer (likely several GB) rather than a bootstrap download.
- **Expected app size**: multi-GB, dominated by model weights (LaMa +
  detection model) and the frozen Python runtime with GPU-capable
  torch/onnxruntime wheels. Call this out in the plan explicitly so it isn't
  a surprise late in the build — this is not a typical "tens of MB" Electron
  app.
- **Platform considerations**: target Windows first (matches the stated
  RTX 5080 dev hardware); Linux as a secondary target if pursued — CUDA
  driver/toolkit availability and packaging (AppImage vs deb) differ enough
  from Windows that it's worth treating as a distinct milestone, not an
  afterthought of the Windows build.
- **Code signing / installer**: out of scope for the initial phases; note it
  as a pre-release checklist item (unsigned installers trigger OS warnings).

## Error handling and edge cases

| Case | Handling |
|---|---|
| No watermark detected | `/detect` returns an empty/near-empty mask or low-confidence detections; renderer shows "no watermark found — you can still draw a mask manually" rather than treating it as a failure. |
| GPU unavailable | Sidecar `/health` reports `gpu.available: false`; app surfaces a blocking error state before allowing detect/inpaint, since CPU fallback for these models is impractically slow — explicitly not a silent CPU fallback. |
| GPU OOM mid-request | Sidecar catches the OOM, returns a structured error (`code: 'gpu_oom'`); main process surfaces it as `job:error` with a suggestion to retry (transient) or reduce image size (persistent for very large images). |
| Unsupported/corrupt image file | Validate format/decodability at import time (Pillow open + verify) before accepting into the pipeline; reject with a clear message rather than failing later at detect/inpaint. |
| Very large images | Define a maximum working dimension (e.g. downscale for detection/inpainting if above a threshold, then upscale the result or apply the mask back onto the full-resolution original) — decide the exact strategy in Phase 1 once real timing/VRAM numbers are available. |
| Batch processing failures | One image's failure must not abort the batch; track per-image status (`pending`/`processing`/`done`/`error`) and let the user retry just the failed ones. |
| Sidecar fails to spawn at all | Treat identically to a crash with a failed respawn — persistent error state, manual retry, and a diagnostic detail (e.g. missing CUDA driver) surfaced to the user. |
| Captioning model refuses or returns empty output | `/caption` returns `caption: null`; the item is marked `error` at the `caption` stage (not silently given a blank or refusal-text caption) and the batch continues; single-image mode shows "captioning failed — retry" rather than blocking export. |
| Non-image files in a bulk folder | Filter to supported extensions (`.jpg`, `.jpeg`, `.png`, `.webp`) at folder-enumeration time; unsupported files are skipped and counted separately from `failed`, not reported as errors. |

## UI/UX flow

Renderer states, in the order a single image typically moves through them:

1. **Idle** — no image loaded; drag-and-drop target visible; sidecar may
   still be `starting` in the background (shown unobtrusively).
2. **Model loading** — only blocks user action if the user tries to detect
   before the sidecar reports `ready`; otherwise import/preview works
   regardless of sidecar state.
3. **Detecting** — spinner/progress on the current image; other imported
   images (batch mode) remain interactable.
4. **Awaiting manual mask adjustment** — detected mask shown as an overlay,
   brush tools active, "confirm mask" action to proceed.
5. **Inpainting** — spinner/progress; mask locked from further edits until
   this completes or fails.
6. **Done** — result preview shown alongside (or toggled against) the
   original; export controls (format, quality, metadata mode) available.
7. **Error** — per-image or app-wide (e.g. sidecar crash), with the specific
   message/code from Error handling and edge cases and a retry action where
   applicable.

Format/export options surface only at the **Done** state (post-inpaint),
per the Image format handling design — conversion is the last step, not an
upfront choice, so the user isn't forced to decide output format before
seeing the result.

**Bulk mode** is a separate top-level view (folder drop instead of a single
image) with its own state machine: idle → importing (enumerating files) →
processing (per-item progress list, each item showing pending/processing/
done/error) → complete (summary: succeeded/failed/skipped counts, "retry
failed" action). Format/quality/metadata options are chosen once up front for
the whole batch, since there's no per-item review step to defer them to.

## Testing strategy

- **Sidecar API (unit/integration, Python)**: test `/detect`, `/inpaint`,
  `/caption`, `/convert` against fixture images directly via HTTP, independent
  of Electron — including the alpha-preservation and flatten-on-JPEG-export
  behavior, metadata-mode handling (keep/strip/strip-except-orientation), and
  `/caption`'s empty-output/refusal-detection → `null` behavior (test with a
  fake model double that returns a canned refusal string, asserting the
  endpoint maps it to `null` rather than passing it through).
- **IPC contract (integration, Electron)**: test that each renderer→main
  channel produces the expected sidecar call and that sidecar responses map
  back to the correct `job:progress`/`job:error` shape — can be tested with
  the sidecar mocked/stubbed to isolate IPC plumbing from model behavior.
  Include the `batch:*` channels: a fake sidecar returning success for some
  items and failure for others must produce the right per-item events and a
  correct final `batch:complete` summary.
- **Format conversion correctness**: dedicated test matrix over
  {JPEG, PNG, WEBP} input × {JPEG, PNG, WEBP} output × {with alpha, without
  alpha} × {each metadata mode}, asserting on decoded pixel content (not just
  "it produced bytes") and confirming EXIF orientation is applied correctly
  when metadata is stripped.
- **End-to-end**: drive the full renderer flow (import → detect → adjust →
  inpaint → caption → export) against the real sidecar and real models for at
  least one fixture image per supported input format, run in CI on a
  GPU-capable runner or gated to run locally if CI has no GPU — plan for the
  latter given the RTX 5080 target isn't a typical CI shape. Separately, run
  one real bulk-mode pass over a small fixture folder (a handful of images,
  including one that should fail a stage) and assert the final succeeded/
  failed counts and that `.txt` caption files land next to their images.
- **Crash/lifecycle tests**: simulate sidecar crash (kill the process
  externally) and assert the main process detects it, respawns, and the
  renderer reflects the `error`→`starting`→`ready` transition.

## Phased milestones

1. **Phase 1 — Sidecar + single-image round trip, one format.** Get
   Electron main ↔ Python sidecar talking over HTTP; hardcode PNG in/out;
   prove detect → inpaint works end-to-end on the RTX 5080 with real models.
   Establish the working-format decision and large-image downscale strategy
   with real timing data.
2. **Phase 2 — Multi-format conversion.** Add the `/convert` endpoint and
   full JPEG/PNG/WEBP input+output matrix, alpha handling, quality settings,
   and metadata modes, per Image format handling above.
3. **Phase 3 — Captioning.** Add the `/caption` endpoint (Qwen2-VL-7B-Instruct
   with the permissive system prompt), refusal/empty-output detection, and
   single-image-mode UI to display and export the caption alongside the image.
4. **Phase 4 — Manual mask adjustment UI.** Brush add/remove tools in the
   renderer, mask round-trip via `mask:update`, confirm-mask gate before
   inpainting (single-image mode only).
5. **Phase 5 — Bulk processing.** Folder import, the fully-automatic
   detect → inpaint → caption → convert pipeline with no per-item pause,
   per-item status tracking, `.txt` caption sidecar files, partial-failure
   handling without aborting the batch, and the bulk queue UI.
6. **Phase 6 — Packaging and distribution.** Freeze the sidecar, wire it as
   an Electron extra resource, build the Windows installer, decide and
   implement the model-weights bundling approach (now including Qwen2-VL-7B's
   weights alongside detection/inpainting), verify expected app size and a
   clean install/uninstall cycle on a machine without Python preinstalled.
