import base64
import io
from PIL import Image

def _img_to_b64(img: Image.Image, format: str = "PNG") -> str:
    buf = io.BytesIO()
    img.save(buf, format=format)
    return base64.b64encode(buf.getvalue()).decode()


def test_normalize_endpoint(client):
    img = Image.new("RGB", (100, 50), color=(200, 100, 50))
    b64_in = _img_to_b64(img, format="JPEG")

    res = client.post("/normalize", json={"image_base64": b64_in})
    assert res.status_code == 200
    data = res.json()
    assert "normalized_base64" in data

    norm_bytes = base64.b64decode(data["normalized_base64"])
    norm_img = Image.open(io.BytesIO(norm_bytes))
    assert norm_img.mode == "RGBA"
    assert norm_img.size == (100, 50)


def test_convert_jpeg_with_flatten(client):
    img = Image.new("RGBA", (50, 50), color=(255, 0, 0, 0)) # transparent red
    b64_in = _img_to_b64(img, format="PNG")

    res = client.post(
        "/convert",
        json={
            "image_base64": b64_in,
            "format": "jpeg",
            "quality": 90,
            "metadata_mode": "strip",
            "flatten_color": "#00FF00", # green background
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["content_type"] == "image/jpeg"

    out_bytes = base64.b64decode(data["result_base64"])
    out_img = Image.open(io.BytesIO(out_bytes))
    assert out_img.mode == "RGB"
    # Transparent area should now be green
    pixel = out_img.getpixel((10, 10))
    assert pixel[1] > 200 # high green channel value


def test_convert_webp_lossless(client):
    img = Image.new("RGBA", (20, 20), color=(10, 20, 30, 200))
    b64_in = _img_to_b64(img, format="PNG")

    res = client.post(
        "/convert",
        json={
            "image_base64": b64_in,
            "format": "webp",
            "quality": 100,
            "lossless": True,
            "metadata_mode": "strip",
        },
    )
    assert res.status_code == 200
    assert res.json()["content_type"] == "image/webp"


def test_convert_png_compression(client):
    img = Image.new("RGBA", (20, 20), color=(50, 50, 50, 255))
    b64_in = _img_to_b64(img, format="PNG")

    res = client.post(
        "/convert",
        json={
            "image_base64": b64_in,
            "format": "png",
            "compress_level": 9,
            "metadata_mode": "strip",
        },
    )
    assert res.status_code == 200
    assert res.json()["content_type"] == "image/png"


def test_convert_unsupported_format(client):
    img = Image.new("RGB", (10, 10))
    b64_in = _img_to_b64(img)

    res = client.post(
        "/convert",
        json={
            "image_base64": b64_in,
            "format": "bmp",
            "metadata_mode": "strip",
        },
    )
    assert res.status_code == 400
