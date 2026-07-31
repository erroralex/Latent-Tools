import os
import time
from functools import lru_cache
from typing import Protocol

import cv2
import numpy as np
import torch
from PIL import Image
from iopaint.model.lama import LaMa
from iopaint.model_manager import ModelManager
from iopaint.schema import InpaintRequest

from app.logger import logger

# Importing iopaint sets TORCH_CUDNN_V8_API_LRU_CACHE_LIMIT=1 process-wide (see its
# __init__.py) to avoid a CPU memory leak in its own long-running jobs. That caps
# cuDNN's execution-plan cache at a single entry, which makes Florence-2 detection
# ~10x slower: its vision encoder issues 156 convolutions across many shapes, so
# nearly every call re-runs cuDNN plan selection. Measured 2.74s -> 0.28s per image.
# PyTorch reads this lazily on first cuDNN use, so restoring it here still takes
# effect. iopaint's other two mitigations (LRU_CACHE_CAPACITY,
# ONEDNN_PRIMITIVE_CACHE_CAPACITY) are left alone -- they don't affect convolutions.
os.environ["TORCH_CUDNN_V8_API_LRU_CACHE_LIMIT"] = "10000"


class Inpainter(Protocol):
    def inpaint(self, image: Image.Image, mask: Image.Image) -> Image.Image: ...


class LamaInpainter:
    def __init__(self, device: str = "cuda") -> None:
        logger.info(f"[Inpaint] Initializing LaMa inpainter on device '{device}'...")
        if not LaMa.is_downloaded():
            logger.info("[Inpaint] Downloading LaMa model weights...")
            LaMa.download()
        self._model_manager = ModelManager(name="lama", device=torch.device(device))
        logger.info("[Inpaint] LaMa inpainter ready.")

    def inpaint(self, image: Image.Image, mask: Image.Image) -> Image.Image:
        start_time = time.perf_counter()
        logger.info(
            f"[Inpaint] Starting watermark removal (LaMa) on image ({image.width}x{image.height})..."
        )
        image_rgb = np.array(image.convert("RGB"), dtype=np.uint8)
        mask_hw = np.array(mask.convert("L"), dtype=np.uint8)
        result_bgr = self._model_manager(image_rgb, mask_hw, InpaintRequest())
        result_rgb = cv2.cvtColor(result_bgr, cv2.COLOR_BGR2RGB)
        elapsed = time.perf_counter() - start_time
        logger.info(f"[Inpaint] Watermark removal complete in {elapsed:.2f}s.")
        return Image.fromarray(result_rgb, mode="RGB")


@lru_cache(maxsize=1)
def _real_inpainter() -> LamaInpainter:
    return LamaInpainter()


def get_inpainter() -> Inpainter:
    return _real_inpainter()
