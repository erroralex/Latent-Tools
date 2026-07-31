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
