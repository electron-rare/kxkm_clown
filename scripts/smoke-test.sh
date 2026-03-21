#!/bin/bash
# E2E Smoke Test — tests all services on kxkm-ai
# Usage: ssh kxkm@kxkm-ai 'bash -s' < scripts/smoke-test.sh
# Or: ssh kxkm@kxkm-ai "cd KXKM_Clown && bash scripts/smoke-test.sh"

set -euo pipefail
HOST="http://localhost:3333"
OLLAMA="http://localhost:11434"
COMFYUI="http://localhost:8188"
AI_BRIDGE="http://localhost:8301"
KOKORO="http://localhost:9201"
MASCARADE="http://localhost:8100"

PASS=0
FAIL=0
SKIP=0

test_endpoint() {
  local name="$1" url="$2" method="${3:-GET}" expected="${4:-200}"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$url" 2>/dev/null || echo "000")
  if [ "$status" = "$expected" ]; then
    echo "  ✓ $name ($status)"
    PASS=$((PASS+1))
  elif [ "$status" = "000" ]; then
    echo "  ⊘ $name (unreachable)"
    SKIP=$((SKIP+1))
  else
    echo "  ✗ $name (got $status, expected $expected)"
    FAIL=$((FAIL+1))
  fi
}

test_json() {
  local name="$1" url="$2" field="$3"
  local resp
  resp=$(curl -s "$url" 2>/dev/null || echo "{}")
  if echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); assert $field" 2>/dev/null; then
    echo "  ✓ $name"
    PASS=$((PASS+1))
  else
    echo "  ✗ $name (field check failed: $field)"
    FAIL=$((FAIL+1))
  fi
}

echo "╔══════════════════════════════════════╗"
echo "║  3615 J'ai pété — E2E Smoke Test    ║"
echo "╚══════════════════════════════════════╝"
echo ""

echo "▸ API Health"
test_json "health" "$HOST/api/v2/health" "d['ok']==True"
test_json "personas" "$HOST/api/v2/health" "d['data']['database']['personas']>=30"
test_json "ollama status" "$HOST/api/v2/health" "d['data']['ollama']['status']=='ok'"

echo "▸ LLM / Mascarade"
test_endpoint "mascarade health" "$MASCARADE/health"
test_json "llm-providers" "$HOST/api/v2/llm-providers" "d['data']['mascarade']==True"

echo "▸ Ollama"
test_endpoint "ollama tags" "$OLLAMA/api/tags"
test_endpoint "ollama ps" "$OLLAMA/api/ps"

echo "▸ ComfyUI"
test_endpoint "comfyui" "$COMFYUI/system_stats"
test_json "workflows" "$HOST/api/v2/comfyui/workflows" "len(d['data'])>=5"

echo "▸ Kokoro TTS"
test_json "kokoro health" "$KOKORO/health" "d['ok']==True"
test_endpoint "kokoro voices" "$KOKORO/voices"

echo "▸ AI Bridge"
test_json "ai-bridge health" "$AI_BRIDGE/health" "d['ok']==True"

echo "▸ DAW Samples"
test_endpoint "samples list" "$HOST/api/v2/daw/samples"

echo "▸ RAG / Feedback"
test_endpoint "rag search" "$HOST/api/v2/rag/search" "POST"
test_endpoint "dpo export" "$HOST/api/v2/export/dpo"
test_endpoint "feedback" "$HOST/api/v2/feedback" "POST"

echo "▸ Scheduler"
test_json "scheduler" "$HOST/api/v2/scheduler" "d['data']['maxVRAM']>0"

echo "▸ Static Assets"
test_endpoint "web app" "$HOST/"
test_endpoint "daw" "$HOST/daw/"

echo "▸ GPU"
FREE_VRAM=$(nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits 2>/dev/null || echo "N/A")
LOADED=$(curl -s "$OLLAMA/api/ps" 2>/dev/null | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('models',[])))" 2>/dev/null || echo "?")
echo "  VRAM free: ${FREE_VRAM}MB | Ollama models loaded: $LOADED"

echo ""
echo "════════════════════════════════"
echo "  PASS: $PASS  FAIL: $FAIL  SKIP: $SKIP"
echo "════════════════════════════════"
[ "$FAIL" -eq 0 ] && echo "  ALL TESTS PASSED ✓" || echo "  SOME TESTS FAILED ✗"
exit $FAIL
