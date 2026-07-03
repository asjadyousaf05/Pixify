# Pixify

A full-stack image-processing web app for AI enhancement, old-photo restoration, background editing, and password-based image encryption.

## Features

- AI image enhancement with upscale, denoise, deblur, and face recovery controls
- Old-photo restoration workflow with repair, colorize, face recovery, and upscale modes
- Background removal and replacement with transparent, solid, blur, and custom backgrounds
- AES-256 image encryption/decryption with PBKDF2 key derivation
- Local auth/admin demo flow, workspace history, vault storage, and downloadable outputs

## Tech Stack

- Frontend: React, Vite, TypeScript, Tailwind CSS, shadcn/Radix UI
- Crypto API: Node.js, Express, Multer, Node `crypto`
- AI API: FastAPI, Pillow, OpenCV, rembg, Real-ESRGAN, GFPGAN, Restormer/MPRNet integrations
- Tests/lint: Vitest, Testing Library, ESLint

## Requirements

- Node.js 20+
- npm
- Python 3.11 recommended for the AI backend

## Quick Start

Install frontend and Node API dependencies:

```bash
npm install
```

Run the React app plus the lightweight Node encryption API:

```bash
npm start
```

Open:

- Frontend: `http://127.0.0.1:5173`
- Crypto API: `http://127.0.0.1:4000`

## Full AI Backend Setup

The enhancement/restoration features call the FastAPI service on port `8000`.

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install --no-deps simple-lama-inpainting==0.1.2
cd ..
npm run start:full
```

Open `http://127.0.0.1:5173`.

Large model weights are intentionally ignored by git. Put model files under `backend/weights/` when needed, or let supported services download/cache their assets during runtime.

## Scripts

- `npm run dev:web` - run Vite only
- `npm run dev:crypto` - run the Node encryption API only
- `npm run dev:ai` - run the FastAPI AI backend only
- `npm start` - run Vite and the Node encryption API
- `npm run start:full` - run Vite, Node encryption API, and FastAPI AI backend
- `npm run build` - create a production frontend build
- `npm test` - run Vitest tests
- `npm run lint` - run ESLint

## API Overview

Node crypto API:

- `GET /health`
- `POST /encrypt`
- `POST /decrypt`
- `GET /download/:id`
- `GET /metadata/:id`

FastAPI AI API:

- `GET /health`
- `POST /api/jobs`
- `GET /api/jobs/{job_id}`
- `POST /api/restore-old`

See [IMPLEMENTATION_FUNCTIONALITY_ENDPOINTS.md](./IMPLEMENTATION_FUNCTIONALITY_ENDPOINTS.md) and [PROJECT_AI_SYSTEM_REPORT.md](./PROJECT_AI_SYSTEM_REPORT.md) for deeper implementation notes.

## GitHub Notes

This repo ignores generated builds, local virtual environments, uploaded files, encrypted outputs, metadata, model weights, and OS/editor files. Keep only source code, config, docs, and lightweight public assets in git.

Before pushing:

```bash
npm run lint
npm test
npm run build
```

## Security Notes

- Passwords are not stored by the encryption API.
- AES keys are derived server-side with PBKDF2-SHA256.
- AES-256-GCM is the default encryption mode.
- Salt, IV, and auth tag are generated per encryption operation.
# Pixify
