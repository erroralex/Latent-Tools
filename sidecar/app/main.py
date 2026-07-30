import base64
import io

from fastapi import Depends, FastAPI
from PIL import Image

from app.detection import WatermarkDetector, get_detector
from app.inpainting import Inpainter, get_inpainter
from app.schemas import (
    DetectRequestBody,
    DetectResponseBody,
    InpaintRequestBody,
    InpaintResponseBody,
)

app = FastAPI(title="Latent Tools Sidecar")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/detect", response_model=DetectResponseBody)
def detect(
    body: DetectRequestBody, detector: WatermarkDetector = Depends(get_detector)
) -> DetectResponseBody:
    image = _decode_png(body.image_base64)
    mask = detector.detect(image)
    return DetectResponseBody(mask_base64=_encode_png(mask))


def _decode_png(data_base64: str) -> Image.Image:
    return Image.open(io.BytesIO(base64.b64decode(data_base64)))


def _encode_png(image: Image.Image) -> str:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


@app.post("/inpaint", response_model=InpaintResponseBody)
def inpaint(
    body: InpaintRequestBody, inpainter: Inpainter = Depends(get_inpainter)
) -> InpaintResponseBody:
    image = _decode_png(body.image_base64)
    mask = _decode_png(body.mask_base64)
    result = inpainter.inpaint(image, mask)
    return InpaintResponseBody(result_base64=_encode_png(result))
