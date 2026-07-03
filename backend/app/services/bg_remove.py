from __future__ import annotations

from io import BytesIO
import logging
import os
from pathlib import Path

import cv2
import numpy as np

from PIL import Image

BACKEND_DIR = Path(__file__).resolve().parents[2]
U2NET_CACHE_DIR = BACKEND_DIR / "weights" / "u2net"
U2NET_CACHE_DIR.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("U2NET_HOME", str(U2NET_CACHE_DIR))

try:
    from rembg import new_session as rembg_new_session, remove as rembg_remove
except Exception as exc:
    rembg_new_session = None
    rembg_remove = None
    _rembg_import_error: str | None = str(exc)
else:
    _rembg_import_error = None


_rembg_session = None
_rembg_error: str | None = None
_logger = logging.getLogger(__name__)


def _session():
    global _rembg_error
    global _rembg_session
    if _rembg_session is None:
        try:
            if rembg_new_session is None:
                raise RuntimeError(f"rembg is unavailable: {_rembg_import_error or 'import failed'}")
            # Triggers U2NET model download on first run.
            _rembg_session = rembg_new_session("u2net")
            _rembg_error = None
        except Exception as exc:
            _rembg_error = str(exc)
            raise
    return _rembg_session


def warmup_rembg() -> None:
    try:
        _session()
    except Exception as exc:
        _logger.warning("rembg warmup failed; will use fallback until retry succeeds: %s", exc)


def _grabcut_fallback(image: Image.Image) -> Image.Image:
    rgb = np.array(image.convert("RGB"))
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    height, width = bgr.shape[:2]

    mask = np.zeros((height, width), np.uint8)
    bgd_model = np.zeros((1, 65), np.float64)
    fgd_model = np.zeros((1, 65), np.float64)

    margin_w = max(4, int(width * 0.04))
    margin_h = max(4, int(height * 0.04))
    rect = (margin_w, margin_h, width - 2 * margin_w, height - 2 * margin_h)
    cv2.grabCut(bgr, mask, rect, bgd_model, fgd_model, 4, cv2.GC_INIT_WITH_RECT)

    alpha = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    rgba = cv2.cvtColor(bgr, cv2.COLOR_BGR2BGRA)
    rgba[:, :, 3] = alpha
    return Image.fromarray(cv2.cvtColor(rgba, cv2.COLOR_BGRA2RGBA), mode="RGBA")


def remove_background(image: Image.Image) -> Image.Image:
    buf = BytesIO()
    image.convert("RGBA").save(buf, format="PNG")

    if rembg_remove is not None:
        try:
            out = rembg_remove(buf.getvalue(), session=_session())
            return Image.open(BytesIO(out)).convert("RGBA")
        except Exception as rembg_exc:
            _logger.warning(
                "rembg background removal failed (%s). Falling back to local grabcut. Last rembg init error: %s",
                rembg_exc,
                _rembg_error,
            )
    else:
        _logger.warning(
            "rembg import unavailable (%s). Falling back to local grabcut.",
            _rembg_import_error,
        )

    try:
        return _grabcut_fallback(image)
    except Exception as grabcut_exc:
        _logger.error(
            "grabcut background fallback failed (%s). Returning original image with opaque alpha.",
            grabcut_exc,
        )
        return image.convert("RGBA")
