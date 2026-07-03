from __future__ import annotations

import io
import logging
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image

from app.core.jobs import create_job, fail_job, get_job, update_job
from app.core.crypto import decrypt_bytes

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
logger = logging.getLogger(__name__)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

# Lazy-load services to prevent import errors
_services_cache = {}

def _get_service(service_name: str):
    """Lazy load services to avoid import errors at startup."""
    if service_name in _services_cache:
        return _services_cache[service_name]
    
    try:
        if service_name == "rembg":
            from app.services.bg_remove import warmup_rembg
            _services_cache[service_name] = warmup_rembg
            return warmup_rembg
        elif service_name == "deoldify":
            from app.services.deoldify import DeOldifyService
            _services_cache[service_name] = DeOldifyService
            return DeOldifyService
        elif service_name == "enhance":
            from app.services.enhance import RealESRGANService
            _services_cache[service_name] = RealESRGANService
            return RealESRGANService
        elif service_name == "face_restore":
            from app.services.face_restore import FaceRestoreService
            _services_cache[service_name] = FaceRestoreService
            return FaceRestoreService
        elif service_name == "lama":
            from app.services.lama import LaMaService
            _services_cache[service_name] = LaMaService
            return LaMaService
        elif service_name == "old_photo_pipeline":
            from app.services.old_photo_pipeline import run_old_photo_pipeline
            _services_cache[service_name] = run_old_photo_pipeline
            return run_old_photo_pipeline
        elif service_name == "restormer":
            from app.services.restormer import RestormerService
            _services_cache[service_name] = RestormerService
            return RestormerService
        elif service_name == "pipeline":
            from app.services.pipeline import run_pipeline
            _services_cache[service_name] = run_pipeline
            return run_pipeline
        elif service_name == "restoration":
            from app.services.restoration import RestorationModel
            _services_cache[service_name] = RestorationModel
            return RestorationModel
    except Exception as e:
        logger.error("Failed to load service %s: %s", service_name, e)
        return None

def get_warmup_rembg():
    return _get_service("rembg")

def get_deoldify_service():
    return _get_service("deoldify")

def get_enhance_service():
    return _get_service("enhance")

def get_face_restore_service():
    return _get_service("face_restore")

def get_lama_service():
    return _get_service("lama")

def get_run_old_photo_pipeline():
    return _get_service("old_photo_pipeline")

def get_restormer_service():
    return _get_service("restormer")

def get_run_pipeline():
    return _get_service("pipeline")

def get_restoration_model():
    return _get_service("restoration")


MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_DIMENSION = 6000

BASE_DIR = Path(__file__).resolve().parents[1]
WEIGHTS_DIR = BASE_DIR / "weights"
STORAGE_DIR = BASE_DIR / "storage"
UPLOAD_DIR = STORAGE_DIR / "uploads"
OUTPUT_DIR = STORAGE_DIR / "outputs"
ENHANCED_DIR = OUTPUT_DIR / "enhanced"
BG_DIR = OUTPUT_DIR / "bg"
ENCRYPTED_DIR = OUTPUT_DIR / "encrypted"
DEBUG_DIR = OUTPUT_DIR / "debug"

for path in [WEIGHTS_DIR, UPLOAD_DIR, ENHANCED_DIR, BG_DIR, ENCRYPTED_DIR, DEBUG_DIR]:
    path.mkdir(parents=True, exist_ok=True)

EXPECTED_CHECKPOINTS: dict[str, Path] = {
    "realesrgan_x4": WEIGHTS_DIR / "RealESRGAN_x4.pth",
    "realesrgan_x2": WEIGHTS_DIR / "RealESRGAN_x2.pth",
    "gfpgan_v1_4": WEIGHTS_DIR / "GFPGANv1.4.pth",
    "mprnet_deblur": WEIGHTS_DIR / "mprnet" / "mprnet_deblur.pth",
    "mprnet_denoise": WEIGHTS_DIR / "mprnet" / "mprnet_denoise.pth",
    "restormer_motion": WEIGHTS_DIR / "restormer" / "motion_deblurring.pth",
    "restormer_denoise": WEIGHTS_DIR / "restormer" / "real_denoising.pth",
    "u2net": WEIGHTS_DIR / "u2net" / "u2net.onnx",
    "deoldify_colorize": WEIGHTS_DIR / "deoldify" / "deoldify" / "models" / "ColorizeStable_gen.pth",
}


def _checkpoint_report() -> dict[str, dict[str, Any]]:
    report: dict[str, dict[str, Any]] = {}
    for name, path in EXPECTED_CHECKPOINTS.items():
        exists = path.exists()
        report[name] = {
            "path": str(path),
            "exists": exists,
            "size_bytes": path.stat().st_size if exists else 0,
        }
    return report


def _log_startup_checkpoint_report() -> None:
    logger.info("Model checkpoint readiness report:")
    for name, info in _checkpoint_report().items():
        status = "FOUND" if info["exists"] else "MISSING"
        logger.info("- %s: %s path=%s size_bytes=%s", name, status, info["path"], info["size_bytes"])

app = FastAPI(title="AI Image Enhancement & Security API")
app.mount("/storage", StaticFiles(directory=str(STORAGE_DIR)), name="storage")

LOCAL_DEV_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://[::1]:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "http://[::1]:5174",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=LOCAL_DEV_ORIGINS,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

executor = ThreadPoolExecutor(max_workers=4)

# Lazy-initialize service instances
_service_instances = {}

def get_enhancer():
    if "enhancer" not in _service_instances:
        RealESRGANService = _get_service("enhance")
        if RealESRGANService:
            _service_instances["enhancer"] = RealESRGANService(WEIGHTS_DIR)
        else:
            logger.warning("RealESRGANService not available")
            return None
    return _service_instances.get("enhancer")

def get_face_restorer():
    if "face_restorer" not in _service_instances:
        FaceRestoreService = _get_service("face_restore")
        if FaceRestoreService:
            _service_instances["face_restorer"] = FaceRestoreService(WEIGHTS_DIR)
        else:
            logger.warning("FaceRestoreService not available")
            return None
    return _service_instances.get("face_restorer")

def get_lama_service_inst():
    if "lama_service" not in _service_instances:
        LaMaService = _get_service("lama")
        if LaMaService:
            _service_instances["lama_service"] = LaMaService(WEIGHTS_DIR / "lama")
        else:
            logger.warning("LaMaService not available")
            return None
    return _service_instances.get("lama_service")

def get_deoldify_service_inst():
    if "deoldify_service" not in _service_instances:
        DeOldifyService = _get_service("deoldify")
        if DeOldifyService:
            _service_instances["deoldify_service"] = DeOldifyService(WEIGHTS_DIR / "deoldify")
        else:
            logger.warning("DeOldifyService not available")
            return None
    return _service_instances.get("deoldify_service")

def get_restormer_models():
    if "restormer_models" not in _service_instances:
        RestormerService = _get_service("restormer")
        if RestormerService:
            _service_instances["restormer_models"] = {
                "motion_deblur": RestormerService(WEIGHTS_DIR / "restormer", task="motion_deblur"),
                "real_denoise": RestormerService(WEIGHTS_DIR / "restormer", task="real_denoise"),
            }
        else:
            logger.warning("RestormerService not available")
            return {}
    return _service_instances.get("restormer_models", {})

def get_restoration_models():
    if "restoration_models" not in _service_instances:
        RestorationModel = _get_service("restoration")
        if RestorationModel:
            _service_instances["restoration_models"] = {
                "deblur": RestorationModel(WEIGHTS_DIR / "mprnet", mode="deblur"),
                "denoise": RestorationModel(WEIGHTS_DIR / "mprnet", mode="denoise"),
            }
        else:
            logger.warning("RestorationModel not available")
            return {}
    return _service_instances.get("restoration_models", {})


@app.on_event("startup")
def startup_event() -> None:
    # Auto-download and cache model assets on first run.
    def warmup_all() -> None:
        try:
            logger.info("Starting model warmup...")
            _log_startup_checkpoint_report()

            enhancer = get_enhancer()
            if enhancer:
                try:
                    enhancer.warmup()
                    logger.info("✅ Enhancer warmed up")
                except Exception as e:
                    logger.error(f"Failed to warmup enhancer: {e}")
            
            face_restorer = get_face_restorer()
            if face_restorer:
                try:
                    face_restorer.ensure_weights()
                    logger.info("✅ Face restorer ready")
                except Exception as e:
                    logger.error(f"Failed to warmup face_restorer: {e}")
            
            warmup_rembg_fn = get_warmup_rembg()
            if warmup_rembg_fn:
                try:
                    warmup_rembg_fn()
                    logger.info("✅ Rembg warmed up")
                except Exception as e:
                    logger.error(f"Failed to warmup rembg: {e}")
            
            restormer_models = get_restormer_models()
            for task, model in restormer_models.items():
                if model:
                    try:
                        ready = False
                        reason = None
                        ensure_ready = getattr(model, "ensure_ready", None)
                        if callable(ensure_ready):
                            ready, reason = ensure_ready(warmup=True)
                        else:
                            model.warmup()
                            ready = True

                        status = {}
                        status_fn = getattr(model, "status", None)
                        if callable(status_fn):
                            status = status_fn()

                        if ready:
                            logger.info(
                                "✅ Restormer %s ACTIVE device=%s weights=%s",
                                task,
                                status.get("device", "unknown"),
                                status.get("weights_path", "unknown"),
                            )
                        else:
                            logger.error("❌ Restormer %s UNAVAILABLE: %s", task, reason or "initialization failed")
                    except Exception as e:
                        logger.error(f"Failed to initialize restormer {task}: {e}")

            restoration_models = get_restoration_models()
            for mode, model in restoration_models.items():
                if model is None:
                    logger.error("❌ MPRNet %s UNAVAILABLE: service missing", mode)
                    continue
                model_ready = getattr(model, "_model", None) is not None
                model_error = getattr(model, "_model_error", None)
                model_path = getattr(model, "model_path", None)
                if model_ready:
                    logger.info("✅ MPRNet %s ACTIVE checkpoint=%s", mode, model_path)
                else:
                    logger.error("❌ MPRNet %s UNAVAILABLE: %s", mode, model_error or "initialization failed")
            
            lama = get_lama_service_inst()
            if lama:
                try:
                    lama.warmup()
                    logger.info("✅ LaMa warmed up")
                except Exception as e:
                    logger.error(f"Failed to warmup lama: {e}")
            
            deoldify = get_deoldify_service_inst()
            if deoldify:
                try:
                    deoldify.warmup()
                    logger.info("✅ DeOldify warmed up")
                except Exception as e:
                    logger.error(f"Failed to warmup deoldify: {e}")
            
            logger.info("Model warmup complete")
        except Exception as e:
            logger.error(f"Warmup failed: {e}")

    executor.submit(warmup_all)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/jobs")
async def create_processing_job(
    file: UploadFile = File(...),
    mode: str = Form("general"),
    enhance: bool = Form(True),
    upscale: int = Form(4),
    quality: str = Form("high"),
    denoise_strength: int = Form(50),
    deblur_strength: int = Form(50),
    restore: bool = Form(True),
    restore_mode: str = Form("auto"),
    portrait_mode: bool = Form(True),
    colorize: bool = Form(True),
    repair_broken: bool = Form(False),
    auto_mask_damage: bool = Form(True),
    face_strength: int = Form(60),
    ultra: bool = Form(True),
    debug_stage_saves: bool = Form(True),
    old_photo_mode: str = Form("repair_only"),
    old_photo_upscale: bool = Form(False),
    old_photo_upscale_factor: int = Form(2),
    remove_bg: bool = Form(False),
    bg_mode: str = Form("transparent"),
    solid_color: str = Form("#ffffff"),
    encrypt: bool = Form(False),
    password: str | None = Form(None),
    mask: UploadFile | None = File(None),
    custom_bg: UploadFile | None = File(None),
) -> dict[str, str]:
    logger.info(
        "Received /api/jobs request: filename=%s content_type=%s mode=%s old_photo_mode=%s enhance=%s quality=%s restore=%s restore_mode=%s remove_bg=%s encrypt=%s debug_stage_saves=%s",
        file.filename,
        file.content_type,
        mode,
        old_photo_mode,
        enhance,
        quality,
        restore,
        restore_mode,
        remove_bg,
        encrypt,
        debug_stage_saves,
    )

    if mode not in {"general", "old_photo"}:
        raise HTTPException(status_code=400, detail="mode must be one of general|old_photo")

    if mode == "old_photo" and old_photo_mode not in {"repair_only", "repair_face", "repair_upscale", "repair_colorize"}:
        raise HTTPException(status_code=400, detail="old_photo_mode must be one of repair_only|repair_face|repair_upscale|repair_colorize")

    if upscale not in (2, 4):
        raise HTTPException(status_code=400, detail="upscale must be 2 or 4")

    if old_photo_upscale_factor not in (2, 4):
        raise HTTPException(status_code=400, detail="old_photo_upscale_factor must be 2 or 4")

    if quality not in {"fast", "balanced", "high"}:
        raise HTTPException(status_code=400, detail="quality must be one of fast|balanced|high")

    if not (0 <= denoise_strength <= 100):
        raise HTTPException(status_code=400, detail="denoise_strength must be 0..100")

    if not (0 <= deblur_strength <= 100):
        raise HTTPException(status_code=400, detail="deblur_strength must be 0..100")

    if not (0 <= face_strength <= 100):
        raise HTTPException(status_code=400, detail="face_strength must be 0..100")

    if restore_mode not in {"deblur", "denoise", "auto"}:
        raise HTTPException(status_code=400, detail="restore_mode must be one of deblur|denoise|auto")

    if bg_mode not in {"transparent", "solid", "blur", "custom"}:
        raise HTTPException(status_code=400, detail="invalid bg_mode")

    if encrypt and (password is None or password.strip() == ""):
        raise HTTPException(status_code=400, detail="password is required when encrypt=true")

    if remove_bg and bg_mode == "custom" and custom_bg is None:
        raise HTTPException(status_code=400, detail="custom_bg file is required when bg_mode=custom")

    if mode == "old_photo" and not enhance:
        enhance = True

    if mode == "old_photo":
        # Old-photo intent modes are explicit and authoritative.
        if old_photo_mode == "repair_only":
            portrait_mode = False
            colorize = False
            old_photo_upscale = False
        elif old_photo_mode == "repair_face":
            portrait_mode = True
            colorize = False
            old_photo_upscale = False
        elif old_photo_mode == "repair_upscale":
            portrait_mode = False
            colorize = False
            old_photo_upscale = True
        elif old_photo_mode == "repair_colorize":
            portrait_mode = False
            colorize = True
            old_photo_upscale = False

    file_bytes = await file.read()
    logger.info(
        "Upload payload parsed: filename=%s content_type=%s size_bytes=%s mode=%s",
        file.filename,
        file.content_type,
        len(file_bytes),
        mode,
    )
    if not file_bytes:
        raise HTTPException(status_code=400, detail="uploaded image file is empty")
    if len(file_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="image size exceeds 20MB")

    try:
        image = Image.open(io.BytesIO(file_bytes))
        width, height = image.size
    except Exception as exc:
        raise HTTPException(status_code=400, detail="invalid image file") from exc

    if width > MAX_DIMENSION or height > MAX_DIMENSION:
        raise HTTPException(status_code=400, detail="image dimensions must be below 6000px")

    job_id = str(uuid.uuid4())
    create_job(job_id, mode=mode)
    update_job(
        job_id,
        old_photo_mode=old_photo_mode if mode == "old_photo" else None,
        last_heartbeat=_utc_now_iso(),
        step_started_at=_utc_now_iso(),
        debug={"input_size": {"bytes": len(file_bytes), "width": width, "height": height}},
    )

    upload_suffix = Path(file.filename or "input.png").suffix or ".png"
    upload_path = UPLOAD_DIR / f"{job_id}{upload_suffix}"
    upload_path.write_bytes(file_bytes)

    custom_bg_path: Path | None = None
    if custom_bg is not None:
        custom_bytes = await custom_bg.read()
        if len(custom_bytes) > MAX_IMAGE_BYTES:
            fail_job(job_id, "custom background exceeds 20MB")
            return {"job_id": job_id, "status": "failed"}
        custom_suffix = Path(custom_bg.filename or "custom.png").suffix or ".png"
        custom_bg_path = UPLOAD_DIR / f"{job_id}_custom{custom_suffix}"
        custom_bg_path.write_bytes(custom_bytes)

    mask_path: Path | None = None
    if mask is not None:
        mask_bytes = await mask.read()
        if len(mask_bytes) > MAX_IMAGE_BYTES:
            fail_job(job_id, "mask exceeds 20MB")
            return {"job_id": job_id, "status": "failed"}
        mask_suffix = Path(mask.filename or "mask.png").suffix or ".png"
        mask_path = UPLOAD_DIR / f"{job_id}_mask{mask_suffix}"
        mask_path.write_bytes(mask_bytes)

    options = {
        "mode": mode,
        "enhance": enhance,
        "upscale": upscale,
        "quality": quality,
        "denoise_strength": denoise_strength,
        "deblur_strength": deblur_strength,
        "restore": restore,
        "restore_mode": restore_mode,
        "portrait_mode": portrait_mode,
        "colorize": colorize,
        "repair_broken": repair_broken,
        "auto_mask_damage": auto_mask_damage,
        "face_strength": face_strength,
        "ultra": ultra,
        "debug_stage_saves": debug_stage_saves if mode == "old_photo" else False,
        "old_photo_mode": old_photo_mode if mode == "old_photo" else None,
        "old_photo_upscale": old_photo_upscale if mode == "old_photo" else False,
        "old_photo_upscale_factor": old_photo_upscale_factor if mode == "old_photo" else 2,
        "remove_bg": remove_bg,
        "bg_mode": bg_mode,
        "solid_color": solid_color,
        "encrypt": encrypt,
        "password": password,
        "custom_bg_path": custom_bg_path,
        "mask_path": mask_path,
    }
    logger.info("Job %s parsed options for mode=%s: %s", job_id, mode, options)

    if mode == "old_photo":
        run_old_photo = _get_service("old_photo_pipeline")
        selected_pipeline = "old_photo_pipeline"
        if not run_old_photo:
            fail_job(job_id, "Old-photo pipeline unavailable; full restoration cannot run")
            return {"job_id": job_id, "status": "failed"}
        logger.info("Job %s selecting pipeline=%s for mode=old_photo", job_id, selected_pipeline)

        executor.submit(
            run_old_photo,
            job_id,
            upload_path,
            OUTPUT_DIR,
            options,
            get_restormer_models().get("motion_deblur") if mode == "old_photo" else None,
            get_restormer_models().get("real_denoise") if mode == "old_photo" else None,
            get_lama_service_inst() if mode == "old_photo" else None,
            get_deoldify_service_inst() if mode == "old_photo" else None,
            get_enhancer(),
            get_face_restorer(),
            get_restoration_models(),
        )
    else:
        run_pipe = _get_service("pipeline")
        selected_pipeline = "pipeline"
        if not run_pipe:
            # Fallback to simple pipeline if main pipeline unavailable
            try:
                from app.services.simple_pipeline import run_simple_pipeline

                run_pipe = run_simple_pipeline
                selected_pipeline = "simple_pipeline_fallback"
                update_job(
                    job_id,
                    used_fallback=True,
                    warnings=["Primary enhancement pipeline unavailable; using simple fallback pipeline."],
                )
            except Exception as exc:
                fail_job(job_id, f"Primary pipeline unavailable and fallback pipeline failed to load: {exc}")
                return {"job_id": job_id, "status": "failed"}
        logger.info("Job %s selecting pipeline=%s for mode=general", job_id, selected_pipeline)
        
        executor.submit(
            run_pipe,
            job_id,
            upload_path,
            OUTPUT_DIR,
            options,
            get_enhancer(),
            get_face_restorer(),
            get_restoration_models(),
        )

    return {"job_id": job_id, "status": "queued"}


@app.post("/api/restore-old")
async def create_old_photo_restoration_job(
    file: UploadFile = File(...),
    old_photo_mode: str = Form("repair_only"),
    old_photo_upscale_factor: int = Form(2),
    restore_mode: str = Form("auto"),
    denoise_strength: int = Form(60),
    deblur_strength: int = Form(60),
    colorize: bool = Form(True),
    repair_broken: bool = Form(False),
    auto_mask_damage: bool = Form(True),
    face_restore: bool = Form(True),
    face_strength: int = Form(60),
    debug_stage_saves: bool = Form(True),
) -> dict[str, str]:
    logger.info(
        "Received /api/restore-old request: filename=%s content_type=%s old_photo_mode=%s restore_mode=%s denoise=%s deblur=%s colorize=%s repair_broken=%s face_restore=%s debug_stage_saves=%s",
        file.filename,
        file.content_type,
        old_photo_mode,
        restore_mode,
        denoise_strength,
        deblur_strength,
        colorize,
        repair_broken,
        face_restore,
        debug_stage_saves,
    )
    if restore_mode not in {"deblur", "denoise", "auto"}:
        raise HTTPException(status_code=400, detail="restore_mode must be one of deblur|denoise|auto")

    if old_photo_mode not in {"repair_only", "repair_face", "repair_upscale", "repair_colorize"}:
        raise HTTPException(status_code=400, detail="old_photo_mode must be one of repair_only|repair_face|repair_upscale|repair_colorize")

    if old_photo_upscale_factor not in (2, 4):
        raise HTTPException(status_code=400, detail="old_photo_upscale_factor must be 2 or 4")

    if not (0 <= denoise_strength <= 100):
        raise HTTPException(status_code=400, detail="denoise_strength must be 0..100")

    if not (0 <= deblur_strength <= 100):
        raise HTTPException(status_code=400, detail="deblur_strength must be 0..100")

    if not (0 <= face_strength <= 100):
        raise HTTPException(status_code=400, detail="face_strength must be 0..100")

    file_bytes = await file.read()
    logger.info(
        "Old-photo payload parsed: filename=%s content_type=%s size_bytes=%s",
        file.filename,
        file.content_type,
        len(file_bytes),
    )
    if not file_bytes:
        raise HTTPException(status_code=400, detail="uploaded image file is empty")
    if len(file_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="image size exceeds 20MB")

    try:
        image = Image.open(io.BytesIO(file_bytes))
        width, height = image.size
    except Exception as exc:
        raise HTTPException(status_code=400, detail="invalid image file") from exc

    if width > MAX_DIMENSION or height > MAX_DIMENSION:
        raise HTTPException(status_code=400, detail="image dimensions must be below 6000px")

    job_id = str(uuid.uuid4())
    create_job(job_id, mode="old_photo")
    update_job(
        job_id,
        old_photo_mode=old_photo_mode,
        last_heartbeat=_utc_now_iso(),
        step_started_at=_utc_now_iso(),
        debug={"input_size": {"bytes": len(file_bytes), "width": width, "height": height}},
    )

    upload_suffix = Path(file.filename or "input.png").suffix or ".png"
    upload_path = UPLOAD_DIR / f"{job_id}{upload_suffix}"
    upload_path.write_bytes(file_bytes)

    options = {
        "mode": "old_photo",
        "enhance": True,
        "upscale": old_photo_upscale_factor,
        "quality": "high",
        "denoise_strength": denoise_strength,
        "deblur_strength": deblur_strength,
        "restore": True,
        "restore_mode": restore_mode,
        "portrait_mode": (old_photo_mode == "repair_face"),
        "colorize": (old_photo_mode == "repair_colorize"),
        "repair_broken": repair_broken,
        "auto_mask_damage": auto_mask_damage,
        "face_strength": face_strength,
        "ultra": False,
        "debug_stage_saves": debug_stage_saves,
        "old_photo_mode": old_photo_mode,
        "old_photo_upscale": (old_photo_mode == "repair_upscale"),
        "old_photo_upscale_factor": old_photo_upscale_factor,
        "remove_bg": False,
        "bg_mode": "transparent",
        "solid_color": "#ffffff",
        "encrypt": False,
        "password": None,
        "custom_bg_path": None,
        "mask_path": None,
    }

    run_old_photo = _get_service("old_photo_pipeline")
    selected_pipeline = "old_photo_pipeline"
    if not run_old_photo:
        fail_job(job_id, "Old-photo pipeline unavailable; full restoration cannot run")
        return {"job_id": job_id, "status": "failed"}
    logger.info("Job %s selecting pipeline=%s for /api/restore-old", job_id, selected_pipeline)

    executor.submit(
        run_old_photo,
        job_id,
        upload_path,
        OUTPUT_DIR,
        options,
        get_restormer_models().get("motion_deblur"),
        get_restormer_models().get("real_denoise"),
        get_lama_service_inst(),
        get_deoldify_service_inst(),
        get_enhancer(),
        get_face_restorer(),
        get_restoration_models(),
    )

    return {"job_id": job_id, "status": "queued"}


@app.get("/api/jobs/{job_id}")
def get_processing_job(job_id: str) -> dict:
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")

    return {
        "job_id": job["job_id"],
        "mode": job["mode"],
        "old_photo_mode": job["old_photo_mode"],
        "status": job["status"],
        "step": job["step"],
        "progress": job["progress"],
        "iterations": job["iterations"],
        "warnings": job["warnings"],
        "used_fallback": job["used_fallback"],
        "stages_completed": job["stages_completed"],
        "stages_run": job["stages_run"],
        "stages_skipped": job["stages_skipped"],
        "stages_rejected": job["stages_rejected"],
        "models_used": job["models_used"],
        "model_failures": job["model_failures"],
        "model_availability": job["model_availability"],
        "output_changed": job["output_changed"],
        "no_meaningful_change": job.get("no_meaningful_change", False),
        "mask_coverage": job["mask_coverage"],
        "mask_coverage_total": job["mask_coverage_total"],
        "mask_coverage_central": job["mask_coverage_central"],
        "destructive_stage_detected": job["destructive_stage_detected"],
        "destructive_output_prevented": job["destructive_output_prevented"],
        "destructive_stage_prevented": job["destructive_stage_prevented"],
        "used_safe_fallback": job["used_safe_fallback"],
        "used_deblur": job["used_deblur"],
        "used_denoise_fallback": job["used_denoise_fallback"],
        "used_lightweight_restoration": job.get("used_lightweight_restoration", False),
        "used_inpainting": job["used_inpainting"],
        "used_enhancement": job["used_enhancement"],
        "used_face_recovery": job["used_face_recovery"],
        "restoration_models_ran": job.get("restoration_models_ran", []),
        "final_stage_selected": job["final_stage_selected"],
        "stage_timings": job["stage_timings"],
        "last_heartbeat": job["last_heartbeat"],
        "step_started_at": job["step_started_at"],
        "debug": job["debug"],
        "metrics": {
            "ssim": job["metrics"]["ssim"],
            "psnr": job["metrics"]["psnr"],
        },
        "outputs": {
            "enhanced_url": job["outputs"]["enhanced_url"],
            "bg_url": job["outputs"]["bg_url"],
            "encrypted_url": job["outputs"]["encrypted_url"],
        },
        "error": job["error"],
    }


@app.get("/api/download/{job_id}/{artifact}")
def download_artifact(job_id: str, artifact: str) -> FileResponse:
    if artifact not in {"enhanced", "bg", "encrypted"}:
        raise HTTPException(status_code=400, detail="artifact must be one of enhanced|bg|encrypted")

    job = get_job(job_id)
    if not job:
        logger.error(f"Download: Job {job_id} not found")
        raise HTTPException(status_code=404, detail="job not found")

    logger.info(f"Download: Job {job_id} found. Outputs: {job['outputs']}")
    
    key = f"{artifact}_path"
    artifact_path = job["outputs"].get(key)
    if not artifact_path:
        # Try alternative: construct path from job_id if not stored
        if artifact == "enhanced":
            alternative_path = ENHANCED_DIR / f"{job_id}.png"
            if alternative_path.exists():
                logger.info(f"Download: Using alternative path for {artifact}: {alternative_path}")
                artifact_path = str(alternative_path)
        
        if not artifact_path:
            logger.error(f"Download: artifact_path not found for {artifact}. Outputs: {job['outputs']}")
            raise HTTPException(status_code=404, detail=f"artifact {artifact} not found for this job")

    file_path = Path(artifact_path)
    if not file_path.exists():
        logger.error(f"Download: artifact file does not exist at {file_path}")
        raise HTTPException(status_code=404, detail="artifact file is missing")

    logger.info(f"Download: Returning {artifact} from {file_path}")
    media_type = "application/octet-stream" if artifact == "encrypted" else "image/png"
    return FileResponse(path=file_path, media_type=media_type, filename=file_path.name)


@app.post("/api/decrypt")
async def decrypt_file(
    file: UploadFile = File(...),
    password: str = Form(...),
) -> Response:
    encrypted_bytes = await file.read()
    if not encrypted_bytes:
        raise HTTPException(status_code=400, detail="encrypted file is required")

    if len(encrypted_bytes) > MAX_IMAGE_BYTES * 2:
        raise HTTPException(status_code=400, detail="encrypted file too large")

    if not password.strip():
        raise HTTPException(status_code=400, detail="password is required")

    try:
        plain_bytes = decrypt_bytes(encrypted_bytes, password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    media_type = "application/octet-stream"
    filename = "decrypted-image.bin"
    try:
        img = Image.open(io.BytesIO(plain_bytes))
        fmt = (img.format or "PNG").upper()
        media_map = {
            "PNG": "image/png",
            "JPEG": "image/jpeg",
            "JPG": "image/jpeg",
            "WEBP": "image/webp",
        }
        ext_map = {
            "PNG": "png",
            "JPEG": "jpg",
            "JPG": "jpg",
            "WEBP": "webp",
        }
        media_type = media_map.get(fmt, "application/octet-stream")
        filename = f"decrypted-image.{ext_map.get(fmt, 'bin')}"
    except Exception:
        pass

    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return Response(content=plain_bytes, media_type=media_type, headers=headers)
