import base64
import io
from PIL import Image

from app.main import app
from app.captioning import get_captioner, is_refusal_or_empty


class FakeCaptioner:
    def __init__(self, canned_response: str | None = "A high quality photo of a landscape with mountains.") -> None:
        self._canned_response = canned_response

    def caption(self, image: Image.Image) -> str | None:
        if is_refusal_or_empty(self._canned_response):
            return None
        return self._canned_response


def _png_base64(image: Image.Image) -> str:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def test_caption_endpoint_returns_caption(client):
    app.dependency_overrides[get_captioner] = lambda: FakeCaptioner("A photo of a cat on a couch.")
    try:
        image = Image.new("RGB", (64, 64), color=(10, 20, 30))
        response = client.post("/caption", json={"image_base64": _png_base64(image)})

        assert response.status_code == 200
        assert response.json()["caption"] == "A photo of a cat on a couch."
    finally:
        app.dependency_overrides.clear()


def test_caption_endpoint_maps_refusal_to_null(client):
    app.dependency_overrides[get_captioner] = lambda: FakeCaptioner("I cannot describe this image.")
    try:
        image = Image.new("RGB", (64, 64), color=(10, 20, 30))
        response = client.post("/caption", json={"image_base64": _png_base64(image)})

        assert response.status_code == 200
        assert response.json()["caption"] is None
    finally:
        app.dependency_overrides.clear()


def test_is_refusal_or_empty_patterns():
    assert is_refusal_or_empty(None) is True
    assert is_refusal_or_empty("") is True
    assert is_refusal_or_empty("   ") is True
    assert is_refusal_or_empty("I cannot fulfill this request.") is True
    assert is_refusal_or_empty("I'm sorry, but I can't generate captions for this.") is True
    assert is_refusal_or_empty("As an AI, I am unable to process this image.") is True
    assert is_refusal_or_empty("A beautiful sunset over the ocean.") is False
