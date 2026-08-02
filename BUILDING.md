# Building Latent Tools from Source

This document describes how to run Latent Tools from source and how to package a
fully self-contained standalone executable. The packaged output mirrors the official
releases — a portable `.exe` and an NSIS installer, both with the Python GPU sidecar
compiled inside via PyInstaller (no separate Python install required by end users).

---

## Prerequisites

Before you begin, ensure the following are installed and available on your `PATH`:

| Tool | Version | Notes |
|---|---|---|
| **Node.js** | 20.x | For building the Electron main/preload/renderer processes |
| **npm** | Bundled with Node 20 | Used for all Node dependency management |
| **Python** | 3.11+ | For the GPU sidecar service |
| **NVIDIA GPU + CUDA driver** | CUDA 12.8-compatible | Required for GPU-accelerated inference; PyTorch falls back to CPU-only otherwise |

---

## Project Structure

```
Latent-Tools/
├── src/            # Electron main, preload, and renderer (TypeScript, strict)
├── sidecar/        # Python FastAPI GPU service (Florence-2, IOPaint/LaMa, Qwen2-VL)
└── scripts/        # Build helper scripts (e.g. copy-renderer-html.js)
```

---

## Step 1 — Set Up the Python Sidecar (one-time)

```bash
cd sidecar
python -m venv .venv

# Install sidecar dependencies in editable mode
.venv\Scripts\python -m pip install -e ".[dev]"

# Install PyTorch with CUDA 12.8 acceleration (crucial for RTX GPUs)
.venv\Scripts\python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128

cd ..
```

> **Plain `pip install torch` installs a CPU-only wheel on Windows.** The explicit
> `--index-url https://download.pytorch.org/whl/cu128` above is required for GPU
> hardware acceleration on RTX graphics cards.

---

## Step 2 — Install Node Dependencies

```bash
npm install
```

---

## Step 3 — Build and Run Locally

```bash
npm run build   # Compiles TypeScript (main, preload, renderer) via tsc
npm start       # Builds, then launches Electron (spawns the Python GPU sidecar automatically)
```

---

## Step 4 — Package a Standalone Executable

```bash
npm run dist
```

`electron-builder` compiles the Python sidecar into a standalone `sidecar.exe` via
PyInstaller, then produces platform-native binaries under `release/`:

| Output | Description |
|---|---|
| `Latent-Tools.exe` | Portable standalone — no installation required |
| `Latent-Tools-Setup.exe` | NSIS installer with Start Menu shortcuts and uninstaller |

---

## Full Build — Copy/Paste Summary

For convenience, the complete sequence from project root:

```bash
# 1. Sidecar (one-time)
cd sidecar
python -m venv .venv
.venv\Scripts\python -m pip install -e ".[dev]"
.venv\Scripts\python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
cd ..

# 2. Node dependencies
npm install

# 3. Build and run locally
npm run build
npm start

# 4. Package standalone executables
npm run dist
```

---

## Running Tests

```bash
# Electron / TypeScript (Vitest)
npm test

# Python sidecar (Pytest) — GPU-marked tests are excluded by default
cd sidecar
.venv\Scripts\python -m pytest tests/ -v
```

---

## Troubleshooting

**`torch.cuda.is_available()` returns `False`**
You likely installed the default CPU-only PyTorch wheel. Reinstall with the
`--index-url https://download.pytorch.org/whl/cu128` flag from Step 1.

**Two model-loading processes fight for GPU memory**
Detection, inpainting, and captioning models all share one GPU. Confirm no other
`python`/`electron` process holds the GPU before benchmarking or reporting a slowdown:
`nvidia-smi --query-compute-apps=pid,process_name --format=csv,noheader`.

**`electron-builder` packaging fails**
Ensure `npm run build` completed successfully first — `electron-builder` bundles the
compiled `dist/` output, not the TypeScript source directly.

**Sidecar fails to start under the packaged app**
The packaged app spawns `sidecar.exe` from `process.resourcesPath/sidecar`, not from
`sidecar/.venv`. Verify the PyInstaller build step in `npm run dist` completed without
errors and that `sidecar.exe` exists in the output directory before packaging Electron.
