from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from PIL import Image

from app.core.crypto import encrypt_file
from app.core.jobs import fail_job, update_job
from app.services.bg_remove import remove_background
from app.services.composite import apply_background_mode
from app.services.enhance import RealESRGANService
from app.services.face_restore import FaceRestoreService
from app.services.metrics import compute_quality_metrics
from app.services.restoration import RestorationModel


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def run_simple_pipeline(
    job_id: str,
    upload_path: Path,
    output_root: Path,
    options: dict[str, Any],
    enhancer: RealESRGANService | None,
    face_restorer: FaceRestoreService | None,
    restoration_models: dict[str, RestorationModel] | None = None,
) -> None:
    warnings: list[str] = []
    model_failures: list[str] = []
    models_used: list[str] = []

    try:
        update_job(
            job_id,
            status="processing",
            step="loading",
            progress=10,
            warnings=warnings,
            model_failures=model_failures,
            models_used=models_used,
            last_heartbeat=_utc_now_iso(),
            step_started_at=_utc_now_iso(),
        )

        original = Image.open(upload_path).convert("RGB")
        working = original.copy()

        enhanced_path: Path | None = None
        bg_path: Path | None = None

        if options.get("enhance", True):
            update_job(job_id, step="enhancing", progress=30, last_heartbeat=_utc_now_iso())
            if enhancer is None:
                warning = "Primary enhancer unavailable in fallback pipeline; enhancement was skipped."
                warnings.append(warning)
                model_failures.append("RealESRGAN unavailable")
            else:
                upscale = int(options.get("upscale", 2))
                if upscale not in (2, 4):
                    upscale = 2
                if getattr(enhancer, "device", "cpu") == "cpu" and upscale == 4:
                    upscale = 2
                    warnings.append("CPU environment detected; fallback upscale reduced from 4x to 2x for stability.")
                working = enhancer.enhance(working, upscale)
                models_used.append("RealESRGAN")

        if options.get("portrait_mode", False):
            update_job(job_id, step="face_recovery", progress=45, last_heartbeat=_utc_now_iso())
            if face_restorer is None:
                warnings.append("Face restoration requested but GFPGAN is unavailable in fallback pipeline.")
                model_failures.append("GFPGAN unavailable")
            else:
                strength = max(0.0, min(1.0, float(options.get("face_strength", 60)) / 100.0))
                working = face_restorer.restore(working, strength=strength, raise_on_error=True)
                models_used.append("GFPGAN")

        update_job(job_id, step="evaluating", progress=60, last_heartbeat=_utc_now_iso())
        ssim, psnr = compute_quality_metrics(original, working)

        enhanced_path = output_root / "enhanced" / f"{job_id}.png"
        enhanced_path.parent.mkdir(parents=True, exist_ok=True)
        working.save(enhanced_path, format="PNG")

        update_job(
            job_id,
            outputs={
                "enhanced_path": str(enhanced_path),
                "enhanced_url": f"/api/download/{job_id}/enhanced",
            },
            metrics={"ssim": round(ssim, 6), "psnr": round(psnr, 6)},
            progress=70,
            warnings=warnings,
            model_failures=model_failures,
            models_used=models_used,
            last_heartbeat=_utc_now_iso(),
        )

        if options.get("remove_bg", False):
            update_job(job_id, step="segmenting", progress=80, last_heartbeat=_utc_now_iso())
            fg = remove_background(working)
            custom_bg = None
            if options.get("bg_mode") == "custom" and options.get("custom_bg_path") is not None:
                custom_bg = Image.open(options["custom_bg_path"])

            composited = apply_background_mode(
                original=working,
                foreground_rgba=fg,
                bg_mode=str(options.get("bg_mode", "transparent")),
                solid_color=str(options.get("solid_color", "#ffffff")),
                custom_background=custom_bg,
            )
            bg_path = output_root / "bg" / f"{job_id}.png"
            bg_path.parent.mkdir(parents=True, exist_ok=True)
            composited.save(bg_path, format="PNG")
            update_job(
                job_id,
                outputs={
                    "bg_path": str(bg_path),
                    "bg_url": f"/api/download/{job_id}/bg",
                },
                progress=88,
                last_heartbeat=_utc_now_iso(),
            )

        if options.get("encrypt", False):
            password = options.get("password")
            if not password:
                raise ValueError("password is required when encrypt=true")
            update_job(job_id, step="encrypting", progress=94, last_heartbeat=_utc_now_iso())
            source_path = bg_path or enhanced_path or upload_path
            encrypted_path = output_root / "encrypted" / f"{job_id}.bin"
            encrypted_path.parent.mkdir(parents=True, exist_ok=True)
            encrypt_file(source_path, encrypted_path, str(password))
            update_job(
                job_id,
                outputs={
                    "encrypted_path": str(encrypted_path),
                    "encrypted_url": f"/api/download/{job_id}/encrypted",
                },
                progress=98,
                last_heartbeat=_utc_now_iso(),
            )

        used_fallback = bool(model_failures)
        update_job(
            job_id,
            status="done",
            step="done",
            progress=100,
            warnings=warnings,
            model_failures=model_failures,
            models_used=models_used,
            used_fallback=used_fallback,
            last_heartbeat=_utc_now_iso(),
        )
    except Exception as exc:
        update_job(
            job_id,
            warnings=warnings,
            model_failures=model_failures,
            models_used=models_used,
            last_heartbeat=_utc_now_iso(),
        )
        fail_job(job_id, str(exc))
