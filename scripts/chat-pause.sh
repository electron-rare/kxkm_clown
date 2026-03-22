#!/bin/bash
# ═══════════════════════════════════════════════════════════
# Chat Pause/Unpause — toggle maintenance mode
# Usage:
#   bash scripts/chat-pause.sh on    # Pause chat
#   bash scripts/chat-pause.sh off   # Unpause chat
#   bash scripts/chat-pause.sh       # Show status
# ═══════════════════════════════════════════════════════════
set -euo pipefail

HOST="${KXKM_HOST:-kxkm@kxkm-ai}"
CONTAINER="${KXKM_CONTAINER:-kxkm_clown-api-1}"

get_status() {
  ssh "$HOST" "docker exec $CONTAINER sh -c 'echo \$CHAT_PAUSED'" 2>/dev/null || echo "?"
}

case "${1:-status}" in
  on|pause|1)
    echo "[chat-pause] Pausing chat..."
    ssh "$HOST" "docker exec $CONTAINER sh -c 'kill -USR1 1'" 2>/dev/null || true
    # Set env via docker update isn't supported, use file flag instead
    ssh "$HOST" "docker exec $CONTAINER sh -c 'echo 1 > /tmp/chat-paused'" 2>/dev/null
    echo "[chat-pause] Chat PAUSED (maintenance mode)"
    ;;
  off|unpause|0)
    echo "[chat-pause] Unpausing chat..."
    ssh "$HOST" "docker exec $CONTAINER sh -c 'rm -f /tmp/chat-paused'" 2>/dev/null
    echo "[chat-pause] Chat ACTIVE"
    ;;
  status|*)
    echo "[chat-pause] Checking status..."
    if ssh "$HOST" "docker exec $CONTAINER sh -c 'test -f /tmp/chat-paused'" 2>/dev/null; then
      echo "[chat-pause] Status: PAUSED"
    else
      echo "[chat-pause] Status: ACTIVE"
    fi
    ;;
esac
