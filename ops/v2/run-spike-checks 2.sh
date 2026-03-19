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
  documents-search  Run the search / document parsing spike checks
  all               Run both spike rails and write a combined summary
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

summarize() {
  local ts="$1"
  local mode="$2"
  local voice_status="$3"
  local docs_status="$4"
  local voice_log="$5"
  local docs_log="$6"
  local summary_file="$OUTPUT_DIR/summary-${mode}-${ts}.md"
  local manifest_file="$OUTPUT_DIR/manifest-${mode}-${ts}.json"

  mkdir -p "$OUTPUT_DIR"

  python3 - "$summary_file" "$manifest_file" "$ts" "$mode" "$voice_status" "$docs_status" "$voice_log" "$docs_log" <<'PY'
import json
import pathlib
import sys
from datetime import datetime, timezone

summary_path = pathlib.Path(sys.argv[1])
manifest_path = pathlib.Path(sys.argv[2])
timestamp = sys.argv[3]
mode = sys.argv[4]
voice_status = sys.argv[5]
docs_status = sys.argv[6]
voice_log = sys.argv[7]
docs_log = sys.argv[8]

summary_lines = [
    f"# Spike Summary {mode} {timestamp}",
    "",
    f"- Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}",
    f"- Voice / MCP smoke: {voice_status}",
    f"- Documents / Search smoke: {docs_status}",
    "",
    "## Logs",
]

if voice_log:
    summary_lines.append(f"- voice-mcp: {voice_log}")
if docs_log:
    summary_lines.append(f"- documents-search: {docs_log}")

summary_path.write_text("\n".join(summary_lines) + "\n", encoding="utf-8")

manifest = {
    "timestamp": timestamp,
    "mode": mode,
    "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "checks": {
        "voice-mcp": voice_status,
        "documents-search": docs_status,
    },
    "logs": {
        "voice-mcp": voice_log,
        "documents-search": docs_log,
    },
    "summary": str(summary_path),
}

manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
PY

  log "summary -> $(basename "$summary_file")"
  log "manifest -> $(basename "$manifest_file")"
}

run_voice() {
  local ts="$1"
  VOICE_LOGFILE="$LOG_DIR/voice-mcp-smoke-$ts.log"
  run_cmd "voice-mcp smoke" "$VOICE_LOGFILE" npm --prefix "$ROOT_DIR" run -s smoke:voice-mcp
}

run_documents() {
  local ts="$1"
  DOCS_LOGFILE="$LOG_DIR/documents-search-smoke-$ts.log"
  run_cmd "documents-search smoke" "$DOCS_LOGFILE" npm --prefix "$ROOT_DIR" run -s smoke:documents-search
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
  voice-mcp|documents-search|all|help) ;;
  *) usage; die "unknown subcommand: $SUBCOMMAND" ;;
esac

if [[ "$SUBCOMMAND" == "help" ]]; then
  usage
  exit 0
fi

mkdir -p "$LOG_DIR" "$OUTPUT_DIR"
ts="$(date +%Y%m%d-%H%M%S)"
voice_status="skipped"
docs_status="skipped"
voice_log=""
docs_log=""
VOICE_LOGFILE=""
DOCS_LOGFILE=""

if [[ "$SUBCOMMAND" == "voice-mcp" || "$SUBCOMMAND" == "all" ]]; then
  if run_voice "$ts"; then
    voice_status="ok"
  else
    voice_status="fail"
  fi
  voice_log="$VOICE_LOGFILE"
fi

if [[ "$SUBCOMMAND" == "documents-search" || "$SUBCOMMAND" == "all" ]]; then
  if run_documents "$ts"; then
    docs_status="ok"
  else
    docs_status="fail"
  fi
  docs_log="$DOCS_LOGFILE"
fi

summarize "$ts" "$SUBCOMMAND" "$voice_status" "$docs_status" "$voice_log" "$docs_log"

if [[ "$SUBCOMMAND" == "all" ]]; then
  log "sync docs from canonical pipeline"
  python3 "$ROOT_DIR/scripts/orchestrate_batches.py" status --root "$OPS_DIR" >/dev/null
fi

if [[ "$voice_status" == "fail" || "$docs_status" == "fail" ]]; then
  exit 1
fi
