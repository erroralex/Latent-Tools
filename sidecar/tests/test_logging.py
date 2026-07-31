import logging
from unittest.mock import MagicMock
import numpy as np
from PIL import Image
from app.logger import logger


def test_logger_instance():
    assert logger.name == "sidecar"
    assert logger.level == logging.INFO
    assert len(logger.handlers) > 0


def test_logging_in_detection(caplog):
    from app.detection import Florence2Detector

    mock_model = MagicMock()
    mock_processor = MagicMock()
    mock_processor.return_value.to.return_value = {"input_ids": None, "pixel_values": None}
    mock_model.generate.return_value = [[1, 2, 3]]
    mock_processor.batch_decode.return_value = ["watermark"]
    mock_processor.post_process_generation.return_value = {
        "<OPEN_VOCABULARY_DETECTION>": {"bboxes": [[10, 10, 50, 50]]}
    }

    detector = Florence2Detector.__new__(Florence2Detector)
    detector._device = "cpu"
    detector._model = mock_model
    detector._processor = mock_processor

    with caplog.at_level(logging.INFO, logger="sidecar"):
        img = Image.new("RGB", (100, 100))
        res = detector.detect(img)
        assert res is not None

    messages = [rec.message for rec in caplog.records]
    assert any("[Detect] Starting watermark detection" in m for m in messages)
    assert any("[Detect] Watermark detection complete" in m for m in messages)


def test_logging_in_inpainting(caplog):
    from app.inpainting import LamaInpainter

    mock_manager = MagicMock()
    mock_manager.return_value = np.zeros((100, 100, 3), dtype=np.uint8)

    inpainter = LamaInpainter.__new__(LamaInpainter)
    inpainter._model_manager = mock_manager

    with caplog.at_level(logging.INFO, logger="sidecar"):
        img = Image.new("RGB", (100, 100))
        mask = Image.new("L", (100, 100))
        res = inpainter.inpaint(img, mask)
        assert res is not None

    messages = [rec.message for rec in caplog.records]
    assert any("[Inpaint] Starting watermark removal" in m for m in messages)
    assert any("[Inpaint] Watermark removal complete" in m for m in messages)
