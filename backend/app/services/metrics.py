from __future__ import annotations

from PIL import Image
import numpy as np
from skimage.metrics import structural_similarity, peak_signal_noise_ratio


def compute_quality_metrics(original: Image.Image, candidate: Image.Image) -> tuple[float, float]:
    original_rgb = original.convert("RGB")
    candidate_rgb = candidate.convert("RGB").resize(original_rgb.size)

    orig = np.array(original_rgb, dtype=np.uint8)
    cand = np.array(candidate_rgb, dtype=np.uint8)

    ssim = float(structural_similarity(orig, cand, channel_axis=2, data_range=255))
    psnr = float(peak_signal_noise_ratio(orig, cand, data_range=255))
    return ssim, psnr
