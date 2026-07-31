import base64
import io
import os

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


def test_iopaint_cudnn_plan_cache_clamp_is_reverted():
    # iopaint's __init__ sets TORCH_CUDNN_V8_API_LRU_CACHE_LIMIT=1 process-wide to
    # avoid a CPU memory leak in its own long-running jobs. A one-entry cuDNN plan
    # cache makes Florence-2 detection ~10x slower (2.74s -> 0.28s per image when
    # reverted), because its vision encoder issues 156 convolutions across many
    # shapes and nearly every call re-runs plan selection. Importing app.inpainting
    # must leave a usable limit behind.
    import app.inpainting  # noqa: F401

    limit = os.environ.get("TORCH_CUDNN_V8_API_LRU_CACHE_LIMIT")
    assert limit is not None, "expected app.inpainting to set a cuDNN plan cache limit"
    assert int(limit) > 1, (
        f"cuDNN plan cache clamped to {limit} entries; iopaint's import-time clamp "
        "was not reverted, which makes watermark detection ~10x slower"
    )


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
