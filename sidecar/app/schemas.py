from pydantic import BaseModel


class InpaintRequestBody(BaseModel):
    image_base64: str
    mask_base64: str


class InpaintResponseBody(BaseModel):
    result_base64: str


class DetectRequestBody(BaseModel):
    image_base64: str


class DetectResponseBody(BaseModel):
    mask_base64: str


class NormalizeRequestBody(BaseModel):
    image_base64: str


class NormalizeResponseBody(BaseModel):
    normalized_base64: str


class ConvertRequestBody(BaseModel):
    image_base64: str
    format: str
    quality: int = 90
    lossless: bool = False
    compress_level: int = 6
    metadata_mode: str = "strip"
    original_base64: str | None = None
    flatten_color: str | None = None


class ConvertResponseBody(BaseModel):
    result_base64: str
    content_type: str

