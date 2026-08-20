## Latent Tools — v1.0.0

Local-first Windows desktop app for bulk image-dataset prep: AI watermark removal (Florence-2 + LaMa), multi-format image conversion (JPEG/PNG/WEBP), and uncensored training captioning (Qwen2-VL) — running entirely on-device on your NVIDIA GPU.

### What's New in v1.0.0

- **On-Demand AI Runtime Downloads** — The installer and portable packages are lightweight (tens of MB) instead of multi-gigabyte monolithic bundles. On first launch, click **"Click to Download AI Components"** in the top bar to stream the self-contained CUDA 12.8 / PyTorch runtime (~1-2GB) directly from Hugging Face Hub, with automatic SHA256 checksum verification and extraction into your user profile.
- **Latent Design System** — Complete UI overhaul with the signature Latent dark graphite palette, crisp flat surface hierarchies, Latent Cyan/Violet accents, and real-time GPU telemetry (VRAM usage, temperature, and live sidecar health status).
- **First-Class Bulk Folder Processing** — Batch watermark detection, inpainting, format conversion, and captioning across entire image folders with a single round-trip pipeline (`/process`), real-time progress bar, and live logs.
- **Interactive Single-Image Editor** — Visual overlay canvas with live brush/eraser controls, zoom and pan, undo/redo history, and seamless watermark removal and caption export.
- **Uncensored Training Dataset Captioning** — Powered by `Qwen2-VL-2B-Instruct` (fast) or `Qwen2-VL-7B-Instruct` (high quality), or custom local model folders with custom trigger words and system prompts.
- **Multi-Format Conversion & Preset System** — High-performance image conversion (PNG/JPEG/WEBP) with custom compression, quality sliders, ICC/EXIF metadata handling, background flattening color picker, and built-in LoRA/Archive/Web presets.
- **Per-Machine MSI Installer** — The MSI installer now always shows a destination-folder screen (editable path plus a "Change..." browse dialog) instead of silently defaulting to a per-user AppData folder.

---

### ⚠️ Important Notice: First-Run Downloads

Latent Tools requires dedicated local AI components and models to operate offline:
1. **Sidecar AI Runtime (~1–2 GB):** When you launch Latent Tools for the first time, click **"Click to Download AI Components"** on the GPU status pill to fetch and unpack the CUDA Python runtime into your AppData directory.
2. **Model Weights (Downloaded on first use):** When first running detection, inpainting, or captioning, the required open-weights models (`microsoft/Florence-2-base`, `IOPaint/LaMa`, `Qwen/Qwen2-VL`) are downloaded directly from Hugging Face Hub and cached locally.

*An active internet connection is only needed during these initial downloads. Once downloaded, all image processing and inference run 100% locally and offline on your GPU.*

---

### 💻 System Requirements

- **OS:** Windows 10 / 11 (64-bit)
- **GPU:** Dedicated NVIDIA GPU with CUDA support (8GB+ VRAM recommended; 12GB+ for large 7B captioning models)
- **Storage:** ~10GB free disk space for AI runtime and local model caches

---

### ⚖️ Responsible Use & Legal Notice

Latent Tools is designed for processing images you have the legal right to edit. Removing watermarks, credit lines, or Copyright Management Information (CMI) from works without authorization may violate 17 U.S.C. § 1202 and copyright law. You are solely responsible for ensuring lawful use of this tool. Third-party model weights carry their own respective licenses.
