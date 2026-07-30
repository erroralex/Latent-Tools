# Watermark Removal Desktop App — Implementation Plan

## Product summary

A local-first Electron desktop app that removes watermarks from images using
AI detection + inpainting, running entirely on-device (target hardware: RTX
5080, 9800X3D). No cloud calls, no telemetry by default, no size limits, no
signup.

## Architecture overview

Three processes, one machine:

```
┌─────────────────────────┐      IPC      ┌──────────────────────────┐      localhost HTTP      ┌─────────────────────────┐
│  Renderer (UI)           │ <───────────> │  Main process             │ <──────────────────────> │  Python sidecar (IOPaint) │
│  drag/drop, preview,      │               │  spawns/manages sidecar,  │                           │  detection + inpainting   │
│  mask adjustment, export  │               │  health checks, lifecycle │                           │  models on GPU             │
└─────────────────────────┘               └──────────────────────────┘                           └─────────────────────────┘
```

- **Renderer**: UI, drag-and-drop image input, preview, manual mask-adjustment
  fallback for missed detections.
- **Main process**: spawns and manages the Python sidecar's lifecycle (start on
  launch or first use, health-check before sending requests, clean shutdown on
  quit). Owns all sidecar HTTP calls — the renderer never talks to the sidecar
  directly, only to the main process via IPC.
- **Python sidecar (IOPaint)**: bundled local HTTP server exposing detection +
  inpainting endpoints. Florence-2 or a fine-tuned YOLO for watermark
  detection/mask generation; LaMa (or another IOPaint-supported model) for
  inpainting. Runs on the RTX 5080.

This plan assumes the architecture above is fixed and does not re-litigate it.
It is framework-agnostic on renderer UI choice (no specific component
framework assumed) except where Electron itself dictates structure.

## Component breakdown

### Renderer

Responsibilities:
- Accept image input via drag-and-drop and file picker (JPEG, JPG, PNG, WEBP).
- Render the working preview and the detected/adjustable mask overlay.
- Provide manual mask-adjustment tools (brush add/remove) for missed or
  over-detected regions, used as a fallback before inpainting.
- Surface sidecar/app state (loading, detecting, awaiting adjustment,
  inpainting, done, error) — see UI/UX flow.
- Expose export options: output format (JPEG/PNG/WEBP), quality/compression
  setting, metadata handling choice.
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
- Manage file I/O: reading dropped/selected files, writing exported output,
  temp file cleanup.
- Handle crash detection and restart of the sidecar; surface sidecar state
  changes to the renderer over IPC.
- Clean sidecar shutdown on app quit (including forced-quit paths).

### Python sidecar (IOPaint)

Responsibilities:
- Expose a local-only HTTP server (bind to `127.0.0.1`, not `0.0.0.0`) with
  endpoints for: health check, detection (image → mask), inpainting
  (image + mask → result), and combined format conversion (see below).
- Load detection and inpainting models once at startup (or lazily on first
  request) and keep them resident on the GPU for the process lifetime to
  avoid per-request reload cost.
- Report GPU availability/status at health-check time so the main process can
  surface a graceful fallback/error state if no capable GPU is present.
- Perform image format conversion in this layer (via Pillow), not in the
  renderer or main process — see Image format handling.

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

The main process assigns and tracks an `imageId` per imported image and a
`maskId` per mask revision, so multiple images (batch mode) can be in flight
without the renderer needing to track sidecar-side state itself.

### HTTP contract (main process ↔ sidecar)

| Endpoint | Method | Request | Response |
|---|---|---|---|
| `/health` | GET | — | `{ status: 'ok', gpu: { available: bool, name?, vramFreeMb? }, modelsLoaded: bool }` |
| `/detect` | POST | multipart image (working format) | `{ maskPng: base64, detections: [{ bbox, confidence }] }` |
| `/inpaint` | POST | `{ imageBase64, maskBase64 }` | `{ resultBase64 }` (working format, alpha-preserving) |
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
| Batch processing failures | One image's failure must not abort the batch; track per-image status (`pending`/`done`/`error`) and let the user retry just the failed ones. |
| Sidecar fails to spawn at all | Treat identically to a crash with a failed respawn — persistent error state, manual retry, and a diagnostic detail (e.g. missing CUDA driver) surfaced to the user. |

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

## Testing strategy

- **Sidecar API (unit/integration, Python)**: test `/detect`, `/inpaint`,
  `/convert` against fixture images directly via HTTP, independent of
  Electron — including the alpha-preservation and flatten-on-JPEG-export
  behavior, and metadata-mode handling (keep/strip/strip-except-orientation).
- **IPC contract (integration, Electron)**: test that each renderer→main
  channel produces the expected sidecar call and that sidecar responses map
  back to the correct `job:progress`/`job:error` shape — can be tested with
  the sidecar mocked/stubbed to isolate IPC plumbing from model behavior.
- **Format conversion correctness**: dedicated test matrix over
  {JPEG, PNG, WEBP} input × {JPEG, PNG, WEBP} output × {with alpha, without
  alpha} × {each metadata mode}, asserting on decoded pixel content (not just
  "it produced bytes") and confirming EXIF orientation is applied correctly
  when metadata is stripped.
- **End-to-end**: drive the full renderer flow (import → detect → adjust →
  inpaint → export) against the real sidecar and real models for at least
  one fixture image per supported input format, run in CI on a GPU-capable
  runner or gated to run locally if CI has no GPU — plan for the latter given
  the RTX 5080 target isn't a typical CI shape.
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
3. **Phase 3 — Manual mask adjustment UI.** Brush add/remove tools in the
   renderer, mask round-trip via `mask:update`, confirm-mask gate before
   inpainting.
4. **Phase 4 — Batch processing.** Multiple images in flight, per-image
   status tracking, partial-failure handling without aborting the batch.
5. **Phase 5 — Packaging and distribution.** Freeze the sidecar, wire it as
   an Electron extra resource, build the Windows installer, decide and
   implement the model-weights bundling approach, verify expected app size
   and a clean install/uninstall cycle on a machine without Python
   preinstalled.
