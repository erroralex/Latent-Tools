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
