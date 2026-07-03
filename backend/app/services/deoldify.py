from __future__ import annotations

import tempfile
import subprocess
import logging
import shutil
from pathlib import Path
from urllib.request import urlretrieve

from PIL import Image
import numpy as np
import torch

logger = logging.getLogger(__name__)


DEOLDIFY_REPO_URL = "https://github.com/jantic/DeOldify.git"
DEOLDIFY_STABLE_WEIGHTS_URL = "https://www.dropbox.com/s/axsd2g85uyixaho/ColorizeStable_gen.pth?dl=1"
DEOLDIFY_MIN_WEIGHT_BYTES = 10 * 1024 * 1024

# Render factor controls internal colorization resolution.
# Higher = more accurate colors but slower; lower = more vibrant but less stable.
# 35 is the library default; we use context-adaptive values in colorize().
DEFAULT_RENDER_FACTOR = 24
SMALL_IMAGE_RENDER_FACTOR = 14   # < 512px: lower RF for highly vibrant color
MEDIUM_IMAGE_RENDER_FACTOR = 21  # 512–1024px: balanced vibrance
LARGE_IMAGE_RENDER_FACTOR = 24   # > 1024px: stable vibrance

# Maximum internal resolution for DeOldify inference.  Larger images are downscaled
# before colorizing, then chroma is transferred back at full resolution.
COLORIZE_MAX_SIDE = 1024


class DeOldifyService:
    def __init__(self, weights_root: Path) -> None:
        self.weights_root = weights_root
        self.weights_root.mkdir(parents=True, exist_ok=True)

        self.repo_path = self.weights_root / "deoldify"
        self.models_path = self.repo_path / "models"
        self.weights_path = self.models_path / "ColorizeStable_gen.pth"
        self._colorizer = None
        self._initialized = False

    def _has_runtime_repo(self) -> bool:
        return (self.repo_path / "deoldify" / "visualize.py").exists()

    def _ensure_repo(self) -> None:
        if self._has_runtime_repo():
            logger.info("DeOldify runtime source found at %s", self.repo_path)
            return

        if self.repo_path.exists() and any(self.repo_path.iterdir()):
            raise RuntimeError(
                f"DeOldify runtime source is incomplete at {self.repo_path}; expected deoldify/visualize.py"
            )

        logger.warning("DeOldify runtime source missing; cloning %s", DEOLDIFY_REPO_URL)
        clone = subprocess.run(
            ["git", "clone", "--depth", "1", DEOLDIFY_REPO_URL, str(self.repo_path)],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if clone.returncode != 0:
            raise RuntimeError(
                f"failed to clone DeOldify runtime source into {self.repo_path}: {clone.stderr.strip() or clone.stdout.strip()}"
            )
        if not self._has_runtime_repo():
            raise RuntimeError(f"DeOldify clone completed but runtime files are missing in {self.repo_path}")
        logger.info("DeOldify runtime source cloned to %s", self.repo_path)

    def _candidate_weight_paths(self) -> list[Path]:
        return [
            self.weights_path,
            self.weights_root / "models" / "ColorizeStable_gen.pth",
            self.weights_root / "ColorizeStable_gen.pth",
        ]

    def _ensure_weights(self) -> None:
        self.models_path.mkdir(parents=True, exist_ok=True)
        for candidate in self._candidate_weight_paths():
            if not candidate.exists():
                continue
            if self._is_valid_weight_file(candidate):
                if candidate != self.weights_path:
                    shutil.copy2(candidate, self.weights_path)
                    logger.info("DeOldify using fallback checkpoint at %s", candidate)
                logger.info("DeOldify checkpoint found at %s", self.weights_path)
                return
            candidate.unlink(missing_ok=True)

        if self.weights_path.exists():
            self.weights_path.unlink(missing_ok=True)

        logger.warning("DeOldify checkpoint missing; downloading from official URL")
        urlretrieve(DEOLDIFY_STABLE_WEIGHTS_URL, self.weights_path)
        if not self._is_valid_weight_file(self.weights_path):
            self.weights_path.unlink(missing_ok=True)
            raise RuntimeError("Downloaded DeOldify weight file is invalid (HTML or too small)")
        logger.info("DeOldify checkpoint downloaded to %s", self.weights_path)

    @staticmethod
    def _is_valid_weight_file(path: Path) -> bool:
        if not path.exists():
            return False
        if path.stat().st_size < DEOLDIFY_MIN_WEIGHT_BYTES:
            return False
        with path.open("rb") as fh:
            head = fh.read(512).lstrip()
        return not head.startswith(b"<")

    def _ensure_initialized(self) -> None:
        if self._initialized:
            return
        self._ensure_repo()
        self._ensure_weights()
        self._initialized = True

    def _get_colorizer(self):
        self._ensure_initialized()
        if self._colorizer is not None:
            return self._colorizer

        try:
            import sys

            if str(self.repo_path) not in sys.path:
                sys.path.insert(0, str(self.repo_path))
            from deoldify.visualize import get_image_colorizer
        except Exception as exc:  # pragma: no cover - optional dependency fallback
            raise RuntimeError("DeOldify dependencies are unavailable") from exc

        # DeOldify uses legacy checkpoints that rely on pickle globals.
        # Torch 2.6+ defaults torch.load(weights_only=True), which breaks these loads.
        original_torch_load = torch.load

        def _compat_torch_load(*args, **kwargs):
            kwargs.setdefault("weights_only", False)
            return original_torch_load(*args, **kwargs)

        try:
            torch.load = _compat_torch_load
            self._colorizer = get_image_colorizer(root_folder=self.repo_path, artistic=False)
        finally:
            torch.load = original_torch_load

        return self._colorizer

    def warmup(self) -> None:
        self._get_colorizer()

    @staticmethod
    def _choose_render_factor(image: Image.Image, render_factor: int | None = None) -> int:
        """Pick a render_factor appropriate for the image size."""
        if render_factor is not None:
            return max(7, min(45, render_factor))
        max_side = max(image.size)
        if max_side <= 512:
            return SMALL_IMAGE_RENDER_FACTOR
        if max_side <= 1024:
            return MEDIUM_IMAGE_RENDER_FACTOR
        return LARGE_IMAGE_RENDER_FACTOR

    @staticmethod
    def _transfer_chroma(
        restored: Image.Image,
        colorized: Image.Image,
        *,
        chroma_strength: float = 0.85,
    ) -> Image.Image:
        """Merge chroma (a/b) from the colorized image with luminance (L) from the
        restored image.  This ensures that restoration detail is never lost, while
        picking up the color information from the model.

        Args:
            restored: The grayscale or restored image whose luminance/detail to keep.
            colorized: The DeOldify output whose chroma channels to use.
            chroma_strength: 0–1 blend between original chroma and colorized chroma.
                1.0 = pure colorized chroma. Lower values fade towards the original.
        """
        restored_rgb = restored.convert("RGB")
        colorized_rgb = colorized.convert("RGB").resize(restored_rgb.size, Image.Resampling.LANCZOS)

        rest_lab = np.asarray(restored_rgb.convert("LAB"), dtype=np.float32)
        color_lab = np.asarray(colorized_rgb.convert("LAB"), dtype=np.float32)

        # Keep luminance from restored, take chroma from colorized.
        merged = rest_lab.copy()
        strength = max(0.0, min(1.0, chroma_strength))
        merged[:, :, 1] = rest_lab[:, :, 1] * (1.0 - strength) + color_lab[:, :, 1] * strength
        merged[:, :, 2] = rest_lab[:, :, 2] * (1.0 - strength) + color_lab[:, :, 2] * strength

        return Image.fromarray(np.clip(merged, 0, 255).astype(np.uint8), mode="LAB").convert("RGB")

    @staticmethod
    def assess_colorization_quality(
        original_gray: Image.Image,
        colorized: Image.Image,
    ) -> dict:
        """Evaluate how good the colorization result looks.

        Returns a dict with:
          - saturation_mean: average saturation of the colorized output
          - saturation_std: standard deviation of saturation
          - acceptable: bool — whether colorization passes basic quality bar
          - reason: optional rejection reason
        """
        # Convert to HSV and analyze saturation channel.
        colorized_rgb = colorized.convert("RGB").resize(original_gray.size[:2], Image.Resampling.LANCZOS)
        hsv = np.asarray(colorized_rgb.convert("HSV"), dtype=np.float32)
        sat = hsv[:, :, 1]
        sat_mean = float(np.mean(sat))
        sat_std = float(np.std(sat))

        result = {
            "saturation_mean": round(sat_mean, 2),
            "saturation_std": round(sat_std, 2),
            "acceptable": True,
            "reason": None,
        }

        # Reject if colors are too washed out (low saturation).
        if sat_mean < 8.0:
            result["acceptable"] = False
            result["reason"] = f"Colorization too washed-out (saturation mean {sat_mean:.1f} < 8)"
            return result

        # Reject if colors are oversaturated / fake-looking.
        if sat_mean > 180.0:
            result["acceptable"] = False
            result["reason"] = f"Colorization oversaturated (saturation mean {sat_mean:.1f} > 180)"
            return result

        # Reject if saturation is extremely uniform (muddy single-tone).
        if sat_mean > 30 and sat_std < 8.0:
            result["acceptable"] = False
            result["reason"] = f"Colorization appears muddy/single-tone (std {sat_std:.1f} < 8)"
            return result

        return result

    def colorize(
        self,
        image: Image.Image,
        *,
        render_factor: int | None = None,
        chroma_strength: float = 0.85,
        raise_on_error: bool = False,
        preserve_luminance: bool = True,
    ) -> Image.Image:
        """Colorize a grayscale image using DeOldify with quality improvements.

        Args:
            image: Input image (should be grayscale-like).
            render_factor: Override the auto-selected render factor (7–45).
            chroma_strength: How strongly to apply colorized chroma (0–1).
                0 = original image unchanged; 1 = full colorization.
            raise_on_error: If True, raise on failure instead of returning original.
            preserve_luminance: If True (default), keep luminance from the input
                and transfer only chroma from DeOldify.  This preserves all
                restored detail while adding color.
        """
        try:
            colorizer = self._get_colorizer()
            rf = self._choose_render_factor(image, render_factor)

            # Downscale large images for inference stability.
            input_rgb = image.convert("RGB")
            original_size = input_rgb.size
            max_side = max(original_size)
            if max_side > COLORIZE_MAX_SIDE:
                scale = COLORIZE_MAX_SIDE / float(max_side)
                new_size = (int(original_size[0] * scale), int(original_size[1] * scale))
                inference_img = input_rgb.resize(new_size, Image.Resampling.LANCZOS)
            else:
                inference_img = input_rgb

            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as temp_file:
                temp_path = Path(temp_file.name)
            try:
                inference_img.save(temp_path)
                colorized = colorizer.get_transformed_image(
                    temp_path,
                    render_factor=rf,
                    watermarked=False,
                )
                if not isinstance(colorized, Image.Image):
                    raise RuntimeError("DeOldify did not return an image")
                colorized = colorized.convert("RGB")
            finally:
                if temp_path.exists():
                    temp_path.unlink(missing_ok=True)

            # Resize colorized back to original resolution if needed.
            if colorized.size != original_size:
                colorized = colorized.resize(original_size, Image.Resampling.LANCZOS)

            # Luminance-preserving chroma transfer.
            if preserve_luminance:
                result = self._transfer_chroma(
                    input_rgb,
                    colorized,
                    chroma_strength=chroma_strength,
                )
            else:
                # Direct blend as fallback.
                strength = max(0.3, min(1.0, chroma_strength))
                result = Image.blend(input_rgb, colorized, strength)

            return result

        except Exception as exc:
            if raise_on_error:
                raise RuntimeError("DeOldify colorization failed") from exc
            logger.exception("DeOldify colorization failed; returning original image")

        return image.convert("RGB")
