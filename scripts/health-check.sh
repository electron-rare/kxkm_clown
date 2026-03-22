#!/bin/bash
# 3615-KXKM Health Check TUI
set -uo pipefail
HOST="${KXKM_HOST:-kxkm@kxkm-ai}"
PASS=0; FAIL=0
G="\033[32m"; R="\033[31m"; C="\033[36m"; N="\033[0m"

check() {
  local name="$1" cmd="$2" expect="${3:-}"
  local result
  result=$(ssh "$HOST" "$cmd" 2>/dev/null) || result="UNREACHABLE"
  if [[ -n "$expect" ]] && echo "$result" | grep -q "$expect"; then
    printf "  ${G}OK${N}  %-25s %s\n" "$name" "$(echo "$result" | head -1 | cut -c1-60)"
    PASS=$((PASS+1))
  elif [[ -z "$expect" ]] && [[ "$result" != "UNREACHABLE" ]]; then
    printf "  ${G}OK${N}  %-25s %s\n" "$name" "$(echo "$result" | head -1 | cut -c1-60)"
    PASS=$((PASS+1))
  else
    printf "  ${R}FAIL${N} %-25s %s\n" "$name" "$(echo "$result" | head -1 | cut -c1-60)"
    FAIL=$((FAIL+1))
  fi
}

echo -e "\n${C}=== 3615-KXKM Health Check ===${N}\n"
echo -e "${C}Docker${N}"
check "API" "docker ps --format '{{.Names}} {{.Status}}' | grep kxkm_clown-api" "Up"
check "Worker" "docker ps --format '{{.Names}} {{.Status}}' | grep worker" "Up"
check "Discord" "docker ps --format '{{.Names}} {{.Status}}' | grep discord" "Up"
check "PostgreSQL" "docker ps --format '{{.Names}} {{.Status}}' | grep postgres" "healthy"
check "SearXNG" "docker ps --format '{{.Names}} {{.Status}}' | grep kxkm_clown-searxng" "healthy"
check "Docling" "docker ps --format '{{.Names}} {{.Status}}' | grep docling" "healthy"
check "Mascarade" "docker ps --format '{{.Names}} {{.Status}}' | grep mascarade-core" "healthy"

echo -e "\n${C}Services${N}"
check "Ollama" "curl -s localhost:11434/api/tags | python3 -c 'import json,sys;d=json.load(sys.stdin);print(len(d.get(\"models\",[])),\"models\")'"
check "AI Bridge" "curl -s localhost:8301/health | python3 -c 'import json,sys;d=json.load(sys.stdin);print(len(d[\"backends\"]),\"backends\")'"
check "Kokoro TTS" "curl -s localhost:9201/health | python3 -c 'import json,sys;print(json.load(sys.stdin)[\"service\"])'" "kokoro"
check "TTS Piper" "curl -s localhost:9100/health | python3 -c 'import json,sys;print(json.load(sys.stdin)[\"backend\"])'"
check "LightRAG" "curl -s localhost:9621/health | python3 -c 'import json,sys;print(json.load(sys.stdin)[\"status\"])'" "healthy"
check "openDIAW.be" "curl -s localhost:3333/daw/ | grep -o 'openDIAW'"

echo -e "\n${C}API${N}"
check "Health" "curl -s localhost:3333/api/v2/health | python3 -c 'import json,sys;print(\"ok\" if json.load(sys.stdin)[\"ok\"] else \"fail\")'" "ok"
check "Prometheus" "curl -s localhost:3333/metrics | head -1" "kxkm"
check "A2A" "curl -s localhost:3333/.well-known/agent.json | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d[\"name\"],len(d[\"skills\"]),\"skills\")'" "3615"
check "Chat pause" "test -f /tmp/chat-paused 2>/dev/null && echo PAUSED || docker exec kxkm_clown-api-1 test -f /app/data/chat-paused 2>/dev/null && echo PAUSED || echo ACTIVE"

echo -e "\n${C}GPU${N}"
check "NVIDIA" "nvidia-smi --query-gpu=name,memory.used,memory.total --format=csv,noheader,nounits | head -1"
check "Cron audit" "crontab -l 2>/dev/null | grep -c deep-audit" 

echo -e "\n${C}===============================${N}"
printf "  ${G}PASS: %d${N}  ${R}FAIL: %d${N}\n\n" "$PASS" "$FAIL"
[[ $FAIL -gt 0 ]] && exit 1 || exit 0
