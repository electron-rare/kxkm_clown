#!/bin/bash
# ═══════════════════════════════════════════════════════════
# Deep instrument test suite — runs on kxkm-ai server
# Tests all 9 openDIAW.be instruments + AI Bridge endpoints
# ═══════════════════════════════════════════════════════════
set -euo pipefail

API="http://localhost:3333"
BRIDGE="http://localhost:8301"
PASS=0
FAIL=0
ERRORS=""

test_endpoint() {
  local name="$1" url="$2" data="$3" expect_type="${4:-audio/wav}"
  local tmp="/tmp/test-inst-${name}.out"
  local http_code
  http_code=$(curl -s -o "$tmp" -w "%{http_code}" -X POST "$url" \
    -H "Content-Type: application/json" -d "$data" --max-time 60 2>/dev/null || echo "000")

  if [[ "$http_code" == "200" ]]; then
    local size=$(wc -c < "$tmp")
    local ct=$(file -b "$tmp" | head -1)
    if [[ "$size" -gt 100 ]] && [[ "$ct" == *"RIFF"* || "$ct" == *"WAV"* || "$ct" == *"data"* ]]; then
      echo "  ✓ $name (${size}B, HTTP $http_code)"
      PASS=$((PASS + 1))
    else
      echo "  ✗ $name — HTTP $http_code but invalid content (${size}B, $ct)"
      FAIL=$((FAIL + 1))
      ERRORS="$ERRORS\n  - $name: invalid content"
      cat "$tmp" 2>/dev/null | head -1
    fi
  else
    echo "  ✗ $name — HTTP $http_code"
    FAIL=$((FAIL + 1))
    ERRORS="$ERRORS\n  - $name: HTTP $http_code"
    cat "$tmp" 2>/dev/null | head -1
  fi
  rm -f "$tmp"
}

test_get() {
  local name="$1" url="$2" expect="$3"
  local resp
  resp=$(curl -s "$url" --max-time 10 2>/dev/null || echo "FAIL")
  if echo "$resp" | grep -q "$expect"; then
    echo "  ✓ $name"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $name — missing '$expect'"
    FAIL=$((FAIL + 1))
    ERRORS="$ERRORS\n  - $name: missing '$expect'"
  fi
}

echo "═══ AI Bridge Health ═══"
test_get "health" "$BRIDGE/health" '"ok":true'
test_get "backends>=18" "$BRIDGE/health" '"drone"'
test_get "backends:honk" "$BRIDGE/health" '"honk"'
test_get "backends:voice-clone" "$BRIDGE/health" '"voice-clone"'

echo ""
echo "═══ AI Bridge Instruments (ffmpeg) ═══"
test_endpoint "drone" "$BRIDGE/instrument/drone" '{"note":"C2","duration":2,"voices":3,"waveform":"saw"}'
test_endpoint "circus" "$BRIDGE/instrument/circus" '{"notes":"C4,E4,G4","duration":2,"register":"principal"}'
test_endpoint "honk-klaxon" "$BRIDGE/instrument/honk" '{"mode":"klaxon","duration":2}'
test_endpoint "honk-siren" "$BRIDGE/instrument/honk" '{"mode":"siren","duration":2}'
test_endpoint "honk-horn" "$BRIDGE/instrument/honk" '{"mode":"horn","duration":2}'
test_endpoint "glitch" "$BRIDGE/instrument/glitch" '{"duration":3,"bpm":140,"crushBits":6}'
test_endpoint "grain" "$BRIDGE/instrument/grain" '{"source":"noise","duration":3,"density":10}'

echo ""
echo "═══ AI Bridge Generation ═══"
test_endpoint "noise-pink" "$BRIDGE/generate/noise" '{"type":"pink","duration":2}'
test_endpoint "noise-drone" "$BRIDGE/generate/noise" '{"type":"drone","duration":2}'
test_endpoint "sound-design-impact" "$BRIDGE/generate/sound-design" '{"category":"impact","duration":2}'
test_endpoint "sound-design-texture" "$BRIDGE/generate/sound-design" '{"category":"texture","duration":2}'

echo ""
echo "═══ Kokoro TTS ═══"
test_endpoint "kokoro-heart" "$BRIDGE/generate/voice-fast" '{"text":"Bonjour test","voice":"af_heart"}'
test_endpoint "kokoro-adam" "$BRIDGE/generate/voice-fast" '{"text":"Hello world","voice":"am_adam"}'

echo ""
echo "═══ API Proxy ═══"
test_get "proxy-health" "$API/api/v2/ai-bridge/health" '"ok":true'
test_get "agent-card" "$API/.well-known/agent.json" '"3615-KXKM"'
test_get "metrics" "$API/metrics" "kxkm_memory_rss_bytes"

echo ""
echo "═══ openDIAW.be Studio ═══"
test_get "daw-index" "$API/daw/" "openDIAW.be"

# Check processor bundle for all 9 instruments
PROC_FILE=$(ls /home/kxkm/openDAW/packages/app/studio/dist/processors.*.js 2>/dev/null | head -1)
if [[ -n "$PROC_FILE" ]]; then
  MISSING=""
  for inst in Drone Grain Glitch Circus Honk Magenta AceStep KokoroTts Piper; do
    if ! grep -q "visit${inst}DeviceBox" "$PROC_FILE"; then
      MISSING="$MISSING $inst"
    fi
  done
  if [[ -z "$MISSING" ]]; then
    echo "  ✓ processor-bundle (9/9 instruments)"
    PASS=$((PASS + 1))
  else
    echo "  ✗ processor-bundle — missing:$MISSING"
    FAIL=$((FAIL + 1))
    ERRORS="$ERRORS\n  - processor-bundle: missing$MISSING"
  fi
else
  echo "  ✗ processor-bundle — dist not found"
  FAIL=$((FAIL + 1))
fi

# Check main bundle
MAIN_FILE=$(ls /home/kxkm/openDAW/packages/app/studio/dist/main.*.js 2>/dev/null | head -1)
if [[ -n "$MAIN_FILE" ]]; then
  MISSING=""
  for inst in Drone Grain Glitch Circus Honk Magenta AceStep KokoroTts Piper; do
    if ! grep -q "visit${inst}DeviceBox" "$MAIN_FILE"; then
      MISSING="$MISSING $inst"
    fi
  done
  if [[ -z "$MISSING" ]]; then
    echo "  ✓ main-bundle (9/9 instruments)"
    PASS=$((PASS + 1))
  else
    echo "  ✗ main-bundle — missing:$MISSING"
    FAIL=$((FAIL + 1))
    ERRORS="$ERRORS\n  - main-bundle: missing$MISSING"
  fi
fi

echo ""
echo "═══════════════════════════════════════"
echo "  RESULTS: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════"
if [[ $FAIL -gt 0 ]]; then
  echo -e "  FAILURES:$ERRORS"
  exit 1
fi
