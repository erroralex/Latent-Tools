# Latent Tools

![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=for-the-badge&logo=python&logoColor=white)
![PyTorch](https://img.shields.io/badge/PyTorch-CUDA_12.8-EE4C2C?style=for-the-badge&logo=pytorch&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.108-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-31-47848F?style=for-the-badge&logo=electron&logoColor=white)

A local-first, on-device desktop application for bulk image dataset preparation: automated AI watermark detection and removal, multi-format image conversion (JPEG/PNG/WEBP), and uncensored training dataset captioning—running entirely offline powered by an embedded Python GPU sidecar.

---

## ⚠️ Disclaimer & Responsible Use

Latent Tools is built to remove watermarks **you have the rights to remove** — your own marks, marks on images you own or are licensed to edit, or marks on assets you otherwise have permission to modify. It is **not** a tool for stripping copyright, attribution, or ownership marks from other people's work.

You are solely responsible for ensuring you have the legal right to edit any image you process with this tool. The authors and contributors accept no liability for misuse.

---

## 🔐 Fast, Portable & Safe

Engineered for AI trainers and dataset creators preparing image libraries for LoRA, Fine-Tuning, and ControlNet models with zero cloud dependency.

* **100% Local & On-Device Execution:** All inference models (Florence-2, IOPaint/LaMa, Qwen2-VL) run locally on your RTX GPU. Your images and dataset descriptions never leave your computer.
* **Secure Loopback Architecture:** The Electron UI communicates with the embedded Python engine over a token-authenticated localhost HTTP loopback (`127.0.0.1:8756`). It never exposes external ports or requires open internet access during processing.
* **First-Class Bulk Folder Processing:** Designed from day one to handle entire image dataset folders in batch mode—not just single one-off edits.
* **Non-Destructive Sidecar Generation:** Text captions are exported as atomic `.txt` sidecar files (Kohya / Automatic1111 format) named identically to the destination image files, ensuring zero data loss.
* **Precise Area & Box Filtering:** Automated watermark detection filters out giant false-positive background boxes, combining multiple text watermarks into clean masks without destroying subject geometry.

---

## ✨ Key Features

* **Automated AI Watermark Removal:**
  * Uses `microsoft/Florence-2-base` open-vocabulary object detection to locate text watermarks, logos, and stamps.
  * Inpaints masked regions seamlessly on-device using `IOPaint` (LaMa model).
* **Interactive Canvas Mask Editor:**
  * Fine-tune AI-generated masks on an interactive visual overlay canvas (`rgba(255, 0, 0, 0.5)`).
  * Smooth **Add Mask** and **Erase Mask** brush tools with real-time size adjustments, mousewheel zoom, and click-and-drag panning.
  * Unlimited **Undo / Redo** history (`Ctrl+Z`, `Ctrl+Shift+Z` / `Ctrl+Y`) with **Clear** and **Reset** controls; the brush stays live immediately after a removal pass for touch-up masking.
* **Uncensored Dataset Captioning:**
  * Powered by `Qwen/Qwen2-VL-2B-Instruct` (default, faster) or `Qwen/Qwen2-VL-7B-Instruct` (higher quality), selectable per-request — or point it at your own local model folder.
  * Custom system prompts and trigger words bypass false-positive safety refusals on uncensored dataset art while maintaining objective description quality.
  * Captions export as atomic `.txt` sidecar files (Kohya / Automatic1111 format) named identically to the destination image.
* **Multi-Format Dataset Conversion:**
  * Convert images to **PNG**, **JPEG**, or **WEBP**.
  * Adjust quality sliders (1–100), WEBP lossless mode, and PNG compression levels (0–9).
  * Custom background flattening color pickers for transparent images.
  * Comprehensive EXIF & ICC metadata handling (`strip`, `keep`, `strip_except_orientation`).
  * LoRA / Archive / Web export presets plus your own `localStorage`-backed custom presets.
* **First-Class Bulk Dataset Processing:**
  * Point at an input folder and an output folder, preview thumbnails, and run detect → inpaint → caption → convert over the whole set in one pass.
  * Real-time progress and a live logs terminal for the batch run.
  * Each image is processed sidecar-side in a single HTTP round trip (`/process`), not five separate calls, for fast bulk throughput.
* **Modern Frameless Interface (Deep Neon theme):**
  * Frameless glass titlebar with custom window controls, app logo, and a live **GPU Sidecar Health Status Pill** (`Starting...`, `Online`, `Offline`).
  * Sidebar GPU widget with real-time VRAM usage bar.
  * `Ctrl` + mousewheel UI zoom (50%–250%, `Ctrl+0` to reset) and dark-themed native dropdowns throughout.
  * System tray icon with Show/Quit controls.

---

## 💻 System Requirements

* **OS:** Windows 10/11 (64-bit), Linux, or macOS.
* **GPU:** NVIDIA discrete GPU (8GB+ VRAM recommended for optimal inference speed).

* **RAM:** 16GB minimum (32GB recommended for large 7B VLM models).
* **Storage:** ~10GB for Python environment and local AI weights.
* **Runtime:** Node.js v18+ & Python 3.11+.

---

## 🛠️ Technical Architecture

Latent Tools combines an Electron frontend with an embedded Python FastAPI sidecar process.

* **Frontend & Main (Electron + TypeScript):**
  * **Strict TypeScript:** Compiled with strict type safety across main, preload, and renderer processes.
  * **ContextBridge IPC:** Secure, isolated IPC channels (`folder:select`, `folder:list-images`, `bulk:process-item`, `image:import`, `image:detect`, `image:inpaint`, `image:caption`, `image:export`, `image:save`, `mask:update`, `gpu:status`, window controls).
  * **Interactive Canvas:** Hardware-accelerated HTML5 canvas mask rendering and undo history stack.

* **GPU Sidecar (Python 3.11 + PyTorch):**
  * **FastAPI Service:** Uvicorn engine bound to `127.0.0.1` loopback only, exposing `/health`, `/gpu`, `/normalize`, `/detect`, `/inpaint`, `/caption`, `/convert`, `/process` (single-round-trip detect→inpaint→caption→convert used by bulk processing), and `/shutdown`.
  * **Florence-2 (`microsoft/Florence-2-base`):** Bounding box & open-vocabulary watermark detection with adaptive Canny stroke contouring.
  * **IOPaint (LaMa):** Fast Fourier Transform-based resolution-agnostic inpainting.
  * **Qwen2-VL (`Qwen/Qwen2-VL-2B-Instruct` or `Qwen/Qwen2-VL-7B-Instruct`, or a custom local model folder):** Multi-modal vision language model for captioning, selectable per-request.
  * **OpenCV & Pillow:** Image normalization, mask dilation, and multi-format encoding.
  * **PyInstaller:** Compiles the sidecar to a standalone `sidecar.exe` for packaged releases — no Python install required by end users.

---

## 📦 Download

Prebuilt Windows installer (NSIS `.exe`) and portable `.exe` builds are published on the [Releases page](https://github.com/erroralex/Latent-Tools/releases) for tagged versions. These bundle the compiled Python sidecar, so no separate Python setup is required.

To build from source instead, follow the steps below.

---

## 🚀 Getting Started

### 1. One-Time Sidecar Setup (Python Venv)

From the repo root directory:

```bash
cd sidecar
python -m venv .venv

# Install sidecar dependencies in editable mode
.venv\Scripts\python -m pip install -e ".[dev]"

# Install PyTorch with CUDA 12.8 acceleration (crucial for RTX GPUs)
.venv\Scripts\python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128

cd ..
```

> **⚡ Important:** Plain `pip install torch` installs a CPU-only wheel on Windows. The explicit `--index-url https://download.pytorch.org/whl/cu128` ensures full GPU hardware acceleration on RTX graphics cards.

### 2. Launching the Application

```bash
# Install Node dependencies
npm install

# Build TypeScript renderer and main process
npm run build

# Start Electron (spawns Python GPU sidecar automatically)
npm start
```

---

## 🧪 Running Unit & Integration Tests

### Electron & IPC Vitest Suite
```bash
npm test
```

### Python Sidecar Pytest Suite
```bash
cd sidecar
.venv\Scripts\python -m pytest tests/ -v
```

---

## 🏗️ Building a Standalone Windows Executable

```bash
npm run dist
```

Packages the app with `electron-builder`, compiling the Python sidecar to `sidecar.exe` via PyInstaller and producing both an NSIS installer and a portable `.exe` under `release/`.

---

## 📜 License

Distributed under the **MIT License** — see [LICENSE.md](LICENSE.md) for the full text.

---

## 💖 Support the Project

If **Latent Tools** has saved you hours of manual dataset prep and watermark removal, consider supporting its ongoing development.

[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-GitHub-ea4aaa?style=for-the-badge&logo=github-sponsors)](https://github.com/sponsors/erroralex)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-F16061?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/error_alex)

---

<p align="center">
  <b>Developed by</b><br>
  <a href="https://github.com/erroralex" target="_blank" rel="noopener noreferrer"><img src="assets/ALX Logo Neon.png" width="120" alt="Alexander Nilsson Logo"></a><br>
  Copyright (c) 2026 Alexander Nilsson
</p>

