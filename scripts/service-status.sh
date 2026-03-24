#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# 3615-KXKM — Service status overview
# Run on kxkm-ai or via: ssh kxkm@kxkm-ai bash scripts/service-status.sh
# ═══════════════════════════════════════════════════════════

echo "=== KXKM Services ==="
echo ""
echo "--- Docker ---"
docker compose --profile v2 ps --format 'table {{.Name}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null
echo ""
echo "--- Systemd User ---"
systemctl --user status kxkm-tts kxkm-lightrag kxkm-reranker kxkm-qwen3-tts --no-pager -l 2>/dev/null | grep -E 'Active:|●'
echo ""
echo "--- Systemd System ---"
sudo systemctl status mascarade nginx netfilter-persistent --no-pager -l 2>/dev/null | grep -E 'Active:|●' || true
echo ""
echo "--- Tailscale ---"
if command -v tailscale >/dev/null 2>&1; then
  sudo tailscale status 2>/dev/null | head -20 || true
else
  echo "  tailscale: not installed"
fi
echo ""
echo "--- Journal ---"
journalctl --user --disk-usage 2>/dev/null || echo "  (no user journal)"
echo ""
echo "--- Health ---"
for svc in "API:http://localhost:3333/api/v2/health" "TTS:http://localhost:9100/health" "LightRAG:http://localhost:9621/health" "Reranker:http://localhost:9500/health" "Qwen3-TTS:http://localhost:9300/health" "SearXNG:http://localhost:8080/" "Ollama:http://localhost:11434/api/tags"; do
  name="${svc%%:*}"
  url="${svc#*:}"
  status=$(curl -sf -o /dev/null -w '%{http_code}' "$url" 2>/dev/null)
  [ "$status" = "200" ] && echo "  $name: OK" || echo "  $name: FAIL ($status)"
done

for svc in "Mascarade:http://localhost:8100/health" "Nginx:http://localhost/"; do
  name="${svc%%:*}"
  url="${svc#*:}"
  status=$(curl -sf -o /dev/null -w '%{http_code}' "$url" 2>/dev/null)
  [ "$status" = "200" -o "$status" = "301" -o "$status" = "302" ] && echo "  $name: OK" || echo "  $name: FAIL ($status)"
done
