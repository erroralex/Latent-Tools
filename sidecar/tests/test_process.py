import base64
import io

from PIL import Image

from app.main import app
from app.captioning import get_captioner
from app.detection import get_detector
from app.inpainting import get_inpainter


class FakeDetector:
    def detect(self, image: Image.Image) -> Image.Image:
        mask = Image.new("L", image.size, color=0)
        mask.paste(255, (0, 0, image.width // 2, image.height // 2))
        return mask


class FakeInpainter:
    def inpaint(self, image: Image.Image, mask: Image.Image) -> Image.Image:
        result = image.copy()
        result.paste((255, 0, 0, 255), mask=mask)
        return result


class FakeCaptioner:
    def __init__(self, canned_response: str | None = "A photo of a scenic landscape.") -> None:
        self._canned_response = canned_response

    def caption(self, image: Image.Image, system_prompt: str | None = None) -> str | None:
        return self._canned_response


def _png_base64(image: Image.Image) -> str:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def test_process_convert_only_skips_detect_inpaint_and_caption(client):
    image = Image.new("RGB", (64, 64), color=(10, 20, 30))

    response = client.post(
        "/process",
        json={
            "image_base64": _png_base64(image),
            "format": "webp",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["content_type"] == "image/webp"
    assert data["caption"] is None

    result = Image.open(io.BytesIO(base64.b64decode(data["result_base64"])))
    assert result.size == (64, 64)


def test_process_runs_full_pipeline_in_one_call(client):
    app.dependency_overrides[get_detector] = lambda: FakeDetector()
    app.dependency_overrides[get_inpainter] = lambda: FakeInpainter()
    app.dependency_overrides[get_captioner] = lambda: FakeCaptioner("A watermark-free photo.")
    try:
        image = Image.new("RGB", (64, 64), color=(0, 255, 0))

        response = client.post(
            "/process",
            json={
                "image_base64": _png_base64(image),
                "auto_remove_watermark": True,
                "generate_caption": True,
                "format": "png",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["caption"] == "A watermark-free photo."

        result = Image.open(io.BytesIO(base64.b64decode(data["result_base64"]))).convert("RGB")
        # Inside the detected/inpainted top-left quadrant, pixels are now red.
        assert result.getpixel((10, 10)) == (255, 0, 0)
        # Outside the mask, the original green is untouched.
        assert result.getpixel((50, 50)) == (0, 255, 0)
    finally:
        app.dependency_overrides.clear()


def test_process_rejects_unsupported_format(client):
    image = Image.new("RGB", (10, 10))

    response = client.post(
        "/process",
        json={"image_base64": _png_base64(image), "format": "bmp"},
    )

    assert response.status_code == 400


def test_process_uses_model_specific_captioner(client, monkeypatch):
    monkeypatch.setattr(
        "app.main.get_captioner_for_model",
        lambda model_id: FakeCaptioner(f"Caption via {model_id}"),
    )
    image = Image.new("RGB", (32, 32), color=(1, 2, 3))

    response = client.post(
        "/process",
        json={
            "image_base64": _png_base64(image),
            "generate_caption": True,
            "model_id": "Qwen/Qwen2-VL-7B-Instruct",
            "format": "png",
        },
    )

    assert response.status_code == 200
    assert response.json()["caption"] == "Caption via Qwen/Qwen2-VL-7B-Instruct"
