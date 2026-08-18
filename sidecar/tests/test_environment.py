import torch


def test_torch_is_a_cuda_build():
    # Regression guard for a packaging bug: `pip install -e .` pulls torch in
    # transitively via iopaint/transformers (a plain CPU wheel from PyPI), and
    # if the later `pip install torch --index-url .../cuXXX` step resolves to
    # the *same* version number already installed, pip reports "already
    # satisfied" and silently keeps the CPU build — captioning and watermark
    # removal then fail instantly with "Torch not compiled with CUDA enabled"
    # in every packaged release. This doesn't need a physical GPU (CI runners
    # have none) — it only checks which wheel variant got installed.
    assert torch.version.cuda is not None, (
        f"torch {torch.__version__} is a CPU-only build (torch.version.cuda is None). "
        "The CUDA-specific torch install step did not take effect."
    )
