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
