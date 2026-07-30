import numpy as np
import pytest
import torch
from PIL import Image

from app.inpainting import LamaInpainter


@pytest.mark.gpu
def test_lama_inpainter_changes_masked_region_on_real_gpu():
    assert torch.cuda.is_available(), "This test requires a CUDA GPU"

    image = Image.fromarray(
        (np.random.rand(256, 256, 3) * 255).astype(np.uint8), mode="RGB"
    )
    mask = Image.new("L", (256, 256), color=0)
    mask.paste(255, (64, 64, 192, 192))

    inpainter = LamaInpainter(device="cuda")
    result = inpainter.inpaint(image, mask)

    original = np.array(image)
    changed = np.array(result)
    assert not np.array_equal(
        original[64:192, 64:192], changed[64:192, 64:192]
    ), "Masked region should have been repainted, not copied through"
