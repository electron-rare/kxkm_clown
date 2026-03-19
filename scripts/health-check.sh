#!/usr/bin/env bash
# ─── KXKM_Clown Health Check TUI ───────────────────────────
# Usage: bash scripts/health-check.sh [--remote kxkm@kxkm-ai]
set -uo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
PASS="${GREEN}✓${NC}"; FAIL="${RED}✗${NC}"; WARN="${YELLOW}⚠${NC}"

HOST="localhost"
SSH=""
if [[ "${1:-}" == "--remote" && -n "${2:-}" ]]; then
  SSH="ssh $2"
  HOST="localhost"
  echo -e "${CYAN}═══ KXKM_Clown Health Check (remote: $2) ═══${NC}"
else
  echo -e "${CYAN}═══ KXKM_Clown Health Check (local) ═══${NC}"
fi

run() { if [[ -n "$SSH" ]]; then $SSH "$@"; else eval "$@"; fi; }
ok=0; fail=0; warn=0

check() {
  local label="$1"; shift
  if result=$(run "$@" 2>/dev/null); then
    echo -e "  ${PASS} ${label}: ${result}"
    ((ok++))
  else
    echo -e "  ${FAIL} ${label}: FAILED"
    ((fail++))
  fi
}

checkwarn() {
  local label="$1"; shift
  if result=$(run "$@" 2>/dev/null); then
    echo -e "  ${PASS} ${label}: ${result}"
    ((ok++))
  else
    echo -e "  ${WARN} ${label}: NOT AVAILABLE"
    ((warn++))
  fi
}

echo ""
echo -e "${CYAN}── Services ──${NC}"
check "API V2 (:3333)" "curl -sf http://${HOST}:3333/api/v2/health | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get(\"data\",{}).get(\"app\",\"?\"))'"
check "PostgreSQL" "docker exec kxkm_clown-postgres-1 pg_isready -q && echo 'ready'"
check "Ollama (:11434)" "curl -sf http://${HOST}:11434/api/tags | python3 -c 'import sys,json; d=json.load(sys.stdin); print(len(d.get(\"models\",[])),\"models\")'"
checkwarn "SearXNG (:8080)" "curl -sf 'http://${HOST}:8080/search?q=test&format=json' -H 'Accept: application/json' | python3 -c 'import sys,json; d=json.load(sys.stdin); print(len(d.get(\"results\",[])),\"results\")'"
checkwarn "TTS Sidecar (:9100)" "curl -sf http://${HOST}:9100/health | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get(\"backend\",\"?\"))'"
checkwarn "Chatterbox (:9200)" "curl -sf http://${HOST}:9200/health | python3 -c 'import sys,json; d=json.load(sys.stdin); print(\"GPU docker\")'"
checkwarn "LightRAG (:9621)" "curl -sf http://${HOST}:9621/health | head -c 50"

echo ""
echo -e "${CYAN}── Docker Containers ──${NC}"
check "Containers" "docker ps --format '{{.Names}}: {{.Status}}' | grep -c 'Up' | xargs -I{} echo '{} running'"

echo ""
echo -e "${CYAN}── Data ──${NC}"
check "Chat logs" "ls -1 data/chat-logs/v2-*.jsonl 2>/dev/null | wc -l | xargs -I{} echo '{} log files'"
check "Context store" "ls -1 data/context/*.jsonl 2>/dev/null | wc -l | xargs -I{} echo '{} channels'"
check "Media images" "ls -1 data/media/images/*.png 2>/dev/null | wc -l | xargs -I{} echo '{} images'"
check "Media audio" "ls -1 data/media/audio/*.wav 2>/dev/null | wc -l | xargs -I{} echo '{} audio files'"
check "Persona memory" "ls -1 data/persona-memory/*.json 2>/dev/null | wc -l | xargs -I{} echo '{} personas with memory'"

echo ""
echo -e "${CYAN}── API Endpoints ──${NC}"
check "Session login" "curl -sf -X POST http://${HOST}:3333/api/session/login -H 'Content-Type: application/json' -d '{\"username\":\"healthcheck\",\"role\":\"viewer\"}' | python3 -c 'import sys,json; print(json.load(sys.stdin).get(\"ok\",False))'"
check "Personas list" "curl -sf -c /tmp/hc.txt -X POST http://${HOST}:3333/api/session/login -H 'Content-Type: application/json' -d '{\"username\":\"hc\"}' > /dev/null && curl -sf -b /tmp/hc.txt http://${HOST}:3333/api/personas | python3 -c 'import sys,json; d=json.load(sys.stdin); print(len(d.get(\"data\",[])),\"personas\")'"
check "Media images API" "curl -sf -b /tmp/hc.txt http://${HOST}:3333/api/v2/media/images | python3 -c 'import sys,json; d=json.load(sys.stdin); print(len(d.get(\"data\",[])),\"images\")'"
check "Node Engine" "curl -sf -c /tmp/hcadm.txt -X POST http://${HOST}:3333/api/session/login -H 'Content-Type: application/json' -d '{\"username\":\"admin\",\"role\":\"admin\",\"token\":\"kxkm\"}' > /dev/null && curl -sf -b /tmp/hcadm.txt http://${HOST}:3333/api/admin/node-engine/overview | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d[\"data\"][\"registry\"][\"models\"],\"models\")'"

echo ""
echo -e "${CYAN}── GPU ──${NC}"
checkwarn "NVIDIA GPU" "nvidia-smi --query-gpu=name,memory.used,memory.total --format=csv,noheader,nounits | head -1"

echo ""
echo -e "${CYAN}── Disk ──${NC}"
check "Disk usage" "df -h / | tail -1 | awk '{print \$3\"/\"\$2\" used (\"\$5\")\"}'"
check "Data dir size" "du -sh data/ 2>/dev/null | cut -f1 | xargs -I{} echo '{} total'"

echo ""
echo -e "═══════════════════════════════════════"
echo -e "  ${GREEN}${ok} passed${NC}  ${RED}${fail} failed${NC}  ${YELLOW}${warn} warnings${NC}"
echo -e "═══════════════════════════════════════"

[[ $fail -eq 0 ]] && exit 0 || exit 1
