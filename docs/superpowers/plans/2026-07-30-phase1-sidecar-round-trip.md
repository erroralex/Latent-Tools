# Phase 1 — Sidecar + Single-Image Round Trip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the full pipeline — Electron main process ↔ Python sidecar ↔ real
GPU models — by getting one PNG image through watermark detection (Florence-2)
and inpainting (IOPaint/LaMa) end to end, driven from a minimal Electron UI.

**Architecture:** A FastAPI sidecar process exposes `/health`, `/detect`, and
`/inpaint` over `127.0.0.1`. The Electron main process spawns the sidecar,
health-checks it, and exposes `image:import` / `image:detect` / `image:inpaint`
IPC channels that a minimal renderer calls. This is a deliberately minimal
subset of the full contract in `docs/implementation-plan.md` (no format
conversion, no captioning, no batch, no manual mask editing yet — those are
later phases); it hardcodes PNG in/out per that doc's Phase 1 scope.

**Tech Stack:** Python 3.11, FastAPI, uvicorn, IOPaint (LaMa), Florence-2 (via
`transformers`), Pillow, OpenCV (`opencv-python-headless`), PyTorch with CUDA
(cu128 wheel — the plain PyPI `torch` wheel is CPU-only and will silently run
on CPU); Node with Electron, TypeScript (`strict: true`), Vitest.

## Global Constraints

- No cloud calls; the sidecar binds `127.0.0.1` only, never `0.0.0.0`.
- TypeScript: `strict: true`, `noUncheckedIndexedAccess: true`, no `any`
  (per `AGENTS.md`'s TypeScript addon).
- Every bugfix/behavior gets a test before or with the code (per `AGENTS.md`
  Testing section); tests must be deterministic — no real network calls in
  automated tests (use an injected fake or a local ephemeral test server).
- GPU-dependent tests (real Florence-2/LaMa inference) are marked and skipped
  by default; fast tests use injected fakes so the suite runs without a GPU.
- Small, one-logical-change commits per step.

---

## Verified facts this plan depends on

These were confirmed by running real code against this machine's RTX 5080
during planning — they are not assumptions:

1. **GPU-enabled torch requires the cu128 index.** Plain `pip install torch`
   on this machine installs a CPU-only wheel (`torch.cuda.is_available()` is
   `False`). The working install is:
   ```
   pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
   ```
   This gave `torch==2.11.0+cu128` with `torch.cuda.is_available() == True` and
   `torch.cuda.get_device_name(0) == 'NVIDIA GeForce RTX 5080'`.

2. **IOPaint's `ModelManager` mask contract.** `ModelManager.__call__`'s own
   docstring says the mask should be `[H, W, 1]` — **this is wrong**. Passing
   a `[H, W, 1]` mask produces a corrupted `(256, 256, 256, 3)` output. The
   mask must be `[H, W]` (2D), `uint8`, `255` = area to repaint. Verified
   working call:
   ```python
   from iopaint.model_manager import ModelManager
   from iopaint.schema import InpaintRequest
   import torch

   mm = ModelManager(name="lama", device=torch.device("cuda"))
   result = mm(image_rgb_hw3_uint8, mask_hw_uint8, InpaintRequest())
   # result: np.ndarray, shape (H, W, 3), dtype uint8, BGR channel order
   ```
   `ModelManager(name="lama", ...)` raises `NotImplementedError` until the
   LaMa weights are downloaded once via `iopaint.model.lama.LaMa.download()`
   (downloads `big-lama.pt`, ~196MB, to the torch hub cache).

3. **Florence-2 open-vocabulary detection output shape.** Verified against
   `microsoft/Florence-2-base` on a real fixture image:
   ```python
   parsed = processor.post_process_generation(
       generated_text, task="<OPEN_VOCABULARY_DETECTION>", image_size=(w, h)
   )
   # parsed == {
   #   "<OPEN_VOCABULARY_DETECTION>": {
   #     "bboxes": [[x1, y1, x2, y2], ...],   # absolute pixel coords, floats
   #     "bboxes_labels": ["watermark", ...],
   #     "polygons": [], "polygons_labels": [],
   #   }
   # }
   ```
   `trust_remote_code=True` is required for both `AutoModelForCausalLM` and
   `AutoProcessor` — Florence-2 ships custom modeling code on the Hub.

---

## File Structure

```
sidecar/
  pyproject.toml
  app/
    __init__.py
    main.py            # FastAPI app: /health, /detect, /inpaint
    schemas.py          # pydantic request/response models
    detection.py         # WatermarkDetector protocol + Florence2Detector
    inpainting.py         # Inpainter protocol + LamaInpainter
  tests/
    conftest.py
    test_health.py
    test_detect.py       # fast, fake detector
    test_inpaint.py       # fast, fake inpainter
    test_real_models.py    # @pytest.mark.gpu, real Florence-2 + LaMa

package.json
tsconfig.json
vitest.config.ts
src/
  main/
    index.ts            # app entry: creates window, spawns sidecar, wires IPC
    sidecar-process.ts    # spawn/health-poll/shutdown lifecycle
    sidecar-client.ts      # HTTP client for /health, /detect, /inpaint
    ipc-handlers.ts         # registers image:import/detect/inpaint
  preload/
    index.ts             # contextBridge, exposes window.api
  renderer/
    index.html
    renderer.ts
tests/
  sidecar-client.test.ts
  sidecar-process.test.ts
  ipc-handlers.test.ts
```

---

### Task 1: Python sidecar scaffold + `/health`

**Files:**
- Create: `sidecar/pyproject.toml`
- Create: `sidecar/app/__init__.py`
- Create: `sidecar/app/main.py`
- Test: `sidecar/tests/conftest.py`
- Test: `sidecar/tests/test_health.py`

**Interfaces:**
- Produces: `sidecar.app.main:app` (a `fastapi.FastAPI` instance) — later
  tasks add routes to this same app object.

- [ ] **Step 1: Write `pyproject.toml`**

```toml
[project]
name = "latent-tools-sidecar"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.32",
    "pydantic>=2.9",
    "pillow>=11.0",
    "numpy>=2.0",
    "opencv-python-headless>=4.10",
    "iopaint>=1.6",
    "transformers>=4.45",
    "einops>=0.8",
    "timm>=1.0",
]

[project.optional-dependencies]
dev = ["pytest>=8.3", "httpx>=0.27"]

[tool.pytest.ini_options]
markers = ["gpu: real-model tests requiring a CUDA GPU (skipped by default)"]
addopts = "-m 'not gpu'"

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"
```

- [ ] **Step 2: Write `sidecar/app/__init__.py`** (empty file, makes `app` a package)

```python
```

- [ ] **Step 3: Write `sidecar/app/main.py`**

```python
from fastapi import FastAPI

app = FastAPI(title="Latent Tools Sidecar")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
```

- [ ] **Step 4: Write the failing test — `sidecar/tests/conftest.py`**

```python
import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    return TestClient(app)
```

- [ ] **Step 5: Write the failing test — `sidecar/tests/test_health.py`**

```python
def test_health_returns_ok(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

- [ ] **Step 6: Install dependencies and run the test**

From `sidecar/`:
```bash
pip install -e ".[dev]"
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
pytest tests/test_health.py -v
```
Expected: `PASS` (this one doesn't need GPU/torch, but torch is a transitive
dependency of `iopaint` so it must be installed before anything imports).

- [ ] **Step 7: Commit**

```bash
git add sidecar/pyproject.toml sidecar/app sidecar/tests
git commit -m "Add sidecar scaffold with /health endpoint"
```

---

### Task 2: Inpainting module + `/inpaint` endpoint

**Files:**
- Create: `sidecar/app/inpainting.py`
- Modify: `sidecar/app/main.py`
- Create: `sidecar/app/schemas.py`
- Test: `sidecar/tests/test_inpaint.py`

**Interfaces:**
- Consumes: `app.main:app` (Task 1).
- Produces: `Inpainter` protocol (`inpaint(image: Image.Image, mask: Image.Image) -> Image.Image`),
  `LamaInpainter` class, `get_inpainter()` FastAPI dependency — Task 3's
  `/detect` endpoint doesn't depend on this, but later phases reuse
  `get_inpainter`'s override pattern.

- [ ] **Step 1: Write `sidecar/app/schemas.py`**

```python
from pydantic import BaseModel


class InpaintRequestBody(BaseModel):
    image_base64: str
    mask_base64: str


class InpaintResponseBody(BaseModel):
    result_base64: str


class DetectRequestBody(BaseModel):
    image_base64: str


class DetectResponseBody(BaseModel):
    mask_base64: str
```

- [ ] **Step 2: Write the failing test — `sidecar/tests/test_inpaint.py`**

```python
import base64
import io

from PIL import Image

from app.main import app
from app.inpainting import get_inpainter


class FakeInpainter:
    def inpaint(self, image: Image.Image, mask: Image.Image) -> Image.Image:
        # Returns solid red everywhere the mask is white, to make the
        # round-trip through the HTTP layer verifiable without a real model.
        result = image.copy()
        result.paste((255, 0, 0), mask=mask)
        return result


def _png_base64(image: Image.Image) -> str:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def test_inpaint_endpoint_returns_result(client):
    app.dependency_overrides[get_inpainter] = lambda: FakeInpainter()
    try:
        image = Image.new("RGB", (64, 64), color=(0, 255, 0))
        mask = Image.new("L", (64, 64), color=0)
        mask.paste(255, (10, 10, 50, 50))

        response = client.post(
            "/inpaint",
            json={
                "image_base64": _png_base64(image),
                "mask_base64": _png_base64(mask),
            },
        )

        assert response.status_code == 200
        result_bytes = base64.b64decode(response.json()["result_base64"])
        result = Image.open(io.BytesIO(result_bytes)).convert("RGB")
        assert result.getpixel((30, 30)) == (255, 0, 0)  # inside mask
        assert result.getpixel((5, 5)) == (0, 255, 0)     # outside mask
    finally:
        app.dependency_overrides.clear()
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pytest tests/test_inpaint.py -v
```
Expected: FAIL — `ImportError: cannot import name 'get_inpainter' from 'app.inpainting'` (module doesn't exist yet).

- [ ] **Step 4: Write `sidecar/app/inpainting.py`**

```python
from functools import lru_cache
from typing import Protocol

import cv2
import numpy as np
import torch
from PIL import Image
from iopaint.model.lama import LaMa
from iopaint.model_manager import ModelManager
from iopaint.schema import InpaintRequest


class Inpainter(Protocol):
    def inpaint(self, image: Image.Image, mask: Image.Image) -> Image.Image: ...


class LamaInpainter:
    def __init__(self, device: str = "cuda") -> None:
        if not LaMa.is_downloaded():
            LaMa.download()
        self._model_manager = ModelManager(name="lama", device=torch.device(device))

    def inpaint(self, image: Image.Image, mask: Image.Image) -> Image.Image:
        image_rgb = np.array(image.convert("RGB"), dtype=np.uint8)
        mask_hw = np.array(mask.convert("L"), dtype=np.uint8)
        result_bgr = self._model_manager(image_rgb, mask_hw, InpaintRequest())
        result_rgb = cv2.cvtColor(result_bgr, cv2.COLOR_BGR2RGB)
        return Image.fromarray(result_rgb, mode="RGB")


@lru_cache(maxsize=1)
def _real_inpainter() -> LamaInpainter:
    return LamaInpainter()


def get_inpainter() -> Inpainter:
    return _real_inpainter()
```

- [ ] **Step 5: Wire the endpoint — modify `sidecar/app/main.py`**

```python
import base64
import io

from fastapi import Depends, FastAPI
from PIL import Image

from app.inpainting import Inpainter, get_inpainter
from app.schemas import InpaintRequestBody, InpaintResponseBody

app = FastAPI(title="Latent Tools Sidecar")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


def _decode_png(data_base64: str) -> Image.Image:
    return Image.open(io.BytesIO(base64.b64decode(data_base64)))


def _encode_png(image: Image.Image) -> str:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


@app.post("/inpaint", response_model=InpaintResponseBody)
def inpaint(
    body: InpaintRequestBody, inpainter: Inpainter = Depends(get_inpainter)
) -> InpaintResponseBody:
    image = _decode_png(body.image_base64)
    mask = _decode_png(body.mask_base64)
    result = inpainter.inpaint(image, mask)
    return InpaintResponseBody(result_base64=_encode_png(result))
```

- [ ] **Step 6: Run test to verify it passes**

```bash
pytest tests/test_inpaint.py -v
```
Expected: PASS. (No GPU/model download needed — the fake is injected.)

- [ ] **Step 7: Write the real-model test — `sidecar/tests/test_real_models.py`**

```python
import numpy as np
import pytest
import torch
from PIL import Image

from app.inpainting import LamaInpainter


@pytest.mark.gpu
def test_lama_inpainter_changes_masked_region_on_real_gpu():
    assert torch.cuda.is_available(), "This test requires a CUDA GPU"

    image = Image.fromarray(
        (np.random.rand(256, 256, 3) * 255).astype(np.uint8), mode="RGB"
    )
    mask = Image.new("L", (256, 256), color=0)
    mask.paste(255, (64, 64, 192, 192))

    inpainter = LamaInpainter(device="cuda")
    result = inpainter.inpaint(image, mask)

    original = np.array(image)
    changed = np.array(result)
    assert not np.array_equal(
        original[64:192, 64:192], changed[64:192, 64:192]
    ), "Masked region should have been repainted, not copied through"
```

- [ ] **Step 8: Run the real-model test manually (requires GPU, downloads ~196MB on first run)**

```bash
pytest tests/test_real_models.py -v -m gpu
```
Expected: PASS, with a log line `Loading model: lama` and a one-time LaMa
weight download the first time it runs on this machine.

- [ ] **Step 9: Commit**

```bash
git add sidecar/app/inpainting.py sidecar/app/main.py sidecar/app/schemas.py sidecar/tests/test_inpaint.py sidecar/tests/test_real_models.py
git commit -m "Add LaMa inpainting endpoint with fake-backed and real-model tests"
```

---

### Task 3: Detection module + `/detect` endpoint

**Files:**
- Create: `sidecar/app/detection.py`
- Modify: `sidecar/app/main.py`
- Test: `sidecar/tests/test_detect.py`
- Modify: `sidecar/tests/test_real_models.py`

**Interfaces:**
- Consumes: `app.schemas.DetectRequestBody`, `DetectResponseBody` (Task 2).
- Produces: `WatermarkDetector` protocol (`detect(image: Image.Image) -> Image.Image`
  returning an `'L'`-mode mask, `255` = detected region), `Florence2Detector`
  class, `get_detector()` FastAPI dependency.

- [ ] **Step 1: Write the failing test — `sidecar/tests/test_detect.py`**

```python
import base64
import io

from PIL import Image

from app.main import app
from app.detection import get_detector


class FakeDetector:
    def detect(self, image: Image.Image) -> Image.Image:
        mask = Image.new("L", image.size, color=0)
        mask.paste(255, (0, 0, image.width // 2, image.height // 2))
        return mask


def _png_base64(image: Image.Image) -> str:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def test_detect_endpoint_returns_mask(client):
    app.dependency_overrides[get_detector] = lambda: FakeDetector()
    try:
        image = Image.new("RGB", (64, 64), color=(10, 20, 30))
        response = client.post("/detect", json={"image_base64": _png_base64(image)})

        assert response.status_code == 200
        mask_bytes = base64.b64decode(response.json()["mask_base64"])
        mask = Image.open(io.BytesIO(mask_bytes)).convert("L")
        assert mask.getpixel((10, 10)) == 255  # inside the fake's detected region
        assert mask.getpixel((50, 50)) == 0     # outside
    finally:
        app.dependency_overrides.clear()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest tests/test_detect.py -v
```
Expected: FAIL — `ImportError: cannot import name 'get_detector' from 'app.detection'`.

- [ ] **Step 3: Write `sidecar/app/detection.py`**

```python
from functools import lru_cache
from typing import Protocol

import cv2
import numpy as np
import torch
from PIL import Image
from transformers import AutoModelForCausalLM, AutoProcessor

_TASK = "<OPEN_VOCABULARY_DETECTION>"
_MASK_DILATE_PX = 6  # grow each box slightly so inpainting covers watermark edges


class WatermarkDetector(Protocol):
    def detect(self, image: Image.Image) -> Image.Image: ...


class Florence2Detector:
    def __init__(self, device: str = "cuda", model_id: str = "microsoft/Florence-2-base") -> None:
        self._device = device
        self._model = AutoModelForCausalLM.from_pretrained(
            model_id, trust_remote_code=True, torch_dtype=torch.float16
        ).to(device)
        self._processor = AutoProcessor.from_pretrained(model_id, trust_remote_code=True)

    def detect(self, image: Image.Image) -> Image.Image:
        rgb_image = image.convert("RGB")
        prompt = _TASK + "watermark"
        inputs = self._processor(text=prompt, images=rgb_image, return_tensors="pt").to(
            self._device, torch.float16
        )
        generated_ids = self._model.generate(
            input_ids=inputs["input_ids"],
            pixel_values=inputs["pixel_values"],
            max_new_tokens=1024,
            num_beams=3,
        )
        generated_text = self._processor.batch_decode(generated_ids, skip_special_tokens=False)[0]
        parsed = self._processor.post_process_generation(
            generated_text, task=_TASK, image_size=(rgb_image.width, rgb_image.height)
        )
        bboxes = parsed[_TASK]["bboxes"]
        return _mask_from_bboxes(bboxes, rgb_image.size)


def _mask_from_bboxes(bboxes: list[list[float]], size: tuple[int, int]) -> Image.Image:
    mask = np.zeros((size[1], size[0]), dtype=np.uint8)
    for x1, y1, x2, y2 in bboxes:
        cv2.rectangle(mask, (int(x1), int(y1)), (int(x2), int(y2)), color=255, thickness=-1)
    if bboxes:
        kernel = np.ones((_MASK_DILATE_PX, _MASK_DILATE_PX), dtype=np.uint8)
        mask = cv2.dilate(mask, kernel)
    return Image.fromarray(mask, mode="L")


@lru_cache(maxsize=1)
def _real_detector() -> Florence2Detector:
    return Florence2Detector()


def get_detector() -> WatermarkDetector:
    return _real_detector()
```

- [ ] **Step 4: Wire the endpoint — modify `sidecar/app/main.py`**

Add these imports at the top (alongside the existing `app.inpainting` import):
```python
from app.detection import WatermarkDetector, get_detector
from app.schemas import DetectRequestBody, DetectResponseBody
```

Add this route below `/health`:
```python
@app.post("/detect", response_model=DetectResponseBody)
def detect(
    body: DetectRequestBody, detector: WatermarkDetector = Depends(get_detector)
) -> DetectResponseBody:
    image = _decode_png(body.image_base64)
    mask = detector.detect(image)
    return DetectResponseBody(mask_base64=_encode_png(mask))
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pytest tests/test_detect.py -v
```
Expected: PASS.

- [ ] **Step 6: Append the real-model test to `sidecar/tests/test_real_models.py`**

```python
from app.detection import Florence2Detector


@pytest.mark.gpu
def test_florence2_detector_finds_a_region_on_real_gpu():
    assert torch.cuda.is_available(), "This test requires a CUDA GPU"

    image = Image.new("RGB", (256, 256), color=(200, 200, 200))
    detector = Florence2Detector(device="cuda")
    mask = detector.detect(image)

    assert mask.mode == "L"
    assert mask.size == (256, 256)
    # Florence-2's open-vocabulary detection returns at least one box for any
    # image (confidence isn't exposed by this task's prompt), so the mask
    # should have some non-zero region rather than being entirely black.
    assert np.array(mask).max() == 255
```

- [ ] **Step 7: Run the real-model test manually (requires GPU, downloads ~460MB Florence-2-base weights on first run)**

```bash
pytest tests/test_real_models.py -v -m gpu
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add sidecar/app/detection.py sidecar/app/main.py sidecar/tests/test_detect.py sidecar/tests/test_real_models.py
git commit -m "Add Florence-2 watermark detection endpoint with fake-backed and real-model tests"
```

---

### Task 4: Electron + TypeScript project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/main/index.ts`
- Test: `tests/sanity.test.ts`

**Interfaces:**
- Produces: the `src/main/` directory later tasks add files to; the
  `npm run build` / `npm test` / `npm start` scripts every later task assumes.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "latent-tools",
  "version": "0.1.0",
  "private": true,
  "main": "dist/main/index.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "npm run build && electron .",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "electron": "^33.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `src/main/index.ts`**

```typescript
import { app, BrowserWindow } from "electron";

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      preload: `${__dirname}/../preload/index.js`,
    },
  });
  void window.loadFile("src/renderer/index.html");
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
```

- [ ] **Step 4: Write `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Write a sanity test — `tests/sanity.test.ts`**

```typescript
import { describe, expect, it } from "vitest";

describe("project scaffold", () => {
  it("runs TypeScript tests", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Install dependencies and run**

```bash
npm install
npm test
npm run build
```
Expected: `npm test` passes (1 test), `npm run build` produces `dist/main/index.js`
with no type errors.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src/main/index.ts tests/sanity.test.ts
git commit -m "Scaffold Electron + TypeScript project"
```

---

### Task 5: `sidecar-client.ts` — HTTP client to the sidecar

**Files:**
- Create: `src/main/sidecar-client.ts`
- Test: `tests/sidecar-client.test.ts`

**Interfaces:**
- Produces: `SidecarClient` class with `health(): Promise<{status: string}>`,
  `detect(imagePng: Buffer): Promise<Buffer>`, `inpaint(imagePng: Buffer, maskPng: Buffer): Promise<Buffer>` —
  Task 7 (`ipc-handlers.ts`) depends on these exact method names and signatures.

- [ ] **Step 1: Write the failing test — `tests/sidecar-client.test.ts`**

```typescript
import * as http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SidecarClient } from "../src/main/sidecar-client";

describe("SidecarClient", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        if (req.url === "/health" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok" }));
          return;
        }
        if (req.url === "/detect" && req.method === "POST") {
          const parsed = JSON.parse(body) as { image_base64: string };
          expect(parsed.image_base64).toBe(Buffer.from("fake-image").toString("base64"));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ mask_base64: Buffer.from("fake-mask").toString("base64") }));
          return;
        }
        if (req.url === "/inpaint" && req.method === "POST") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ result_base64: Buffer.from("fake-result").toString("base64") }));
          return;
        }
        res.writeHead(404);
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected server to bind a port");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(() => {
    server.close();
  });

  it("health() calls GET /health", async () => {
    const client = new SidecarClient(baseUrl);
    const result = await client.health();
    expect(result).toEqual({ status: "ok" });
  });

  it("detect() posts the image and returns the decoded mask", async () => {
    const client = new SidecarClient(baseUrl);
    const mask = await client.detect(Buffer.from("fake-image"));
    expect(mask.toString()).toBe("fake-mask");
  });

  it("inpaint() posts image+mask and returns the decoded result", async () => {
    const client = new SidecarClient(baseUrl);
    const result = await client.inpaint(Buffer.from("fake-image"), Buffer.from("fake-mask"));
    expect(result.toString()).toBe("fake-result");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- sidecar-client
```
Expected: FAIL — `Cannot find module '../src/main/sidecar-client'`.

- [ ] **Step 3: Write `src/main/sidecar-client.ts`**

```typescript
type HealthResponse = { status: string };
type DetectResponse = { mask_base64: string };
type InpaintResponse = { result_base64: string };

export class SidecarClient {
  constructor(private readonly baseUrl: string) {}

  async health(): Promise<HealthResponse> {
    const response = await fetch(`${this.baseUrl}/health`);
    if (!response.ok) {
      throw new Error(`Sidecar health check failed: ${response.status}`);
    }
    return (await response.json()) as HealthResponse;
  }

  async detect(imagePng: Buffer): Promise<Buffer> {
    const response = await fetch(`${this.baseUrl}/detect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_base64: imagePng.toString("base64") }),
    });
    if (!response.ok) {
      throw new Error(`Sidecar /detect failed: ${response.status}`);
    }
    const body = (await response.json()) as DetectResponse;
    return Buffer.from(body.mask_base64, "base64");
  }

  async inpaint(imagePng: Buffer, maskPng: Buffer): Promise<Buffer> {
    const response = await fetch(`${this.baseUrl}/inpaint`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_base64: imagePng.toString("base64"),
        mask_base64: maskPng.toString("base64"),
      }),
    });
    if (!response.ok) {
      throw new Error(`Sidecar /inpaint failed: ${response.status}`);
    }
    const body = (await response.json()) as InpaintResponse;
    return Buffer.from(body.result_base64, "base64");
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- sidecar-client
```
Expected: PASS (3 tests). No real sidecar or network access involved — the
test server is a local ephemeral HTTP server.

- [ ] **Step 5: Commit**

```bash
git add src/main/sidecar-client.ts tests/sidecar-client.test.ts
git commit -m "Add SidecarClient HTTP wrapper for /health, /detect, /inpaint"
```

---

### Task 6: `sidecar-process.ts` — spawn/health-poll/shutdown lifecycle

**Files:**
- Create: `src/main/sidecar-process.ts`
- Test: `tests/sidecar-process.test.ts`

**Interfaces:**
- Consumes: `SidecarClient` (Task 5) — injected, not constructed internally,
  so tests can supply a fake.
- Produces: `SidecarState` type (`"starting" | "ready" | "error"`),
  `SidecarProcess` class with `start(): Promise<void>`,
  `getState(): SidecarState`, `onStateChange(listener: (state: SidecarState) => void): void`,
  `stop(): Promise<void>` — Task 7 depends on these exact names.

- [ ] **Step 1: Write the failing test — `tests/sidecar-process.test.ts`**

```typescript
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { SidecarProcess } from "../src/main/sidecar-process";
import type { SidecarClient } from "../src/main/sidecar-client";

function fakeChildProcess() {
  const emitter = new EventEmitter() as EventEmitter & { kill: () => void };
  emitter.kill = vi.fn();
  return emitter;
}

describe("SidecarProcess", () => {
  it("reaches 'ready' once the client's health check succeeds", async () => {
    const child = fakeChildProcess();
    const spawnFn = vi.fn().mockReturnValue(child);
    const client = {
      health: vi.fn().mockResolvedValue({ status: "ok" }),
    } as unknown as SidecarClient;

    const states: string[] = [];
    const process = new SidecarProcess({
      spawnFn,
      client,
      pythonExecutable: "python",
      scriptArgs: ["-m", "uvicorn", "app.main:app"],
      healthPollIntervalMs: 1,
    });
    process.onStateChange((state) => states.push(state));

    await process.start();

    expect(process.getState()).toBe("ready");
    expect(states).toEqual(["starting", "ready"]);
    expect(spawnFn).toHaveBeenCalledWith(
      "python",
      ["-m", "uvicorn", "app.main:app"],
      expect.anything(),
    );
  });

  it("reaches 'error' if the health check never succeeds within the retry budget", async () => {
    const child = fakeChildProcess();
    const spawnFn = vi.fn().mockReturnValue(child);
    const client = {
      health: vi.fn().mockRejectedValue(new Error("connection refused")),
    } as unknown as SidecarClient;

    const process = new SidecarProcess({
      spawnFn,
      client,
      pythonExecutable: "python",
      scriptArgs: [],
      healthPollIntervalMs: 1,
      maxHealthPollAttempts: 3,
    });

    await process.start();

    expect(process.getState()).toBe("error");
    expect(client.health).toHaveBeenCalledTimes(3);
  });

  it("stop() kills the child process", async () => {
    const child = fakeChildProcess();
    const spawnFn = vi.fn().mockReturnValue(child);
    const client = { health: vi.fn().mockResolvedValue({ status: "ok" }) } as unknown as SidecarClient;

    const process = new SidecarProcess({
      spawnFn,
      client,
      pythonExecutable: "python",
      scriptArgs: [],
      healthPollIntervalMs: 1,
    });
    await process.start();
    await process.stop();

    expect(child.kill).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- sidecar-process
```
Expected: FAIL — `Cannot find module '../src/main/sidecar-process'`.

- [ ] **Step 3: Write `src/main/sidecar-process.ts`**

```typescript
import type { ChildProcess, SpawnOptions } from "node:child_process";
import type { SidecarClient } from "./sidecar-client";

export type SidecarState = "starting" | "ready" | "error";

type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export type SidecarProcessOptions = {
  spawnFn: SpawnFn;
  client: SidecarClient;
  pythonExecutable: string;
  scriptArgs: readonly string[];
  healthPollIntervalMs?: number;
  maxHealthPollAttempts?: number;
};

export class SidecarProcess {
  private readonly spawnFn: SpawnFn;
  private readonly client: SidecarClient;
  private readonly pythonExecutable: string;
  private readonly scriptArgs: readonly string[];
  private readonly healthPollIntervalMs: number;
  private readonly maxHealthPollAttempts: number;
  private state: SidecarState = "starting";
  private child: ChildProcess | undefined;
  private listeners: Array<(state: SidecarState) => void> = [];

  constructor(options: SidecarProcessOptions) {
    this.spawnFn = options.spawnFn;
    this.client = options.client;
    this.pythonExecutable = options.pythonExecutable;
    this.scriptArgs = options.scriptArgs;
    this.healthPollIntervalMs = options.healthPollIntervalMs ?? 500;
    this.maxHealthPollAttempts = options.maxHealthPollAttempts ?? 40;
  }

  getState(): SidecarState {
    return this.state;
  }

  onStateChange(listener: (state: SidecarState) => void): void {
    this.listeners.push(listener);
  }

  private setState(state: SidecarState): void {
    this.state = state;
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  async start(): Promise<void> {
    this.setState("starting");
    this.child = this.spawnFn(this.pythonExecutable, this.scriptArgs, {});

    for (let attempt = 0; attempt < this.maxHealthPollAttempts; attempt++) {
      try {
        await this.client.health();
        this.setState("ready");
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, this.healthPollIntervalMs));
      }
    }
    this.setState("error");
  }

  async stop(): Promise<void> {
    this.child?.kill();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- sidecar-process
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/sidecar-process.ts tests/sidecar-process.test.ts
git commit -m "Add SidecarProcess spawn/health-poll/shutdown lifecycle"
```

---

### Task 7: `ipc-handlers.ts` — wire `image:import` / `image:detect` / `image:inpaint`

**Files:**
- Create: `src/main/ipc-handlers.ts`
- Test: `tests/ipc-handlers.test.ts`

**Interfaces:**
- Consumes: `SidecarClient` (Task 5, exact methods `detect`/`inpaint`).
- Produces: `registerIpcHandlers(ipcMain: IpcMainLike, client: SidecarClient): void` —
  the image-ID-keyed store is internal to this function (a `Map`), not an
  injected parameter. Task 8 calls this from `src/main/index.ts` with the
  real `ipcMain`.

- [ ] **Step 1: Write the failing test — `tests/ipc-handlers.test.ts`**

```typescript
import { describe, expect, it, vi } from "vitest";
import { registerIpcHandlers } from "../src/main/ipc-handlers";
import type { SidecarClient } from "../src/main/sidecar-client";

describe("registerIpcHandlers", () => {
  function setup() {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
        handlers.set(channel, listener);
      }),
    };
    const client = {
      detect: vi.fn().mockResolvedValue(Buffer.from("mask-bytes")),
      inpaint: vi.fn().mockResolvedValue(Buffer.from("result-bytes")),
    } as unknown as SidecarClient;

    registerIpcHandlers(ipcMain, client);
    return { handlers, client };
  }

  it("registers image:import, image:detect, and image:inpaint", () => {
    const { handlers } = setup();
    expect(handlers.has("image:import")).toBe(true);
    expect(handlers.has("image:detect")).toBe(true);
    expect(handlers.has("image:inpaint")).toBe(true);
  });

  it("image:import assigns and returns an imageId", async () => {
    const { handlers } = setup();
    const importHandler = handlers.get("image:import");
    if (importHandler === undefined) throw new Error("handler not registered");

    const result = (await importHandler({}, { buffer: Buffer.from("png-bytes") })) as {
      imageId: string;
    };
    expect(typeof result.imageId).toBe("string");
    expect(result.imageId.length).toBeGreaterThan(0);
  });

  it("image:detect calls client.detect with the imported image's bytes", async () => {
    const { handlers, client } = setup();
    const importHandler = handlers.get("image:import");
    const detectHandler = handlers.get("image:detect");
    if (importHandler === undefined || detectHandler === undefined) {
      throw new Error("handlers not registered");
    }

    const { imageId } = (await importHandler({}, { buffer: Buffer.from("png-bytes") })) as {
      imageId: string;
    };
    const result = (await detectHandler({}, { imageId })) as { maskBase64: string };

    expect(client.detect).toHaveBeenCalledWith(Buffer.from("png-bytes"));
    expect(Buffer.from(result.maskBase64, "base64").toString()).toBe("mask-bytes");
  });

  it("image:detect rejects an unknown imageId", async () => {
    const { handlers } = setup();
    const detectHandler = handlers.get("image:detect");
    if (detectHandler === undefined) throw new Error("handler not registered");

    await expect(detectHandler({}, { imageId: "does-not-exist" })).rejects.toThrow(
      /unknown imageId/i,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- ipc-handlers
```
Expected: FAIL — `Cannot find module '../src/main/ipc-handlers'`.

- [ ] **Step 3: Write `src/main/ipc-handlers.ts`**

```typescript
import { randomUUID } from "node:crypto";
import type { SidecarClient } from "./sidecar-client";

export type IpcMainLike = {
  handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => void;
};

export function registerIpcHandlers(ipcMain: IpcMainLike, client: SidecarClient): void {
  const images = new Map<string, Buffer>();

  ipcMain.handle("image:import", (_event, args) => {
    const { buffer } = args as { buffer: Buffer };
    const imageId = randomUUID();
    images.set(imageId, buffer);
    return { imageId };
  });

  ipcMain.handle("image:detect", async (_event, args) => {
    const { imageId } = args as { imageId: string };
    const image = images.get(imageId);
    if (image === undefined) {
      throw new Error(`Unknown imageId: ${imageId}`);
    }
    const mask = await client.detect(image);
    return { maskBase64: mask.toString("base64") };
  });

  ipcMain.handle("image:inpaint", async (_event, args) => {
    const { imageId, maskBase64 } = args as { imageId: string; maskBase64: string };
    const image = images.get(imageId);
    if (image === undefined) {
      throw new Error(`Unknown imageId: ${imageId}`);
    }
    const mask = Buffer.from(maskBase64, "base64");
    const result = await client.inpaint(image, mask);
    images.set(imageId, result);
    return { resultBase64: result.toString("base64") };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- ipc-handlers
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc-handlers.ts tests/ipc-handlers.test.ts
git commit -m "Add IPC handlers for image:import, image:detect, image:inpaint"
```

---

### Task 8: Wire the app entry, preload, and minimal renderer; manual verification

**Files:**
- Modify: `src/main/index.ts`
- Create: `src/preload/index.ts`
- Create: `src/renderer/index.html`
- Create: `src/renderer/renderer.ts`
- Create: `sidecar/run.py` (uvicorn entry point the main process spawns)

**Interfaces:**
- Consumes: `SidecarProcess` (Task 6), `SidecarClient` (Task 5),
  `registerIpcHandlers` (Task 7).
- Produces: a runnable app (`npm start`) — this is the task's deliverable;
  there is no further task depending on its internals.

- [ ] **Step 1: Write `sidecar/run.py`** (a stable entry point for `spawnFn`, independent of cwd)

```python
import uvicorn

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="127.0.0.1", port=8756)
```

- [ ] **Step 2: Rewrite `src/main/index.ts`**

```typescript
import { spawn } from "node:child_process";
import * as path from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { SidecarClient } from "./sidecar-client";
import { SidecarProcess } from "./sidecar-process";
import { registerIpcHandlers } from "./ipc-handlers";

const SIDECAR_URL = "http://127.0.0.1:8756";

async function createWindow(): Promise<void> {
  const client = new SidecarClient(SIDECAR_URL);
  const sidecarProcess = new SidecarProcess({
    spawnFn: spawn,
    client,
    pythonExecutable: "python",
    scriptArgs: ["run.py"],
  });
  sidecarProcess.onStateChange((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send("sidecar:state", { state });
    }
  });

  registerIpcHandlers(ipcMain, client);

  const window = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
    },
  });
  void window.loadFile("src/renderer/index.html");

  await sidecarProcess.start();

  app.on("before-quit", () => {
    void sidecarProcess.stop();
  });
}

app.whenReady().then(() => {
  void createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
```

> Note: `scriptArgs: ["run.py"]` assumes the sidecar process's cwd is
> `sidecar/`. Electron's `spawn` needs `{ cwd: path.join(__dirname, "../../sidecar") }`
> passed as its options — add this when running `npm start` for real; the
> unit tests in Task 6 don't exercise cwd since `spawnFn` is faked there.

- [ ] **Step 3: Write `src/preload/index.ts`**

```typescript
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  importImage: (buffer: Uint8Array) => ipcRenderer.invoke("image:import", { buffer }),
  detect: (imageId: string) => ipcRenderer.invoke("image:detect", { imageId }),
  inpaint: (imageId: string, maskBase64: string) =>
    ipcRenderer.invoke("image:inpaint", { imageId, maskBase64 }),
});
```

- [ ] **Step 4: Write `src/renderer/index.html`**

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Latent Tools</title>
  </head>
  <body>
    <input type="file" id="file-input" accept="image/png" />
    <button id="detect-btn" disabled>Detect watermark</button>
    <button id="inpaint-btn" disabled>Remove watermark</button>
    <div>
      <img id="preview" style="max-width: 480px" />
    </div>
    <script src="renderer.js"></script>
  </body>
</html>
```

- [ ] **Step 5: Write `src/renderer/renderer.ts`**

```typescript
declare global {
  interface Window {
    api: {
      importImage: (buffer: Uint8Array) => Promise<{ imageId: string }>;
      detect: (imageId: string) => Promise<{ maskBase64: string }>;
      inpaint: (imageId: string, maskBase64: string) => Promise<{ resultBase64: string }>;
    };
  }
}

let currentImageId: string | undefined;
let currentMaskBase64: string | undefined;

const fileInput = document.getElementById("file-input") as HTMLInputElement;
const detectBtn = document.getElementById("detect-btn") as HTMLButtonElement;
const inpaintBtn = document.getElementById("inpaint-btn") as HTMLButtonElement;
const preview = document.getElementById("preview") as HTMLImageElement;

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (file === undefined) return;
  const buffer = new Uint8Array(await file.arrayBuffer());
  const { imageId } = await window.api.importImage(buffer);
  currentImageId = imageId;
  preview.src = URL.createObjectURL(file);
  detectBtn.disabled = false;
});

detectBtn.addEventListener("click", async () => {
  if (currentImageId === undefined) return;
  const { maskBase64 } = await window.api.detect(currentImageId);
  currentMaskBase64 = maskBase64;
  inpaintBtn.disabled = false;
});

inpaintBtn.addEventListener("click", async () => {
  if (currentImageId === undefined || currentMaskBase64 === undefined) return;
  const { resultBase64 } = await window.api.inpaint(currentImageId, currentMaskBase64);
  preview.src = `data:image/png;base64,${resultBase64}`;
});
```

- [ ] **Step 6: Update the build to include preload/renderer, then build**

Modify `tsconfig.json`'s `include` if needed (it already covers all of `src`,
so no change is required — verify by running the build):
```bash
npm run build
```
Expected: `dist/main/index.js`, `dist/preload/index.js`, and
`dist/renderer/renderer.js` all exist with no type errors.

- [ ] **Step 7: Manual verification (real GPU, no automated test — this is the Phase 1 acceptance check)**

1. In one terminal, from `sidecar/`: `pip install -e ".[dev]"` (if not already
   done in Task 1) then leave the sidecar startable — the Electron app spawns
   it itself, no need to run it manually first.
2. From the repo root: `npm start`.
3. In the window that opens, click the file input and choose a PNG with a
   visible watermark.
4. Click **Detect watermark** — wait for it to finish (first run downloads
   Florence-2-base, ~460MB).
5. Click **Remove watermark** — wait for it to finish (first run downloads
   LaMa, ~196MB).
6. Confirm the displayed image no longer shows the watermark in the
   originally-marked region.

This manual pass is Phase 1's real acceptance criterion (per
`docs/implementation-plan.md`'s Testing strategy — GPU-dependent end-to-end
runs are gated/manual, not CI-automated). Record the result (pass/fail, and
which step failed if not) before moving to Phase 2.

- [ ] **Step 8: Commit**

```bash
git add src/main/index.ts src/preload/index.ts src/renderer sidecar/run.py
git commit -m "Wire main process, preload, and minimal renderer for the detect/inpaint round trip"
```

---

## Self-Review Notes

- **Spec coverage:** Task 1–3 cover the sidecar half of Phase 1's "Get
  Electron main ↔ Python sidecar talking over HTTP... prove detect → inpaint
  works end-to-end on the RTX 5080 with real models" goal; Tasks 4–8 cover
  the Electron half and the manual GPU acceptance check. Format conversion,
  captioning, manual mask editing, and batch mode are explicitly out of
  scope here — they're Phases 2–5 in `docs/implementation-plan.md`.
- **No placeholders:** every code block is complete; the one open decision
  (`cwd` for the spawned sidecar process) is called out explicitly as a note
  in Task 8 rather than hidden as a TODO, because it only matters for the
  real `npm start` run, not for any test in this plan.
- **Type/name consistency checked:** `SidecarClient.detect`/`inpaint` (Task 5)
  match the calls in `ipc-handlers.ts` (Task 7) and `SidecarProcessOptions`
  (Task 6); `registerIpcHandlers(ipcMain, client)` signature is consistent
  between Task 7's test and Task 8's usage in `index.ts`.
