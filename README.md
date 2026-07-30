# Latent Tools

**Latent Tools** is a local-first Electron desktop application for **bulk image-dataset preparation**, AI watermark removal (automated detection + inpainting), multi-format conversion, and NSFW/mature-content-tolerant image captioning. Running entirely on-device, it leverages an embedded Python FastAPI sidecar powered by PyTorch for RTX GPU acceleration.

---

## Key Features

- **Automated AI Watermark Detection & Removal**: Uses `microsoft/Florence-2-base` open-vocabulary object detection to identify watermark bounding boxes and `IOPaint` (LaMa model) for seamless on-device inpainting.
- **Interactive Mask Editor**: Fine-tune detected masks directly on a responsive visual overlay canvas using **Add Mask** and **Erase Mask** brush tools, adjustable brush sizes, and **Undo / Redo** history.
- **NSFW-Tolerant Dataset Captioning**: Generates detailed, factual dataset training descriptions via `Qwen/Qwen2-VL-7B-Instruct` with built-in refusal filtering, automatically exporting Kohya-style matching `.txt` sidecar files alongside image exports.
- **Multi-Format Conversion**: Convert between JPEG, PNG, and WEBP with full control over quality sliders, WEBP lossless mode, PNG compression levels (0–9), background transparency flattening color pickers, and EXIF/ICC metadata handling (`strip`, `keep`, `strip_except_orientation`).
- **First-Class Bulk Folder Processing**: Select input and output folders to batch-process entire image datasets (watermark removal + captioning + format conversion) with a live progress bar, status logging, and batch cancellation.
- **Frameless Dark UI & Custom Titlebar**: Integrated dark design system starting maximized by default with custom window controls (Minimize, Maximize/Restore, Close), window dragging, and a live GPU sidecar health status pill.

---

## Architecture Overview

```
+-------------------------------------------------------------+
| Electron Main & Renderer Process (TypeScript, Strict)       |
|  - Custom Frameless Titlebar & Window Dragging              |
|  - Interactive Mask Overlay Canvas & Undo/Redo Engine       |
|  - Single Image & Bulk Dataset View Controller              |
+-------------------------------------------------------------+
                               |
                        IPC / Localhost HTTP
                               v
+-------------------------------------------------------------+
| Embedded Python Sidecar (FastAPI - http://127.0.0.1:8756)    |
|  - Florence-2 (<OPEN_VOCABULARY_DETECTION> "watermark")     |
|  - IOPaint / LaMa (Inpainting)                              |
|  - Qwen2-VL-7B-Instruct (Image Captioning)                  |
|  - Pillow & OpenCV (Format Conversion & Ingest Normalization)|
+-------------------------------------------------------------+
```

---

## Hardware & System Requirements

- **OS**: Windows 10/11 (or Linux / macOS with Python 3.11+)
- **GPU**: NVIDIA RTX Series (RTX 5080 / 4090 recommended for optimal inference speed)
- **Node.js**: v18+
- **Python**: 3.11+

---

## Installation & Local Setup

### 1. One-Time Sidecar Setup (Python Venv)

From the project root directory:

```bash
cd sidecar
python -m venv .venv

# Install sidecar dependencies
.venv\Scripts\python -m pip install -e ".[dev]"

# Install PyTorch with CUDA 12.8 support (crucial for RTX GPUs)
.venv\Scripts\python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128

cd ..
```

> **Note**: Plain `pip install torch` installs a CPU-only wheel on Windows. Using the explicit `https://download.pytorch.org/whl/cu128` index URL ensures full CUDA acceleration.

### 2. Electron Application Setup

```bash
# Install Node dependencies
npm install

# Build TypeScript renderer & main process
npm run build

# Start the desktop application (spawns Python sidecar automatically)
npm start
```

---

## Keyboard Shortcuts & Controls

| Shortcut / Control | Action |
| :--- | :--- |
| `Ctrl + Z` / `Cmd + Z` | **Undo** last mask brush edit |
| `Ctrl + Shift + Z` / `Ctrl + Y` | **Redo** mask brush edit |
| `Pointer Drag` on Titlebar | Drag application window |
| `Add Mask` Brush | Draw on visual red overlay to extend watermark mask |
| `Erase Mask` Brush | Erase mask highlight to fix over-detections |

---

## Running Unit & Integration Tests

### Electron TypeScript Tests (Vitest)

```bash
npm test
```

### Python Sidecar Tests (Pytest)

```bash
cd sidecar
.venv\Scripts\python -m pytest tests/ -v
```

---

## Project Structure

```
Latent-Tools/
├── src/
│   ├── main/                 # Electron main process & SidecarClient HTTP wrapper
│   ├── preload/              # Secure contextBridge preload bindings
│   └── renderer/             # HTML5/TypeScript visual editor & bulk processor UI
├── sidecar/
│   ├── app/                  # FastAPI endpoints (/detect, /inpaint, /caption, /convert, /normalize)
│   ├── tests/                # Pytest sidecar unit tests
│   └── pyproject.toml        # Sidecar Python dependency manifest
├── tests/                    # Vitest unit test suite for main process & IPC handlers
├── docs/
│   └── implementation-plan.md# Full multi-phase architecture spec
├── HANDOVER.md               # Current project status & verified engineering facts
└── package.json              # App build & script configuration
```
