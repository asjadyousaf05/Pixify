# LinkedIn Post Prompt

Copy this into ChatGPT to generate a LinkedIn post:

```text
Write a professional but engaging LinkedIn post about my final-year/project portfolio app.

Project name: Pixify

What it does:
- A full-stack web app for image enhancement, old-photo restoration, background editing, and secure image encryption.
- Users can upload an image, choose AI processing options, preview processed versions, download results, and store work in a local vault.
- It includes AES-256 encryption/decryption so users can protect processed images with a password.

Key features:
- AI upscaling, denoising, deblurring, and face recovery
- Old-photo restoration with repair, colorization, face recovery, and upscale modes
- Background removal and replacement
- AES-256-GCM encryption with PBKDF2-SHA256 key derivation
- React workspace UI with job progress tracking, image previews, export controls, auth/admin demo flow, and vault history

Tech stack:
- React, Vite, TypeScript, Tailwind CSS, shadcn/Radix UI
- Node.js, Express, Multer, Node crypto
- FastAPI, Python, Pillow, OpenCV, rembg, Real-ESRGAN, GFPGAN, Restormer/MPRNet integrations
- Vitest and ESLint for project quality

What I learned:
- Building a practical full-stack AI workflow
- Connecting React UI state to backend job queues and progress polling
- Handling image upload, processing, preview, export, and secure encryption flows
- Preparing a project for GitHub with clean documentation, scripts, tests, linting, and ignored generated assets

Tone:
- Confident, student/developer-friendly, and concise
- Mention that this project combines AI image restoration with cybersecurity
- Include a short call to action asking people for feedback
- Add relevant hashtags
```
