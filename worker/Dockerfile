FROM python:3.11-slim

# System deps for audio libs
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    rubberband-cli \
    build-essential \
    libsndfile1 \
    libffi-dev \
    libicu-dev \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

EXPOSE 8000
CMD sh -c "celery -A app.celery_app worker --loglevel=INFO & uvicorn app:app --host 0.0.0.0 --port 8000"
