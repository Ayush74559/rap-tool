# Root Dockerfile for hosting the API on platforms that look for ./Dockerfile
# Builds the Express API from the server/ directory
FROM node:20-alpine

# Install ffmpeg and bash
RUN apk add --no-cache ffmpeg bash

WORKDIR /app

# Install deps using server package manifests
COPY server/package.json server/package-lock.json* server/yarn.lock* server/pnpm-lock.yaml* ./
RUN npm ci || npm i

# Copy API source
COPY server/. .

# Prepare storage dir (can be overridden by STORAGE_DIR env)
ENV STORAGE_DIR=/app/storage
RUN mkdir -p ${STORAGE_DIR}/uploads ${STORAGE_DIR}/outputs

EXPOSE 4000
CMD ["npm", "start"]
