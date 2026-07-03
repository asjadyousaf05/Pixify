from __future__ import annotations

from copy import deepcopy
from threading import Lock
from typing import Any


_jobs: dict[str, dict[str, Any]] = {}
_jobs_lock = Lock()


def create_job(job_id: str, mode: str = "general") -> dict[str, Any]:
    payload = {
        "job_id": job_id,
        "mode": mode,
        "old_photo_mode": None,
        "status": "queued",
        "step": "uploading",
        "progress": 0,
        "iterations": 0,
        "metrics": {"ssim": None, "psnr": None},
        "warnings": [],
        "used_fallback": False,
        "stages_completed": [],
        "stages_run": [],
        "stages_skipped": [],
        "stages_rejected": [],
        "models_used": [],
        "model_failures": [],
        "output_changed": None,
        "no_meaningful_change": False,
        "mask_coverage": None,
        "mask_coverage_total": None,
        "mask_coverage_central": None,
        "destructive_stage_detected": False,
        "destructive_output_prevented": False,
        "destructive_stage_prevented": False,
        "used_safe_fallback": False,
        "model_availability": {},
        "used_deblur": False,
        "used_denoise_fallback": False,
        "used_lightweight_restoration": False,
        "used_inpainting": False,
        "used_enhancement": False,
        "used_face_recovery": False,
        "restoration_models_ran": [],
        "final_stage_selected": None,
        "stage_timings": {},
        "last_heartbeat": None,
        "step_started_at": None,
        "debug": {
            "input_size": None,
            "output_size": None,
            "mean_pixel_delta": None,
            "stage_diagnostics": {},
            "stage_debug_dir": None,
        },
        "outputs": {
            "enhanced_url": None,
            "bg_url": None,
            "encrypted_url": None,
            "enhanced_path": None,
            "bg_path": None,
            "encrypted_path": None,
        },
        "error": None,
    }
    with _jobs_lock:
        _jobs[job_id] = payload
    return deepcopy(payload)


def get_job(job_id: str) -> dict[str, Any] | None:
    with _jobs_lock:
        job = _jobs.get(job_id)
        return deepcopy(job) if job else None


def update_job(job_id: str, **updates: Any) -> dict[str, Any] | None:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return None
        for key, value in updates.items():
            if key in {"metrics", "outputs", "stage_timings", "debug", "model_availability"} and isinstance(value, dict):
                job[key].update(value)
            elif key in {
                "warnings",
                "stages_completed",
                "stages_run",
                "stages_skipped",
                "stages_rejected",
                "models_used",
                "model_failures",
                "restoration_models_ran",
            } and isinstance(value, list):
                job[key] = value
            else:
                job[key] = value
        return deepcopy(job)


def fail_job(job_id: str, error: str) -> dict[str, Any] | None:
    return update_job(job_id, status="failed", error=error)
