from __future__ import annotations

import time
from datetime import datetime, timezone
from pathlib import Path
from threading import Event, Thread
from typing import Any, Callable, TypeVar

from PIL import Image

from app.core.crypto import encrypt_file
from app.core.jobs import fail_job, update_job
from app.services.bg_remove import remove_background
from app.services.composite import apply_background_mode
from app.services.enhance import RealESRGANService
from app.services.face_restore import FaceRestoreService
from app.services.metrics import compute_quality_metrics
from app.services.restoration import RestorationModel


T = TypeVar("T")


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _set_step(job_id: str, step: str, progress: int, **extra: Any) -> None:
    payload: dict[str, Any] = {
        "step": step,
        "progress": progress,
        "last_heartbeat": _utc_now_iso(),
        "step_started_at": _utc_now_iso(),
    }
    payload.update(extra)
    update_job(job_id, **payload)


def _heartbeat(job_id: str, step: str, progress: int) -> None:
    update_job(job_id, step=step, progress=progress, last_heartbeat=_utc_now_iso())


def _run_with_watchdog(
    job_id: str,
    step: str,
    start_progress: int,
    end_progress: int,
    operation: Callable[[], T],
    *,
    timeout_seconds: float | None,
    interval_seconds: float = 3.0,
) -> T:
    stop_event = Event()
    result_holder: dict[str, T] = {}
    error_holder: dict[str, Exception] = {}

    def runner() -> None:
        try:
            result_holder["value"] = operation()
        except Exception as exc:
            error_holder["error"] = exc
        finally:
            stop_event.set()

    Thread(target=runner, daemon=True).start()
    started = time.monotonic()

    while not stop_event.wait(interval_seconds):
        elapsed = time.monotonic() - started
        if timeout_seconds is not None and elapsed > timeout_seconds:
            raise TimeoutError(f"{step} timed out after {timeout_seconds:.0f}s")

        if timeout_seconds and timeout_seconds > 0 and end_progress > start_progress:
            ratio = min(0.92, elapsed / timeout_seconds)
            progress = int(start_progress + ratio * (end_progress - start_progress))
        else:
            progress = max(start_progress, end_progress - 1)

        _heartbeat(job_id, step, progress)

    if "error" in error_holder:
        raise error_holder["error"]
    if "value" not in result_holder:
        raise RuntimeError(f"{step} exited without result")

    _heartbeat(job_id, step, end_progress)
    return result_holder["value"]


def run_pipeline(
    job_id: str,
    upload_path: Path,
    output_root: Path,
    options: dict[str, Any],
    enhancer: RealESRGANService | None,
    face_restorer: FaceRestoreService | None,
    restoration_models: dict[str, RestorationModel] | None,
) -> None:
    warnings: list[str] = []
    model_failures: list[str] = []
    models_used: list[str] = []
    stage_timings: dict[str, float] = {}

    try:
        update_job(
            job_id,
            status="processing",
            step="uploading",
            progress=5,
            warnings=warnings,
            model_failures=model_failures,
            models_used=models_used,
            stage_timings=stage_timings,
            last_heartbeat=_utc_now_iso(),
            step_started_at=_utc_now_iso(),
        )

        original = Image.open(upload_path).convert("RGB")
        working = original

        enhanced_path: Path | None = None
        bg_path: Path | None = None
        encrypted_path: Path | None = None

        iterations = 0
        final_ssim = None
        final_psnr = None
        restoration_models = restoration_models or {}

        restore_enabled = bool(options.get("restore", False))
        restore_mode = options.get("restore_mode", "auto")
        ultra = bool(options.get("ultra", False))
        face_strength = max(0.0, min(1.0, float(options.get("face_strength", 75)) / 100.0))

        def build_restore_stages() -> list[str]:
            if restore_mode in {"deblur", "denoise"}:
                if ultra:
                    secondary = "denoise" if restore_mode == "deblur" else "deblur"
                    return [restore_mode, secondary]
                return [restore_mode]
            deblur_strength = int(options.get("deblur_strength", 50))
            denoise_strength = int(options.get("denoise_strength", 50))
            if deblur_strength >= denoise_strength:
                return ["deblur", "denoise"] if ultra else ["deblur"]
            return ["denoise", "deblur"] if ultra else ["denoise"]

        def apply_restore_stages(image: Image.Image, progress_start: int, progress_end: int) -> Image.Image:
            out = image
            stages = build_restore_stages()
            if not stages:
                return out

            planned: list[tuple[str, RestorationModel]] = []
            for stage in stages:
                restorer = restoration_models.get(stage)
                if restorer is None:
                    warning = f"{stage} restoration model unavailable; skipping stage."
                    if warning not in warnings:
                        warnings.append(warning)
                    failure = f"MPRNet:{stage} unavailable"
                    if failure not in model_failures:
                        model_failures.append(failure)
                    continue

                model_ready = getattr(restorer, "_model", None) is not None
                if not model_ready:
                    reason = getattr(restorer, "_model_error", "model initialization failed")
                    warning = f"{stage} restoration model failed to initialize; skipping stage ({reason})."
                    if warning not in warnings:
                        warnings.append(warning)
                    failure = f"MPRNet:{stage} init_failed"
                    if failure not in model_failures:
                        model_failures.append(failure)
                    continue

                planned.append((stage, restorer))

            if not planned:
                update_job(
                    job_id,
                    warnings=warnings,
                    model_failures=model_failures,
                    used_fallback=True,
                    last_heartbeat=_utc_now_iso(),
                )
                return out

            span = max(1, progress_end - progress_start)
            segment = max(1, span // len(planned))
            stage_succeeded = False

            for idx, (stage, restorer) in enumerate(planned):
                stage_start = progress_start + (idx * segment)
                stage_end = progress_end if idx == len(planned) - 1 else min(progress_end - 1, stage_start + segment)
                stage_tag = f"MPRNet:{stage}"
                if stage_tag not in models_used:
                    models_used.append(stage_tag)

                _set_step(
                    job_id,
                    "restoring",
                    stage_start,
                    warnings=warnings,
                    model_failures=model_failures,
                    models_used=models_used,
                    stage_timings=stage_timings,
                )

                stage_started = time.perf_counter()
                timeout_seconds = 120.0 if max(out.size) > 1600 else 80.0
                try:
                    out = _run_with_watchdog(
                        job_id=job_id,
                        step="restoring",
                        start_progress=stage_start,
                        end_progress=max(stage_start + 1, stage_end),
                        operation=lambda restorer=restorer, current=out: restorer.restore(current, raise_on_error=True),
                        timeout_seconds=timeout_seconds,
                        interval_seconds=3.0,
                    )
                    stage_succeeded = True
                except TimeoutError as exc:
                    warning = f"{stage} restoration timed out; job aborted to avoid an infinite wait."
                    if warning not in warnings:
                        warnings.append(warning)
                    failure = f"MPRNet:{stage} timeout"
                    if failure not in model_failures:
                        model_failures.append(failure)
                    update_job(
                        job_id,
                        warnings=warnings,
                        model_failures=model_failures,
                        models_used=models_used,
                        stage_timings=stage_timings,
                        used_fallback=True,
                        last_heartbeat=_utc_now_iso(),
                    )
                    raise RuntimeError(str(exc)) from exc
                except Exception as exc:
                    warning = f"{stage} restoration failed; stage skipped ({exc})."
                    if warning not in warnings:
                        warnings.append(warning)
                    failure = f"MPRNet:{stage} failed"
                    if failure not in model_failures:
                        model_failures.append(failure)
                    stage_timings[f"restore_{stage}"] = round(time.perf_counter() - stage_started, 3)
                    update_job(
                        job_id,
                        warnings=warnings,
                        model_failures=model_failures,
                        models_used=models_used,
                        stage_timings=stage_timings,
                        used_fallback=True,
                        last_heartbeat=_utc_now_iso(),
                    )
                    continue

                stage_timings[f"restore_{stage}"] = round(time.perf_counter() - stage_started, 3)
                update_job(
                    job_id,
                    warnings=warnings,
                    model_failures=model_failures,
                    models_used=models_used,
                    stage_timings=stage_timings,
                    last_heartbeat=_utc_now_iso(),
                )

            if not stage_succeeded:
                warning = "Restoration was requested but no restoration stage completed successfully."
                if warning not in warnings:
                    warnings.append(warning)
                update_job(
                    job_id,
                    warnings=warnings,
                    model_failures=model_failures,
                    models_used=models_used,
                    stage_timings=stage_timings,
                    used_fallback=True,
                    last_heartbeat=_utc_now_iso(),
                )

            return out

        if restore_enabled:
            _set_step(job_id, "restoring", 12, warnings=warnings, model_failures=model_failures, models_used=models_used, stage_timings=stage_timings)
            if not options["enhance"]:
                working = apply_restore_stages(working, 12, 35)
                ssim, psnr = compute_quality_metrics(original, working)
                iterations = 1
                final_ssim = ssim
                final_psnr = psnr
                update_job(
                    job_id,
                    iterations=iterations,
                    metrics={"ssim": round(ssim, 6), "psnr": round(psnr, 6)},
                    progress=35,
                    warnings=warnings,
                    model_failures=model_failures,
                    models_used=models_used,
                    stage_timings=stage_timings,
                    last_heartbeat=_utc_now_iso(),
                )

                enhanced_path = output_root / "enhanced" / f"{job_id}.png"
                working.save(enhanced_path, format="PNG")
                update_job(
                    job_id,
                    outputs={
                        "enhanced_path": str(enhanced_path),
                        "enhanced_url": f"/api/download/{job_id}/enhanced",
                    },
                    progress=55,
                    warnings=warnings,
                    model_failures=model_failures,
                    models_used=models_used,
                    stage_timings=stage_timings,
                    last_heartbeat=_utc_now_iso(),
                )

        if options["enhance"]:
            _set_step(job_id, "enhancing", 20, warnings=warnings, model_failures=model_failures, models_used=models_used, stage_timings=stage_timings)
            quality = options.get("quality", "high")
            enhancement_ran = False

            if restore_enabled:
                working = apply_restore_stages(working, 25, 40)

            if enhancer is None:
                warning = "Enhancement was requested but RealESRGAN service is unavailable; skipping enhancement stage."
                if warning not in warnings:
                    warnings.append(warning)
                failure = "RealESRGAN unavailable"
                if failure not in model_failures:
                    model_failures.append(failure)
                update_job(
                    job_id,
                    warnings=warnings,
                    model_failures=model_failures,
                    models_used=models_used,
                    stage_timings=stage_timings,
                    used_fallback=True,
                    last_heartbeat=_utc_now_iso(),
                )
            else:
                requested_upscale = int(options.get("upscale", 4))
                upscale = 4 if quality == "high" or ultra else requested_upscale
                if getattr(enhancer, "device", "cpu") == "cpu" and upscale == 4:
                    upscale = 2
                    warning = "CPU environment detected; upscale reduced from 4x to 2x for stability."
                    if warning not in warnings:
                        warnings.append(warning)
                if "RealESRGAN" not in models_used:
                    models_used.append("RealESRGAN")

                enhance_started = time.perf_counter()
                enhance_timeout = 180.0 if upscale == 2 else 220.0
                working = _run_with_watchdog(
                    job_id=job_id,
                    step="enhancing",
                    start_progress=40,
                    end_progress=50,
                    operation=lambda image=working, factor=upscale: enhancer.enhance(image, factor),
                    timeout_seconds=enhance_timeout,
                    interval_seconds=3.0,
                )
                stage_timings["enhancing"] = round(time.perf_counter() - enhance_started, 3)
                enhancement_ran = True

            if options["portrait_mode"]:
                if face_restorer is None:
                    warning = "Face restoration was requested but GFPGAN service is unavailable; skipping face stage."
                    if warning not in warnings:
                        warnings.append(warning)
                    failure = "GFPGAN unavailable"
                    if failure not in model_failures:
                        model_failures.append(failure)
                    update_job(
                        job_id,
                        warnings=warnings,
                        model_failures=model_failures,
                        models_used=models_used,
                        stage_timings=stage_timings,
                        used_fallback=True,
                        last_heartbeat=_utc_now_iso(),
                    )
                else:
                    if "GFPGAN" not in models_used:
                        models_used.append("GFPGAN")
                    face_started = time.perf_counter()
                    working = _run_with_watchdog(
                        job_id=job_id,
                        step="evaluating",
                        start_progress=50,
                        end_progress=54,
                        operation=lambda image=working: face_restorer.restore(
                            image,
                            strength=face_strength,
                            raise_on_error=True,
                        ),
                        timeout_seconds=85.0,
                        interval_seconds=3.0,
                    )
                    stage_timings["face_restore"] = round(time.perf_counter() - face_started, 3)

            no_processing_possible = (
                not enhancement_ran
                and not restore_enabled
                and (not options.get("portrait_mode", False) or face_restorer is None)
                and not options.get("remove_bg", False)
                and not options.get("encrypt", False)
            )
            if no_processing_possible:
                raise RuntimeError("No processing stage could run: requested model stages are unavailable")

            iterations = 1
            _set_step(job_id, "evaluating", 55, warnings=warnings, model_failures=model_failures, models_used=models_used, stage_timings=stage_timings)
            ssim, psnr = compute_quality_metrics(original, working)
            final_ssim = ssim
            final_psnr = psnr
            update_job(
                job_id,
                iterations=1,
                metrics={"ssim": round(ssim, 6), "psnr": round(psnr, 6)},
                warnings=warnings,
                model_failures=model_failures,
                models_used=models_used,
                stage_timings=stage_timings,
                last_heartbeat=_utc_now_iso(),
            )

            enhanced_path = output_root / "enhanced" / f"{job_id}.png"
            working.save(enhanced_path, format="PNG")
            update_job(
                job_id,
                outputs={
                    "enhanced_path": str(enhanced_path),
                    "enhanced_url": f"/api/download/{job_id}/enhanced",
                },
                progress=55,
                warnings=warnings,
                model_failures=model_failures,
                models_used=models_used,
                stage_timings=stage_timings,
                last_heartbeat=_utc_now_iso(),
            )

        bg_source = working if (options["enhance"] or restore_enabled) else original

        if options["remove_bg"]:
            _set_step(job_id, "segmenting", 65, warnings=warnings, model_failures=model_failures, models_used=models_used, stage_timings=stage_timings)
            segment_started = time.perf_counter()
            fg = _run_with_watchdog(
                job_id=job_id,
                step="segmenting",
                start_progress=65,
                end_progress=76,
                operation=lambda source=bg_source: remove_background(source),
                timeout_seconds=95.0,
                interval_seconds=3.0,
            )
            stage_timings["segmenting"] = round(time.perf_counter() - segment_started, 3)

            custom_bg = None
            if options["bg_mode"] == "custom":
                custom_path = options.get("custom_bg_path")
                if not custom_path:
                    raise ValueError("custom background was not uploaded")
                custom_bg = Image.open(custom_path)

            _set_step(job_id, "compositing", 78, warnings=warnings, model_failures=model_failures, models_used=models_used, stage_timings=stage_timings)
            composite_started = time.perf_counter()
            composited = _run_with_watchdog(
                job_id=job_id,
                step="compositing",
                start_progress=78,
                end_progress=88,
                operation=lambda: apply_background_mode(
                    original=bg_source,
                    foreground_rgba=fg,
                    bg_mode=options["bg_mode"],
                    solid_color=options["solid_color"],
                    custom_background=custom_bg,
                ),
                timeout_seconds=70.0,
                interval_seconds=3.0,
            )
            stage_timings["compositing"] = round(time.perf_counter() - composite_started, 3)

            bg_path = output_root / "bg" / f"{job_id}.png"
            composited.save(bg_path, format="PNG")
            update_job(
                job_id,
                outputs={
                    "bg_path": str(bg_path),
                    "bg_url": f"/api/download/{job_id}/bg",
                },
                progress=88,
                warnings=warnings,
                model_failures=model_failures,
                models_used=models_used,
                stage_timings=stage_timings,
                last_heartbeat=_utc_now_iso(),
            )

        if options["encrypt"]:
            if not options.get("password"):
                raise ValueError("password is required when encrypt=true")

            _set_step(job_id, "encrypting", 93, warnings=warnings, model_failures=model_failures, models_used=models_used, stage_timings=stage_timings)
            source_path = bg_path or enhanced_path or upload_path
            encrypted_path = output_root / "encrypted" / f"{job_id}.bin"
            encrypt_file(source_path, encrypted_path, options["password"])
            update_job(
                job_id,
                outputs={
                    "encrypted_path": str(encrypted_path),
                    "encrypted_url": f"/api/download/{job_id}/encrypted",
                },
                progress=98,
                warnings=warnings,
                model_failures=model_failures,
                models_used=models_used,
                stage_timings=stage_timings,
                last_heartbeat=_utc_now_iso(),
            )

        update_job(
            job_id,
            status="done",
            step="done",
            progress=100,
            iterations=iterations,
            metrics={
                "ssim": round(final_ssim, 6) if final_ssim is not None else None,
                "psnr": round(final_psnr, 6) if final_psnr is not None else None,
            },
            warnings=warnings,
            model_failures=model_failures,
            models_used=models_used,
            stage_timings=stage_timings,
            last_heartbeat=_utc_now_iso(),
        )

    except Exception as exc:
        update_job(
            job_id,
            warnings=warnings,
            model_failures=model_failures,
            models_used=models_used,
            stage_timings=stage_timings,
            last_heartbeat=_utc_now_iso(),
        )
        fail_job(job_id, str(exc))
