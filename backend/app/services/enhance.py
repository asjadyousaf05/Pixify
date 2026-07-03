from __future__ import annotations

from pathlib import Path
from urllib.request import urlretrieve
import logging

from PIL import Image
import cv2
import numpy as np
import torch
from realesrgan import RealESRGANer


MODEL_URLS = {
    2: "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.1/RealESRGAN_x2plus.pth",
    4: "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth",
}
MIN_WEIGHT_BYTES = 10 * 1024 * 1024
logger = logging.getLogger(__name__)


class RealESRGANService:
    def __init__(self, weights_dir: Path) -> None:
        self.weights_dir = weights_dir
        self.weights_dir.mkdir(parents=True, exist_ok=True)
        self.device = self._choose_device()
        self._models: dict[tuple[int, int], RealESRGANer] = {}

    @staticmethod
    def _choose_device() -> str:
        """Choose device: CUDA > CPU (skip MPS due to stability issues)."""
        if torch.cuda.is_available():
            return "cuda"
        # Skip MPS despite availability - stability issues with complex models
        return "cpu"

    def _weight_path(self, scale: int) -> Path:
        if scale not in (2, 4):
            raise ValueError("upscale must be 2 or 4")
        return self.weights_dir / f"RealESRGAN_x{scale}.pth"

    @staticmethod
    def _validate_weight_file(path: Path) -> None:
        if not path.exists():
            raise FileNotFoundError(f"RealESRGAN weights missing at {path}")
        size = path.stat().st_size
        if size < MIN_WEIGHT_BYTES:
            raise RuntimeError(f"RealESRGAN checkpoint is unexpectedly small ({size} bytes): {path}")
        with path.open("rb") as fh:
            head = fh.read(256).lstrip()
        if head.startswith(b"<"):
            raise RuntimeError(f"RealESRGAN checkpoint looks like HTML, not model weights: {path}")

    def _ensure_weights(self, scale: int) -> Path:
        path = self._weight_path(scale)
        if path.exists():
            self._validate_weight_file(path)
            logger.info("RealESRGAN x%s checkpoint found at %s", scale, path)
            return path

        logger.warning("RealESRGAN x%s checkpoint missing; downloading from %s", scale, MODEL_URLS[scale])
        if not path.exists():
            urlretrieve(MODEL_URLS[scale], path)
        self._validate_weight_file(path)
        logger.info("RealESRGAN x%s checkpoint downloaded to %s", scale, path)
        return path

    def _build_rrdb(self, scale: int):
        """Build RRDB model architecture used by RealESRGAN checkpoints."""
        try:
            from basicsr.archs.rrdbnet_arch import RRDBNet
        except ImportError as exc:
            raise RuntimeError("basicsr is required for RealESRGAN inference but is not installed") from exc
        
        return RRDBNet(
            num_in_ch=3,
            num_out_ch=3,
            num_feat=64,
            num_block=23,
            num_grow_ch=32,
            scale=scale,
        )

    def _tile_for_image(self, image: Image.Image) -> int:
        width, height = image.size
        max_side = max(width, height)
        if self.device == "cpu":
            return 128 if max_side > 1024 else 0
        if max_side > 2048:
            return 128
        if max_side > 1280:
            return 256
        return 0

    def _get_model(self, scale: int, tile: int) -> RealESRGANer:
        cache_key = (scale, tile)
        if cache_key in self._models:
            return self._models[cache_key]

        model = self._build_rrdb(scale)
        model_path = self._ensure_weights(scale)
        use_half = False
        logger.info("Loading RealESRGAN model scale=%s tile=%s from %s", scale, tile, model_path)
        model = RealESRGANer(
            scale=scale,
            model_path=str(model_path),
            model=model,
            tile=tile,
            tile_pad=10,
            pre_pad=0,
            half=use_half,
            device=self.device,
        )
        self._models[cache_key] = model
        return model

    def warmup(self) -> None:
        self._get_model(2, 0)
        self._get_model(4, 0)

    def enhance(self, image: Image.Image, upscale: int) -> Image.Image:
        rgb = np.array(image.convert("RGB"))
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)

        tile_candidates = [0, self._tile_for_image(image), 256, 128]
        last_error: Exception | None = None

        for tile in dict.fromkeys(tile_candidates):
            try:
                model = self._get_model(upscale, tile)
                out_bgr, _ = model.enhance(bgr, outscale=upscale)
                out_rgb = cv2.cvtColor(out_bgr, cv2.COLOR_BGR2RGB)
                return Image.fromarray(out_rgb)
            except Exception as exc:
                last_error = exc

        if last_error:
            raise last_error
        raise RuntimeError("enhancement failed")
