# AI Rapper Studio Monorepo

Packages:
- web: Next.js + Tailwind + GSAP frontend
- server: Express API (Node.js)
- worker: Python Celery workers for heavy audio processing
- shared: shared types and utils

Stack:
- ffmpeg, librosa, pyrubberband, crepe/pyin, demucs, Redis, Celery
- Storage: local (./storage) with an S3-compatible interface (pluggable)

Dev quickstart in Docker is provided.
