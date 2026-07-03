from __future__ import annotations

import importlib.util
import logging
import re
import subprocess
from http.cookiejar import CookieJar
from pathlib import Path
from types import ModuleType
from urllib.parse import urlencode
from urllib.request import HTTPCookieProcessor, build_opener, urlopen, urlretrieve

import numpy as np
from PIL import Image
import torch


logger = logging.getLogger(__name__)


MPRNET_REPO_URL = "https://github.com/swz30/MPRNet.git"
GOOGLE_DRIVE_IDS = {
    "deblur": "1QwQUVbk6YVOJViCsOKYNykCsdJSVGRtb",
    "denoise": "1LODPt9kYmxwU98g96UrRA0_Eh5HYcsRw",
}
WEIGHT_URL_MIRRORS: dict[str, list[str]] = {
    "deblur": [
        "https://huggingface.co/spaces/akhaliq/MPRNet/resolve/main/Deblurring/pretrained_models/model_deblurring.pth",
    ],
    "denoise": [
        "https://huggingface.co/spaces/akhaliq/MPRNet/resolve/main/Denoising/pretrained_models/model_denoising.pth",
    ],
}


class RestorationModel:
    def __init__(self, weights_root: Path, mode: str = "deblur") -> None:
        if mode not in {"deblur", "denoise"}:
            raise ValueError("mode must be one of deblur|denoise")

        self.mode = mode
        self.weights_root = weights_root
        self.weights_root.mkdir(parents=True, exist_ok=True)

        self.repo_path = self.weights_root / "MPRNet"
        self.model_path = self.weights_root / f"mprnet_{mode}.pth"
        self.device = self._choose_device()

        self._model: torch.nn.Module | None = None
        self._model_error: str | None = None

        try:
            self._ensure_repo()
            self._ensure_weights()
            self._model = self._load_model()
        except Exception as exc:
            # Keep object construction non-fatal so degraded startup can continue.
            self._model_error = str(exc)
            self._model = None
            logger.error("MPRNet %s initialization failed: %s", self.mode, exc)

    @staticmethod
    def _choose_device() -> torch.device:
        if torch.cuda.is_available():
            return torch.device("cuda")
        # MPRNet can stall on MPS with newer torch/macOS combinations; prefer CPU for reliability.
        return torch.device("cpu")

    def _runtime_arch_candidates(self) -> list[Path]:
        if self.mode == "deblur":
            return [
                self.repo_path / "Deblurring" / "MPRNet.py",
                self.repo_path / "Deblurring" / "model.py",
            ]
        return [
            self.repo_path / "Denoising" / "MPRNet.py",
            self.repo_path / "Denoising" / "model.py",
        ]

    def _has_runtime_repo(self) -> bool:
        return any(path.exists() for path in self._runtime_arch_candidates())

    def _ensure_repo(self) -> None:
        if self._has_runtime_repo():
            logger.info("MPRNet runtime source found at %s", self.repo_path)
            return

        if self.repo_path.exists() and any(self.repo_path.iterdir()):
            raise RuntimeError(
                f"MPRNet runtime source is incomplete at {self.repo_path}; expected one of: "
                + ", ".join(str(p) for p in self._runtime_arch_candidates())
            )

        self.repo_path.parent.mkdir(parents=True, exist_ok=True)
        logger.warning("MPRNet runtime source missing; cloning %s", MPRNET_REPO_URL)
        clone = subprocess.run(
            ["git", "clone", "--depth", "1", MPRNET_REPO_URL, str(self.repo_path)],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if clone.returncode != 0:
            raise RuntimeError(
                f"failed to clone MPRNet runtime source into {self.repo_path}: {clone.stderr.strip() or clone.stdout.strip()}"
            )
        if not self._has_runtime_repo():
            raise RuntimeError(f"MPRNet clone completed but runtime files are missing in {self.repo_path}")
        logger.info("MPRNet runtime source cloned to %s", self.repo_path)

    def _ensure_weights(self) -> None:
        if self.model_path.exists():
            logger.info("MPRNet %s checkpoint found at %s", self.mode, self.model_path)
            return

        last_error: Exception | None = None
        file_id = GOOGLE_DRIVE_IDS[self.mode]
        try:
            self._download_google_drive(file_id, self.model_path)
            return
        except Exception as exc:
            last_error = exc

        urls = WEIGHT_URL_MIRRORS[self.mode]
        for url in urls:
            try:
                urlretrieve(url, self.model_path)
                return
            except Exception as exc:
                last_error = exc

        if last_error:
            raise RuntimeError(f"unable to download MPRNet {self.mode} weights: {last_error}") from last_error
        raise RuntimeError(f"unable to download MPRNet {self.mode} weights")

    @staticmethod
    def _download_google_drive(file_id: str, output_path: Path) -> None:
        cookie_jar = CookieJar()
        opener = build_opener(HTTPCookieProcessor(cookie_jar))

        base_url = "https://drive.google.com/uc"
        first_url = f"{base_url}?{urlencode({'export': 'download', 'id': file_id})}"
        response = opener.open(first_url)
        data = response.read()

        confirm_token = None
        for cookie in cookie_jar:
            if cookie.name.startswith("download_warning"):
                confirm_token = cookie.value
                break

        if confirm_token is None:
            html = data.decode("utf-8", errors="ignore")
            match = re.search(r"confirm=([0-9A-Za-z_\-]+)", html)
            if match:
                confirm_token = match.group(1)

        if confirm_token is not None:
            second_url = f"{base_url}?{urlencode({'export': 'download', 'confirm': confirm_token, 'id': file_id})}"
            stream = opener.open(second_url)
        else:
            # Small files may not require a confirm token.
            stream = urlopen(first_url)

        output_path.parent.mkdir(parents=True, exist_ok=True)
        with output_path.open("wb") as out_file:
            while True:
                chunk = stream.read(1024 * 1024)
                if not chunk:
                    break
                out_file.write(chunk)

        with output_path.open("rb") as check_file:
            head = check_file.read(512).lstrip()
            if head.startswith(b"<"):
                raise RuntimeError("received HTML response instead of model weights")

    def _resolve_model_module(self) -> ModuleType:
        for path in self._runtime_arch_candidates():
            if not path.exists():
                continue

            module_name = f"mprnet_{self.mode}_module"
            spec = importlib.util.spec_from_file_location(module_name, str(path))
            if not spec or not spec.loader:
                continue
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module

        raise FileNotFoundError(f"unable to find MPRNet architecture file for mode={self.mode}")

    @staticmethod
    def _instantiate_model(module: ModuleType, mode: str) -> torch.nn.Module:
        model_cls = getattr(module, "MPRNet", None)
        if model_cls is None:
            raise AttributeError("MPRNet class was not found in module")

        # MPRNet architecture parameters used by the reference implementation.
        n_feat = 80 if mode == "denoise" else 96
        try:
            return model_cls(in_c=3, out_c=3, n_feat=n_feat, scale_unetfeats=48, scale_orsnetfeats=32, num_cab=8)
        except TypeError:
            return model_cls()

    def _load_model(self) -> torch.nn.Module:
        module = self._resolve_model_module()
        model = self._instantiate_model(module, self.mode)

        logger.info("Loading MPRNet %s checkpoint from %s", self.mode, self.model_path)

        checkpoint = torch.load(self.model_path, map_location=self.device)
        if isinstance(checkpoint, dict):
            state_dict = checkpoint.get("state_dict") or checkpoint.get("params") or checkpoint
        else:
            state_dict = checkpoint

        cleaned_state: dict[str, torch.Tensor] = {}
        for key, value in state_dict.items():
            if key.startswith("module."):
                cleaned_state[key[7:]] = value
            else:
                cleaned_state[key] = value

        model.load_state_dict(cleaned_state, strict=False)
        model.to(self.device)
        model.eval()
        logger.info("MPRNet %s model loaded on device=%s", self.mode, self.device)
        return model

    @staticmethod
    def _resize_for_inference(image: Image.Image, max_side: int = 1024) -> tuple[Image.Image, tuple[int, int]]:
        rgb = image.convert("RGB")
        original_size = rgb.size
        width, height = original_size
        max_dim = max(width, height)
        if max_dim <= max_side:
            return rgb, original_size

        scale = max_side / float(max_dim)
        resized = rgb.resize((int(width * scale), int(height * scale)), Image.Resampling.LANCZOS)
        return resized, original_size

    @staticmethod
    def _pad_to_multiple(tensor: torch.Tensor, multiple: int = 8) -> tuple[torch.Tensor, tuple[int, int]]:
        _, _, height, width = tensor.shape
        pad_h = (multiple - (height % multiple)) % multiple
        pad_w = (multiple - (width % multiple)) % multiple
        if pad_h == 0 and pad_w == 0:
            return tensor, (0, 0)

        padded = torch.nn.functional.pad(tensor, (0, pad_w, 0, pad_h), mode="reflect")
        return padded, (pad_h, pad_w)

    def restore(self, image: Image.Image, *, raise_on_error: bool = False) -> Image.Image:
        # Keep optional fallback behavior but allow callers to demand hard failure.
        if self._model is None:
            message = self._model_error or f"MPRNet {self.mode} model unavailable"
            if raise_on_error:
                raise RuntimeError(message)
            logger.warning("MPRNet %s unavailable; returning original image: %s", self.mode, message)
            return image.convert("RGB")

        try:
            # CPU inference at full resolution can stall for minutes on larger inputs.
            max_inference_size = 1024 if self.device.type == "cpu" else 2048
            resized, original_size = self._resize_for_inference(image, max_side=max_inference_size)
            arr = np.asarray(resized, dtype=np.float32) / 255.0
            inp = torch.from_numpy(arr).permute(2, 0, 1).unsqueeze(0).to(self.device)
            padded, (pad_h, pad_w) = self._pad_to_multiple(inp, multiple=8)

            use_half = False
            if use_half:
                padded = padded.half()

            with torch.no_grad():
                out = self._model(padded)
                if isinstance(out, (list, tuple)):
                    out = out[-1]
                # Convert back to fp32 if we used fp16
                if use_half:
                    out = out.float()
                out = torch.clamp(out, 0.0, 1.0)

            if pad_h > 0:
                out = out[:, :, :-pad_h, :]
            if pad_w > 0:
                out = out[:, :, :, :-pad_w]

            out_np = out.squeeze(0).permute(1, 2, 0).detach().cpu().numpy()
            out_img = Image.fromarray((out_np * 255.0).astype(np.uint8))

            if out_img.size != original_size:
                out_img = out_img.resize(original_size, Image.Resampling.LANCZOS)
            return out_img
        except Exception as exc:
            if raise_on_error:
                raise RuntimeError(f"MPRNet {self.mode} restore failed") from exc
            logger.exception("MPRNet %s restore failed; returning original image", self.mode)
            return image.convert("RGB")
