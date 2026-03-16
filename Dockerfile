# ---------------------------------------------------------------------------
# Stage 1 — install dependencies
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps

WORKDIR /app

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
FROM node:22-alpine AS runtime

WORKDIR /app

# System deps: tini for PID 1
RUN apk add --no-cache tini

# Copy the assembled dist produced by scripts/build.js
COPY --from=build /app/dist ./

# Re-install production deps inside dist/
RUN npm ci --omit=dev --ignore-scripts 2>/dev/null || npm install --omit=dev --ignore-scripts

# Ensure data directories exist (they will be mounted as volumes in prod)
RUN mkdir -p data/logs data/sessions data/training data/memory data/dpo \
    data/persona-sources data/persona-feedback data/persona-proposals \
    data/uploads data/uploads-meta data/node-engine/graphs \
    data/node-engine/runs data/node-engine/artifacts data/node-engine/cache

ENV NODE_ENV=production
ENV PORT=3333
ENV HOST=0.0.0.0

EXPOSE 3333

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
