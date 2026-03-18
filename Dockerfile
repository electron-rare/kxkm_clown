# ---------------------------------------------------------------------------
# Stage 1 — install dependencies
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps

WORKDIR /app

# Build deps for native modules (@discordjs/opus, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy workspace manifests first for layer caching
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

RUN npm ci

# ---------------------------------------------------------------------------
# Stage 2 — build V1 dist + V2 TypeScript / Vite
# ---------------------------------------------------------------------------
FROM deps AS build

WORKDIR /app

# Copy all source (respects .dockerignore)
COPY . .

# Build V2 (tsc + vite) then V1 (assembles dist/)
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 3 — production runtime
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

WORKDIR /app

# System deps: tini for PID 1, python3 for TTS/ML, ffmpeg for audio
RUN apt-get update && apt-get install -y --no-install-recommends \
    tini ca-certificates python3 python3-pip python3-venv ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m pip install --break-system-packages piper-tts pathvalidate 2>/dev/null || true

# Copy the assembled dist produced by scripts/build.js
COPY --from=build /app/dist ./

# Copy V2 app builds (api + web)
COPY --from=build /app/apps/api/dist ./apps/api/dist/
COPY --from=build /app/apps/web/dist ./apps/web/dist/

# Re-install production deps inside dist/
RUN npm ci --omit=dev --ignore-scripts 2>/dev/null || npm install --omit=dev --ignore-scripts

# Copy scripts (TTS, training, eval)
COPY --from=build /app/scripts/train_unsloth.py ./scripts/
COPY --from=build /app/scripts/eval_model.py ./scripts/
COPY --from=build /app/scripts/ollama-import-adapter.sh ./scripts/
COPY --from=build /app/scripts/extract_pdf_docling.py ./scripts/
COPY --from=build /app/scripts/tts_synthesize.py ./scripts/
COPY --from=build /app/scripts/tts_clone_voice.py ./scripts/
COPY --from=build /app/scripts/tts-server.py ./scripts/

# Ensure data directories exist (they will be mounted as volumes in prod)
RUN mkdir -p data/logs data/sessions data/training data/memory data/dpo \
    data/persona-sources data/persona-feedback data/persona-proposals \
    data/uploads data/uploads-meta data/node-engine/graphs \
    data/node-engine/runs data/node-engine/artifacts data/node-engine/cache \
    data/media/images data/media/audio data/voice-samples data/piper-voices

ENV NODE_ENV=production
ENV PORT=3333
ENV HOST=0.0.0.0

EXPOSE 3333

ENTRYPOINT ["tini", "--"]
CMD ["node", "server.js"]
