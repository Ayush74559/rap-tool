# AI Rapper Studio

Packages:
- web: Next.js + Tailwind + GSAP frontend
- server: Express API (Node.js)
- worker: Python Celery workers for heavy audio processing
- shared: shared types and utils

Stack:
- ffmpeg, librosa, pyrubberband, crepe/pyin, demucs, Redis, Celery
- Storage: local (./storage) with an S3-compatible interface (pluggable)

Dev quickstart in Docker is provided.

## Deploy

### UI (Next.js on Vercel)
1. Ensure `web/` builds locally.
2. Add `vercel.json` (already included) and set project Root Directory to `web` in Vercel.
3. Set env var `NEXT_PUBLIC_API_URL` (Preview + Production) to your API URL.
4. Deploy via dashboard or:

```bash
npx vercel --cwd web
npx vercel --prod --cwd web
```

### API (Express + ffmpeg)
Deploy to a container host (Render or Railway).

#### Render (recommended)
- Repo root contains `render.yaml`. In Render, "New +" → "Blueprint" → select this repo.
- It provisions a Web Service using Docker in `server/`.
- Persistent disk mounted at `/data`; STORAGE_DIR points to `/data/storage`.
- Health check: `/health`.

#### Railway
- Create a new service from repo; Railway will read `railway.json`.
- Uses `server/Dockerfile`; add a Volume mounted at `/data`.
- Set envs: `PORT=4000`, `NODE_ENV=production`, `STORAGE_DIR=/data/storage`.

After API is live, update Vercel Project env `NEXT_PUBLIC_API_URL` to the API’s public URL and redeploy UI.

## Environment
- NEXT_PUBLIC_API_URL: base URL of the API for the web app
- PORT (API): port to bind (default 4000)
- STORAGE_DIR (API): directory for uploads/outputs (default `../storage` locally; `/data/storage` in cloud)
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
