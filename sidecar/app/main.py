import base64
import io
import os
import signal
import subprocess
import threading
import time
import torch

from fastapi import Depends, FastAPI, HTTPException
from PIL import Image, ImageColor, ImageOps

from app.captioning import get_captioner, get_captioner_for_model
from app.detection import WatermarkDetector, get_detector
from app.inpainting import Inpainter, get_inpainter
from app.logger import logger
from app.schemas import (
    CaptionRequestBody,
    CaptionResponseBody,
    ConvertRequestBody,
    ConvertResponseBody,
    DetectRequestBody,
    DetectResponseBody,
    GpuStatusResponseBody,
    InpaintRequestBody,
    InpaintResponseBody,
    NormalizeRequestBody,
    NormalizeResponseBody,
    ProcessRequestBody,
    ProcessResponseBody,
)

app = FastAPI(title="Latent Tools Sidecar")


@app.on_event("startup")
def on_startup() -> None:
    logger.info("[Sidecar] Latent Tools Python sidecar starting up...")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


def _terminate_process() -> None:
    os.kill(os.getpid(), signal.SIGTERM)


@app.post("/shutdown")
def shutdown() -> dict:
    # Terminate from a background thread, after the response has had a
    # moment to flush — this lets the caller (Electron, on app quit) know
    # the sidecar accepted the shutdown request, whether it was spawned by
    # Electron itself or started independently (e.g. an IntelliJ run config).
    logger.info("[Sidecar] Received shutdown request. Shutting down sidecar...")

    def _delayed_terminate() -> None:
        time.sleep(0.1)
        _terminate_process()

    threading.Thread(target=_delayed_terminate, daemon=True).start()
    return {"status": "shutting down"}


@app.get("/gpu", response_model=GpuStatusResponseBody)
def gpu_status() -> GpuStatusResponseBody:
    try:
        res = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total,memory.used,temperature.gpu",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=1,
        )
        if res.returncode == 0 and res.stdout.strip():
            parts = [p.strip() for p in res.stdout.strip().split(",")]
            if len(parts) >= 4:
                name = parts[0].replace("NVIDIA GeForce ", "").replace("NVIDIA ", "")
                total_mb = float(parts[1])
                used_mb = float(parts[2])
                temp_c = int(parts[3])
                total_gb = round(total_mb / 1024.0, 1)
                used_gb = round(used_mb / 1024.0, 1)
                pct = round((used_mb / total_mb) * 100, 1) if total_mb > 0 else 0.0
                return GpuStatusResponseBody(
                    name=name,
                    vram_used_mb=used_mb,
                    vram_total_mb=total_mb,
                    vram_used_gb=used_gb,
                    vram_total_gb=total_gb,
                    vram_pct=pct,
                    temperature_c=temp_c,
                    status="ok",
                )
    except Exception:
        pass

    if torch.cuda.is_available():
        try:
            name = (
                torch.cuda.get_device_name(0)
                .replace("NVIDIA GeForce ", "")
                .replace("NVIDIA ", "")
            )
            free_b, total_b = torch.cuda.mem_get_info(0)
            used_b = total_b - free_b
            total_gb = round(total_b / (1024**3), 1)
            used_gb = round(used_b / (1024**3), 1)
            pct = round((used_b / total_b) * 100, 1) if total_b > 0 else 0.0
            return GpuStatusResponseBody(
                name=name,
                vram_used_mb=round(used_b / (1024**2), 1),
                vram_total_mb=round(total_b / (1024**2), 1),
                vram_used_gb=used_gb,
                vram_total_gb=total_gb,
                vram_pct=pct,
                temperature_c=None,
                status="ok",
            )
        except Exception:
            pass

    return GpuStatusResponseBody(
        name="No CUDA GPU",
        vram_used_mb=0,
        vram_total_mb=0,
        vram_used_gb=0,
        vram_total_gb=0,
        vram_pct=0,
        temperature_c=None,
        status="none",
    )



@app.post("/caption", response_model=CaptionResponseBody)
def caption(body: CaptionRequestBody) -> CaptionResponseBody:
    try:
        image = _decode_png(body.image_base64)
        if body.model_id:
            active_captioner = get_captioner_for_model(body.model_id)
        else:
            # Resolved lazily (rather than via Depends()) so a request that
            # specifies model_id never pays for loading the default model too.
            captioner_fn = app.dependency_overrides.get(get_captioner, get_captioner)
            active_captioner = captioner_fn()
        result_caption = active_captioner.caption(image, system_prompt=body.system_prompt)
        return CaptionResponseBody(caption=result_caption)
    except Exception as e:
        logger.error(f"[/caption endpoint error]: {e}")
        return CaptionResponseBody(caption=None)





@app.post("/normalize", response_model=NormalizeResponseBody)
def normalize(body: NormalizeRequestBody) -> NormalizeResponseBody:
    try:
        logger.info("[Normalize] Normalizing image orientation and mode to RGBA PNG...")
        raw_bytes = base64.b64decode(body.image_base64)
        image = Image.open(io.BytesIO(raw_bytes))
        image = ImageOps.exif_transpose(image)
        image = image.convert("RGBA")
        return NormalizeResponseBody(normalized_base64=_encode_png(image))
    except Exception as e:
        logger.error(f"[Normalize] Failed to normalize image: {e}")
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


_CONTENT_TYPES = {
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
}


def _normalize_format(format_str: str) -> str:
    fmt = format_str.lower()
    if fmt == "jpg":
        fmt = "jpeg"
    if fmt not in _CONTENT_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported format: {format_str}")
    return fmt


def _encode_image(
    image: Image.Image,
    fmt: str,
    quality: int,
    lossless: bool,
    compress_level: int,
    metadata_mode: str,
    original_bytes: bytes | None,
    flatten_color: str | None,
) -> tuple[bytes, str]:
    save_kwargs = {}
    target_image = image

    if fmt == "jpeg":
        save_kwargs["quality"] = max(1, min(100, quality))
        if target_image.mode in ("RGBA", "LA", "P"):
            bg_color = _parse_flatten_color(flatten_color)
            bg = Image.new("RGB", target_image.size, bg_color)
            if target_image.mode == "P":
                target_image = target_image.convert("RGBA")
            alpha = target_image.split()[-1]
            bg.paste(target_image, mask=alpha)
            target_image = bg
        elif target_image.mode != "RGB":
            target_image = target_image.convert("RGB")
    elif fmt == "webp":
        save_kwargs["quality"] = max(1, min(100, quality))
        save_kwargs["lossless"] = lossless
    elif fmt == "png":
        save_kwargs["compress_level"] = max(0, min(9, compress_level))

    if metadata_mode == "keep" and original_bytes:
        try:
            orig_img = Image.open(io.BytesIO(original_bytes))
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
    return buf.getvalue(), _CONTENT_TYPES[fmt]


@app.post("/convert", response_model=ConvertResponseBody)
def convert(body: ConvertRequestBody) -> ConvertResponseBody:
    try:
        fmt = _normalize_format(body.format)
        logger.info(f"[Convert] Converting image to target format '{fmt.upper()}' (quality={body.quality}, metadata={body.metadata_mode})...")
        working_image = Image.open(io.BytesIO(base64.b64decode(body.image_base64)))

        original_bytes = base64.b64decode(body.original_base64) if body.original_base64 else None
        result_bytes, content_type = _encode_image(
            working_image,
            fmt,
            body.quality,
            body.lossless,
            body.compress_level,
            body.metadata_mode,
            original_bytes,
            body.flatten_color,
        )
        logger.info(f"[Convert] Image converted successfully to {fmt.upper()}.")

        return ConvertResponseBody(
            result_base64=base64.b64encode(result_bytes).decode(),
            content_type=content_type,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Convert] Failed to convert image: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to convert image: {str(e)}")


@app.post("/process", response_model=ProcessResponseBody)
def process(
    body: ProcessRequestBody,
    detector: WatermarkDetector = Depends(get_detector),
    inpainter: Inpainter = Depends(get_inpainter),
) -> ProcessResponseBody:
    try:
        fmt = _normalize_format(body.format)
        raw_bytes = base64.b64decode(body.image_base64)

        logger.info("[Process] Normalizing image orientation and mode to RGBA...")
        image = Image.open(io.BytesIO(raw_bytes))
        image = ImageOps.exif_transpose(image)
        image = image.convert("RGBA")

        if body.auto_remove_watermark:
            logger.info("[Process] Detecting watermark...")
            mask = detector.detect(image)
            logger.info("[Process] Inpainting detected region...")
            image = inpainter.inpaint(image, mask)

        caption_text: str | None = None
        if body.generate_caption:
            logger.info("[Process] Generating caption...")
            if body.model_id:
                active_captioner = get_captioner_for_model(body.model_id)
            else:
                captioner_fn = app.dependency_overrides.get(get_captioner, get_captioner)
                active_captioner = captioner_fn()
            caption_text = active_captioner.caption(image, system_prompt=body.system_prompt)

        logger.info(f"[Process] Converting to target format '{fmt.upper()}'...")
        result_bytes, content_type = _encode_image(
            image,
            fmt,
            body.quality,
            body.lossless,
            body.compress_level,
            body.metadata_mode,
            raw_bytes,
            body.flatten_color,
        )
        logger.info("[Process] Pipeline complete.")

        return ProcessResponseBody(
            result_base64=base64.b64encode(result_bytes).decode(),
            content_type=content_type,
            caption=caption_text,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Process] Failed to process image: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to process image: {str(e)}")

