#!/usr/bin/env bash
# Start Qwen3-TTS on demand, stop after 5 min idle
# Usage: called by tts-server.py when qwen3 backend is requested

PORT=9300
SERVICE=kxkm-qwen3-tts.service
IDLE_TIMEOUT=300  # 5 minutes

# Check if already running
if systemctl --user is-active $SERVICE >/dev/null 2>&1; then
  # Already running, just check health
  curl -sf http://localhost:$PORT/health >/dev/null && exit 0
fi

# Start service
systemctl --user start $SERVICE
echo "[qwen3-tts] Starting on-demand..." >&2

# Wait for health (max 30s)
for i in $(seq 1 30); do
  curl -sf http://localhost:$PORT/health >/dev/null 2>&1 && break
  sleep 1
done

# Schedule auto-stop after idle timeout
(sleep $IDLE_TIMEOUT && systemctl --user stop $SERVICE && echo "[qwen3-tts] Auto-stopped after ${IDLE_TIMEOUT}s idle" >&2) &
disown

echo "[qwen3-tts] Ready on :$PORT" >&2
