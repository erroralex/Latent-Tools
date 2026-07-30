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
        all_bboxes: list[list[float]] = []

        # Target prompts to catch all types of watermarks, logos, text overlays, and stamps
        tasks_and_prompts = [
            (_TASK, _TASK + "watermark"),
            (_TASK, _TASK + "logo"),
            (_TASK, _TASK + "text"),
            (_TASK, _TASK + "stamp"),
            ("<OCR_WITH_REGION>", "<OCR_WITH_REGION>"),
        ]

        for task, prompt in tasks_and_prompts:
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
                    generated_text, task=task, image_size=(rgb_image.width, rgb_image.height)
                )
                if task in parsed:
                    res = parsed[task]
                    if isinstance(res, dict):
                        if "bboxes" in res and isinstance(res["bboxes"], list):
                            all_bboxes.extend(res["bboxes"])
                        if "quad_boxes" in res and isinstance(res["quad_boxes"], list):
                            all_bboxes.extend(res["quad_boxes"])
            except Exception:
                pass

        return _mask_from_bboxes(all_bboxes, rgb_image.size)


def _mask_from_bboxes(bboxes: list[list[float]], size: tuple[int, int]) -> Image.Image:
    mask = np.zeros((size[1], size[0]), dtype=np.uint8)
    for box in bboxes:
        if len(box) == 4:
            x1, y1, x2, y2 = box
        elif len(box) == 8:
            x_coords = box[0::2]
            y_coords = box[1::2]
            x1, y1, x2, y2 = min(x_coords), min(y_coords), max(x_coords), max(y_coords)
        else:
            continue
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
