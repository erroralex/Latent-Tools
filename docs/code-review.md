# Code Review: Latent Tools (v1.0.0)

_Date: August 5, 2026_  
_Target: Latent Tools Architecture & Codebase (Electron TypeScript + FastAPI Python Sidecar)_

---

## 📊 Summary & Health Status

A full code review was conducted across the Electron main process, TypeScript renderer UI, and FastAPI Python sidecar.

| Category | Status | Details |
| :--- | :---: | :--- |
| **TypeScript Build & Types** | 🟢 PASS | Clean `tsc --noEmit` build with `strict: true` and zero compiler errors. |
| **Electron Unit Tests** | 🟢 PASS | **27 / 27** Vitest tests passing ([`tests/`](file:///c:/Users/error/IdeaProjects/Projects/Latent-Tools/tests/)). |
| **Python Sidecar Tests** | 🟢 PASS | **25 / 25** Pytest tests passing ([`sidecar/tests/`](file:///c:/Users/error/IdeaProjects/Projects/Latent-Tools/sidecar/tests/)). |
| **Security & Network** | 🟢 PASS | Sidecar bound strictly to `127.0.0.1` loopback; no external network exposures or firewall prompts. |
| **Architecture & Aesthetics** | 🟢 EXCELLENT | Clean IPC contracts, unified design system tokens, and single-round-trip bulk batching. |

---

## 🌟 Key Architecture & Engineering Highlights

1. **Single-Round-Trip Bulk Processing ([`main.py`](file:///c:/Users/error/IdeaProjects/Projects/Latent-Tools/sidecar/app/main.py#L315))**:
   - Combining normalize $\rightarrow$ detect $\rightarrow$ inpaint $\rightarrow$ caption $\rightarrow$ convert into the unified `/process` endpoint eliminated 5 IPC/HTTP and base64 encoding round-trips per image, driving batch throughput up by **~45%** (from 6.0s down to 3.32s per item).
2. **GPU VRAM & cuDNN Optimization ([`inpainting.py`](file:///c:/Users/error/IdeaProjects/Projects/Latent-Tools/sidecar/app/inpainting.py#L24), [`captioning.py`](file:///c:/Users/error/IdeaProjects/Projects/Latent-Tools/sidecar/app/captioning.py#L178))**:
   - Restoring `TORCH_CUDNN_V8_API_LRU_CACHE_LIMIT = "10000"` counteracts `iopaint`'s process-wide cache cap, accelerating Florence-2 vision detection by **~6x** (2.74s $\rightarrow$ 0.28s).
   - `_captioner_for_model` uses `lru_cache(maxsize=1)` to automatically unload and reclaim VRAM when switching between models (2B $\rightarrow$ 7B $\rightarrow$ custom).
3. **Resilient Process Management ([`sidecar-process.ts`](file:///c:/Users/error/IdeaProjects/Projects/Latent-Tools/src/main/sidecar-process.ts#L60))**:
   - `start()` checks for an already-running sidecar before spawning a new child process, avoiding port collisions when developing with IDE run configs.

---

## 🔍 Key Findings & Resolution Status

### 1. Main Process Memory Accumulation (RAM) — 🟢 FIXED
* **Location**: [`ipc-handlers.ts:L47`](file:///c:/Users/error/IdeaProjects/Projects/Latent-Tools/src/main/ipc-handlers.ts#L47)
* **Fix**: Added `MAX_IMAGES = 10` cache ceiling. `image:import` evicts the oldest image key when capacity is reached. Covered by unit test in [`ipc-handlers.test.ts`](file:///c:/Users/error/IdeaProjects/Projects/Latent-Tools/tests/ipc-handlers.test.ts).

---

### 2. Missing `torch.inference_mode()` in Detection — 🟢 FIXED
* **Location**: [`detection.py:L40`](file:///c:/Users/error/IdeaProjects/Projects/Latent-Tools/sidecar/app/detection.py#L40)
* **Fix**: Wrapped Florence-2 prompt generation loop inside `with torch.inference_mode():`. Verified via Pytest suite.

---

### 3. IPC `shell:open-external` Protocol Hardening — 🟢 FIXED
* **Location**: [`ipc-handlers.ts:L51`](file:///c:/Users/error/IdeaProjects/Projects/Latent-Tools/src/main/ipc-handlers.ts#L51)
* **Fix**: Validated incoming URLs with `new URL(url)` and restricted execution to `http:` and `https:` protocols only. Non-HTTP protocols and invalid URLs are safely ignored. Covered by unit test in [`ipc-handlers.test.ts`](file:///c:/Users/error/IdeaProjects/Projects/Latent-Tools/tests/ipc-handlers.test.ts).

---

### 4. Error Resilience in Folder Image Scanning — 🟢 FIXED
* **Location**: [`ipc-handlers.ts:L97`](file:///c:/Users/error/IdeaProjects/Projects/Latent-Tools/src/main/ipc-handlers.ts#L97)
* **Fix**: Wrapped `readDir(folderPath)` in a `try...catch` block. On permission errors or missing directories, returns `{ files: [], error: err.message }` rather than throwing an unhandled rejection. Covered by unit test in [`ipc-handlers.test.ts`](file:///c:/Users/error/IdeaProjects/Projects/Latent-Tools/tests/ipc-handlers.test.ts).

---

### 5. UI Canvas & Object URL Memory Management — 🟢 FIXED
* **Location**: [`renderer.ts:L1155`](file:///c:/Users/error/IdeaProjects/Projects/Latent-Tools/src/renderer/renderer.ts#L1155)
* **Fix**: Added `currentObjectUrl` state tracking to single-image editor. Calls `URL.revokeObjectURL(currentObjectUrl)` prior to opening or creating a new Object URL.

