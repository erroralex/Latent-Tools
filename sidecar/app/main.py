import base64
import io

from fastapi import Depends, FastAPI, HTTPException
from PIL import Image, ImageColor, ImageOps

from app.detection import WatermarkDetector, get_detector
from app.inpainting import Inpainter, get_inpainter
from app.schemas import (
    ConvertRequestBody,
    ConvertResponseBody,
    DetectRequestBody,
    DetectResponseBody,
    InpaintRequestBody,
    InpaintResponseBody,
    NormalizeRequestBody,
    NormalizeResponseBody,
)

app = FastAPI(title="Latent Tools Sidecar")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/normalize", response_model=NormalizeResponseBody)
def normalize(body: NormalizeRequestBody) -> NormalizeResponseBody:
    try:
        raw_bytes = base64.b64decode(body.image_base64)
        image = Image.open(io.BytesIO(raw_bytes))
        image = ImageOps.exif_transpose(image)
        image = image.convert("RGBA")
        return NormalizeResponseBody(normalized_base64=_encode_png(image))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to normalize image: {str(e)}")


@app.post("/detect", response_model=DetectResponseBody)
def detect(
    body: DetectRequestBody, detector: WatermarkDetector = Depends(get_detector)
) -> DetectResponseBody:
    image = _decode_png(body.image_base64)
    mask = detector.detect(image)
    return DetectResponseBody(mask_base64=_encode_png(mask))


def _decode_png(data_base64: str) -> Image.Image:
    return Image.open(io.BytesIO(data_base64_to_bytes(data_base64)))


def data_base64_to_bytes(data_base64: str) -> bytes:
    return base64.b64decode(data_base64)


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


def _parse_flatten_color(color_str: str | None) -> tuple[int, int, int]:
    if not color_str:
        return (255, 255, 255)
    try:
        rgb = ImageColor.getrgb(color_str)
        return rgb[:3]
    except Exception:
        return (255, 255, 255)


@app.post("/convert", response_model=ConvertResponseBody)
def convert(body: ConvertRequestBody) -> ConvertResponseBody:
    try:
        working_image = Image.open(io.BytesIO(base64.b64decode(body.image_base64)))
        fmt = body.format.lower()
        if fmt == "jpg":
            fmt = "jpeg"

        if fmt not in ("jpeg", "png", "webp"):
            raise HTTPException(status_code=400, detail=f"Unsupported format: {body.format}")

        content_types = {
            "jpeg": "image/jpeg",
            "png": "image/png",
            "webp": "image/webp",
        }

        save_kwargs = {}
        target_image = working_image

        if fmt == "jpeg":
            save_kwargs["quality"] = max(1, min(100, body.quality))
            if target_image.mode in ("RGBA", "LA", "P"):
                bg_color = _parse_flatten_color(body.flatten_color)
                bg = Image.new("RGB", target_image.size, bg_color)
                if target_image.mode == "P":
                    target_image = target_image.convert("RGBA")
                alpha = target_image.split()[-1]
                bg.paste(target_image, mask=alpha)
                target_image = bg
            elif target_image.mode != "RGB":
                target_image = target_image.convert("RGB")
        elif fmt == "webp":
            save_kwargs["quality"] = max(1, min(100, body.quality))
            save_kwargs["lossless"] = body.lossless
        elif fmt == "png":
            save_kwargs["compress_level"] = max(0, min(9, body.compress_level))

        if body.metadata_mode == "keep" and body.original_base64:
            try:
                orig_bytes = base64.b64decode(body.original_base64)
                orig_img = Image.open(io.BytesIO(orig_bytes))
                icc = orig_img.info.get("icc_profile")
                if icc:
                    save_kwargs["icc_profile"] = icc
                exif = orig_img.getexif()
                if exif:
                    if 0x0112 in exif:
                        del exif[0x0112]
                    save_kwargs["exif"] = exif
            except Exception:
                pass

        buf = io.BytesIO()
        target_image.save(buf, format=fmt.upper(), **save_kwargs)
        result_b64 = base64.b64encode(buf.getvalue()).decode()

        return ConvertResponseBody(
            result_base64=result_b64,
            content_type=content_types[fmt],
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to convert image: {str(e)}")

