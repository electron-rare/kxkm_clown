#!/usr/bin/env bash
# Preload Ollama models into VRAM after boot/restart
# Run via: systemctl --user start kxkm-ollama-warmup
OLLAMA=http://localhost:11434

echo "[warmup] Loading models..."
for model in qwen3.5:9b mistral:7b nomic-embed-text; do
  curl -sf $OLLAMA/api/chat -d "{\"model\":\"\",\"messages\":[{\"role\":\"user\",\"content\":\".\"}],\"stream\":false,\"options\":{\"num_predict\":1,\"num_ctx\":8192},\"keep_alive\":\"30m\"}" -o /dev/null 2>/dev/null
  echo "  : loaded"
done

echo "[warmup] Done. Models in VRAM:"
curl -sf $OLLAMA/api/ps 2>/dev/null | python3 -c 'import sys,json; [print(f"  {m[\"name\"]}: {m[\"size\"]//1e9:.1f}GB {m[\"details\"][\"family\"]}") for m in json.load(sys.stdin).get(\"models\",[])]' 2>/dev/null || ollama ps
