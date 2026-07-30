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


def test_mask_from_bboxes_combines_multiple_watermarks_and_quads():
    from app.detection import _mask_from_bboxes

    # Multiple bounding boxes across different corners & quad_box format
    bboxes = [
        [0, 0, 10, 10],                        # Top-left box
        [50, 50, 60, 60],                      # Bottom-right box
        [20, 20, 30, 20, 30, 30, 20, 30],      # Quad box [x1,y1, x2,y2, x3,y3, x4,y4]
    ]
    mask = _mask_from_bboxes(bboxes, (100, 100))

    # All three regions should be masked (value 255)
    assert mask.getpixel((5, 5)) == 255
    assert mask.getpixel((55, 55)) == 255
    assert mask.getpixel((25, 25)) == 255
    # Unmasked region remains 0
    assert mask.getpixel((80, 10)) == 0

