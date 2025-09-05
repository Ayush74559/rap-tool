FROM node:20-alpine
WORKDIR /app
# Install ffmpeg and bash
RUN apk add --no-cache ffmpeg bash
COPY package.json package-lock.json* yarn.lock* pnpm-lock.yaml* ./
RUN npm ci || yarn install || pnpm i
COPY . .
# Ensure storage dir exists (for uploads/outputs mounted or ephemeral)
ENV STORAGE_DIR=/app/storage
RUN mkdir -p ${STORAGE_DIR}/uploads ${STORAGE_DIR}/outputs
EXPOSE 4000
CMD ["npm", "start"]
