from __future__ import annotations

import gc
import importlib.util
import logging
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any, Callable

import gdown
import numpy as np
import torch
from PIL import Image

logger = logging.getLogger(__name__)

# Use pre-downloaded weights paths
RESTORMER_REPO_URL = "https://github.com/swz30/restormer.git"
# Motion Deblurring pretrained model folder from Restormer Motion_Deblurring/README.md.
RESTORMER_MOTION_PRETRAINED_FOLDER_URL = "https://drive.google.com/drive/folders/1czMyfRTQDX3j3ErByYeZ1PM4GVLbJeGK?usp=sharing"
RESTORMER_REAL_DENOISE_FILE_ID = "1FF_4NTboTWQ7sHCq4xhyLZsSl0U0JfjH"
RESTORMER_REAL_DENOISE_ALT_FILE_ID = "1CsEiN6R0hlmEoSTyy48nnhfF06P5aRR7"
MIN_WEIGHT_BYTES = 5 * 1024 * 1024


class RestormerService:
    """Restormer service with strict model loading and explicit readiness signaling."""

    def __init__(self, weights_root: Path, task: str) -> None:
        if task not in {"motion_deblur", "real_denoise"}:
            raise ValueError("task must be motion_deblur or real_denoise")

        self.weights_root = weights_root
        self.task = task
        self.weights_root.mkdir(parents=True, exist_ok=True)

        self.repo_path = self.weights_root / "restormer"
        self.weights_path = self._weights_path()
        self.device = self._choose_device()
        self._model: torch.nn.Module | None = None
        self._initialized = False
        self._model_error: str | None = None
        self._last_inference_seconds: float | None = None

        logger.info("RestormerService init: task=%s device=%s weights=%s", task, self.device, self.weights_path)

    @staticmethod
    def _choose_device() -> torch.device:
        """Choose device: CUDA > CPU (skip MPS due to stability issues)."""
        if torch.cuda.is_available():
            logger.info("Using CUDA device: %s", torch.cuda.get_device_name(0))
            return torch.device("cuda")

        logger.warning("CUDA not available, using CPU (inference will be slow)")
        return torch.device("cpu")

    def _weights_path(self) -> Path:
        if self.task == "motion_deblur":
            return self.weights_root / "motion_deblurring.pth"
        return self.weights_root / "real_denoising.pth"

    def _candidate_weight_paths(self) -> list[Path]:
        if self.task == "motion_deblur":
            return [
                self.weights_root / "motion_deblurring.pth",
                self.weights_root / "motion_pretrained" / "motion_deblurring.pth",
            ]
        return [self.weights_root / "real_denoising.pth"]

    def _has_runtime_repo(self) -> bool:
        return (self.repo_path / "basicsr" / "models" / "archs" / "restormer_arch.py").exists()

    def _ensure_repo(self) -> None:
        """Ensure Restormer runtime source is available."""
        if self._has_runtime_repo():
            logger.info("Restormer runtime source found at %s", self.repo_path)
            return

        if self.repo_path.exists() and any(self.repo_path.iterdir()):
            raise RuntimeError(
                "Restormer runtime source is incomplete at "
                f"{self.repo_path}; expected basicsr/models/archs/restormer_arch.py"
            )

        logger.info("Cloning Restormer repo to %s", self.repo_path)
        clone = subprocess.run(
            ["git", "clone", "--depth", "1", RESTORMER_REPO_URL, str(self.repo_path)],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if clone.returncode != 0:
            raise RuntimeError(
                "failed to clone Restormer runtime source into "
                f"{self.repo_path}: {clone.stderr.strip() or clone.stdout.strip()}"
            )
        if not self._has_runtime_repo():
            raise RuntimeError(f"Restormer clone completed but runtime files are missing in {self.repo_path}")
        logger.info("Restormer runtime source cloned to %s", self.repo_path)

    @staticmethod
    def _validate_weights_file(path: Path) -> None:
        if not path.exists():
            raise FileNotFoundError(f"weights file missing: {path}")
        size = path.stat().st_size
        if size < MIN_WEIGHT_BYTES:
            raise RuntimeError(f"weights file is unexpectedly small ({size} bytes): {path}")

        with path.open("rb") as fh:
            head = fh.read(512).lstrip()
        if head.startswith(b"<"):
            raise RuntimeError(f"weights file appears to be HTML instead of checkpoint: {path}")

    def _download_motion_deblur_weights(self) -> None:
        download_root = self.weights_root / "motion_pretrained"
        download_root.mkdir(parents=True, exist_ok=True)

        logger.info("Downloading motion deblur Restormer weights from official pretrained folder")
        downloaded = gdown.download_folder(
            url=RESTORMER_MOTION_PRETRAINED_FOLDER_URL,
            output=str(download_root),
            quiet=True,
            use_cookies=False,
        )

        if downloaded:
            logger.info("Motion deblur download produced %d entries", len(downloaded))

        candidates = list(download_root.rglob("motion_deblurring*.pth"))
        if not candidates:
            candidates = [p for p in download_root.rglob("*.pth") if "deblur" in p.name.lower()]

        # Also honor manually dropped checkpoints in the cloned repo path.
        repo_pretrained = self.repo_path / "Motion_Deblurring" / "pretrained_models"
        if repo_pretrained.exists():
            repo_candidates = list(repo_pretrained.rglob("motion_deblurring*.pth"))
            if repo_candidates:
                candidates.extend(repo_candidates)

        if not candidates:
            raise RuntimeError("no motion deblur checkpoint was found after download")

        source = candidates[0]
        self.weights_path.parent.mkdir(parents=True, exist_ok=True)
        if source != self.weights_path:
            shutil.copy2(source, self.weights_path)
        self._validate_weights_file(self.weights_path)
        logger.info("Motion deblur checkpoint ready at %s", self.weights_path)

    def _download_real_denoise_weights(self) -> None:
        ids = [RESTORMER_REAL_DENOISE_FILE_ID, RESTORMER_REAL_DENOISE_ALT_FILE_ID]
        last_error: Exception | None = None

        for file_id in ids:
            try:
                url = f"https://drive.google.com/uc?id={file_id}"
                logger.info("Downloading real denoise weights via file id=%s", file_id)
                gdown.download(url=url, output=str(self.weights_path), quiet=True, fuzzy=True)
                self._validate_weights_file(self.weights_path)
                logger.info("Real denoise checkpoint ready at %s", self.weights_path)
                return
            except Exception as exc:
                last_error = exc
                if self.weights_path.exists():
                    try:
                        self.weights_path.unlink()
                    except Exception:
                        logger.exception("Failed to remove invalid denoise checkpoint at %s", self.weights_path)

        if last_error is not None:
            raise RuntimeError(f"unable to download real denoise weights: {last_error}") from last_error
        raise RuntimeError("unable to download real denoise weights")

    def _ensure_weights(self) -> None:
        """Ensure model weights are downloaded."""
        for candidate in self._candidate_weight_paths():
            if not candidate.exists():
                continue
            try:
                self._validate_weights_file(candidate)
                if candidate != self.weights_path:
                    self.weights_path.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(candidate, self.weights_path)
                    logger.info("Restormer task=%s using fallback checkpoint at %s", self.task, candidate)
                logger.info("Weights already exist: %s", self.weights_path)
                return
            except Exception as exc:
                logger.warning("Existing weights at %s are invalid (%s); checking next candidate", candidate, exc)
                try:
                    candidate.unlink()
                except Exception:
                    logger.exception("Could not remove invalid weights file at %s", candidate)

        logger.info("Downloading Restormer weights for task=%s", self.task)

        if self.task == "motion_deblur":
            self._download_motion_deblur_weights()
            return

        if self.task == "real_denoise":
            self._download_real_denoise_weights()
            return

        raise RuntimeError(f"unable to download Restormer weights for task={self.task}")

    def _ensure_initialized(self) -> None:
        """Ensure repo and weights are ready."""
        if self._initialized:
            return
        logger.info("Initializing Restormer service...")
        self._ensure_repo()
        self._ensure_weights()
        self._initialized = True
        logger.info("RestormerService initialized successfully")

    @staticmethod
    def _extract_state_dict(checkpoint: Any) -> dict[str, torch.Tensor]:
        if isinstance(checkpoint, dict):
            for key in ("params_ema", "params", "state_dict"):
                value = checkpoint.get(key)
                if isinstance(value, dict):
                    checkpoint = value
                    break

        if not isinstance(checkpoint, dict):
            raise RuntimeError("checkpoint has unsupported format")

        cleaned: dict[str, torch.Tensor] = {}
        for key, value in checkpoint.items():
            if key.startswith("module."):
                cleaned[key[7:]] = value
            else:
                cleaned[key] = value
        return cleaned

    def _create_model_architecture(self) -> torch.nn.Module:
        """Create Restormer model architecture directly from repo source file."""
        try:
            arch_path = self.repo_path / "basicsr" / "models" / "archs" / "restormer_arch.py"
            if not arch_path.exists():
                raise FileNotFoundError(f"Restormer architecture file missing: {arch_path}")

            spec = importlib.util.spec_from_file_location("restormer_arch_local", arch_path)
            if spec is None or spec.loader is None:
                raise RuntimeError(f"Unable to load module spec for {arch_path}")

            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            Restormer = getattr(module, "Restormer", None)
            if Restormer is None:
                raise RuntimeError("Restormer class was not found in restormer_arch.py")

            params = {
                "inp_channels": 3,
                "out_channels": 3,
                "dim": 48,
                "num_blocks": [4, 6, 6, 8],
                "num_refinement_blocks": 4,
                "heads": [1, 2, 4, 8],
                "ffn_expansion_factor": 2.66,
                "bias": False,
                "LayerNorm_type": "WithBias" if self.task == "motion_deblur" else "BiasFree",
                "dual_pixel_task": False,
            }

            return Restormer(**params)
        except Exception as exc:
            raise RuntimeError(f"failed to import Restormer architecture: {exc}") from exc

    def status(self) -> dict[str, Any]:
        return {
            "task": self.task,
            "device": self.device.type,
            "weights_path": str(self.weights_path),
            "weights_present": self.weights_path.exists(),
            "initialized": self._initialized,
            "model_loaded": self._model is not None,
            "model_error": self._model_error,
            "last_inference_seconds": self._last_inference_seconds,
        }

    def ensure_ready(self, *, warmup: bool = False) -> tuple[bool, str | None]:
        try:
            self._ensure_initialized()
            self._get_model()
            if warmup:
                self.warmup()
            return True, None
        except Exception as exc:
            self._model_error = str(exc)
            logger.error("Restormer task=%s unavailable: %s", self.task, exc)
            return False, str(exc)

    def _get_model(self) -> torch.nn.Module:
        """Get or create the model."""
        self._ensure_initialized()
        if self._model is not None:
            return self._model

        logger.info("Loading Restormer model from %s", self.weights_path)
        try:
            model = self._create_model_architecture()

            logger.info("Loading checkpoint...")
            checkpoint = torch.load(self.weights_path, map_location=self.device)
            state_dict = self._extract_state_dict(checkpoint)

            logger.info("Loading state dict into model...")
            load_result = model.load_state_dict(state_dict, strict=False)
            total_param_tensors = len(model.state_dict())
            missing = len(load_result.missing_keys)
            unexpected = len(load_result.unexpected_keys)
            loaded_ratio = float(max(0, total_param_tensors - missing)) / float(max(1, total_param_tensors))
            logger.info(
                "Restormer task=%s state_dict coverage loaded_ratio=%.3f missing=%d unexpected=%d",
                self.task,
                loaded_ratio,
                missing,
                unexpected,
            )
            if loaded_ratio < 0.70:
                raise RuntimeError(
                    f"insufficient checkpoint coverage for {self.task} (loaded_ratio={loaded_ratio:.3f})"
                )

            model = model.to(self.device)
            model.eval()

            for param in model.parameters():
                param.requires_grad = False

            self._model = model
            self._model_error = None
            logger.info("Model loaded successfully for task=%s", self.task)
            return model

        except Exception as exc:
            self._model_error = str(exc)
            logger.error("Error loading model for task=%s: %s", self.task, exc)
            raise

    def warmup(self) -> None:
        """Warmup the model by doing a forward pass."""
        try:
            logger.info("Warming up Restormer model for task=%s", self.task)
            model = self._get_model()

            dummy_input = torch.randn(1, 3, 256, 256, device=self.device, dtype=torch.float32)
            with torch.inference_mode():
                _ = model(dummy_input)

            if self.device.type == "cuda":
                torch.cuda.empty_cache()
                gc.collect()

            logger.info("Warmup completed for task=%s", self.task)
        except Exception as exc:
            self._model_error = str(exc)
            logger.error("Warmup error for task=%s: %s", self.task, exc)
            raise

    @staticmethod
    def _pad(image_tensor: torch.Tensor, multiple: int = 8) -> tuple[torch.Tensor, tuple[int, int]]:
        """Pad tensor to multiple of 8."""
        _, _, height, width = image_tensor.shape
        pad_height = (multiple - height % multiple) % multiple
        pad_width = (multiple - width % multiple) % multiple
        if pad_height == 0 and pad_width == 0:
            return image_tensor, (0, 0)
        padded = torch.nn.functional.pad(image_tensor, (0, pad_width, 0, pad_height), mode="reflect")
        return padded, (pad_height, pad_width)

    def restore(
        self,
        image: Image.Image,
        progress_callback: Callable[[float], None] | None = None,
        *,
        raise_on_error: bool = False,
    ) -> Image.Image:
        """
        Restore image using Restormer with intelligent strategy.
        
        Args:
            image: Input PIL Image
            progress_callback: Optional callback for progress updates
        
        Returns:
            Restored PIL Image
        """
        try:
            started = time.perf_counter()
            model = self._get_model()
            rgb = image.convert("RGB")
            original_size = rgb.size
            width, height = original_size
            max_side = max(width, height)

            logger.info("Restormer restore task=%s size=%sx%s", self.task, width, height)

            if self.device.type == "cpu":
                if max_side > 768:
                    restored = self._restore_tiled(
                        model,
                        rgb,
                        original_size,
                        tile_size=320,
                        overlap=32,
                        progress_callback=progress_callback,
                    )
                else:
                    restored = self._restore_standard(model, rgb, original_size, progress_callback=progress_callback)
            elif max_side > 2048:
                restored = self._restore_tiled(
                    model,
                    rgb,
                    original_size,
                    tile_size=1024,
                    overlap=64,
                    progress_callback=progress_callback,
                )
            else:
                restored = self._restore_standard(model, rgb, original_size, progress_callback=progress_callback)

            self._last_inference_seconds = round(time.perf_counter() - started, 4)
            logger.info(
                "Restormer task=%s inference completed in %.3fs",
                self.task,
                self._last_inference_seconds,
            )
            return restored

        except Exception as exc:
            self._model_error = str(exc)
            logger.error("Restoration failed for task=%s: %s", self.task, exc)
            if raise_on_error:
                raise RuntimeError(f"Restormer restore failed for {self.task}") from exc
            return image.convert("RGB")

    @staticmethod
    def _forward_model(model: torch.nn.Module, tensor: torch.Tensor) -> torch.Tensor:
        output = model(tensor)
        if isinstance(output, (list, tuple)):
            output = output[-1]
        if not isinstance(output, torch.Tensor):
            raise RuntimeError("Restormer model returned unsupported output type")
        return output

    def _restore_standard(
        self, 
        model: torch.nn.Module, 
        image: Image.Image,
        original_size: tuple[int, int],
        progress_callback: Callable[[float], None] | None = None,
    ) -> Image.Image:
        """Standard single-pass restoration."""
        try:
            # Convert image to tensor
            image_array = np.asarray(image, dtype=np.float32) / 255.0
            tensor = torch.from_numpy(image_array).permute(2, 0, 1).unsqueeze(0).to(self.device)
            tensor, (pad_height, pad_width) = self._pad(tensor)
            
            if progress_callback:
                progress_callback(0.1)
            
            logger.debug(f"Running inference on tensor shape: {tensor.shape}")

            with torch.inference_mode():
                output = self._forward_model(model, tensor)

            if progress_callback:
                progress_callback(0.9)

            if pad_height > 0:
                output = output[:, :, :-pad_height, :]
            if pad_width > 0:
                output = output[:, :, :, :-pad_width]

            output = torch.clamp(output, 0.0, 1.0)
            output_array = output.squeeze(0).permute(1, 2, 0).detach().cpu().numpy()
            restored = Image.fromarray((output_array * 255.0).astype(np.uint8))

            if restored.size != original_size:
                restored = restored.resize(original_size, Image.Resampling.LANCZOS)

            if progress_callback:
                progress_callback(1.0)

            if self.device.type == "cuda":
                torch.cuda.empty_cache()

            return restored

        except Exception as exc:
            logger.error("Standard restoration error for task=%s: %s", self.task, exc)
            raise

    def _restore_tiled(
        self,
        model: torch.nn.Module,
        image: Image.Image,
        original_size: tuple[int, int],
        tile_size: int = 512,
        overlap: int = 32,
        progress_callback: Callable[[float], None] | None = None,
    ) -> Image.Image:
        """Restore using tile-based processing to avoid memory issues."""
        try:
            image_array = np.asarray(image, dtype=np.float32) / 255.0
            height, width = image_array.shape[:2]

            output_array = np.zeros_like(image_array)
            weight_map = np.zeros((height, width), dtype=np.float32)

            tiles_list = []
            for y in range(0, height, tile_size - overlap):
                for x in range(0, width, tile_size - overlap):
                    y_end = min(y + tile_size, height)
                    x_end = min(x + tile_size, width)
                    tiles_list.append((y, x, y_end, x_end))

            total_tiles = len(tiles_list)
            logger.info("Processing %d tiles (%dpx with %dpx overlap)", total_tiles, tile_size, overlap)

            for tile_idx, (y, x, y_end, x_end) in enumerate(tiles_list):
                tile = image_array[y:y_end, x:x_end, :]

                tile_tensor = torch.from_numpy(tile).permute(2, 0, 1).unsqueeze(0).to(self.device)
                tile_tensor, (pad_h, pad_w) = self._pad(tile_tensor)

                with torch.inference_mode():
                    tile_output = self._forward_model(model, tile_tensor)

                if pad_h > 0:
                    tile_output = tile_output[:, :, :-pad_h, :]
                if pad_w > 0:
                    tile_output = tile_output[:, :, :, :-pad_w]

                tile_output = torch.clamp(tile_output, 0.0, 1.0)
                tile_result = tile_output.squeeze(0).permute(1, 2, 0).detach().cpu().numpy()

                tile_h, tile_w = tile_result.shape[:2]
                blend_mask = self._create_blend_mask(tile_h, tile_w, overlap)

                output_array[y:y_end, x:x_end] += tile_result * blend_mask[..., np.newaxis]
                weight_map[y:y_end, x:x_end] += blend_mask

                if progress_callback:
                    progress = 0.2 + ((tile_idx + 1) / total_tiles) * 0.7
                    progress_callback(progress)

                logger.debug("Processed tile %d/%d", tile_idx + 1, total_tiles)

            weight_map = np.clip(weight_map, 1e-5, 1.0)
            output_array = output_array / weight_map[..., np.newaxis]
            output_array = np.clip(output_array, 0.0, 1.0)

            restored = Image.fromarray((output_array * 255.0).astype(np.uint8))

            if progress_callback:
                progress_callback(1.0)

            if self.device.type == "cuda":
                torch.cuda.empty_cache()

            return restored

        except Exception as exc:
            logger.error("Tiled restoration error for task=%s: %s", self.task, exc)
            raise

    @staticmethod
    def _create_blend_mask(height: int, width: int, overlap: int = 32) -> np.ndarray:
        """Create smooth blend mask for tile stitching."""
        mask = np.ones((height, width), dtype=np.float32)
        
        if overlap > 0:
            fade_size = min(overlap // 2, 16)
            if fade_size > 0:
                fade = np.linspace(0.0, 1.0, fade_size)
                
                # Edge fading
                if height > fade_size * 2:
                    mask[:fade_size, :] *= fade[:, np.newaxis]
                    mask[-fade_size:, :] *= fade[::-1, np.newaxis]
                
                if width > fade_size * 2:
                    mask[:, :fade_size] *= fade[np.newaxis, :]
                    mask[:, -fade_size:] *= fade[np.newaxis, ::-1]
        
        return mask
