#!/bin/bash
# ═══════════════════════════════════════════════════════════
# 3615-KXKM — Deploy script
# Usage: bash scripts/deploy.sh [--full|--web|--api|--tts]
# ═══════════════════════════════════════════════════════════
set -euo pipefail

HOST="kxkm@kxkm-ai"
REMOTE_DIR="/home/kxkm/KXKM_Clown"
SSH="ssh $HOST"
LOG_PREFIX="[deploy]"

log()  { echo "$LOG_PREFIX $*"; }
fail() { echo "$LOG_PREFIX ERROR: $*" >&2; exit 1; }

MODE="${1:---full}"

# ─── Step 1: Build locally ─────────────────────────────────
log "Building locally..."
npx tsc --noEmit -p apps/api/tsconfig.json || fail "TypeScript API check failed"
npx tsc --noEmit -p apps/web/tsconfig.json || fail "TypeScript Web check failed"
npm run -w @kxkm/web build || fail "Web build failed"
npm run -w @kxkm/api build || fail "API build failed"
log "Local build OK"

# ─── Step 2: Sync to remote ────────────────────────────────
log "Syncing to $HOST..."

if [[ "$MODE" == "--full" || "$MODE" == "--web" ]]; then
  rsync -avz --delete --exclude='node_modules' --exclude='.git' \
    apps/web/src/ "$HOST:$REMOTE_DIR/apps/web/src/"
  log "Web sources synced"
fi

if [[ "$MODE" == "--full" || "$MODE" == "--api" ]]; then
  rsync -avz --delete --exclude='node_modules' --exclude='.git' \
    apps/api/src/ "$HOST:$REMOTE_DIR/apps/api/src/"
  log "API sources synced"
fi

rsync -avz scripts/ "$HOST:$REMOTE_DIR/scripts/"
rsync -avz Dockerfile docker-compose.yml "$HOST:$REMOTE_DIR/"
log "Scripts + infra synced"

# ─── Step 3: Remote build ──────────────────────────────────
log "Building on remote..."
$SSH "source ~/.nvm/nvm.sh && cd $REMOTE_DIR && \
  npx tsc -b tsconfig.v2.json && \
  npm run -w @kxkm/web build && \
  npm run -w @kxkm/api build && \
  npm run build" || fail "Remote build failed"
log "Remote build OK"

# ─── Step 4: Deploy to Docker ──────────────────────────────
log "Deploying to Docker..."
$SSH "cd $REMOTE_DIR && \
  docker cp apps/web/dist/. kxkm_clown-api-1:/app/apps/web/dist/ && \
  docker cp apps/api/dist/. kxkm_clown-api-1:/app/apps/api/dist/ && \
  docker restart kxkm_clown-api-1" || fail "Docker deploy failed"
log "Docker restarted"

# ─── Step 5: Restart TTS server (systemd user unit) ───────
if [[ "$MODE" == "--full" || "$MODE" == "--tts" ]]; then
  log "Restarting TTS server (systemd)..."
  $SSH "systemctl --user restart kxkm-tts.service; \
    sleep 3; \
    curl -sf http://127.0.0.1:9100/health && echo ' TTS OK' || echo ' TTS FAIL'"
fi

# ─── Step 5b: Restart LightRAG server (systemd user unit) ─
if [[ "$MODE" == "--full" ]]; then
  log "Restarting LightRAG server (systemd)..."
  $SSH "systemctl --user restart kxkm-lightrag.service; \
    sleep 5; \
    curl -sf http://127.0.0.1:9621/health | head -c 30 && echo ' LightRAG OK' || echo ' LightRAG FAIL'"
fi

# ─── Step 5c: Restart Reranker server (systemd user unit) ─
if [[ "$MODE" == "--full" ]]; then
  log "Restarting Reranker server (systemd)..."
  $SSH "systemctl --user restart kxkm-reranker.service; \
    sleep 3; \
    curl -sf http://127.0.0.1:9500/health && echo ' Reranker OK' || echo ' Reranker FAIL'"
fi

# ─── Step 5d: Restart Qwen3-TTS server (on-demand, GPU-heavy) ─
if [[ "$MODE" == "--full" ]]; then
  log "Checking Qwen3-TTS server (on-demand)..."
  $SSH "if systemctl --user is-active kxkm-qwen3-tts.service >/dev/null 2>&1; then \
    systemctl --user restart kxkm-qwen3-tts.service; \
    sleep 5; \
    curl -sf http://127.0.0.1:9300/health && echo ' Qwen3-TTS OK' || echo ' Qwen3-TTS FAIL'; \
  else \
    echo ' Qwen3-TTS not active (on-demand, skipped)'; \
  fi"
fi

# ─── Step 6: Health check ──────────────────────────────────
log "Health check..."
sleep 3
$SSH "curl -sf http://localhost:3333/api/v2/health | head -c 50" && echo " API OK" || echo " API FAIL"

# Docker container health
log "Docker containers status..."
$SSH "docker compose --profile v2 ps --format 'table {{.Name}}\t{{.Status}}' 2>/dev/null"

# Journal disk usage
log "Journal disk usage..."
$SSH "journalctl --user --disk-usage 2>/dev/null"

log "═══ Deploy complete ═══"
