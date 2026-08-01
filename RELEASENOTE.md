## Latent Tools — v0.1.0-beta.3

Local-first Windows desktop app for bulk image-dataset prep: AI watermark
removal, format conversion, and uncensored image captioning — all running
entirely on-device on your own GPU.

### What's new since v0.1.0-beta.2

- **Fix: brush unusable right after "Remove Watermark"** — Previously the
  mask canvas was hidden after an inpaint pass, which silently disabled all
  brush input until you ran Detect again and cleared it. The brush now
  stays live immediately after removal so you can touch up any remaining
  watermark without the Detect detour.
- **Documented usage disclaimer** — The README and CONTRIBUTING guide now
  state clearly that Latent Tools is intended for removing watermarks you
  have the rights to remove (your own marks, or marks on assets you're
  licensed to edit) — not for stripping copyright or ownership marks from
  other people's work. Responsibility for lawful use rests with the user.
- **LICENSE.md added** — The MIT license was previously only claimed in the
  README with no license file; it's now published in the repo and
  referenced from `package.json`.
- **CONTRIBUTING.md added** — Setup steps, workflow expectations (GPU
  exclusivity for performance work, test-first bugfixes), and commit/PR
  conventions for anyone contributing to the project.
- **README overhaul** — Now documents bulk dataset processing, the
  single-round-trip `/process` sidecar endpoint, the 2B/7B/custom
  captioning model selector, export presets, the Deep Neon UI, and how to
  grab a prebuilt release — all previously undocumented.

### Highlights (full feature set)

- **Watermark removal** — Florence-2 open-vocabulary detection finds
  watermarks/logos/text, LaMa (IOPaint) inpaints them out. Manual mask
  brush/eraser editing with undo/redo if the automatic detection needs a
  nudge.
- **Format conversion** — JPEG / PNG / WEBP export with quality, lossless,
  compression-level, background-flatten color, and metadata-retention
  controls. Export presets for LoRA / Archive / Web, plus custom
  `localStorage`-backed presets.
- **Uncensored image captioning** — Qwen2-VL-2B / Qwen2-VL-7B-Instruct, or
  point it at your own local model folder. Custom system prompts and
  trigger-word support.
- **Bulk dataset processing** — folder-in, folder-out batch pipeline built
  for preparing training datasets (e.g. LoRA), not just one-off cleanup.
  Single round-trip `/process` pipeline (normalize → detect → inpaint →
  caption → convert) for throughput.
- **Single Image Editor** — Detect → Remove → Caption stepper with a
  zoomable/pannable canvas mask overlay.
- **Live GPU telemetry** — real-time GPU name, VRAM usage, and temperature
  in the titlebar and sidebar.
- **Deep Neon UI** — dark, glassy theme; `Ctrl` + scroll to zoom the whole
  UI (50%–250%).
- **Runs fully local** — no cloud calls; a Python (FastAPI) sidecar talks
  to the Electron app over `127.0.0.1` only.

### Requirements

- Windows 10/11
- A CUDA-capable discrete GPU (Florence-2, LaMa, and Qwen2-VL all run on
  GPU; recommend 12 GB+ VRAM)

### Installation

Download and run either:
- `Latent-Tools-Setup-*.exe` — NSIS installer
- `Latent-Tools-*-portable.exe` — no-install portable build

### Known limitations (beta)

- Windows-only for now.
- First run downloads model weights (Florence-2, LaMa, Qwen2-VL) from
  Hugging Face — expect a delay and disk usage on first launch.
- No auto-update mechanism yet — check the Releases page for new versions.

**Full Changelog**: https://github.com/erroralex/Latent-Tools/compare/v0.1.0-beta.2...v0.1.0-beta.3
