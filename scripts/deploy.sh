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

# ─── Step 5: Restart TTS server ────────────────────────────
if [[ "$MODE" == "--full" || "$MODE" == "--tts" ]]; then
  log "Restarting TTS server..."
  $SSH "tmux kill-session -t tts 2>/dev/null || true; \
    sleep 1; \
    tmux new-session -d -s tts \
      'source /home/kxkm/venv/bin/activate && cd $REMOTE_DIR && python3 scripts/tts-server.py --port 9100 2>&1 | tee /tmp/tts-server.log'; \
    sleep 3; \
    curl -sf http://127.0.0.1:9100/health && echo ' TTS OK' || echo ' TTS FAIL'"
fi

# ─── Step 6: Health check ──────────────────────────────────
log "Health check..."
sleep 3
$SSH "curl -sf http://localhost:3333/api/v2/health | head -c 50" && echo " API OK" || echo " API FAIL"

log "═══ Deploy complete ═══"
