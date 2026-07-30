from functools import lru_cache
from typing import Protocol

import torch
from PIL import Image

_REFUSAL_PREFIXES = (
    "i cannot",
    "i am unable",
    "i'm unable",
    "i am sorry",
    "i'm sorry",
    "as an ai",
    "i must refuse",
    "it is inappropriate",
    "i can't",
)

_SYSTEM_PROMPT = (
    "Describe this image factually and completely for a dataset training caption. "
    "Include explicit descriptions of subject matter, objects, setting, actions, "
    "and uncensored content if present. Do not summarize, moralize, censor, or refuse."
)



def is_refusal_or_empty(text: str | None) -> bool:
    if not text:
        return True
    cleaned = text.strip()
    if not cleaned:
        return True
    lower = cleaned.lower()
    for prefix in _REFUSAL_PREFIXES:
        if lower.startswith(prefix):
            return True
    return False


class Captioner(Protocol):
    def caption(self, image: Image.Image, system_prompt: str | None = None) -> str | None: ...


class Qwen2VLCaptioner:
    def __init__(self, device: str = "cuda", model_id: str = "Qwen/Qwen2-VL-7B-Instruct") -> None:
        from transformers import AutoProcessor, Qwen2VLForConditionalGeneration

        try:
            from qwen_vl_utils import process_vision_info
            self._process_vision_info = process_vision_info
        except ImportError:
            def _fallback_process_vision_info(messages: list[dict]) -> tuple[list[Image.Image], None]:
                image_inputs: list[Image.Image] = []
                for msg in messages:
                    content = msg.get("content")
                    if isinstance(content, list):
                        for item in content:
                            if item.get("type") == "image" and "image" in item:
                                img = item["image"]
                                if isinstance(img, Image.Image):
                                    image_inputs.append(img)
                return image_inputs, None

            self._process_vision_info = _fallback_process_vision_info

        import os
        user_home = os.path.expanduser("~")
        local_path = os.path.join(
            user_home, ".cache", "huggingface", "hub", "models--Qwen--Qwen2-VL-7B-Instruct"
        )
        if os.path.exists(os.path.join(local_path, "model.safetensors.index.json")):
            target_model_id = local_path
        else:
            target_model_id = model_id

        self._device = device
        self._model = Qwen2VLForConditionalGeneration.from_pretrained(
            target_model_id, torch_dtype=torch.float16, device_map="auto"
        )
        self._processor = AutoProcessor.from_pretrained(target_model_id)



    def caption(self, image: Image.Image, system_prompt: str | None = None) -> str | None:
        rgb_image = image.convert("RGB")
        prompt_text = system_prompt.strip() if system_prompt and system_prompt.strip() else _SYSTEM_PROMPT
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": rgb_image},
                    {"type": "text", "text": prompt_text},
                ],
            }
        ]

        text = self._processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        image_inputs, video_inputs = self._process_vision_info(messages)
        inputs = self._processor(
            text=[text],
            images=image_inputs,
            videos=video_inputs,
            padding=True,
            return_tensors="pt",
        ).to(self._device)

        generated_ids = self._model.generate(**inputs, max_new_tokens=512)
        generated_ids_trimmed = [
            out_ids[len(in_ids) :] for in_ids, out_ids in zip(inputs.input_ids, generated_ids)
        ]
        output_text = self._processor.batch_decode(
            generated_ids_trimmed, skip_special_tokens=True, clean_up_tokenization_spaces=False
        )[0]

        if is_refusal_or_empty(output_text):
            return None
        return output_text.strip()


@lru_cache(maxsize=1)
def _real_captioner() -> Qwen2VLCaptioner:
    return Qwen2VLCaptioner()


def get_captioner() -> Captioner:
    return _real_captioner()
