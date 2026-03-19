#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OPS_DIR="$ROOT_DIR/ops/v2"
LOG_DIR="$OPS_DIR/logs"
OUTPUT_DIR="$OPS_DIR/outputs/spikes"
JSON_MODE=0
VERBOSE=0
YES=0

usage() {
  cat <<'EOF'
Usage: ops/v2/run-spike-checks.sh <subcommand> [options]

Subcommands:
  voice-mcp         Run the voice / MCP spike smoke checks
  voice-clone       Run the XTTS / voice-cloning readiness checks
  documents-search  Run the search / document parsing spike checks
  embeddings        Run the embeddings runtime checks
  all               Run every spike rail and write a combined summary
  help              Show this help

Options:
  --json            Emit machine-readable log lines where possible
  --verbose         Print executed commands
  --yes             Accepted for CLI parity (no prompt in this script)
  --help            Show this help
EOF
}

log() {
  local message="$1"
  if [[ "$JSON_MODE" -eq 1 ]]; then
    python3 - "$message" <<'PY'
import json
import sys
print(json.dumps({"level": "info", "msg": sys.argv[1]}))
PY
  else
    printf '[spike-checks] %s\n' "$message"
  fi
}

die() {
  local message="$1"
  if [[ "$JSON_MODE" -eq 1 ]]; then
    python3 - "$message" <<'PY'
import json
import sys
print(json.dumps({"level": "error", "msg": sys.argv[1]}))
PY
  else
    printf '[spike-checks] error: %s\n' "$message" >&2
  fi
  exit 1
}

run_cmd() {
  local label="$1"
  local logfile="$2"
  shift 2
  mkdir -p "$(dirname "$logfile")"
  if [[ "$VERBOSE" -eq 1 ]]; then
    log "$label -> $*"
  else
    log "$label"
  fi
  if "$@" >"$logfile" 2>&1; then
    log "$label ok -> $(basename "$logfile")"
    return 0
  fi
  log "$label failed -> $(basename "$logfile")"
  tail -n 40 "$logfile" >&2 || true
  return 1
}

run_voice_mcp() {
  local ts="$1"
  VOICE_MCP_LOGFILE="$LOG_DIR/voice-mcp-smoke-$ts.log"
  run_cmd "voice-mcp smoke" "$VOICE_MCP_LOGFILE" npm --prefix "$ROOT_DIR" run -s smoke:voice-mcp
}

run_voice_clone() {
  local ts="$1"
  VOICE_CLONE_LOGFILE="$LOG_DIR/voice-clone-smoke-$ts.log"
  run_cmd "voice-clone smoke" "$VOICE_CLONE_LOGFILE" npm --prefix "$ROOT_DIR" run -s smoke:voice-clone
}

run_documents() {
  local ts="$1"
  DOCS_LOGFILE="$LOG_DIR/documents-search-smoke-$ts.log"
  run_cmd "documents-search smoke" "$DOCS_LOGFILE" npm --prefix "$ROOT_DIR" run -s smoke:documents-search
}

run_embeddings() {
  local ts="$1"
  EMBEDDINGS_LOGFILE="$LOG_DIR/embeddings-smoke-$ts.log"
  run_cmd "embeddings smoke" "$EMBEDDINGS_LOGFILE" npm --prefix "$ROOT_DIR" run -s smoke:embeddings
}

summarize() {
  local ts="$1"
  local mode="$2"
  local voice_mcp_status="$3"
  local voice_clone_status="$4"
  local docs_status="$5"
  local embeddings_status="$6"
  local voice_mcp_log="$7"
  local voice_clone_log="$8"
  local docs_log="$9"
  local embeddings_log="${10}"
  local summary_file="$OUTPUT_DIR/summary-${mode}-${ts}.md"
  local manifest_file="$OUTPUT_DIR/manifest-${mode}-${ts}.json"

  mkdir -p "$OUTPUT_DIR"

  python3 - "$summary_file" "$manifest_file" "$ts" "$mode" "$voice_mcp_status" "$voice_clone_status" "$docs_status" "$embeddings_status" "$voice_mcp_log" "$voice_clone_log" "$docs_log" "$embeddings_log" <<'PY'
import json
import pathlib
import sys
from datetime import datetime, timezone

summary_path = pathlib.Path(sys.argv[1])
manifest_path = pathlib.Path(sys.argv[2])
timestamp = sys.argv[3]
mode = sys.argv[4]
voice_mcp_status = sys.argv[5]
voice_clone_status = sys.argv[6]
docs_status = sys.argv[7]
embeddings_status = sys.argv[8]
voice_mcp_log = sys.argv[9]
voice_clone_log = sys.argv[10]
docs_log = sys.argv[11]
embeddings_log = sys.argv[12]

summary_lines = [
    f"# Spike Summary {mode} {timestamp}",
    "",
    f"- Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}",
    f"- Voice / MCP smoke: {voice_mcp_status}",
    f"- Voice cloning smoke: {voice_clone_status}",
    f"- Documents / Search smoke: {docs_status}",
    f"- Embeddings smoke: {embeddings_status}",
    "",
    "## Logs",
]

logs = {
    "voice-mcp": voice_mcp_log,
    "voice-clone": voice_clone_log,
    "documents-search": docs_log,
    "embeddings": embeddings_log,
}
for name, value in logs.items():
    if value:
        summary_lines.append(f"- {name}: {value}")

summary_path.write_text("\n".join(summary_lines) + "\n", encoding="utf-8")

manifest = {
    "timestamp": timestamp,
    "mode": mode,
    "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "checks": {
        "voice-mcp": voice_mcp_status,
        "voice-clone": voice_clone_status,
        "documents-search": docs_status,
        "embeddings": embeddings_status,
    },
    "logs": logs,
    "summary": str(summary_path),
}

manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
PY

  log "summary -> $(basename "$summary_file")"
  log "manifest -> $(basename "$manifest_file")"
}

SUBCOMMAND="${1:-all}"
if [[ $# -gt 0 ]]; then
  shift
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) JSON_MODE=1 ;;
    --verbose) VERBOSE=1 ;;
    --yes) YES=1 ;;
    --help|-h) usage; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done

case "$SUBCOMMAND" in
  voice-mcp|voice-clone|documents-search|embeddings|all|help) ;;
  *) usage; die "unknown subcommand: $SUBCOMMAND" ;;
esac

if [[ "$SUBCOMMAND" == "help" ]]; then
  usage
  exit 0
fi

mkdir -p "$LOG_DIR" "$OUTPUT_DIR"
ts="$(date +%Y%m%d-%H%M%S)"
voice_mcp_status="skipped"
voice_clone_status="skipped"
docs_status="skipped"
embeddings_status="skipped"
voice_mcp_log=""
voice_clone_log=""
docs_log=""
embeddings_log=""
VOICE_MCP_LOGFILE=""
VOICE_CLONE_LOGFILE=""
DOCS_LOGFILE=""
EMBEDDINGS_LOGFILE=""

if [[ "$SUBCOMMAND" == "voice-mcp" || "$SUBCOMMAND" == "all" ]]; then
  if run_voice_mcp "$ts"; then
    voice_mcp_status="ok"
  else
    voice_mcp_status="fail"
  fi
  voice_mcp_log="$VOICE_MCP_LOGFILE"
fi

if [[ "$SUBCOMMAND" == "voice-clone" || "$SUBCOMMAND" == "all" ]]; then
  if run_voice_clone "$ts"; then
    voice_clone_status="ok"
  else
    voice_clone_status="fail"
  fi
  voice_clone_log="$VOICE_CLONE_LOGFILE"
fi

if [[ "$SUBCOMMAND" == "documents-search" || "$SUBCOMMAND" == "all" ]]; then
  if run_documents "$ts"; then
    docs_status="ok"
  else
    docs_status="fail"
  fi
  docs_log="$DOCS_LOGFILE"
fi

if [[ "$SUBCOMMAND" == "embeddings" || "$SUBCOMMAND" == "all" ]]; then
  if run_embeddings "$ts"; then
    embeddings_status="ok"
  else
    embeddings_status="fail"
  fi
  embeddings_log="$EMBEDDINGS_LOGFILE"
fi

summarize "$ts" "$SUBCOMMAND" "$voice_mcp_status" "$voice_clone_status" "$docs_status" "$embeddings_status" "$voice_mcp_log" "$voice_clone_log" "$docs_log" "$embeddings_log"

if [[ "$SUBCOMMAND" == "all" ]]; then
  log "sync docs from canonical pipeline"
  python3 "$ROOT_DIR/scripts/orchestrate_batches.py" status --root "$OPS_DIR" >/dev/null
fi

if [[ "$voice_mcp_status" == "fail" || "$voice_clone_status" == "fail" || "$docs_status" == "fail" || "$embeddings_status" == "fail" ]]; then
  exit 1
fi
