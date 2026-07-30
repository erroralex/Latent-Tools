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
