from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

import numpy as np
from PIL import Image

from app.services.metrics import compute_quality_metrics


@dataclass(frozen=True)
class GatePolicy:
    max_delta_prev: float
    min_ssim_prev: float
    max_delta_original: float
    min_ssim_original: float


@dataclass(frozen=True)
class StageMetrics:
    mean_delta_prev: float
    ssim_prev: float
    mean_delta_original: float
    ssim_original: float
    psnr_original: float


def mean_absolute_delta(image_a: Image.Image, image_b: Image.Image) -> float:
    rgb_a = image_a.convert("RGB")
    rgb_b = image_b.convert("RGB").resize(rgb_a.size, Image.Resampling.LANCZOS)
    arr_a = np.asarray(rgb_a, dtype=np.float32)
    arr_b = np.asarray(rgb_b, dtype=np.float32)
    return float(np.mean(np.abs(arr_a - arr_b)))


def compare_stage(previous: Image.Image, candidate: Image.Image, original: Image.Image) -> StageMetrics:
    ssim_prev, _ = compute_quality_metrics(previous, candidate)
    ssim_original, psnr_original = compute_quality_metrics(original, candidate)
    return StageMetrics(
        mean_delta_prev=mean_absolute_delta(previous, candidate),
        ssim_prev=float(ssim_prev),
        mean_delta_original=mean_absolute_delta(original, candidate),
        ssim_original=float(ssim_original),
        psnr_original=float(psnr_original),
    )


def evaluate_gate(metrics: StageMetrics, policy: GatePolicy) -> tuple[bool, str | None]:
    if metrics.mean_delta_prev > policy.max_delta_prev and metrics.ssim_prev < policy.min_ssim_prev:
        return False, "stage diverged too far from previous output"
    if metrics.mean_delta_original > policy.max_delta_original and metrics.ssim_original < policy.min_ssim_original:
        return False, "stage diverged too far from original structure"
    return True, None


def metrics_dict(metrics: StageMetrics) -> dict[str, float]:
    return {
        "mean_delta_prev": float(metrics.mean_delta_prev),
        "ssim_prev": float(metrics.ssim_prev),
        "mean_delta_original": float(metrics.mean_delta_original),
        "ssim_original": float(metrics.ssim_original),
        "psnr_original": float(metrics.psnr_original),
    }


def choose_best_stage(
    candidates: Mapping[str, Image.Image],
    original: Image.Image,
    *,
    conservative: bool,
) -> tuple[str, dict[str, dict[str, float]], list[str]]:
    if not candidates:
        return "loaded", {}, []

    baseline_name = "loaded" if "loaded" in candidates else next(iter(candidates.keys()))
    selected_name = baseline_name
    rejected: list[str] = []

    baseline_metrics = compare_stage(original, candidates[baseline_name], original)
    selected_score = 0.0
    metrics_by_stage: dict[str, dict[str, float]] = {
        baseline_name: metrics_dict(baseline_metrics)
    }

    for stage_name, image in candidates.items():
        if stage_name == baseline_name:
            continue

        stage_metrics = compare_stage(original, image, original)
        metrics_by_stage[stage_name] = metrics_dict(stage_metrics)

        if stage_name != "colorize":
            if conservative:
                if stage_metrics.mean_delta_original > 30.0:
                    rejected.append(f"{stage_name}:quality_guard")
                    continue
                if stage_metrics.ssim_original < 0.78 and stage_metrics.mean_delta_original > 18.0:
                    rejected.append(f"{stage_name}:quality_guard")
                    continue
            else:
                if stage_metrics.mean_delta_original > 48.0:
                    rejected.append(f"{stage_name}:quality_guard")
                    continue
                if stage_metrics.ssim_original < 0.62 and stage_metrics.mean_delta_original > 32.0:
                    rejected.append(f"{stage_name}:quality_guard")
                    continue

        # Prefer meaningful restoration while penalizing structural drift.
        drift_penalty = (1.0 - stage_metrics.ssim_original) * (22.0 if conservative else 14.0)
        score = stage_metrics.mean_delta_original - drift_penalty
        if stage_metrics.mean_delta_original < 0.8:
            score -= 1.0

        if score > selected_score:
            selected_score = score
            selected_name = stage_name

    if selected_name != baseline_name and selected_score < 0.3:
        selected_name = baseline_name

    return selected_name, metrics_by_stage, rejected

