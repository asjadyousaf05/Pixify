from __future__ import annotations

import os
import logging
from pathlib import Path

from PIL import Image

logger = logging.getLogger(__name__)


class LaMaService:
    def __init__(self, weights_root: Path) -> None:
        self.weights_root = weights_root
        self.weights_root.mkdir(parents=True, exist_ok=True)
        cache_root = self.weights_root / "cache"
        cache_root.mkdir(parents=True, exist_ok=True)
        self.checkpoint_path = cache_root / "torch" / "hub" / "checkpoints" / "big-lama.pt"
        os.environ.setdefault("HF_HOME", str(cache_root))
        os.environ.setdefault("XDG_CACHE_HOME", str(cache_root))
        self._model = None

    def _get_model(self):
        if self._model is not None:
            return self._model

        try:
            from simple_lama_inpainting import SimpleLama
        except Exception as exc:  # pragma: no cover - optional dependency fallback
            raise RuntimeError(
                "simple_lama_inpainting is not installed; LaMa inpainting is unavailable"
            ) from exc

        if self.checkpoint_path.exists():
            logger.info("LaMa checkpoint found at %s", self.checkpoint_path)
        else:
            logger.warning("LaMa checkpoint missing at %s; it will be downloaded on first inference", self.checkpoint_path)

        self._model = SimpleLama()
        if self.checkpoint_path.exists():
            logger.info("LaMa checkpoint ready at %s", self.checkpoint_path)
        return self._model

    def inpaint(self, image: Image.Image, mask: Image.Image, *, raise_on_error: bool = False) -> Image.Image:
        if mask is None:
            return image.convert("RGB")

        model = self._get_model()
        image_rgb = image.convert("RGB")
        mask_l = mask.convert("L")
        try:
            result = model(image_rgb, mask_l)
            return result.convert("RGB")
        except Exception as exc:
            if raise_on_error:
                raise RuntimeError("LaMa inpainting failed") from exc
            logger.exception("LaMa inpainting failed; returning original image")
            return image_rgb

    def warmup(self) -> None:
        self._get_model()
