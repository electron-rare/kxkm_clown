#!/usr/bin/env bash
set -euo pipefail

OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434}"
JSON_MODE=0
STRICT=0
VERBOSE=0
RUN_BENCH=0

usage() {
  cat <<'EOF'
Usage: scripts/health-embeddings.sh [options]

Checks Ollama embedding model availability and optionally runs the local benchmark.

Options:
  --ollama-url URL   Ollama base URL (default: $OLLAMA_URL or http://localhost:11434)
  --bench            Run scripts/bench-embeddings.js when the candidate models are present
  --strict           Exit non-zero unless Ollama is reachable and bge-m3 is available
  --json             Emit JSON lines
  --verbose          Print probe details
  --yes              Accepted for CLI parity
  --help             Show this help
EOF
}

log() {
  local message="$1"
  if [[ "$JSON_MODE" -eq 1 ]]; then
    python3 - "$message" <<'PY'
import json, sys
print(json.dumps({"level": "info", "msg": sys.argv[1]}))
PY
  else
    printf '[health-embeddings] %s\n' "$message"
  fi
}

warn() {
  local message="$1"
  if [[ "$JSON_MODE" -eq 1 ]]; then
    python3 - "$message" <<'PY'
import json, sys
print(json.dumps({"level": "warn", "msg": sys.argv[1]}))
PY
  else
    printf '[health-embeddings] warn: %s\n' "$message" >&2
  fi
}

die() {
  local message="$1"
  if [[ "$JSON_MODE" -eq 1 ]]; then
    python3 - "$message" <<'PY'
import json, sys
print(json.dumps({"level": "error", "msg": sys.argv[1]}))
PY
  else
    printf '[health-embeddings] error: %s\n' "$message" >&2
  fi
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ollama-url)
      shift
      [[ $# -gt 0 ]] || die "--ollama-url requires a value"
      OLLAMA_URL="$1"
      ;;
    --bench) RUN_BENCH=1 ;;
    --strict) STRICT=1 ;;
    --json) JSON_MODE=1 ;;
    --verbose) VERBOSE=1 ;;
    --yes) ;;
    --help|-h) usage; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done

log "ollama-url=$OLLAMA_URL"

probe_output="$(python3 - "$OLLAMA_URL" "$JSON_MODE" <<'PY'
import json
import sys
import urllib.error
import urllib.request

base = sys.argv[1].rstrip("/")
json_mode = sys.argv[2] == "1"
payload = {
    "check": "embeddings-runtime",
    "ok": False,
    "ollama_url": base,
    "models": [],
    "has_nomic_embed_text": False,
    "has_bge_m3": False,
    "error": None,
}

try:
    with urllib.request.urlopen(f"{base}/api/tags", timeout=5) as response:
        body = json.loads(response.read().decode("utf-8"))
        models = [entry.get("name", "") for entry in body.get("models", [])]
        payload["models"] = models
        payload["has_nomic_embed_text"] = any(name.startswith("nomic-embed-text") for name in models)
        payload["has_bge_m3"] = any(name.startswith("bge-m3") for name in models)
        payload["ok"] = payload["has_nomic_embed_text"] or payload["has_bge_m3"]
except Exception as exc:
    payload["error"] = str(exc)

print(json.dumps(payload))
PY
)"

printf '%s\n' "$probe_output"

if [[ "$STRICT" -eq 1 ]]; then
  has_bge="$(printf '%s\n' "$probe_output" | python3 -c 'import json,sys; print("yes" if json.load(sys.stdin).get("has_bge_m3") else "no")')"
  if [[ "$has_bge" != "yes" ]]; then
    die "bge-m3 not available from Ollama"
  fi
fi

if [[ "$RUN_BENCH" -eq 1 ]]; then
  if node scripts/bench-embeddings.js --json --ollama-url "$OLLAMA_URL"; then
    exit 0
  fi
  if [[ "$STRICT" -eq 1 ]]; then
    die "embedding benchmark failed"
  fi
  warn "embedding benchmark failed; ensure Ollama and candidate models are installed"
fi

if [[ "$STRICT" -eq 0 ]]; then
  has_bge="$(printf '%s\n' "$probe_output" | python3 -c 'import json,sys; print("yes" if json.load(sys.stdin).get("has_bge_m3") else "no")')"
  if [[ "$has_bge" != "yes" ]]; then
    warn "bge-m3 is not installed in Ollama; pull it before strict benchmarking"
  fi
fi

exit 0
