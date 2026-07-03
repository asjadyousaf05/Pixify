from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from threading import Event, Thread
from typing import TYPE_CHECKING, Any, Callable

import cv2
import numpy as np
from PIL import Image, ImageOps

from app.core.jobs import fail_job, update_job
from app.services.metrics import compute_quality_metrics
from app.services.quality_gate import (
    GatePolicy,
    choose_best_stage,
    compare_stage,
    evaluate_gate,
    mean_absolute_delta,
    metrics_dict,
)
from app.services.restoration import RestorationModel
from app.services.restormer import RestormerService

if TYPE_CHECKING:
    from app.services.deoldify import DeOldifyService
    from app.services.enhance import RealESRGANService
    from app.services.face_restore import FaceRestoreService
    from app.services.lama import LaMaService

logger = logging.getLogger(__name__)

MIN_SIGNIFICANT_DELTA = 1.5
NO_MEANINGFUL_CHANGE_SSIM = 0.985
OLD_PHOTO_MODES = {"repair_only", "repair_face", "repair_upscale", "repair_colorize"}
SAFE_MASK_TOTAL_MAX = 1.25
SAFE_MASK_CENTRAL_MAX = 1.75
SAFE_MASK_TOTAL_MAX_DENOISE = 0.8
SAFE_MASK_CENTRAL_MAX_DENOISE = 1.2
MIN_MASK_CONFIDENCE = 0.72


@dataclass(frozen=True)
class ModeConfig:
    mode: str
    enable_face: bool
    enable_upscale: bool
    enable_colorize: bool
    allow_inpainting: bool


@dataclass
class PipelineState:
    warnings: list[str] = field(default_factory=list)
    stages_completed: list[str] = field(default_factory=list)
    stages_run: list[str] = field(default_factory=list)
    stages_skipped: list[str] = field(default_factory=list)
    stages_rejected: list[str] = field(default_factory=list)
    models_used: list[str] = field(default_factory=list)
    model_failures: list[str] = field(default_factory=list)
    stage_timings: dict[str, float] = field(default_factory=dict)
    stage_diagnostics: dict[str, dict[str, float | bool | str]] = field(default_factory=dict)
    destructive_stage_detected: bool = False
    destructive_output_prevented: bool = False
    destructive_stage_prevented: bool = False
    used_safe_fallback: bool = False
    model_availability: dict[str, bool] = field(default_factory=dict)
    used_deblur: bool = False
    used_denoise_fallback: bool = False
    used_lightweight_restoration: bool = False
    used_inpainting: bool = False
    used_enhancement: bool = False
    used_face_recovery: bool = False
    final_stage_selected: str = "loaded"
    mask_coverage_total: float | None = None
    mask_coverage_central: float | None = None
    restoration_models_ran: list[str] = field(default_factory=list)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _append_unique(items: list[str], value: str) -> list[str]:
    if value and value not in items:
        items.append(value)
    return items


def _save_debug_image(image: Image.Image, debug_dir: Path | None, filename: str) -> None:
    if debug_dir is None:
        return
    try:
        debug_dir.mkdir(parents=True, exist_ok=True)
        image.convert("RGB").save(debug_dir / filename, format="PNG")
    except Exception:
        logger.exception("Failed to write debug image %s", filename)


def _save_debug_mask(mask: Image.Image, debug_dir: Path | None, filename: str) -> None:
    if debug_dir is None:
        return
    try:
        debug_dir.mkdir(parents=True, exist_ok=True)
        mask.convert("L").save(debug_dir / filename, format="PNG")
    except Exception:
        logger.exception("Failed to write debug mask %s", filename)


def _write_debug_summary(debug_dir: Path | None, summary: dict[str, Any]) -> None:
    if debug_dir is None:
        return
    try:
        debug_dir.mkdir(parents=True, exist_ok=True)
        with (debug_dir / "stage_summary.json").open("w", encoding="utf-8") as fh:
            json.dump(summary, fh, indent=2, sort_keys=True)
    except Exception:
        logger.exception("Failed to write stage summary")


def _update_state(job_id: str, state: PipelineState, *, debug: dict[str, Any] | None = None, **extra: Any) -> None:
    payload: dict[str, Any] = {
        "warnings": state.warnings,
        "stages_completed": state.stages_completed,
        "stages_run": state.stages_run,
        "stages_skipped": state.stages_skipped,
        "stages_rejected": state.stages_rejected,
        "models_used": state.models_used,
        "model_failures": state.model_failures,
        "stage_timings": state.stage_timings,
        "destructive_stage_detected": state.destructive_stage_detected,
        "destructive_output_prevented": state.destructive_output_prevented,
        "destructive_stage_prevented": state.destructive_stage_prevented,
        "used_safe_fallback": state.used_safe_fallback,
        "model_availability": state.model_availability,
        "used_deblur": state.used_deblur,
        "used_denoise_fallback": state.used_denoise_fallback,
        "used_lightweight_restoration": state.used_lightweight_restoration,
        "used_inpainting": state.used_inpainting,
        "used_enhancement": state.used_enhancement,
        "used_face_recovery": state.used_face_recovery,
        "final_stage_selected": state.final_stage_selected,
        "mask_coverage_total": state.mask_coverage_total,
        "mask_coverage_central": state.mask_coverage_central,
        "restoration_models_ran": state.restoration_models_ran,
        "last_heartbeat": _utc_now_iso(),
    }
    if debug is not None:
        payload["debug"] = debug
    payload.update(extra)
    update_job(job_id, **payload)


def update_stage(job_id: str, step: str, progress: int, *, state: PipelineState | None = None) -> None:
    payload: dict[str, Any] = {
        "step": step,
        "progress": progress,
        "last_heartbeat": _utc_now_iso(),
        "step_started_at": _utc_now_iso(),
    }
    if state is not None:
        payload.update(
            {
                "warnings": state.warnings,
                "stages_completed": state.stages_completed,
                "stages_run": state.stages_run,
                "stages_skipped": state.stages_skipped,
                "stages_rejected": state.stages_rejected,
                "models_used": state.models_used,
                "model_failures": state.model_failures,
                "stage_timings": state.stage_timings,
                "destructive_stage_detected": state.destructive_stage_detected,
                "destructive_output_prevented": state.destructive_output_prevented,
                "destructive_stage_prevented": state.destructive_stage_prevented,
                "used_safe_fallback": state.used_safe_fallback,
                "model_availability": state.model_availability,
                "used_deblur": state.used_deblur,
                "used_denoise_fallback": state.used_denoise_fallback,
                "used_lightweight_restoration": state.used_lightweight_restoration,
                "used_inpainting": state.used_inpainting,
                "used_enhancement": state.used_enhancement,
                "used_face_recovery": state.used_face_recovery,
                "final_stage_selected": state.final_stage_selected,
                "mask_coverage_total": state.mask_coverage_total,
                "mask_coverage_central": state.mask_coverage_central,
                "restoration_models_ran": state.restoration_models_ran,
            }
        )
    update_job(job_id, **payload)


def _central_region(shape: tuple[int, int]) -> tuple[int, int, int, int]:
    height, width = shape
    x0 = int(width * 0.26)
    x1 = int(width * 0.74)
    y0 = int(height * 0.22)
    y1 = int(height * 0.86)
    return x0, x1, y0, y1


def _mask_coverage_percent(mask: np.ndarray) -> float:
    return float(np.count_nonzero(mask)) * 100.0 / float(mask.size)


def _mask_coverage_central_percent(mask: np.ndarray) -> float:
    x0, x1, y0, y1 = _central_region(mask.shape)
    region = mask[y0:y1, x0:x1]
    if region.size == 0:
        return 0.0
    return float(np.count_nonzero(region)) * 100.0 / float(region.size)


def _remove_small_components(mask: np.ndarray, min_area: int) -> np.ndarray:
    if min_area <= 1:
        return mask
    labels_count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    filtered = np.zeros_like(mask, dtype=np.uint8)
    for idx in range(1, labels_count):
        area = int(stats[idx, cv2.CC_STAT_AREA])
        if area >= min_area:
            filtered[labels == idx] = 255
    return filtered


def build_conservative_damage_mask(image: Image.Image) -> tuple[Image.Image, float, float, float]:
    rgb = np.asarray(image.convert("RGB"))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    blur = cv2.GaussianBlur(gray, (0, 0), 1.1)
    residual = cv2.absdiff(gray, blur)

    edges = cv2.Canny(gray, 120, 220)
    _, residual_mask = cv2.threshold(residual, 22, 255, cv2.THRESH_BINARY)
    candidate = cv2.bitwise_and(residual_mask, edges)
    candidate = cv2.morphologyEx(candidate, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8), iterations=1)
    candidate = cv2.morphologyEx(candidate, cv2.MORPH_CLOSE, np.ones((2, 2), np.uint8), iterations=1)
    candidate = _remove_small_components(candidate, max(16, int(candidate.size * 0.000025)))

    total = _mask_coverage_percent(candidate)
    central = _mask_coverage_central_percent(candidate)
    overlap = float(np.count_nonzero(cv2.bitwise_and(candidate, edges))) / float(max(1, np.count_nonzero(candidate)))
    confidence = min(1.0, max(0.0, 0.35 + (0.65 * overlap)))
    return Image.fromarray(candidate, mode="L"), total, central, confidence


def _normalize_old_photo(image: Image.Image) -> Image.Image:
    rgb = np.asarray(image.convert("RGB"))
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)
    l, a, b = cv2.split(lab)

    dynamic_range = float(np.percentile(l, 99) - np.percentile(l, 1))
    if dynamic_range >= 96:
        return image.convert("RGB")

    clahe = cv2.createCLAHE(clipLimit=1.7, tileGridSize=(8, 8))
    l2 = clahe.apply(l)
    merged = cv2.merge([l2, a, b])
    normalized = cv2.cvtColor(merged, cv2.COLOR_LAB2RGB)
    return Image.fromarray(normalized).convert("RGB")


def is_grayscale_like(image: Image.Image) -> bool:
    """Detect if an image is grayscale or nearly grayscale (e.g. old B&W with mild scan color cast).

    Threshold of 8.0 allows mild sepia/color-cast from scanning to still be treated
    as colorization candidates. True B&W is typically < 2.0, intentionally colored > 12.
    """
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
    rg = np.mean(np.abs(rgb[:, :, 0] - rgb[:, :, 1]))
    rb = np.mean(np.abs(rgb[:, :, 0] - rgb[:, :, 2]))
    gb = np.mean(np.abs(rgb[:, :, 1] - rgb[:, :, 2]))
    return (rg + rb + gb) / 3.0 < 8.0


def detect_face_presence(image: Image.Image) -> bool:
    try:
        gray = cv2.cvtColor(np.asarray(image.convert("RGB")), cv2.COLOR_RGB2GRAY)
        max_side = max(gray.shape[:2])
        if max_side > 1400:
            scale = 1400.0 / float(max_side)
            gray = cv2.resize(
                gray,
                (int(gray.shape[1] * scale), int(gray.shape[0] * scale)),
                interpolation=cv2.INTER_AREA,
            )

        cascade_path = Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml"
        if not cascade_path.exists():
            logger.warning("Face cascade missing; assuming face may be present")
            return True

        detector = cv2.CascadeClassifier(str(cascade_path))
        faces = detector.detectMultiScale(gray, scaleFactor=1.15, minNeighbors=4, minSize=(36, 36))
        return len(faces) > 0
    except Exception:
        logger.exception("Face detection failed; defaulting to enabled")
        return True


def _restormer_stage_available(service: RestormerService | None, stage: str) -> tuple[bool, str | None]:
    if service is None:
        return False, f"Restormer {stage} service unavailable."

    ready_fn = getattr(service, "ensure_ready", None)
    if callable(ready_fn):
        ok, reason = ready_fn(warmup=False)
        if ok:
            return True, None
        return False, f"Restormer {stage} unavailable: {reason or 'model initialization failed'}"

    weights_path = getattr(service, "weights_path", None)
    if isinstance(weights_path, Path) and not weights_path.exists():
        return False, f"Restormer {stage} weights are not present locally."
    return True, None


def _lightweight_stage_available(service: RestorationModel | None, stage: str) -> tuple[bool, str | None]:
    if service is None:
        return False, f"Lightweight {stage} restoration service unavailable."

    model = getattr(service, "_model", None)
    if model is None:
        model_error = getattr(service, "_model_error", "initialization failed")
        return False, f"Lightweight {stage} restoration unavailable: {model_error}"
    return True, None


def _resolve_mode(options: dict[str, Any]) -> ModeConfig:
    mode = str(options.get("old_photo_mode", "repair_only")).strip().lower()
    if mode not in OLD_PHOTO_MODES:
        mode = "repair_only"
    return ModeConfig(
        mode=mode,
        enable_face=mode == "repair_face",
        enable_upscale=mode == "repair_upscale",
        enable_colorize=mode == "repair_colorize",
        allow_inpainting=bool(options.get("repair_broken", False)),
    )


def _blend_with_strength(original: Image.Image, restored: Image.Image, strength_pct: int, *, fallback: bool) -> Image.Image:
    base = original.convert("RGB")
    candidate = restored.convert("RGB").resize(base.size, Image.Resampling.LANCZOS)
    strength = max(0, min(100, strength_pct)) / 100.0
    if fallback:
        # Fallback mode needs to be strong enough to produce visible change.
        alpha = 0.30 + strength * 0.35
    else:
        # Primary restoration: allow the model output to dominate.
        alpha = 0.40 + strength * 0.40
    alpha = max(0.25, min(0.85, alpha))
    return Image.blend(base, candidate, alpha=alpha)


def _boost_restore_fallback(image: Image.Image) -> Image.Image:
    rgb = np.asarray(image.convert("RGB"), dtype=np.uint8)
    # Stronger denoising for a more visible restoration effect.
    denoised = cv2.fastNlMeansDenoisingColored(rgb, None, 14, 14, 7, 21)
    # Adaptive sharpening via unsharp mask.
    blur = cv2.GaussianBlur(denoised, (0, 0), 1.5)
    boosted = cv2.addWeighted(denoised, 1.45, blur, -0.45, 0.0)
    # CLAHE on luminance channel for additional contrast boost.
    lab = cv2.cvtColor(boosted, cv2.COLOR_RGB2LAB)
    l_ch, a_ch, b_ch = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_ch = clahe.apply(l_ch)
    boosted = cv2.cvtColor(cv2.merge([l_ch, a_ch, b_ch]), cv2.COLOR_LAB2RGB)
    return Image.fromarray(boosted).convert("RGB")


def create_progress_callback(job_id: str, stage_start: int, stage_end: int) -> Callable[[float], None]:
    def callback(ratio: float) -> None:
        if 0.0 <= ratio <= 1.0:
            progress = int(stage_start + ratio * (stage_end - stage_start))
            update_job(job_id, step="restoring", progress=progress, last_heartbeat=_utc_now_iso())

    return callback


def restore_stage_adaptive(
    image: Image.Image,
    service: RestormerService | RestorationModel,
    *,
    accelerate: bool,
    reduced_side: int,
    blend_alpha: float,
    progress_callback: Any = None,
) -> Image.Image:
    rgb = image.convert("RGB")

    if isinstance(service, RestorationModel):
        if progress_callback:
            progress_callback(0.1)
        result = service.restore(rgb, raise_on_error=True)
        if progress_callback:
            progress_callback(1.0)
        return result

    width, height = rgb.size
    max_side = max(width, height)
    if not accelerate or max_side <= reduced_side:
        return service.restore(rgb, progress_callback=progress_callback, raise_on_error=True)

    scale = reduced_side / float(max_side)
    resized = rgb.resize((int(width * scale), int(height * scale)), Image.Resampling.LANCZOS)
    restored_small = service.restore(resized, progress_callback=progress_callback, raise_on_error=True)
    restored_full = restored_small.resize(rgb.size, Image.Resampling.LANCZOS)
    return Image.blend(rgb, restored_full.convert("RGB"), alpha=max(0.16, min(0.42, blend_alpha)))


def run_with_progress_nudger(
    job_id: str,
    step: str,
    start_progress: int,
    operation: Callable[[], Image.Image],
    *,
    interval_seconds: float = 3.0,
    max_duration_seconds: float | None = None,
) -> Image.Image:
    stop_event = Event()
    result: dict[str, Image.Image] = {}
    error: dict[str, Exception] = {}

    def runner() -> None:
        try:
            result["value"] = operation()
        except Exception as exc:
            error["error"] = exc
        finally:
            stop_event.set()

    thread = Thread(target=runner, daemon=True)
    thread.start()

    started = time.monotonic()
    while not stop_event.wait(interval_seconds):
        update_job(job_id, step=step, progress=start_progress, last_heartbeat=_utc_now_iso())
        if max_duration_seconds is not None and (time.monotonic() - started) > max_duration_seconds:
            stop_event.set()
            raise TimeoutError(f"stage {step} timed out after {max_duration_seconds:.0f}s")

    if "error" in error:
        raise error["error"]
    if "value" not in result:
        raise RuntimeError(f"stage {step} exited without result")
    return result["value"]


def _run_stage(
    *,
    job_id: str,
    state: PipelineState,
    step: str,
    progress_start: int,
    progress_end: int,
    stage_key: str,
    stage_label: str,
    before: Image.Image,
    original: Image.Image,
    operation: Callable[[], Image.Image],
    gate_policy: GatePolicy,
    debug_dir: Path | None,
    debug_filename: str | None,
    model_name: str | None = None,
    timeout_seconds: float | None = None,
    interval_seconds: float = 3.0,
    failure_message: str | None = None,
    reject_message: str | None = None,
    negligible_message: str | None = None,
) -> tuple[Image.Image, bool, bool]:
    state.stages_run = _append_unique(state.stages_run, stage_key)
    update_stage(job_id, step, progress_start, state=state)

    stage_started = time.perf_counter()
    before_rgb = before.convert("RGB")
    rejected = False

    try:
        if model_name:
            state.models_used = _append_unique(state.models_used, model_name)
        after = run_with_progress_nudger(
            job_id,
            step,
            progress_start,
            operation,
            interval_seconds=interval_seconds,
            max_duration_seconds=timeout_seconds,
        )
    except Exception as exc:
        state.stages_skipped = _append_unique(state.stages_skipped, stage_key)
        if model_name:
            state.model_failures = _append_unique(state.model_failures, f"{model_name}: {exc}")
        if failure_message:
            state.warnings = _append_unique(state.warnings, failure_message)
        state.stage_timings[stage_key] = round(time.perf_counter() - stage_started, 3)
        logger.exception("Old-photo stage %s failed for job %s", stage_key, job_id)
        _update_state(job_id, state)
        if debug_filename:
            _save_debug_image(before_rgb, debug_dir, debug_filename)
        return before_rgb, False, False

    after_rgb = after.convert("RGB")
    metrics = compare_stage(before_rgb, after_rgb, original)
    accepted, reason = evaluate_gate(metrics, gate_policy)
    completed = False

    if not accepted:
        rejected = True
        state.destructive_stage_detected = True
        state.destructive_output_prevented = True
        state.destructive_stage_prevented = True
        state.stages_rejected = _append_unique(state.stages_rejected, stage_key)
        state.stages_skipped = _append_unique(state.stages_skipped, f"{stage_key}:reverted")
        state.warnings = _append_unique(
            state.warnings,
            reject_message or f"{stage_label} output rejected by quality gate ({reason}).",
        )
        after_rgb = before_rgb
    elif metrics.mean_delta_prev >= MIN_SIGNIFICANT_DELTA:
        state.stages_completed = _append_unique(state.stages_completed, stage_key)
        completed = True
    else:
        state.stages_skipped = _append_unique(state.stages_skipped, stage_key)
        if negligible_message:
            state.warnings = _append_unique(state.warnings, negligible_message)

    elapsed = round(time.perf_counter() - stage_started, 3)
    state.stage_timings[stage_key] = elapsed
    stage_diag = metrics_dict(metrics)
    stage_diag["accepted"] = accepted
    stage_diag["rejected"] = rejected
    stage_diag["duration_seconds"] = elapsed
    state.stage_diagnostics[stage_key] = stage_diag

    logger.info(
        "Old-photo job %s stage=%s accepted=%s rejected=%s delta_prev=%.4f ssim_prev=%.5f delta_orig=%.4f ssim_orig=%.5f elapsed=%.3fs",
        job_id,
        stage_key,
        accepted,
        rejected,
        metrics.mean_delta_prev,
        metrics.ssim_prev,
        metrics.mean_delta_original,
        metrics.ssim_original,
        elapsed,
    )

    _update_state(
        job_id,
        state,
        debug={"stage_diagnostics": state.stage_diagnostics},
        progress=progress_end,
    )
    if debug_filename:
        _save_debug_image(after_rgb, debug_dir, debug_filename)
    return after_rgb, completed, rejected


def run_old_photo_pipeline(
    job_id: str,
    upload_path: Path,
    output_root: Path,
    options: dict[str, Any],
    restormer_deblur: RestormerService | None,
    restormer_denoise: RestormerService | None,
    lama_service: LaMaService | None,
    deoldify_service: DeOldifyService | None,
    enhancer: RealESRGANService | None,
    face_restorer: FaceRestoreService | None,
    lightweight_restorers: dict[str, RestorationModel] | None = None,
) -> None:
    try:
        state = PipelineState()
        mode_cfg = _resolve_mode(options)
        debug_stage_saves = bool(options.get("debug_stage_saves", True))
        debug_dir = output_root / "debug" / job_id if debug_stage_saves else None
        if debug_dir is not None:
            debug_dir.mkdir(parents=True, exist_ok=True)

        update_job(
            job_id,
            status="processing",
            old_photo_mode=mode_cfg.mode,
            step="loading",
            progress=5,
            warnings=state.warnings,
            stages_completed=state.stages_completed,
            stages_run=state.stages_run,
            stages_skipped=state.stages_skipped,
            stages_rejected=state.stages_rejected,
            models_used=state.models_used,
            model_failures=state.model_failures,
            stage_timings=state.stage_timings,
            destructive_stage_detected=state.destructive_stage_detected,
            destructive_output_prevented=state.destructive_output_prevented,
            destructive_stage_prevented=state.destructive_stage_prevented,
            used_safe_fallback=state.used_safe_fallback,
            model_availability=state.model_availability,
            final_stage_selected=state.final_stage_selected,
            used_lightweight_restoration=state.used_lightweight_restoration,
            restoration_models_ran=state.restoration_models_ran,
            last_heartbeat=_utc_now_iso(),
            step_started_at=_utc_now_iso(),
            debug={"stage_diagnostics": state.stage_diagnostics, "stage_debug_dir": str(debug_dir) if debug_dir else None},
        )

        lightweight_restorers = lightweight_restorers or {}

        # 1) Preprocess / normalize
        load_started = time.perf_counter()
        original = ImageOps.exif_transpose(Image.open(upload_path)).convert("RGB")
        working = original.copy()
        state.stage_timings["load"] = round(time.perf_counter() - load_started, 3)
        _save_debug_image(working, debug_dir, "stage_1_loaded.png")
        _save_debug_image(working, debug_dir, "loaded.png")
        stage_candidates: dict[str, Image.Image] = {"loaded": working.copy()}

        state.warnings = _append_unique(
            state.warnings,
            f"Old Photo mode: {mode_cfg.mode.replace('_', ' ')}.",
        )

        max_side = max(working.size)
        cpu_like = (
            getattr(getattr(restormer_deblur, "device", None), "type", "cpu") == "cpu"
            if restormer_deblur is not None
            else True
        )
        max_processing_side = int(options.get("old_photo_max_side", 1200 if cpu_like else 2000))
        if max_side > max_processing_side:
            scale = max_processing_side / float(max_side)
            resized = (
                max(1, int(working.width * scale)),
                max(1, int(working.height * scale)),
            )
            working = working.resize(resized, Image.Resampling.LANCZOS)
            original = original.resize(resized, Image.Resampling.LANCZOS)
            stage_candidates["loaded"] = working.copy()
            state.warnings = _append_unique(
                state.warnings,
                f"Input was downscaled to {working.width}x{working.height} for stability.",
            )
            _save_debug_image(working, debug_dir, "stage_1_loaded.png")
            _save_debug_image(working, debug_dir, "loaded.png")

        normalize_policy = GatePolicy(
            max_delta_prev=12.0,
            min_ssim_prev=0.86,
            max_delta_original=12.0,
            min_ssim_original=0.86,
        )
        working, normalize_done, _ = _run_stage(
            job_id=job_id,
            state=state,
            step="normalizing",
            progress_start=10,
            progress_end=18,
            stage_key="normalize",
            stage_label="Preprocess normalize",
            before=working,
            original=original,
            operation=lambda image=working: _normalize_old_photo(image),
            gate_policy=normalize_policy,
            debug_dir=debug_dir,
            debug_filename=None,
            timeout_seconds=10.0,
            failure_message="Normalization failed; using original input.",
            reject_message="Normalization output was rejected by quality safety gate.",
            negligible_message="Normalization produced little visible change.",
        )
        if normalize_done:
            stage_candidates["preprocess"] = working.copy()

        deblur_available, deblur_reason = _restormer_stage_available(restormer_deblur, "deblur")
        denoise_available, denoise_reason = _restormer_stage_available(restormer_denoise, "denoise")
        lightweight_deblur = lightweight_restorers.get("deblur")
        lightweight_denoise = lightweight_restorers.get("denoise")
        lw_deblur_available, lw_deblur_reason = _lightweight_stage_available(lightweight_deblur, "deblur")
        lw_denoise_available, lw_denoise_reason = _lightweight_stage_available(lightweight_denoise, "denoise")
        state.model_availability = {
            "restormer_deblur": deblur_available,
            "restormer_denoise": denoise_available,
            "lightweight_deblur": lw_deblur_available,
            "lightweight_denoise": lw_denoise_available,
            "lama": lama_service is not None,
            "deoldify": deoldify_service is not None,
            "enhancer": enhancer is not None,
            "face_restorer": face_restorer is not None,
        }
        restoration_available = deblur_available or denoise_available
        primary_missing = not restoration_available

        if deblur_reason and not deblur_available:
            state.warnings = _append_unique(state.warnings, deblur_reason)
            state.model_failures = _append_unique(state.model_failures, "Restormer:deblur unavailable")
        if denoise_reason and not denoise_available:
            state.warnings = _append_unique(state.warnings, denoise_reason)
            state.model_failures = _append_unique(state.model_failures, "Restormer:denoise unavailable")
        if primary_missing:
            state.used_safe_fallback = True
            state.warnings = _append_unique(
                state.warnings,
                "Full old-photo restoration is unavailable because Restormer deblur/denoise models could not be initialized.",
            )
            _update_state(job_id, state)
            # Check if lightweight fallback models are available.
            lw_any = lw_deblur_available or lw_denoise_available
            if not lw_any:
                raise RuntimeError(
                    "Old-photo restoration unavailable: no restoration models (Restormer or lightweight) could be initialized"
                )

        # Conservative inpainting (disabled unless mask is tiny and confident)
        mask_coverage_total: float | None = None
        mask_coverage_central: float | None = None
        mask_confidence: float | None = None
        allow_inpainting = mode_cfg.allow_inpainting
        manual_mask_path = options.get("mask_path")
        damage_mask: Image.Image | None = None

        if allow_inpainting and not state.used_safe_fallback and not primary_missing:
            update_stage(job_id, "inpainting", 22, state=state)
            if manual_mask_path:
                try:
                    mask_arr = np.asarray(Image.open(manual_mask_path).convert("L"))
                    mask_arr = np.where(mask_arr > 0, 255, 0).astype(np.uint8)
                    damage_mask = Image.fromarray(mask_arr, mode="L")
                    mask_coverage_total = _mask_coverage_percent(mask_arr)
                    mask_coverage_central = _mask_coverage_central_percent(mask_arr)
                    mask_confidence = 1.0
                except Exception:
                    logger.exception("Manual mask could not be loaded")
            else:
                damage_mask, mask_coverage_total, mask_coverage_central, mask_confidence = build_conservative_damage_mask(working)

            state.mask_coverage_total = mask_coverage_total
            state.mask_coverage_central = mask_coverage_central
            _save_debug_mask(damage_mask if damage_mask is not None else Image.new("L", working.size, 0), debug_dir, "stage_2_mask.png")
            _save_debug_mask(damage_mask if damage_mask is not None else Image.new("L", working.size, 0), debug_dir, "mask.png")

            if damage_mask is None:
                state.stages_skipped = _append_unique(state.stages_skipped, "inpainting")
                state.warnings = _append_unique(state.warnings, "Damage mask unavailable; inpainting skipped.")
            elif lama_service is None:
                state.stages_skipped = _append_unique(state.stages_skipped, "inpainting")
                state.model_failures = _append_unique(state.model_failures, "LaMa: service unavailable")
                state.warnings = _append_unique(state.warnings, "LaMa unavailable; inpainting skipped.")
            else:
                total_limit = SAFE_MASK_TOTAL_MAX_DENOISE if state.used_denoise_fallback else SAFE_MASK_TOTAL_MAX
                central_limit = SAFE_MASK_CENTRAL_MAX_DENOISE if state.used_denoise_fallback else SAFE_MASK_CENTRAL_MAX
                if (
                    (mask_coverage_total or 0.0) > total_limit
                    or (mask_coverage_central or 0.0) > central_limit
                    or (mask_confidence or 0.0) < MIN_MASK_CONFIDENCE
                ):
                    state.stages_skipped = _append_unique(state.stages_skipped, "inpainting")
                    state.warnings = _append_unique(
                        state.warnings,
                        (
                            "Inpainting skipped: mask was not tiny/high-confidence enough "
                            f"(total={mask_coverage_total or 0.0:.2f}% central={mask_coverage_central or 0.0:.2f}% confidence={mask_confidence or 0.0:.2f})."
                        ),
                    )
                else:
                    inpaint_policy = GatePolicy(
                        max_delta_prev=8.0,
                        min_ssim_prev=0.90,
                        max_delta_original=9.0,
                        min_ssim_original=0.88,
                    )
                    working, inpaint_done, _ = _run_stage(
                        job_id=job_id,
                        state=state,
                        step="inpainting",
                        progress_start=22,
                        progress_end=30,
                        stage_key="inpainting",
                        stage_label="Micro inpainting",
                        before=working,
                        original=original,
                        operation=lambda image=working, mask=damage_mask: lama_service.inpaint(image, mask, raise_on_error=True),
                        gate_policy=inpaint_policy,
                        debug_dir=debug_dir,
                        debug_filename="stage_3_inpaint.png",
                        model_name="LaMa",
                        timeout_seconds=35.0 if cpu_like else 45.0,
                        interval_seconds=6.0,
                        failure_message="Inpainting failed; previous image was kept.",
                        reject_message="Inpainting output was rejected by quality gate.",
                        negligible_message="Inpainting produced little visible change.",
                    )
                    state.used_inpainting = inpaint_done
                    if inpaint_done:
                        stage_candidates["inpaint"] = working.copy()
            _update_state(
                job_id,
                state,
                mask_coverage=round(mask_coverage_total, 3) if mask_coverage_total is not None else None,
                mask_coverage_total=round(mask_coverage_total, 3) if mask_coverage_total is not None else None,
                mask_coverage_central=round(mask_coverage_central, 3) if mask_coverage_central is not None else None,
                debug={
                    "mask_coverage": round(mask_coverage_total, 3) if mask_coverage_total is not None else None,
                    "mask_coverage_total": round(mask_coverage_total, 3) if mask_coverage_total is not None else None,
                    "mask_coverage_central": round(mask_coverage_central, 3) if mask_coverage_central is not None else None,
                    "mask_confidence": round(mask_confidence, 3) if mask_confidence is not None else None,
                },
            )
            _save_debug_image(working, debug_dir, "inpaint.png")
            _save_debug_image(working, debug_dir, "stage_3_inpaint.png")
        else:
            state.stages_skipped = _append_unique(state.stages_skipped, "inpainting")
            if allow_inpainting and primary_missing:
                state.warnings = _append_unique(
                    state.warnings,
                    "Inpainting was disabled because the primary restoration model was unavailable.",
                )
            _save_debug_mask(Image.new("L", working.size, 0), debug_dir, "stage_2_mask.png")
            _save_debug_mask(Image.new("L", working.size, 0), debug_dir, "mask.png")
            _save_debug_image(working, debug_dir, "stage_3_inpaint.png")
            _save_debug_image(working, debug_dir, "inpaint.png")
            _update_state(job_id, state)

        # 2) Mandatory restoration stage (Restormer preferred, lightweight fallback if needed).
        requested_restore_mode = str(options.get("restore_mode", "auto")).strip().lower()
        if requested_restore_mode not in {"auto", "deblur", "denoise"}:
            requested_restore_mode = "auto"

        # In auto mode, flexibly use whatever is available instead of hard-requiring deblur.
        if requested_restore_mode == "auto":
            if not deblur_available and not denoise_available:
                # Only crash if NOTHING is available at all (including lightweight).
                if not lw_deblur_available and not lw_denoise_available:
                    _update_state(job_id, state)
                    raise RuntimeError(
                        "Old-photo restoration unavailable: no restoration models could be initialized"
                    )
        elif requested_restore_mode == "deblur" and not deblur_available:
            # User explicitly asked for deblur — try to fall back to denoise.
            if denoise_available:
                state.warnings = _append_unique(
                    state.warnings,
                    "Deblur model was unavailable; automatically falling back to denoise.",
                )
                requested_restore_mode = "denoise"
            elif lw_deblur_available:
                pass  # Will be handled below in plan building.
            else:
                _update_state(job_id, state)
                raise RuntimeError(
                    "Old-photo restoration unavailable: requested deblur model could not be loaded"
                )
        elif requested_restore_mode == "denoise" and not denoise_available:
            if deblur_available:
                state.warnings = _append_unique(
                    state.warnings,
                    "Denoise model was unavailable; automatically falling back to deblur.",
                )
                requested_restore_mode = "deblur"
            elif lw_denoise_available:
                pass
            else:
                _update_state(job_id, state)
                raise RuntimeError("Old-photo restoration unavailable: requested denoise model could not be loaded")

        # Build the list of stages to attempt based on what's actually available.
        if requested_restore_mode == "auto":
            requested_stages = []
            if deblur_available:
                requested_stages.append("deblur")
            if denoise_available:
                requested_stages.append("denoise")
            # If still empty, try lightweight models.
            if not requested_stages:
                if lw_deblur_available:
                    requested_stages.append("deblur")
                if lw_denoise_available:
                    requested_stages.append("denoise")
        else:
            requested_stages = [requested_restore_mode]

        deblur_strength = max(0, min(100, int(options.get("deblur_strength", 60))))
        denoise_strength = max(0, min(100, int(options.get("denoise_strength", 55))))

        restoration_plan: list[tuple[str, RestormerService | RestorationModel, str, int, bool]] = []
        for stage_name in requested_stages:
            if stage_name == "deblur":
                if deblur_available and restormer_deblur is not None:
                    restoration_plan.append(("deblur", restormer_deblur, "Restormer:deblur", deblur_strength, False))
                elif lw_deblur_available and lightweight_deblur is not None:
                    restoration_plan.append(("deblur", lightweight_deblur, "MPRNet:deblur", deblur_strength, True))
                    state.used_lightweight_restoration = True
                    state.warnings = _append_unique(
                        state.warnings,
                        "Restormer deblur unavailable; using lightweight MPRNet deblur fallback.",
                    )
                else:
                    state.warnings = _append_unique(state.warnings, "Deblur restoration model is unavailable.")
            elif stage_name == "denoise":
                if denoise_available and restormer_denoise is not None:
                    restoration_plan.append(("denoise", restormer_denoise, "Restormer:denoise", denoise_strength, False))
                elif lw_denoise_available and lightweight_denoise is not None:
                    restoration_plan.append(("denoise", lightweight_denoise, "MPRNet:denoise", denoise_strength, True))
                    state.used_lightweight_restoration = True
                    state.warnings = _append_unique(
                        state.warnings,
                        "Restormer denoise unavailable; using lightweight MPRNet denoise fallback.",
                    )
                else:
                    state.warnings = _append_unique(state.warnings, "Denoise restoration model is unavailable.")

        if not restoration_plan:
            state.stages_skipped = _append_unique(state.stages_skipped, "restoration")
            _update_state(job_id, state)
            raise RuntimeError("Old-photo restoration unavailable: no requested restoration stage could be initialized")

        state.used_deblur = any(stage_name == "deblur" for stage_name, *_ in restoration_plan)
        state.used_denoise_fallback = not state.used_deblur and any(
            stage_name == "denoise" for stage_name, *_ in restoration_plan
        )
        if state.used_denoise_fallback:
            state.warnings = _append_unique(
                state.warnings,
                "Deblur model was unavailable; running denoise-driven restoration.",
            )

        restore_policy = (
            GatePolicy(24.0, 0.76, 18.0, 0.80)
            if state.used_denoise_fallback
            else GatePolicy(42.0, 0.58, 32.0, 0.62)
        )
        use_accel = cpu_like or max(working.size) > 1400
        reduced_side = 1024 if use_accel else 1536
        timeout = 50.0 if cpu_like else 75.0

        progress_ranges: list[tuple[int, int]] = []
        if len(restoration_plan) == 1:
            progress_ranges.append((32, 60))
        else:
            cursor = 32
            segment = max(8, int(28 / len(restoration_plan)))
            for idx in range(len(restoration_plan)):
                end = 60 if idx == len(restoration_plan) - 1 else min(59, cursor + segment)
                progress_ranges.append((cursor, end))
                cursor = end

        restoration_completed = False
        restoration_rejected = False
        restoration_started = time.perf_counter()

        for index, (stage_name, stage_service, model_name, stage_strength, stage_is_fallback) in enumerate(restoration_plan):
            progress_start, progress_end = progress_ranges[index]
            update_stage(job_id, "restoring", progress_start, state=state)
            progress_callback = create_progress_callback(job_id, progress_start, progress_end)
            blend_alpha = 0.32 if stage_name == "deblur" else 0.26
            stage_key = f"restoration_{stage_name}"

            logger.info(
                "Old-photo restoration stage job=%s stage=%s model=%s fallback=%s",
                job_id,
                stage_name,
                model_name,
                stage_is_fallback,
            )

            stage_input = working
            working, stage_done, stage_rejected = _run_stage(
                job_id=job_id,
                state=state,
                step="restoring",
                progress_start=progress_start,
                progress_end=progress_end,
                stage_key=stage_key,
                stage_label=f"{stage_name.title()} restoration",
                before=working,
                original=original,
                operation=lambda image=stage_input, service=stage_service, strength=stage_strength, is_fallback=stage_is_fallback, accel=use_accel, side=reduced_side, alpha=blend_alpha, cb=progress_callback: _blend_with_strength(
                    image,
                    restore_stage_adaptive(
                        image=image,
                        service=service,
                        accelerate=accel,
                        reduced_side=side,
                        blend_alpha=alpha,
                        progress_callback=cb,
                    ),
                    strength,
                    fallback=is_fallback,
                ),
                gate_policy=restore_policy,
                debug_dir=debug_dir,
                debug_filename=None,
                model_name=model_name,
                timeout_seconds=timeout,
                failure_message=f"{stage_name.title()} restoration failed; previous image kept.",
                reject_message=f"{stage_name.title()} restoration output rejected by quality gate.",
                negligible_message=f"{stage_name.title()} restoration produced minimal visible change.",
            )

            state.restoration_models_ran = _append_unique(state.restoration_models_ran, model_name)
            restoration_completed = restoration_completed or stage_done
            restoration_rejected = restoration_rejected or stage_rejected

            if stage_done:
                candidate_key = "deblur_restore" if stage_name == "deblur" else "denoise_restore"
                stage_candidates[candidate_key] = working.copy()
                if stage_is_fallback:
                    state.used_lightweight_restoration = True

            if stage_name == "deblur":
                _save_debug_image(working, debug_dir, "deblur_restore.png")
            if stage_name == "denoise":
                _save_debug_image(working, debug_dir, "denoise_restore.png")
            _save_debug_image(working, debug_dir, "stage_4_restore.png")

        state.stage_timings["restoration_total"] = round(time.perf_counter() - restoration_started, 3)

        if not restoration_completed:
            state.warnings = _append_unique(
                state.warnings,
                "Restoration stages ran but did not produce an acceptable output.",
            )
            logger.warning("Old-photo restoration did not complete with acceptable output for job=%s", job_id)
            # Fall through — the best candidate selector will choose the loaded input.

        restoration_quality = compare_stage(original, working, original)
        no_meaningful_change = restoration_quality.ssim_original > NO_MEANINGFUL_CHANGE_SSIM
        if no_meaningful_change:
            logger.warning(
                "No meaningful change produced by restoration models: job=%s ssim=%.6f delta=%.4f",
                job_id,
                restoration_quality.ssim_original,
                restoration_quality.mean_delta_original,
            )
            state.warnings = _append_unique(state.warnings, "Image appears already clean; structural restoration was bypassed.")
            # We purposely do NO artificial boost here. If it's already clean, we want
            # preserving the clear original pixels for downstream colorization.

        logger.info(
            "Old-photo restoration summary job=%s ran=%s models=%s inference_time=%.3fs",
            job_id,
            restoration_completed,
            state.restoration_models_ran,
            state.stage_timings.get("restoration_total", 0.0),
        )

        skip_downstream = False
        if not restoration_completed and not no_meaningful_change:
            skip_downstream = True

        if restoration_rejected:
            skip_downstream = True
            state.warnings = _append_unique(
                state.warnings,
                "Restoration output was reverted; downstream stages were skipped for safety.",
            )

        # 3) Optional face restoration
        if mode_cfg.enable_face and not skip_downstream:
            if not detect_face_presence(working):
                state.stages_skipped = _append_unique(state.stages_skipped, "face_recovery")
                state.warnings = _append_unique(state.warnings, "No clear face detected; face restoration skipped.")
                _save_debug_image(working, debug_dir, "stage_7_face.png")
                _save_debug_image(working, debug_dir, "face_restore.png")
                _update_state(job_id, state, debug={"face_detected": False})
            elif face_restorer is None:
                state.stages_skipped = _append_unique(state.stages_skipped, "face_recovery")
                state.model_failures = _append_unique(state.model_failures, "GFPGAN: service unavailable")
                state.warnings = _append_unique(state.warnings, "GFPGAN unavailable; face restoration skipped.")
                _save_debug_image(working, debug_dir, "stage_7_face.png")
                _save_debug_image(working, debug_dir, "face_restore.png")
                _update_state(job_id, state, debug={"face_detected": True})
            else:
                face_strength = max(0.0, min(1.0, float(options.get("face_strength", 55)) / 100.0))
                face_policy = (
                    GatePolicy(14.0, 0.84, 12.0, 0.86)
                    if state.used_denoise_fallback
                    else GatePolicy(20.0, 0.74, 18.0, 0.78)
                )
                stage_input = working
                working, face_done, _ = _run_stage(
                    job_id=job_id,
                    state=state,
                    step="face_recovery",
                    progress_start=62,
                    progress_end=72,
                    stage_key="face_recovery",
                    stage_label="Face restoration",
                    before=working,
                    original=original,
                    operation=lambda image=stage_input, strength=face_strength: face_restorer.restore(
                        image,
                        strength=strength,
                        raise_on_error=True,
                    ),
                    gate_policy=face_policy,
                    debug_dir=debug_dir,
                    debug_filename="stage_7_face.png",
                    model_name="GFPGAN",
                    timeout_seconds=28.0 if cpu_like else 40.0,
                    failure_message="Face restoration failed; previous image kept.",
                    reject_message="Face restoration output rejected by quality gate.",
                    negligible_message="Face restoration produced little visible change.",
                )
                state.used_face_recovery = face_done
                if face_done:
                    stage_candidates["face_restore"] = working.copy()
                _save_debug_image(working, debug_dir, "face_restore.png")
        else:
            state.stages_skipped = _append_unique(state.stages_skipped, "face_recovery")
            _save_debug_image(working, debug_dir, "stage_7_face.png")
            _save_debug_image(working, debug_dir, "face_restore.png")
            _update_state(job_id, state)

        # 4) Optional upscale
        if mode_cfg.enable_upscale and not skip_downstream:
            if enhancer is None:
                state.stages_skipped = _append_unique(state.stages_skipped, "enhancement")
                state.model_failures = _append_unique(state.model_failures, "RealESRGAN: service unavailable")
                state.warnings = _append_unique(state.warnings, "Upscale skipped because enhancer is unavailable.")
                _save_debug_image(working, debug_dir, "stage_6_enhance.png")
                _save_debug_image(working, debug_dir, "enhance.png")
                _update_state(job_id, state)
            else:
                upscale_factor = int(options.get("old_photo_upscale_factor", 2))
                if upscale_factor not in (2, 4):
                    upscale_factor = 2
                if cpu_like and upscale_factor == 4:
                    upscale_factor = 2
                    state.warnings = _append_unique(
                        state.warnings,
                        "CPU environment detected; old-photo upscale was reduced to 2x for stability.",
                    )

                upscale_policy = (
                    GatePolicy(16.0, 0.82, 14.0, 0.84)
                    if state.used_denoise_fallback
                    else GatePolicy(24.0, 0.70, 24.0, 0.72)
                )
                stage_input = working
                working, upscale_done, _ = _run_stage(
                    job_id=job_id,
                    state=state,
                    step="upscaling",
                    progress_start=74,
                    progress_end=86,
                    stage_key="enhancement",
                    stage_label="Upscale enhancement",
                    before=working,
                    original=original,
                    operation=lambda image=stage_input, up=upscale_factor: enhancer.enhance(image, up),
                    gate_policy=upscale_policy,
                    debug_dir=debug_dir,
                    debug_filename="stage_6_enhance.png",
                    model_name="RealESRGAN",
                    timeout_seconds=42.0 if cpu_like else 65.0,
                    failure_message="Upscale failed; previous image kept.",
                    reject_message="Upscale output rejected by quality gate.",
                    negligible_message="Upscale produced minimal visible change.",
                )
                state.used_enhancement = upscale_done
                if upscale_done:
                    stage_candidates["enhance"] = working.copy()
                _save_debug_image(working, debug_dir, "enhance.png")
        else:
            state.stages_skipped = _append_unique(state.stages_skipped, "enhancement")
            _save_debug_image(working, debug_dir, "stage_6_enhance.png")
            _save_debug_image(working, debug_dir, "enhance.png")
            _update_state(job_id, state)

        # 5) Optional colorization (quality-gated, luminance-preserving)
        if mode_cfg.enable_colorize and not skip_downstream:
            if not is_grayscale_like(working):
                state.stages_skipped = _append_unique(state.stages_skipped, "colorization")
                state.warnings = _append_unique(
                    state.warnings,
                    "Colorization skipped because image does not appear grayscale-like.",
                )
                _save_debug_image(working, debug_dir, "stage_5_colorize.png")
                _update_state(job_id, state)
            elif deoldify_service is None:
                state.stages_skipped = _append_unique(state.stages_skipped, "colorization")
                state.model_failures = _append_unique(state.model_failures, "DeOldify: service unavailable")
                state.warnings = _append_unique(state.warnings, "Colorization skipped because DeOldify is unavailable.")
                _save_debug_image(working, debug_dir, "stage_5_colorize.png")
                _update_state(job_id, state)
            else:
                update_stage(job_id, "colorizing", 88, state=state)
                state.stages_run = _append_unique(state.stages_run, "colorization")
                if "DeOldify" not in state.models_used:
                    state.models_used = _append_unique(state.models_used, "DeOldify")

                colorize_started = time.perf_counter()
                pre_colorize = working.copy()
                try:
                    colorized = run_with_progress_nudger(
                        job_id,
                        "colorizing",
                        88,
                        lambda img=working: deoldify_service.colorize(
                            img,
                            chroma_strength=0.85,
                            raise_on_error=True,
                            preserve_luminance=True,
                        ),
                        interval_seconds=3.0,
                        max_duration_seconds=35.0 if cpu_like else 55.0,
                    )

                    # Quality assessment: check saturation, reject fake/washed colors.
                    color_quality = deoldify_service.assess_colorization_quality(pre_colorize, colorized)
                    state.stage_diagnostics["colorization_quality"] = color_quality

                    if not color_quality["acceptable"]:
                        # Colorization failed quality check — keep restored version.
                        state.stages_rejected = _append_unique(state.stages_rejected, "colorization")
                        state.warnings = _append_unique(
                            state.warnings,
                            f"Colorization rejected: {color_quality['reason']}. Kept restored grayscale version.",
                        )
                        _save_debug_image(colorized, debug_dir, "stage_5_colorize_rejected.png")
                        _save_debug_image(working, debug_dir, "stage_5_colorize.png")
                    else:
                        color_metrics = compare_stage(pre_colorize, colorized, original)
                        color_diag = metrics_dict(color_metrics)
                        color_diag.update(color_quality)
                        state.stage_diagnostics["colorization"] = color_diag

                        if color_metrics.mean_delta_prev < MIN_SIGNIFICANT_DELTA / 2.0:
                            state.stages_skipped = _append_unique(state.stages_skipped, "colorization")
                            state.warnings = _append_unique(
                                state.warnings,
                                "Colorization produced little visible change.",
                            )
                            _save_debug_image(colorized, debug_dir, "stage_5_colorize.png")
                        else:
                            # Colorization accepted!
                            working = colorized
                            state.stages_completed = _append_unique(state.stages_completed, "colorization")
                            stage_candidates["colorize"] = working.copy()
                            _save_debug_image(working, debug_dir, "stage_5_colorize.png")

                except Exception as exc:
                    state.stages_skipped = _append_unique(state.stages_skipped, "colorization")
                    state.model_failures = _append_unique(state.model_failures, f"DeOldify: {exc}")
                    state.warnings = _append_unique(state.warnings, "Colorization failed; previous image kept.")
                    logger.exception("DeOldify colorization failed for job %s", job_id)
                    _save_debug_image(working, debug_dir, "stage_5_colorize.png")

                state.stage_timings["colorization"] = round(time.perf_counter() - colorize_started, 3)
                _update_state(job_id, state)
        else:
            state.stages_skipped = _append_unique(state.stages_skipped, "colorization")
            _save_debug_image(working, debug_dir, "stage_5_colorize.png")
            _update_state(job_id, state)

        # 6) Choose best safe stage, not automatically the last.
        update_stage(job_id, "evaluating", 96, state=state)
        stage_candidates["current"] = working.copy()
        conservative_pick = state.used_safe_fallback
        selected_stage, candidate_metrics, final_rejected = choose_best_stage(
            stage_candidates,
            original,
            conservative=conservative_pick,
        )
        for rejected_name in final_rejected:
            state.stages_rejected = _append_unique(state.stages_rejected, rejected_name)

        if selected_stage != "current":
            state.warnings = _append_unique(
                state.warnings,
                f"Final output selected from safest stage: {selected_stage}.",
            )

        if selected_stage == "loaded":
            state.destructive_output_prevented = True
            no_meaningful_change = True
            if state.used_safe_fallback or state.used_denoise_fallback:
                state.destructive_stage_prevented = True
            state.warnings = _append_unique(
                state.warnings,
                "Final output reverted to loaded input because all restoration stages were rejected or produced no change.",
            )

        working = stage_candidates[selected_stage].convert("RGB")
        state.final_stage_selected = selected_stage
        _save_debug_image(working, debug_dir, "final.png")

        ssim, psnr = compute_quality_metrics(original, working)
        mean_delta = mean_absolute_delta(original, working)
        output_changed = bool(mean_delta >= MIN_SIGNIFICANT_DELTA)
        logger.info(
            "Old-photo output summary job=%s restoration_ran=%s models=%s inference_time=%.3fs output_changed=%s ssim=%.6f psnr=%.3f",
            job_id,
            bool(state.restoration_models_ran),
            state.restoration_models_ran,
            state.stage_timings.get("restoration_total", 0.0),
            output_changed,
            float(ssim),
            float(psnr),
        )
        if not output_changed:
            no_meaningful_change = True
            state.warnings = _append_unique(state.warnings, "Final output is nearly identical to input.")
        if float(ssim) > NO_MEANINGFUL_CHANGE_SSIM:
            no_meaningful_change = True
            logger.warning(
                "No meaningful change produced: job=%s ssim=%.6f delta=%.4f",
                job_id,
                float(ssim),
                float(mean_delta),
            )
            state.warnings = _append_unique(
                state.warnings,
                "No meaningful change produced. The output may look similar to the input.",
            )
        if state.used_safe_fallback:
            state.warnings = _append_unique(
                state.warnings,
                "Full old-photo restoration did not run because the primary model was unavailable; safe fallback output was returned.",
            )
        if state.used_denoise_fallback:
            state.warnings = _append_unique(
                state.warnings,
                "Deblur model was unavailable; denoise-driven restoration policy was used.",
            )
        if state.used_lightweight_restoration:
            state.warnings = _append_unique(
                state.warnings,
                "Full Restormer stack was partially unavailable; lightweight restoration model was used.",
            )

        # Save output.
        update_stage(job_id, "saving", 97, state=state)
        save_started = time.perf_counter()
        enhanced_path = output_root / "enhanced" / f"{job_id}.png"
        enhanced_path.parent.mkdir(parents=True, exist_ok=True)
        working.save(enhanced_path, format="PNG")
        state.stage_timings["save"] = round(time.perf_counter() - save_started, 3)
        input_bytes = upload_path.stat().st_size if upload_path.exists() else None
        output_bytes = enhanced_path.stat().st_size if enhanced_path.exists() else None

        used_fallback = (
            state.used_safe_fallback
            or state.used_denoise_fallback
            or state.used_lightweight_restoration
            or bool(state.model_failures)
            or state.destructive_output_prevented
        )
        _update_state(
            job_id,
            state,
            iterations=1,
            used_fallback=used_fallback,
            output_changed=output_changed,
            no_meaningful_change=no_meaningful_change,
            mask_coverage=round(mask_coverage_total, 3) if mask_coverage_total is not None else None,
            destructive_output_prevented=state.destructive_output_prevented,
            used_safe_fallback=state.used_safe_fallback,
            used_lightweight_restoration=state.used_lightweight_restoration,
            restoration_models_ran=state.restoration_models_ran,
            model_availability=state.model_availability,
            metrics={"ssim": round(float(ssim), 6), "psnr": round(float(psnr), 6)},
            outputs={
                "enhanced_path": str(enhanced_path),
                "enhanced_url": f"/api/download/{job_id}/enhanced",
            },
            debug={
                "output_size": {"width": working.width, "height": working.height, "bytes": output_bytes},
                "input_size": {"bytes": input_bytes, "width": original.width, "height": original.height},
                "mean_pixel_delta": round(float(mean_delta), 6),
                "stage_diagnostics": state.stage_diagnostics,
                "stage_debug_dir": str(debug_dir) if debug_dir else None,
                "candidate_metrics": candidate_metrics,
                "restoration": {
                    "models_ran": state.restoration_models_ran,
                    "inference_time_seconds": state.stage_timings.get("restoration_total"),
                    "output_changed": output_changed,
                },
            },
        )

        _write_debug_summary(
            debug_dir,
            {
                "job_id": job_id,
                "mode": mode_cfg.mode,
                "warnings": state.warnings,
                "stage_timings": state.stage_timings,
                "stages_run": state.stages_run,
                "stages_completed": state.stages_completed,
                "stages_skipped": state.stages_skipped,
                "stages_rejected": state.stages_rejected,
                "model_availability": state.model_availability,
                "models_used": state.models_used,
                "model_failures": state.model_failures,
                "used_deblur": state.used_deblur,
                "used_denoise_fallback": state.used_denoise_fallback,
                "used_lightweight_restoration": state.used_lightweight_restoration,
                "used_inpainting": state.used_inpainting,
                "used_enhancement": state.used_enhancement,
                "used_face_recovery": state.used_face_recovery,
                "mask_coverage_total": state.mask_coverage_total,
                "mask_coverage_central": state.mask_coverage_central,
                "final_stage_selected": state.final_stage_selected,
                "restoration_models_ran": state.restoration_models_ran,
                "candidate_metrics": candidate_metrics,
            },
        )

        if options.get("encrypt"):
            from app.core.crypto import encrypt_file

            if options.get("password"):
                update_stage(job_id, "encrypting", 98, state=state)
                encrypted_path = output_root / "encrypted" / f"{job_id}.bin"
                encrypt_file(enhanced_path, encrypted_path, str(options["password"]))
                update_job(
                    job_id,
                    outputs={
                        "encrypted_path": str(encrypted_path),
                        "encrypted_url": f"/api/download/{job_id}/encrypted",
                    },
                    last_heartbeat=_utc_now_iso(),
                )
            else:
                state.warnings = _append_unique(state.warnings, "Encryption was requested without a password; skipped.")

        update_job(
            job_id,
            status="done",
            old_photo_mode=mode_cfg.mode,
            step="done",
            progress=100,
            warnings=state.warnings,
            used_fallback=used_fallback,
            stages_completed=state.stages_completed,
            stages_run=state.stages_run,
            stages_skipped=state.stages_skipped,
            stages_rejected=state.stages_rejected,
            models_used=state.models_used,
            model_failures=state.model_failures,
            model_availability=state.model_availability,
            output_changed=output_changed,
            mask_coverage=round(mask_coverage_total, 3) if mask_coverage_total is not None else None,
            mask_coverage_total=round(state.mask_coverage_total, 3) if state.mask_coverage_total is not None else None,
            mask_coverage_central=round(state.mask_coverage_central, 3) if state.mask_coverage_central is not None else None,
            destructive_stage_detected=state.destructive_stage_detected,
            destructive_output_prevented=state.destructive_output_prevented,
            destructive_stage_prevented=state.destructive_stage_prevented,
            used_safe_fallback=state.used_safe_fallback,
            used_deblur=state.used_deblur,
            used_denoise_fallback=state.used_denoise_fallback,
            used_lightweight_restoration=state.used_lightweight_restoration,
            used_inpainting=state.used_inpainting,
            used_enhancement=state.used_enhancement,
            used_face_recovery=state.used_face_recovery,
            restoration_models_ran=state.restoration_models_ran,
            final_stage_selected=state.final_stage_selected,
            stage_timings=state.stage_timings,
            last_heartbeat=_utc_now_iso(),
            debug={"stage_diagnostics": state.stage_diagnostics, "stage_debug_dir": str(debug_dir) if debug_dir else None},
        )
    except Exception as exc:
        logger.exception("Old-photo job %s failed", job_id)
        fail_job(job_id, str(exc))
