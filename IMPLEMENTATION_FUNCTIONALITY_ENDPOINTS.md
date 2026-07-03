# Implementation, Functionalities, and Endpoint Reference

Last updated: 2026-04-18

This document describes the current implementation across frontend, Python backend, Node encryption server, core functionality, processing pipelines, and all API endpoints present in this repository.

## 1) System Overview

This workspace contains a multi-part image processing application:

- Frontend web app (React + Vite + TypeScript) for upload, processing controls, results, vault, and admin views.
- Primary AI backend (FastAPI, Python) for enhancement, old-photo restoration, background operations, and decryption.
- Secondary encryption backend (Express, Node.js) for standalone AES encrypt/decrypt and metadata/download flows.

High-level execution flow:

1. User uploads image in frontend workspace.
2. Frontend sends multipart request to Python API.
3. Backend creates async job and executes selected pipeline in worker thread.
4. Frontend polls job status and updates progress timeline.
5. Frontend renders result URLs and supports download/export/decrypt previews.

## 2) Repository Architecture

### 2.1 Frontend

Main frontend areas:

- src/pages
  - Landing page
  - Login/Signup
  - Workspace (main processing UI)
  - Vault (saved items UI)
  - Admin dashboard
- src/contexts
  - AuthContext: mock auth/session/roles
  - WorkspaceContext: image + settings + presets + comparison state
  - JobContext: upload job creation, polling, result binding, error toasts
- src/components/workspace
  - Upload, pipeline controls, old-photo controls, background/security controls, preview, progress, export, encrypt/decrypt modals
- src/services
  - admin and vault services (mock/demo data)
  - encryptionApi (Node server endpoints /encrypt and /decrypt)

### 2.2 Python Backend

Main backend areas:

- backend/app/main.py
  - FastAPI app, CORS, startup warmup, endpoint handlers
- backend/app/core
  - jobs.py: in-memory job store and updates
  - crypto.py: AES-GCM file encryption/decryption helpers
- backend/app/services
  - pipeline.py: general enhancement pipeline (with watchdog + heartbeats + stage timeouts)
  - old_photo_pipeline.py: dedicated old-photo restoration pipeline with quality gates
  - simple_pipeline.py: minimal fallback pipeline
  - restormer.py: Restormer model bootstrap and inference
  - restoration.py: MPRNet-based restoration model wrapper
  - enhance.py: RealESRGAN wrapper
  - face_restore.py: GFPGAN wrapper
  - lama.py: LaMa inpainting wrapper
  - deoldify.py: DeOldify colorization wrapper
  - bg_remove.py: rembg with grabcut fallback
  - composite.py: background compositing modes
  - metrics.py and quality_gate.py: SSIM/PSNR metrics and stage safety gating

### 2.3 Node Encryption Server

Main server areas:

- server/index.js: Express routes for encrypt/decrypt/download/metadata
- server/crypto.js: PBKDF2 + AES-GCM/AES-CBC implementation
- server/store.js: local file and metadata record storage

## 3) Frontend Functionalities

## 3.1 Routing

Routes implemented:

- / -> Landing
- /login -> Login
- /signup -> Signup
- /app -> Workspace
- /vault -> Vault
- /admin -> Admin
- * -> NotFound

## 3.2 Authentication and Roles

AuthContext provides:

- login(email, password)
- signup(name, email, password)
- loginWithGoogle()
- logout()
- setDevRole(role)

Important behavior:

- Uses mock users and localStorage session persistence.
- Supports roles guest/user/admin in UI logic.

## 3.3 Workspace and Processing Controls

Implemented user capabilities:

- Upload image (drag-drop or file picker; jpg/png/webp validation + size checks in UI).
- Configure enhancement settings:
  - Upscale mode
  - Restore mode
  - Denoise/deblur strengths
  - Face restoration toggle
  - Quality level
- Configure old-photo settings:
  - Intent modes: repair_only, repair_face, repair_upscale, repair_colorize
  - Inpainting toggle and auto-mask
  - Face/upscale/colorize stage toggles and strengths
- Configure background settings:
  - Remove or replace background
  - Transparent/solid/blur/custom modes
- Configure security:
  - Encrypt output with password in job flow
  - Decrypt .bin/.enc via Python /api/decrypt
  - Generate mock share links
- Start/cancel/clear jobs and watch stage progress.
- Image version history and comparison slider.
- Export dialog and result download links.

## 3.4 Job Execution and Polling

JobContext implementation details:

- Upload uses FormData to Python API /api/jobs.
- Polling interval around 1.5s with status mapping to frontend step IDs.
- Handles both general and old_photo request payloads.
- Adds cache-busting to result URLs.
- Shows explicit destructive toasts on upload/processing failures.
- Defaults API base to same-origin when VITE_API_BASE_URL is not set.

## 3.5 Vault and Admin

Current behavior:

- Vault and Admin are present with full UI flows, but data is mock/generated in frontend services.
- Vault supports listing/filter/search/delete/share-link (mock).
- Admin supports model cards, metrics, logs, user listing and role/status update (mock).

## 4) Python API Endpoints (FastAPI)

Base service: backend/app/main.py

## 4.1 GET /health

Purpose:

- Service health probe.

Response:

- { "status": "ok" }

## 4.2 POST /api/jobs

Purpose:

- Main job creation endpoint for both general and old-photo modes.

Content type:

- multipart/form-data

Inputs (key form fields):

- file (required)
- mode: general | old_photo
- enhance: bool
- upscale: 2 | 4
- quality: fast | balanced | high
- denoise_strength: 0..100
- deblur_strength: 0..100
- restore: bool
- restore_mode: deblur | denoise | auto
- portrait_mode: bool
- colorize: bool
- repair_broken: bool
- auto_mask_damage: bool
- face_strength: 0..100
- ultra: bool
- debug_stage_saves: bool
- old_photo_mode: repair_only | repair_face | repair_upscale | repair_colorize
- old_photo_upscale: bool
- old_photo_upscale_factor: 2 | 4
- remove_bg: bool
- bg_mode: transparent | solid | blur | custom
- solid_color: hex string
- encrypt: bool
- password: required if encrypt=true
- mask: optional file
- custom_bg: required if bg_mode=custom

Validations implemented:

- Empty file check
- Max payload size (20MB)
- Max image dimensions (6000)
- Enum/range validation for mode/quality/strengths/upscale/bg_mode

Behavior:

- Creates job record.
- Saves uploaded files to storage.
- Selects pipeline:
  - mode=old_photo -> old_photo_pipeline
  - mode=general -> pipeline (or simple fallback if unavailable)
- Executes asynchronously in ThreadPoolExecutor.

Response:

- { "job_id": "...", "status": "queued" }

## 4.3 POST /api/restore-old

Purpose:

- Dedicated endpoint for old-photo mode requests.

Content type:

- multipart/form-data

Inputs:

- file
- old_photo_mode
- old_photo_upscale_factor
- restore_mode
- denoise_strength
- deblur_strength
- colorize
- repair_broken
- auto_mask_damage
- face_restore
- face_strength
- debug_stage_saves

Behavior:

- Creates old-photo job and executes old_photo_pipeline asynchronously.

Response:

- { "job_id": "...", "status": "queued" }

## 4.4 GET /api/jobs/{job_id}

Purpose:

- Retrieve detailed job state and telemetry.

Response includes:

- Core state: status, step, progress, iterations, error
- Mode fields: mode, old_photo_mode
- Metrics: ssim, psnr
- Outputs: enhanced_url, bg_url, encrypted_url
- Pipeline telemetry:
  - warnings
  - stages_completed, stages_run, stages_skipped, stages_rejected
  - models_used, model_failures, model_availability
  - output_changed
  - restoration flags and selected final stage
  - mask coverage values
  - stage_timings
  - last_heartbeat, step_started_at
  - debug object

## 4.5 GET /api/download/{job_id}/{artifact}

Purpose:

- Download produced artifact for a completed job.

Path params:

- artifact: enhanced | bg | encrypted

Behavior:

- Resolves artifact path from job outputs.
- Returns file response with appropriate media type.

## 4.6 POST /api/decrypt

Purpose:

- Decrypt encrypted file produced by Python backend AES format.

Inputs:

- file (encrypted payload)
- password

Behavior:

- Validates payload.
- Decrypts with backend/core/crypto.py logic.
- Attempts to infer image mime and filename.

Response:

- Raw decrypted bytes with download headers.

## 5) Python Pipeline Implementations

## 5.1 General Pipeline (pipeline.py)

Major stages:

1. Uploading/load
2. Restoration (optional)
3. Enhancement (optional)
4. Face restoration (optional)
5. Background segmentation/compositing (optional)
6. Encryption (optional)
7. Completion + metrics

Reliability mechanisms:

- _run_with_watchdog runs expensive stage work in a worker thread.
- Heartbeats are updated periodically during long operations.
- Per-stage timeout to prevent infinite wait.
- If timeout occurs, job fails with explicit error.
- CPU stability fallback:
  - General 4x upscale reduced to 2x when enhancer device is cpu.

Telemetry captured:

- warnings, model_failures, models_used, stage_timings, heartbeat timestamps.

## 5.2 Old Photo Pipeline (old_photo_pipeline.py)

High-level flow:

1. Load and optional downscale for stability.
2. Normalize stage with quality gate.
3. Optional conservative inpainting (LaMa) with strict mask safety checks.
4. Mandatory restoration stage (Restormer-driven, strict availability checks).
5. Optional face stage (GFPGAN).
6. Optional upscale stage (RealESRGAN).
7. Optional colorization stage (DeOldify).
8. Candidate stage evaluation and safest output selection.
9. No-meaningful-change checks and fail-fast behavior if output is identity-like.
10. Save outputs, metrics, and debug artifacts.

Safety and quality controls:

- Stage-level GatePolicy checks based on SSIM and mean pixel delta.
- Destructive output detection and rejection tracking.
- Candidate stage chooser to avoid blindly taking the last stage.
- Strict errors when required restoration models are unavailable.

## 5.3 Simple Fallback Pipeline (simple_pipeline.py)

Purpose:

- Minimal processing fallback when primary pipeline is unavailable.

Behavior:

- Loads image, attempts basic enhancement if available, saves output, optional encryption.
- Marks used_fallback=true with warning.

## 6) Service Module Functionalities (Python)

- bg_remove.py
  - Primary segmentation via rembg (U2NET cache under backend/weights/u2net)
  - Local grabcut fallback if rembg fails
- composite.py
  - Compositing for transparent/solid/blur/custom background modes
- enhance.py
  - RealESRGAN enhancement with tile strategy and scale handling
- face_restore.py
  - GFPGAN face restoration with configurable strength
- restoration.py
  - MPRNet deblur/denoise wrapper
  - Uses CUDA if available else CPU (MPS disabled for stability)
  - CPU inference resize cap for practical runtime
- restormer.py
  - Restormer model bootstrap, checkpoint validation, warmup, tiled/standard inference
- lama.py
  - LaMa inpainting wrapper via simple_lama_inpainting
- deoldify.py
  - DeOldify repository/weights management and colorization
  - Compatibility handling for torch legacy checkpoint loading
- metrics.py
  - SSIM/PSNR computation
- quality_gate.py
  - Stage comparison metrics, gate evaluation, safe final-stage selection

## 7) Node Encryption Server Endpoints (Express)

Base service: server/index.js, default port 4000

## 7.1 GET /health

- Returns status ok.

## 7.2 POST /encrypt

Inputs (multipart):

- file
- password
- algorithm (aes-256-gcm | aes-256-cbc)

Behavior:

- Encrypts file buffer.
- Stores encrypted file under server/storage/encrypted.
- Stores metadata JSON under server/storage/metadata.
- Returns id + download and metadata URLs.

## 7.3 GET /download/:id

- Downloads encrypted file by id.

## 7.4 GET /metadata/:id

- Returns metadata JSON by id.

## 7.5 POST /decrypt

Inputs (multipart):

- file
- password
- salt
- iv
- authTag (for gcm)
- algorithm
- optional metadata JSON

Behavior:

- Decrypts and returns original content as downloadable response.

## 8) Encryption Implementations

## 8.1 Python backend/core/crypto.py

- AES-GCM encryption for job output files.
- Key derivation via PBKDF2-HMAC-SHA256.
- Constants:
  - iterations: 210000
  - salt: 16 bytes
  - nonce: 12 bytes
- File format:
  - MAGIC header + salt + nonce + ciphertext+tag

## 8.2 Node server/crypto.js

- PBKDF2-SHA256 with 100000 iterations and 32-byte key.
- Supports AES-256-GCM (default) and AES-256-CBC.
- Returns metadata with salt/iv/authTag and mime/originalName.

## 9) Job and Storage Model

## 9.1 Job Model (in-memory)

Defined in backend/app/core/jobs.py with detailed fields for:

- status/progress/step
- metrics and outputs
- warnings and fallback flags
- stage lists and model telemetry
- heartbeat and debug payload

## 9.2 Storage Paths

Python backend storage:

- backend/storage/uploads
- backend/storage/outputs/enhanced
- backend/storage/outputs/bg
- backend/storage/outputs/encrypted
- backend/storage/outputs/debug

Node server storage:

- server/storage/encrypted
- server/storage/metadata
- server/storage/uploads

## 10) Runtime, Ports, and Config

Frontend (Vite):

- Default host/port: 127.0.0.1:5173
- Proxy: /api -> http://127.0.0.1:8000

Python API:

- Default expected port: 8000

Node encryption API:

- Default port: 4000

Relevant frontend env variables:

- VITE_API_BASE_URL (used by JobContext for Python API base)
- VITE_API_URL (used by encryptionApi axios client)

## 11) Notes on Current Behavior

- General pipeline now uses watchdog heartbeats and stage timeouts, so long operations no longer remain silently stuck.
- On CPU, some operations are intentionally reduced (for example, 4x upscale may be reduced to 2x) to favor stability and completion.
- Old-photo pipeline is strict about model availability and can fail explicitly when required restoration quality conditions are not met.
- Vault/Admin data is mock/demo unless replaced with real backend persistence APIs.

## 12) Suggested Next Documentation Extensions

If needed, this file can be expanded with:

- Full request/response JSON schema examples for each endpoint
- Sequence diagrams per mode (general vs old_photo)
- Deployment profiles (CPU-only, GPU, split backend setup)
- Production hardening checklist (auth, persistence, observability)
