# Project AI System Report

## 1. Executive Summary

This repository is not a single-purpose app. It is a combined product with three major layers:

1. A React + Vite frontend for image upload, enhancement configuration, preview, export, demo auth, vault, and admin UI.
2. A Python FastAPI backend that performs AI-powered image processing and an internal encrypted-package flow.
3. A separate Node.js + Express AES service that supports a standalone encryption/decryption UI flow.

The core production-style image workflow is:

`Frontend workspace -> FastAPI /api/jobs -> async background pipeline -> storage outputs -> frontend polling -> preview/export/download`

There are also several demo or mock features:

- Auth is mocked in the frontend with localStorage-based session persistence.
- Vault is a mock in-memory frontend service.
- Admin dashboard is backed by mock frontend data.
- The Node encryption server is real, but it is only used by the standalone AES encryption UI, not by the main AI processing workspace.

The project therefore behaves like a hybrid of:

- a real AI image enhancement application,
- a real but separate AES encryption demo/service,
- and a set of frontend product/demo surfaces that are not fully wired to persistent backend systems.

## 2. High-Level Architecture

### 2.1 Runtime Components

#### Frontend

- Path root: `src/`
- Framework: React 18 + TypeScript + Vite
- UI stack: shadcn/ui, Radix UI, Tailwind
- Main entry: `src/main.tsx`
- App router and providers: `src/App.tsx`

#### Python AI Backend

- Path root: `backend/app/`
- Framework: FastAPI
- Main entry: `backend/app/main.py`
- Purpose:
  - receive image-processing jobs,
  - validate input,
  - dispatch async processing jobs on a thread pool,
  - expose job status,
  - serve downloadable artifacts,
  - decrypt internal encrypted output files.

#### Node AES Backend

- Path root: `server/`
- Framework: Express
- Main entry: `server/index.js`
- Purpose:
  - encrypt uploaded files using AES-256-GCM or AES-256-CBC,
  - store `.enc` payloads and metadata JSON,
  - decrypt `.enc` uploads using provided metadata and password.

### 2.2 Architectural Split

There are two different encryption systems in this repo:

#### Encryption system A: FastAPI internal encryption

- Used by the main image-processing workspace.
- Implemented in `backend/app/core/crypto.py`.
- Uses AES-GCM only.
- Produces a single binary package with a custom header format.
- Triggered as part of `/api/jobs` when `encrypt=true`.

#### Encryption system B: Express standalone AES service

- Used by the standalone AES UI in `src/components/AesEncryptionApp.tsx`.
- Implemented in `server/crypto.js`.
- Supports AES-256-GCM and AES-256-CBC.
- Stores encrypted file and separate metadata JSON.
- Accessed through `src/services/encryptionApi.ts`.

These two systems are related conceptually, but they are not the same format and are not interchangeable by design.

## 3. Frontend Structure

## 3.1 Application Shell

The frontend is composed in `src/App.tsx` with these providers:

- `QueryClientProvider`
- `ThemeProvider`
- `AuthProvider`
- `WorkspaceProvider`
- `JobProvider`
- `TooltipProvider`
- React Router

Main routes:

- `/` -> landing page
- `/login` -> mock login
- `/signup` -> mock signup
- `/app` -> main workspace
- `/vault` -> vault UI
- `/admin` -> admin UI

## 3.2 Key Frontend Contexts

### `AuthContext`

File: `src/contexts/AuthContext.tsx`

Responsibilities:

- stores current user in localStorage,
- simulates login/signup,
- supports mock Google login,
- supports role switching for demo.

Important note:

- There is no real backend authentication or authorization.
- User identities are frontend-only mock objects.

### `WorkspaceContext`

File: `src/contexts/WorkspaceContext.tsx`

Responsibilities:

- stores the currently selected image,
- tracks image version history,
- stores enhancement/background/security settings,
- tracks selected preset,
- manages preview UI state,
- stores decrypted preview generated from backend decryption.

This context is the main UX state container for the workspace.

### `JobContext`

File: `src/contexts/JobContext.tsx`

Responsibilities:

- creates jobs by sending form-data to FastAPI,
- polls job status,
- maps backend progress states into frontend pipeline steps,
- updates the current job object,
- pushes completed outputs into image history.

This context is the bridge between the workspace UI and the FastAPI backend.

## 3.3 Main User-Facing Pages

### Landing

File: `src/pages/Landing.tsx`

- Marketing/presentation page.
- Uses compositional content sections from `src/components/landing/`.

### Workspace

File: `src/pages/Workspace.tsx`

This is the real operational center of the app.

It includes:

- left configuration sidebar,
- central image preview,
- right job status/export panel,
- quick action shortcuts.

The workspace pulls together:

- `ActionButtons`
- `PipelineSection`
- `EnhancementControls`
- `RestorationControls`
- `BackgroundControls`
- `SecurityControls`
- `ImagePreview`
- `JobProgress`
- `ExportSection`

### Vault

File: `src/pages/Vault.tsx`

- Displays processed items, filters, and share actions.
- Backed by `src/services/vault.service.ts`.
- This is mock storage, not a real backend vault.

### Admin

File: `src/pages/Admin.tsx`

- Displays model status, audit logs, and users.
- Backed by `src/services/admin.service.ts`.
- Entirely mock/demo data.

## 3.4 Workspace Functional Modules

### Pipeline Selection

File: `src/components/workspace/PipelineSection.tsx`

Lets the user:

- choose presets,
- configure enabled steps,
- trigger the main processing pipeline.

Presets are defined in `WorkspaceContext` and combine:

- enhancement settings,
- background settings,
- security settings.

### Quick Actions

File: `src/components/workspace/ActionButtons.tsx`

Provides one-click flows such as:

- Auto Enhance
- Old Photo AI
- Remove Blur
- Remove Background
- Replace Background
- Full Pipeline
- Encrypt
- Decrypt

These buttons either:

- directly trigger a job, or
- prepare settings and open the relevant control panel/modal.

### Old Photo Restoration UI

File: `src/components/workspace/RestorationControls.tsx`

Dedicated control surface for:

- deblur vs denoise mode,
- colorization,
- damage repair,
- auto damage masking,
- face recovery,
- restoration strength values.

This uses a specialized old-photo backend pipeline rather than the general pipeline.

### Background Editing UI

File: `src/components/workspace/BackgroundControls.tsx`

Lets the user:

- remove a background,
- replace a background with solid/preset/custom content,
- choose blur or transparent output,
- upload custom replacement image.

The actual compositing logic happens in the Python backend.

### Security UI

Files:

- `src/components/workspace/SecurityControls.tsx`
- `src/components/workspace/EncryptModal.tsx`
- `src/components/workspace/DecryptModal.tsx`

Behaviors:

- enable encryption as part of a processing job,
- collect password,
- start an encryption-only FastAPI job,
- decrypt FastAPI-generated encrypted files through `/api/decrypt`.

Important distinction:

- The workspace encryption/decryption UI talks to FastAPI.
- The standalone AES app talks to the Node server.

### Export UI

File: `src/components/workspace/ExportSection.tsx`

Allows download of:

- enhanced artifact,
- background-edited artifact,
- encrypted artifact.

Downloads are made by fetching artifact URLs returned by FastAPI.

## 4. Frontend End-to-End Functional Flows

## 4.1 General Enhancement Flow

1. User uploads/selects an image in the workspace.
2. `WorkspaceContext` stores it as `currentImage` and initializes version history.
3. User triggers processing from quick actions or `PipelineSection`.
4. `JobContext.startJob()` builds a `FormData` payload.
5. Frontend POSTs to `FastAPI /api/jobs`.
6. Backend returns `{ job_id, status: "queued" }`.
7. Frontend polls `GET /api/jobs/{job_id}` every ~1.5 seconds.
8. Backend pipeline writes artifacts and updates in-memory job state.
9. When status becomes `done`, frontend adds the processed URL into version history.
10. User previews or downloads artifacts from the export panel.

## 4.2 Old Photo Restoration Flow

1. User enables old photo restoration controls.
2. `JobContext.startOldPhotoRestoration()` forces a special settings set:
   - enhancement disabled,
   - old photo enabled,
   - background disabled,
   - security disabled.
3. Frontend still posts to `/api/jobs`, but with `mode=old_photo`.
4. Backend routes the request to `run_old_photo_pipeline()`.
5. Progress is reported through stages like:
   - loading,
   - inpainting,
   - restoring,
   - colorizing,
   - enhancing,
   - face recovery.
6. Final enhanced image is returned as job output.

## 4.3 Background Removal / Replacement Flow

1. User configures background behavior in `BackgroundControls`.
2. Frontend sends:
   - `remove_bg`,
   - `bg_mode`,
   - `solid_color`,
   - optional `custom_bg`.
3. Backend pipeline calls:
   - `remove_background()` to create foreground alpha cutout,
   - `apply_background_mode()` to produce final composited image.
4. Output is stored under `backend/storage/outputs/bg/`.

## 4.4 FastAPI Encryption Flow

1. User enables security in workspace or uses `EncryptModal`.
2. Frontend sends `encrypt=true` and `password`.
3. Backend pipeline finishes image generation first, then encrypts the chosen source artifact.
4. Encrypted binary is stored under `backend/storage/outputs/encrypted/`.
5. Job output exposes `encrypted_url`.
6. User downloads encrypted package.
7. `DecryptModal` can POST that file plus password to `FastAPI /api/decrypt`.

## 4.5 Standalone AES Encryption Flow

1. User uses `AesEncryptionApp.tsx`.
2. Frontend calls `src/services/encryptionApi.ts`.
3. API calls go to the Node server:
   - `POST /encrypt`
   - `POST /decrypt`
4. Express service returns metadata and download URLs.
5. User can separately download encrypted file and metadata JSON.

This flow is separate from the main workspace pipeline.

## 5. Python FastAPI Backend

## 5.1 Main API Surface

File: `backend/app/main.py`

Primary endpoints:

- `GET /health`
- `POST /api/jobs`
- `POST /api/restore-old`
- `GET /api/jobs/{job_id}`
- `GET /api/download/{job_id}/{artifact}`
- `POST /api/decrypt`

### Input Validation

The backend validates:

- allowed mode values,
- upscale values,
- quality values,
- strength ranges,
- background mode,
- encryption password presence,
- max upload size,
- max image dimensions,
- required custom background upload.

### Async Job Model

The backend uses:

- `ThreadPoolExecutor(max_workers=4)`
- in-memory job tracking

Job execution is asynchronous:

- request thread validates and stores uploads,
- background thread runs the chosen pipeline,
- frontend polls job state until completion.

### Startup Warmup

At startup, FastAPI attempts background warmup for:

- RealESRGAN
- GFPGAN
- rembg/U2Net
- Restormer models
- LaMa
- DeOldify

This is done lazily and defensively so the service can still start even if some heavy dependencies fail.

## 5.2 Job State Management

File: `backend/app/core/jobs.py`

Job storage is:

- in-memory Python dict,
- protected by a thread lock,
- non-persistent.

Each job tracks:

- `job_id`
- `mode`
- `status`
- `step`
- `progress`
- `iterations`
- `metrics`
- output URLs and file paths
- error string

Implications:

- restart the FastAPI process -> all job metadata disappears,
- existing output files may remain on disk but become undiscoverable via in-memory job lookup,
- this is suitable for prototype/demo usage, not durable production queueing.

## 5.3 General Pipeline Logic

File: `backend/app/services/pipeline.py`

This is the main pipeline for normal image processing.

Stage logic:

1. Load original image.
2. Optionally restore using MPRNet-based restoration models.
3. Optionally enhance/upscale using RealESRGAN.
4. Optionally restore faces using GFPGAN.
5. Compute SSIM and PSNR against the original.
6. Save enhanced image.
7. Optionally remove/replace background.
8. Optionally encrypt the final artifact.
9. Mark job as done.

Design notes:

- restoration order depends on `restore_mode`, denoise strength, deblur strength, and `ultra`.
- if enhancement is enabled, enhancement is the dominant output-producing stage.
- if background removal is enabled, background output is generated from the current working image.
- encryption encrypts `bg_path`, else `enhanced_path`, else original upload.

## 5.4 Old Photo Pipeline Logic

File: `backend/app/services/old_photo_pipeline.py`

This pipeline is specialized and more complex than the general one.

Main stages:

1. Load original image.
2. Optionally generate or load a damage mask.
3. Inpaint damaged areas using LaMa.
4. Run adaptive restoration using Restormer:
   - motion deblur,
   - real denoise,
   - auto mode ordering,
   - optional multi-stage behavior when `ultra` is enabled.
5. Optionally colorize grayscale-like images using DeOldify.
6. Enhance with RealESRGAN.
7. Optionally recover faces using GFPGAN.
8. Compute metrics.
9. Save final enhanced image.
10. Optionally encrypt result.

Notable implementation details:

- damage mask can be auto-generated from edges and local contrast using OpenCV.
- large images are accelerated through reduced-resolution restoration + blending.
- progress is “nudged” during long-running operations to keep UI progress moving.
- colorization only runs if the image appears grayscale-like.

## 5.5 Fallback Pipeline

File: `backend/app/services/simple_pipeline.py`

This is a degraded fallback path used when main dependencies are missing.

It:

- loads image,
- optionally tries enhancement if enhancer exists,
- saves output,
- optionally encrypts output.

It does not provide the full AI feature set.

This file is important because the backend is built to survive partial dependency failure.

## 5.6 AI Service Modules

### RealESRGAN

File: `backend/app/services/enhance.py`

Purpose:

- image enhancement and upscaling.

Behavior:

- lazy downloads model weights,
- chooses CUDA if available, otherwise CPU,
- adapts tile size based on image size,
- supports 2x and 4x models.

### GFPGAN

File: `backend/app/services/face_restore.py`

Purpose:

- face recovery on portraits or degraded faces.

Behavior:

- lazily downloads GFPGAN weights,
- returns original image if restoration fails.

### MPRNet Wrapper

File: `backend/app/services/restoration.py`

Purpose:

- deblur and denoise restoration for the general pipeline.

Behavior:

- clones MPRNet repo if missing,
- downloads weights from Google Drive or fallback mirrors,
- loads model dynamically,
- resizes large images for inference,
- fails gracefully by returning original image if loading/inference fails.

### Restormer Wrapper

File: `backend/app/services/restormer.py`

Purpose:

- stronger restoration for old photo flow.

Behavior:

- clones Restormer repo if missing,
- downloads weights through `gdown`,
- supports tiled or standard inference,
- reports progress callback ratios,
- uses aggressive tiling on CPU for stability.

### LaMa Wrapper

File: `backend/app/services/lama.py`

Purpose:

- inpainting damaged regions.

### DeOldify Wrapper

File: `backend/app/services/deoldify.py`

Purpose:

- colorize grayscale-like photos.

Behavior:

- clones DeOldify repo if missing,
- downloads model weights,
- runs through temporary files,
- falls back to original RGB image if colorization fails.

### Background Removal

File: `backend/app/services/bg_remove.py`

Primary approach:

- `rembg` with U2Net session.

Fallback approach:

- OpenCV GrabCut rectangle-based segmentation.

This makes the background feature more resilient than a single-model dependency chain.

### Background Compositing

File: `backend/app/services/composite.py`

Supports:

- transparent output,
- solid color fill,
- blurred original background,
- custom replacement image.

### Metrics

File: `backend/app/services/metrics.py`

Computes:

- SSIM
- PSNR

These are quality comparisons between original and candidate image.

## 5.7 FastAPI Internal Encryption Format

File: `backend/app/core/crypto.py`

The internal encryption scheme:

- uses PBKDF2-HMAC-SHA256,
- 210,000 iterations,
- 32-byte key,
- AESGCM from `cryptography`,
- stores a custom binary format:
  - 8-byte magic header `IMGSECV1`
  - 16-byte salt
  - 12-byte nonce
  - ciphertext + auth tag

Decryption endpoint:

- `POST /api/decrypt`

This endpoint:

- accepts an encrypted file and password,
- verifies header,
- derives key,
- attempts AES-GCM decryption,
- tries to infer MIME type by opening the plaintext as an image.

## 6. Node AES Backend

## 6.1 Purpose

Files:

- `server/index.js`
- `server/crypto.js`
- `server/store.js`

This backend is a standalone secure file encryption/decryption service for the separate AES UI.

## 6.2 Core Behavior

### `/encrypt`

- accepts uploaded image,
- requires password,
- supports `aes-256-gcm` or `aes-256-cbc`,
- encrypts buffer,
- stores encrypted `.enc` file on disk,
- writes metadata JSON,
- returns download and metadata URLs.

### `/decrypt`

- accepts encrypted file,
- password,
- metadata fields or full metadata JSON,
- decrypts and returns original image bytes.

## 6.3 Node Encryption Format

In `server/crypto.js`:

- PBKDF2-SHA256
- 100,000 iterations
- 32-byte key
- 16-byte salt
- 16-byte IV
- optional auth tag for GCM

This format depends on separate metadata and is not the same as the FastAPI binary format.

## 6.4 Node Storage Model

In `server/store.js`:

- encrypted files stored on disk,
- metadata stored as JSON files,
- record registry stored in an in-memory `Map`.

Implication:

- files persist on disk,
- in-memory records are lost on server restart,
- some download/lookup behavior depends on process memory.

## 7. Storage Layout

### FastAPI storage

Under `backend/storage/`:

- `uploads/` -> raw uploaded files
- `outputs/enhanced/` -> processed enhanced PNGs
- `outputs/bg/` -> background-edited PNGs
- `outputs/encrypted/` -> encrypted binaries

FastAPI also mounts:

- `/storage` -> static files from `backend/storage`

However, the main frontend primarily consumes download endpoints, not static storage URLs.

### Node storage

Under `server/storage/`:

- `encrypted/` -> encrypted files
- `metadata/` -> metadata JSON
- `uploads/` -> declared but not meaningfully used with memory upload storage

## 8. Environment and API Configuration

There are two frontend environment conventions in use:

- `VITE_API_BASE_URL` -> used by workspace/FastAPI flows
- `VITE_API_URL` -> used by standalone Node AES API service

Defaults:

- workspace API defaults to `http://127.0.0.1:8000`
- Node AES service defaults to empty base URL unless `VITE_API_URL` is set

This matters because:

- the workspace and standalone AES app do not share the same API base variable,
- deployments must configure both if both backends are expected to work.

## 9. Real vs Mocked Functionality

This section is critical for any AI trying to modify or extend the repo.

### Real backend-connected features

- Workspace image processing via FastAPI
- Job polling and progress UI
- AI enhancement pipeline
- Old photo restoration pipeline
- Background removal/replacement
- FastAPI encryption and decryption
- Standalone Node AES encryption/decryption service

### Mock/demo-only features

- Auth and role management
- Signup/login persistence beyond localStorage
- Vault persistence and retrieval
- Share links
- Admin metrics, logs, model status, user management

### Hybrid features

- Security UI is real for FastAPI job encryption, but secure share links are mocked.
- Export UI is real for current job artifacts, but long-term vault storage is mocked.

## 10. Important Implementation Realities and Caveats

## 10.1 Persistence Limitations

- FastAPI jobs are in-memory only.
- Node record index is in-memory only.
- Vault and admin are frontend-memory/mock only.

This repo has persistent artifact files but mostly non-persistent metadata layers.

## 10.2 Heavy Dependency Bootstrapping

Several services clone repos or download weights dynamically:

- MPRNet
- Restormer
- DeOldify
- RealESRGAN weights
- GFPGAN weights
- U2Net/rembg cache

That means first-run behavior may be slow, network-dependent, and environment-sensitive.

## 10.3 Defensive / Fallback Design

The backend is designed to degrade rather than crash:

- lazy imports in `main.py`,
- fallback to `simple_pipeline`,
- face restoration returns original on failure,
- deoldify returns original on failure,
- background removal falls back to GrabCut,
- MPRNet wrapper returns original image if model bootstrap fails.

This is a deliberate resilience pattern across the codebase.

## 10.4 Pipeline/UI Naming Mismatch Risk

The frontend maps backend step names manually in `JobContext`.

If backend step labels change, progress visualization can drift or break. The mapping layer is:

- `mapBackendStep()` in `src/contexts/JobContext.tsx`

## 10.5 Some Status Docs Are More Optimistic Than the Codebase Reality

`SYSTEM_STATUS.md` describes the system as fully operational and production-ready.

Actual code reality is more nuanced:

- some major features are mock/demo only,
- some model-backed features depend on heavyweight dynamic downloads,
- metadata persistence is mostly in-memory,
- there are two separate encryption systems.

An AI modifying this repo should trust the code paths more than summary claims.

## 11. Recommended Mental Model for Another AI

If another AI needs to work on this project, the best mental model is:

### The product

“An AI image enhancement web app with a rich frontend workspace, a real FastAPI image-processing backend, a separate standalone AES encryption service, and several demo-only product surfaces.”

### The main operational path

“Most real image functionality lives in the React workspace + FastAPI job pipeline path.”

### The biggest architecture warning

“Do not assume all visible UI features are backed by persistent backend systems.”

### The backend philosophy

“Heavy models are optional and lazily initialized; the app prefers degraded functionality over startup failure.”

## 12. File Map for Fast Orientation

### Frontend core

- `src/App.tsx`
- `src/pages/Workspace.tsx`
- `src/contexts/WorkspaceContext.tsx`
- `src/contexts/JobContext.tsx`
- `src/types/index.ts`

### Frontend workspace modules

- `src/components/workspace/ActionButtons.tsx`
- `src/components/workspace/PipelineSection.tsx`
- `src/components/workspace/RestorationControls.tsx`
- `src/components/workspace/BackgroundControls.tsx`
- `src/components/workspace/SecurityControls.tsx`
- `src/components/workspace/EncryptModal.tsx`
- `src/components/workspace/DecryptModal.tsx`
- `src/components/workspace/ExportSection.tsx`

### Mock/demo frontend services

- `src/contexts/AuthContext.tsx`
- `src/services/vault.service.ts`
- `src/services/admin.service.ts`

### Python backend

- `backend/app/main.py`
- `backend/app/core/jobs.py`
- `backend/app/core/crypto.py`
- `backend/app/services/pipeline.py`
- `backend/app/services/old_photo_pipeline.py`
- `backend/app/services/simple_pipeline.py`

### Python AI modules

- `backend/app/services/enhance.py`
- `backend/app/services/face_restore.py`
- `backend/app/services/restoration.py`
- `backend/app/services/restormer.py`
- `backend/app/services/lama.py`
- `backend/app/services/deoldify.py`
- `backend/app/services/bg_remove.py`
- `backend/app/services/composite.py`
- `backend/app/services/metrics.py`

### Node AES service

- `server/index.js`
- `server/crypto.js`
- `server/store.js`
- `src/services/encryptionApi.ts`
- `src/components/AesEncryptionApp.tsx`

## 13. Best Next-Step Suggestions for Future Work

If this project is to be made more production-realistic, the highest-value next steps would be:

1. Replace in-memory job tracking with a persistent store and queue.
2. Replace mock auth with real backend authentication.
3. Replace mock vault/admin systems with backend persistence.
4. Unify or clearly separate the two encryption experiences in product architecture.
5. Add a formal model availability/status layer so the UI can reflect actual backend capability.
6. Add integration tests that cover the real workspace -> FastAPI flow.

## 14. Final Understanding

The repository is best understood as a multi-mode image AI platform prototype:

- real AI processing exists,
- real encryption exists in two forms,
- some product surfaces are mock,
- the backend is built to survive missing model dependencies,
- the workspace + FastAPI path is the primary real functional core.

That is the most accurate single-sentence understanding of the project.
