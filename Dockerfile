# ---------------------------------------------------------------------------
# KXKM_Clown — Production Dockerfile
#
# Strategy: pre-built artifacts (dist/ + apps/*/dist/) are copied in.
# The Docker build does NOT run npm run build — that's done on the host.
# This keeps the image small and the build fast.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

WORKDIR /app

# System deps: python3 for TTS/ML, ffmpeg for audio
RUN apt-get update && apt-get install -y --no-install-recommends \
    tini ca-certificates python3 python3-pip ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# TTS deps (lightweight)
RUN pip3 install --break-system-packages --no-cache-dir \
    piper-tts pathvalidate

# ML deps for /compose (torch CPU ~800MB, cached in its own layer)
RUN pip3 install --break-system-packages --no-cache-dir \
    torch --index-url https://download.pytorch.org/whl/cpu \
    && pip3 install --break-system-packages --no-cache-dir \
    transformers accelerate scipy

# Copy package manifests + install production deps
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/storage/package.json packages/storage/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/chat-domain/package.json packages/chat-domain/package.json
COPY packages/persona-domain/package.json packages/persona-domain/package.json
COPY packages/node-engine/package.json packages/node-engine/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/tui/package.json packages/tui/package.json

RUN npm ci --omit=dev --ignore-scripts 2>/dev/null || npm install --omit=dev --ignore-scripts

# Copy pre-built artifacts
COPY dist/ ./
COPY apps/api/dist/ ./apps/api/dist/
COPY apps/web/dist/ ./apps/web/dist/
COPY packages/core/dist/ ./packages/core/dist/
COPY packages/auth/dist/ ./packages/auth/dist/
COPY packages/chat-domain/dist/ ./packages/chat-domain/dist/
COPY packages/persona-domain/dist/ ./packages/persona-domain/dist/
COPY packages/node-engine/dist/ ./packages/node-engine/dist/
COPY packages/storage/dist/ ./packages/storage/dist/

# Copy scripts
COPY scripts/tts_synthesize.py scripts/tts_clone_voice.py scripts/tts-server.py \
     scripts/train_unsloth.py scripts/eval_model.py scripts/extract_pdf_docling.py \
     scripts/ollama-import-adapter.sh ./scripts/

# Create data directories (mounted as volumes in prod)
RUN mkdir -p data/logs data/sessions data/training data/memory data/dpo \
    data/persona-sources data/persona-feedback data/persona-proposals \
    data/uploads data/uploads-meta data/node-engine/graphs \
    data/node-engine/runs data/node-engine/artifacts data/node-engine/cache \
    data/media/images data/media/audio data/voice-samples data/piper-voices \
    data/chat-logs data/context data/persona-memory

ENV NODE_ENV=production
ENV PORT=3333
ENV HOST=0.0.0.0

EXPOSE 3333

ENTRYPOINT ["tini", "--"]
CMD ["node", "server.js"]
