from __future__ import annotations

from pathlib import Path
from urllib.request import urlretrieve
import logging

import cv2
import numpy as np
import torch
from PIL import Image
from gfpgan import GFPGANer


GFPGAN_URL = "https://github.com/TencentARC/GFPGAN/releases/download/v1.3.4/GFPGANv1.4.pth"
MIN_WEIGHT_BYTES = 20 * 1024 * 1024
logger = logging.getLogger(__name__)


class FaceRestoreService:
    def __init__(self, weights_dir: Path) -> None:
        self.weights_dir = weights_dir
        self.weights_dir.mkdir(parents=True, exist_ok=True)
        self.model_path = self.weights_dir / "GFPGANv1.4.pth"
        self._restorer: GFPGANer | None = None
        self.device = self._choose_device()

    @staticmethod
    def _choose_device() -> str:
        """Choose device: CUDA > CPU (skip MPS due to stability issues)."""
        if torch.cuda.is_available():
            return "cuda"
        # Skip MPS despite availability - stability issues with complex models
        return "cpu"

    def ensure_weights(self) -> None:
        if self.model_path.exists():
            self._validate_weights(self.model_path)
            logger.info("GFPGAN checkpoint found at %s", self.model_path)
            return

        logger.warning("GFPGAN checkpoint missing; downloading from %s", GFPGAN_URL)
        if not self.model_path.exists():
            urlretrieve(GFPGAN_URL, self.model_path)
        self._validate_weights(self.model_path)
        logger.info("GFPGAN checkpoint downloaded to %s", self.model_path)

    @staticmethod
    def _validate_weights(path: Path) -> None:
        if not path.exists():
            raise FileNotFoundError(f"GFPGAN checkpoint missing at {path}")
        size = path.stat().st_size
        if size < MIN_WEIGHT_BYTES:
            raise RuntimeError(f"GFPGAN checkpoint is unexpectedly small ({size} bytes): {path}")
        with path.open("rb") as fh:
            head = fh.read(256).lstrip()
        if head.startswith(b"<"):
            raise RuntimeError(f"GFPGAN checkpoint appears to be HTML instead of weights: {path}")

    def _get_restorer(self) -> GFPGANer:
        if self._restorer is not None:
            return self._restorer
        self.ensure_weights()
        # Use gpu_id=0 for CUDA, gpu_id=-1 for CPU
        gpu_id = 0 if self.device == "cuda" else -1
        self._restorer = GFPGANer(
            model_path=str(self.model_path),
            upscale=1,
            arch="clean",
            channel_multiplier=2,
            bg_upsampler=None,
            device=self.device,
        )
        return self._restorer

    def restore(self, image: Image.Image, strength: float = 0.5, *, raise_on_error: bool = False) -> Image.Image:
        try:
            bgr = cv2.cvtColor(np.array(image.convert("RGB")), cv2.COLOR_RGB2BGR)
            _cropped, _restored, out = self._get_restorer().enhance(
                bgr,
                has_aligned=False,
                only_center_face=False,
                paste_back=True,
                weight=max(0.0, min(1.0, float(strength))),
            )
            out_rgb = cv2.cvtColor(out, cv2.COLOR_BGR2RGB)
            return Image.fromarray(out_rgb)
        except Exception as exc:
            if raise_on_error:
                raise RuntimeError("GFPGAN face restore failed") from exc
            logger.exception("GFPGAN face restore failed; returning original image")
            return image.convert("RGB")
