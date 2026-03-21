#!/bin/bash
# =============================================================================
# KXKM-AI Optimization Script — requires sudo
# Run on kxkm-ai: sudo bash scripts/sudo-optimize.sh
# =============================================================================

set -e
echo "╔══════════════════════════════════════╗"
echo "║  KXKM-AI Optimization (sudo)        ║"
echo "╚══════════════════════════════════════╝"
echo ""

# --- 1. Ollama tuning ---
echo "▸ [1/4] Ollama tuning..."
mkdir -p /etc/systemd/system/ollama.service.d
cat > /etc/systemd/system/ollama.service.d/override.conf << 'EOF'
[Service]
Environment="OLLAMA_NUM_PARALLEL=2"
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_KV_CACHE_TYPE=q8_0"
Environment="OLLAMA_MAX_LOADED_MODELS=2"
Environment="OLLAMA_ORIGINS=*"
EOF
echo "  Written /etc/systemd/system/ollama.service.d/override.conf"
systemctl daemon-reload
systemctl restart ollama
echo "  Ollama restarted with: NUM_PARALLEL=2 FLASH_ATTENTION=1 KV_CACHE=q8_0"
sleep 3

# --- 2. Docker GPU runtime ---
echo ""
echo "▸ [2/4] Docker GPU runtime..."
if nvidia-ctk --version > /dev/null 2>&1; then
  echo "  nvidia-container-toolkit already installed"
else
  echo "  Installing nvidia-container-toolkit..."
  apt-get update -qq && apt-get install -y -qq nvidia-container-toolkit
  nvidia-ctk runtime configure --runtime=docker
  systemctl restart docker
  echo "  Docker GPU runtime configured"
fi

# --- 3. Linger for kxkm user services ---
echo ""
echo "▸ [3/4] Enabling linger for kxkm..."
loginctl enable-linger kxkm 2>/dev/null && echo "  Linger enabled" || echo "  Linger already enabled"

# --- 4. Free ComfyUI VRAM ---
echo ""
echo "▸ [4/4] Freeing ComfyUI VRAM..."
curl -s -X POST http://localhost:8188/free -H 'Content-Type: application/json' -d '{"unload_models":true,"free_memory":true}' > /dev/null 2>&1 && echo "  ComfyUI VRAM freed" || echo "  ComfyUI not reachable (skip)"

# --- Verify ---
echo ""
echo "════════════════════════════════════════"
echo "  Verification"
echo "════════════════════════════════════════"

# Ollama
echo ""
echo "▸ Ollama:"
systemctl is-active ollama && echo "  Status: running" || echo "  Status: STOPPED"
sleep 2
curl -s http://localhost:11434/api/ps | python3 -c "
import sys,json
d=json.load(sys.stdin)
for m in d.get('models',[]):
    print(f'  Model: {m[\"name\"]} ({m.get(\"size_vram\",0)/(1024**3):.1f}GB VRAM)')
if not d.get('models'):
    print('  No models loaded (will load on first request)')
" 2>/dev/null || echo "  Ollama not responding yet"

# GPU
echo ""
echo "▸ GPU:"
nvidia-smi --query-gpu=memory.used,memory.free,memory.total --format=csv,noheader 2>/dev/null | while read line; do
  echo "  VRAM: $line"
done

# Docker
echo ""
echo "▸ Docker GPU:"
docker info 2>/dev/null | grep -i "runtimes\|nvidia" | head -3 | while read line; do
  echo "  $line"
done

# Services
echo ""
echo "▸ User services (kxkm):"
su - kxkm -c "systemctl --user status kokoro-tts --no-pager 2>/dev/null | head -3" 2>/dev/null
su - kxkm -c "systemctl --user status ai-bridge --no-pager 2>/dev/null | head -3" 2>/dev/null

echo ""
echo "════════════════════════════════════════"
echo "  Done. Reload Ollama model:"
echo "  curl -s http://localhost:11434/api/chat \\"
echo "    -d '{\"model\":\"qwen3.5:9b\",\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}],\"stream\":false,\"options\":{\"num_predict\":1},\"keep_alive\":\"30m\"}'"
echo "════════════════════════════════════════"
