import time
from functools import lru_cache
from typing import Protocol

import cv2
import numpy as np
import torch
from PIL import Image
from transformers import AutoModelForCausalLM, AutoProcessor

from app.logger import logger

_TASK = "<OPEN_VOCABULARY_DETECTION>"
_MASK_DILATE_PX = 6  # grow each box slightly so inpainting covers watermark edges


class WatermarkDetector(Protocol):
    def detect(self, image: Image.Image) -> Image.Image: ...


class Florence2Detector:
    def __init__(self, device: str = "cuda", model_id: str = "microsoft/Florence-2-base") -> None:
        self._device = device
        logger.info(f"[Detect] Initializing Florence2Detector ({model_id}) on {device}...")
        self._model = AutoModelForCausalLM.from_pretrained(
            model_id, trust_remote_code=True, torch_dtype=torch.float16
        ).to(device)
        self._processor = AutoProcessor.from_pretrained(model_id, trust_remote_code=True)
        logger.info("[Detect] Florence2Detector ready.")

    def detect(self, image: Image.Image) -> Image.Image:
        start_time = time.perf_counter()
        logger.info(f"[Detect] Starting watermark detection on image ({image.width}x{image.height})...")
        rgb_image = image.convert("RGB")
        all_bboxes: list[list[float]] = []

        prompts = [
            _TASK + "watermark",
            _TASK + "text watermark",
            _TASK + "logo watermark",
        ]

        with torch.inference_mode():
            for prompt in prompts:
                try:
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
                    bboxes = parsed.get(_TASK, {}).get("bboxes", [])
                    all_bboxes.extend(bboxes)
                except Exception as e:
                    logger.warning(f"[Detect] Prompt execution error for '{prompt}': {e}")

        result_mask = _mask_from_bboxes(all_bboxes, rgb_image)
        elapsed = time.perf_counter() - start_time
        logger.info(
            f"[Detect] Watermark detection complete in {elapsed:.2f}s (found {len(all_bboxes)} bounding box candidate(s))."
        )
        return result_mask


def _mask_from_bboxes(bboxes: list[list[float]], image: Image.Image) -> Image.Image:
    size = image.size
    gray = np.array(image.convert("L"))
    mask = np.zeros((size[1], size[0]), dtype=np.uint8)
    max_box_area = 0.25 * (size[0] * size[1])  # Ignore boxes covering > 25% of total image area

    drawn_any = False
    for box in bboxes:
        if len(box) == 4:
            x1, y1, x2, y2 = box
        elif len(box) == 8:
            x_coords = box[0::2]
            y_coords = box[1::2]
            x1, y1, x2, y2 = min(x_coords), min(y_coords), max(x_coords), max(y_coords)
        else:
            continue

        ix1, iy1 = max(0, int(x1)), max(0, int(y1))
        ix2, iy2 = min(size[0], int(x2)), min(size[1], int(y2))
        w, h = ix2 - ix1, iy2 - iy1

        if w <= 0 or h <= 0 or (w * h) > max_box_area or h > 0.65 * size[1]:
            continue

        crop = gray[iy1:iy2, ix1:ix2]
        if crop.size == 0:
            continue

        # Extract text edge gradient and Otsu binarization inside the bounding box
        grad = cv2.morphologyEx(crop, cv2.MORPH_GRADIENT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
        _, otsu = cv2.threshold(grad, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        canny = cv2.Canny(crop, 50, 150)
        stroke_mask = cv2.bitwise_or(otsu, canny)

        # Dilate stroke mask to cover antialiased text edges cleanly
        kernel = np.ones((_MASK_DILATE_PX, _MASK_DILATE_PX), dtype=np.uint8)
        dilated_stroke = cv2.dilate(stroke_mask, kernel)

        # If strokes cover a valid text portion of the box (0.5% - 75%), use tight contour mask
        coverage = np.mean(dilated_stroke > 0)
        if 0.005 <= coverage <= 0.75:
            mask[iy1:iy2, ix1:ix2] = cv2.bitwise_or(mask[iy1:iy2, ix1:ix2], dilated_stroke)
        else:
            # Fallback to box if background contrast is low
            cv2.rectangle(mask, (ix1, iy1), (ix2, iy2), color=255, thickness=-1)

        drawn_any = True

    if drawn_any and np.mean(mask > 0) == 0:
        kernel = np.ones((_MASK_DILATE_PX, _MASK_DILATE_PX), dtype=np.uint8)
        mask = cv2.dilate(mask, kernel)

    return Image.fromarray(mask, mode="L")





@lru_cache(maxsize=1)
def _real_detector() -> Florence2Detector:
    return Florence2Detector()


def get_detector() -> WatermarkDetector:
    return _real_detector()
