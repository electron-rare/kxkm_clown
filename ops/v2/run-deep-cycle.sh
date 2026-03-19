#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OPS_DIR="$ROOT_DIR/ops/v2"
LOG_DIR="$OPS_DIR/logs"
OUTPUT_DIR="$OPS_DIR/outputs/deep-cycles"
LOCK_DIR="$OPS_DIR/.locks"
CYCLE_LOCK_DIR="$LOCK_DIR/deep-cycle.run.lock"
KEEP_DAYS="${KEEP_DAYS:-7}"
EMPTY_LOG_GRACE_SECONDS="${EMPTY_LOG_GRACE_SECONDS:-300}"
JSON_MODE=0
VERBOSE=0
YES=0

usage() {
  cat <<'EOF'
Usage: ops/v2/run-deep-cycle.sh <subcommand> [options]

Subcommands:
  run         Execute deep-audit + check:v2 + test:v2, then summarize and prune
  summarize   Build manifest + markdown summary from a timestamp or latest run
  prune       Delete empty logs and logs older than retention policy
  sync-docs   Refresh PLAN/TODO/STATUS from ops/v2/pipeline.json
  help        Show this help

Options:
  --json           Emit machine-readable status lines where possible
  --verbose        Print executed commands
  --yes            Skip confirmation prompts for destructive maintenance
  --keep-days N    Override retention policy (default: 7)
  --timestamp TS   Target a specific cycle timestamp for summarize
  --help           Show this help
EOF
}

log() {
  if [[ "$JSON_MODE" -eq 1 ]]; then
    printf '{"level":"info","msg":%s}\n' "$(printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
  else
    printf '[deep-cycle] %s\n' "$1"
  fi
}

die() {
  >&2 printf '[deep-cycle] error: %s\n' "$1"
  exit 1
}

acquire_cycle_lock() {
  mkdir -p "$LOCK_DIR"
  if mkdir "$CYCLE_LOCK_DIR" 2>/dev/null; then
    printf '%s\n' "$$" >"$CYCLE_LOCK_DIR/pid"
    return 0
  fi

  local owner="unknown"
  if [[ -f "$CYCLE_LOCK_DIR/pid" ]]; then
    owner="$(<"$CYCLE_LOCK_DIR/pid")"
  fi
  die "another deep-cycle is already running (lock owner: $owner)"
}

release_cycle_lock() {
  rm -rf "$CYCLE_LOCK_DIR"
}

require_confirmation() {
  local prompt="$1"
  if [[ "$YES" -eq 1 ]]; then
    return 0
  fi
  if [[ ! -t 0 ]]; then
    die "$prompt (rerun with --yes in non-interactive mode)"
  fi
  printf '%s [y/N] ' "$prompt" >&2
  read -r answer
  [[ "$answer" =~ ^[Yy]$ ]]
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

hash_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    cksum "$1" | awk '{print $1}'
  fi
}

latest_timestamp() {
  local latest
  latest="$(find "$LOG_DIR" -maxdepth 1 -type f \( -name 'deep-audit-*.json' -o -name 'check-v2-*.log' -o -name 'test-v2-*.log' \) \
    | sed -E 's#.*/(deep-audit|check-v2|test-v2)-([0-9]{8}-[0-9]{6})\..*#\2#' \
    | sort | tail -n 1)"
  [[ -n "$latest" ]] || die "no cycle logs found in $LOG_DIR"
  printf '%s\n' "$latest"
}

sync_docs() {
  log "sync docs from canonical pipeline"
  python3 "$ROOT_DIR/scripts/orchestrate_batches.py" status --root "$OPS_DIR"
}

prune_logs() {
  mkdir -p "$LOG_DIR"
  if [[ "$YES" -ne 1 ]]; then
    require_confirmation "Prune empty logs and logs older than $KEEP_DAYS days?" || {
      log "prune cancelled"
      return 0
    }
  fi

  log "prune stale empty logs (>${EMPTY_LOG_GRACE_SECONDS}s)"
  python3 - "$LOG_DIR" "$EMPTY_LOG_GRACE_SECONDS" <<'PY'
import pathlib
import sys
import time

log_dir = pathlib.Path(sys.argv[1])
grace_seconds = int(sys.argv[2])
now = time.time()

for path in sorted(log_dir.rglob("*")):
    if not path.is_file():
        continue
    try:
        stat = path.stat()
    except FileNotFoundError:
        continue
    if stat.st_size != 0:
        continue
    age = now - stat.st_mtime
    if age <= grace_seconds:
        continue
    print(path)
    try:
        path.unlink()
    except FileNotFoundError:
        pass
PY

  log "prune logs older than $KEEP_DAYS days"
  find "$LOG_DIR" -type f -mtime "+$KEEP_DAYS" -print -delete || true

  prune_transient_artifacts
}

prune_transient_artifacts() {
  local pycache_dir="$ROOT_DIR/scripts/__pycache__"
  local removed=0

  if [[ -d "$pycache_dir" ]]; then
    log "prune transient artifact -> ${pycache_dir#$ROOT_DIR/}"
    rm -rf "$pycache_dir"
    removed=1
  fi

  if [[ -d "$ROOT_DIR/scripts" ]]; then
    local pyc_files=()
    while IFS= read -r pyc; do
      [[ -n "$pyc" ]] || continue
      pyc_files+=("$pyc")
    done < <(find "$ROOT_DIR/scripts" -type f -name '*.pyc' -print 2>/dev/null)

    if [[ "${#pyc_files[@]}" -gt 0 ]]; then
      log "prune transient .pyc files (${#pyc_files[@]})"
      printf '%s\n' "${pyc_files[@]}"
      find "$ROOT_DIR/scripts" -type f -name '*.pyc' -delete 2>/dev/null || true
      removed=1
    fi
  fi

  if [[ "$removed" -eq 0 ]]; then
    log "no transient script artifacts to prune"
  fi
}

summarize_cycle() {
  local ts="$1"
  mkdir -p "$OUTPUT_DIR"
  local audit_file="$LOG_DIR/deep-audit-$ts.json"
  local check_file="$LOG_DIR/check-v2-$ts.log"
  local test_file="$LOG_DIR/test-v2-$ts.log"
  local summary_file="$OUTPUT_DIR/summary-$ts.md"
  local manifest_file="$OUTPUT_DIR/manifest-$ts.json"

  [[ -f "$audit_file" ]] || die "missing audit file for $ts"
  [[ -f "$check_file" ]] || die "missing check:v2 log for $ts"
  [[ -f "$test_file" ]] || die "missing test:v2 log for $ts"

  log "build summary -> $(basename "$summary_file")"
  python3 - "$audit_file" "$check_file" "$test_file" "$summary_file" "$manifest_file" "$ts" "$KEEP_DAYS" <<'PY'
import hashlib
import json
import pathlib
import re
import sys
from datetime import datetime, timezone

audit_path = pathlib.Path(sys.argv[1])
check_path = pathlib.Path(sys.argv[2])
test_path = pathlib.Path(sys.argv[3])
summary_path = pathlib.Path(sys.argv[4])
manifest_path = pathlib.Path(sys.argv[5])
timestamp = sys.argv[6]
keep_days = int(sys.argv[7])

audit = json.loads(audit_path.read_text(encoding="utf-8"))
check_text = check_path.read_text(encoding="utf-8")
test_text = test_path.read_text(encoding="utf-8")

def find_status(text: str, ok_pattern: str, fail_pattern: str = "") -> str:
    if ok_pattern and re.search(ok_pattern, text, re.I):
        return "ok"
    if fail_pattern and re.search(fail_pattern, text, re.I):
        return "fail"
    return "unknown"

security = audit.get("security", [])
performance = audit.get("performance", [])
metrics = audit.get("metrics", [])
debt = audit.get("debt", {})

large_files = [item["file"] for item in metrics if item.get("flag") == "large"][:5]
open_findings = [
    {
        "severity": finding.get("severity", "P2"),
        "file": finding.get("file", ""),
        "line": finding.get("line", 0),
        "pattern": finding.get("pattern", ""),
    }
    for finding in (security + performance)[:10]
]

check_status = find_status(check_text, r'"ok"\s*:\s*true|0 errors|checked', r"error TS|failed")
test_status = find_status(test_text, r"All tests passed|pass\s+\d+", r"\bfail\b")

summary_lines = [
    f"# Deep Cycle Summary {timestamp}",
    "",
    f"- Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}",
    f"- Retention policy: {keep_days} days",
    f"- check:v2: {check_status}",
    f"- test:v2: {test_status}",
    f"- security findings: {len(security)}",
    f"- performance findings: {len(performance)}",
    f"- debt score: {debt.get('score', 'n/a')}/100 ({debt.get('level', 'n/a')})",
    "",
    "## Hotspots",
]

if large_files:
    summary_lines.extend([f"- {item}" for item in large_files])
else:
    summary_lines.append("- none")

summary_lines.extend(["", "## Open Findings"])
if open_findings:
    summary_lines.extend(
        [f"- {item['severity']} {item['file']}:{item['line']} — {item['pattern']}" for item in open_findings]
    )
else:
    summary_lines.append("- none")

summary_path.write_text("\n".join(summary_lines) + "\n", encoding="utf-8")

manifest = {
    "timestamp": timestamp,
    "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "files": {
        "audit": str(audit_path),
        "check": str(check_path),
        "test": str(test_path),
        "summary": str(summary_path),
    },
    "checks": {
        "check:v2": check_status,
        "test:v2": test_status,
    },
    "retained_logs": [
        str(audit_path),
        str(check_path),
        str(test_path),
    ],
    "counts": {
        "security": len(security),
        "performance": len(performance),
        "large_files": len([item for item in metrics if item.get("flag") == "large"]),
    },
    "debt": debt,
    "hotspots": large_files,
    "open_findings": open_findings,
    "backlog_links": [
        "lot-12-deep-audit/pipeline-canonique",
        "lot-12-deep-audit/deep-cycle-operator",
        "lot-12-deep-audit/ws-chat-seams",
        "lot-12-deep-audit/ui-contract",
        "lot-12-deep-audit/web-shell-convergence",
    ],
    "retention_days": keep_days,
    "hashes": {
        "audit_sha256": hashlib.sha256(audit_path.read_bytes()).hexdigest(),
        "check_sha256": hashlib.sha256(check_path.read_bytes()).hexdigest(),
        "test_sha256": hashlib.sha256(test_path.read_bytes()).hexdigest(),
    },
}
manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
PY
}

run_cycle() {
  acquire_cycle_lock
  trap release_cycle_lock EXIT
  mkdir -p "$LOG_DIR"
  local ts
  ts="$(date +%Y%m%d-%H%M%S)"
  local audit_file="$LOG_DIR/deep-audit-$ts.json"
  local check_file="$LOG_DIR/check-v2-$ts.log"
  local test_file="$LOG_DIR/test-v2-$ts.log"

  log "root=$ROOT_DIR"
  log "logs=$LOG_DIR"
  run_cmd "deep-audit" "$audit_file" node "$ROOT_DIR/ops/v2/deep-audit.js" --json
  run_cmd "check:v2" "$check_file" npm --prefix "$ROOT_DIR" run -s check:v2
  run_cmd "test:v2" "$test_file" npm --prefix "$ROOT_DIR" run -s test:v2
  summarize_cycle "$ts"
  YES=1 prune_logs
  sync_docs
  log "cycle done -> $ts"
  trap - EXIT
  release_cycle_lock
}

SUBCOMMAND="${1:-run}"
if [[ $# -gt 0 ]]; then
  shift
fi

TIMESTAMP=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) JSON_MODE=1 ;;
    --verbose) VERBOSE=1 ;;
    --yes) YES=1 ;;
    --keep-days)
      shift
      [[ $# -gt 0 ]] || die "--keep-days requires a value"
      KEEP_DAYS="$1"
      ;;
    --timestamp)
      shift
      [[ $# -gt 0 ]] || die "--timestamp requires a value"
      TIMESTAMP="$1"
      ;;
    --help|-h) usage; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done

case "$SUBCOMMAND" in
  run) run_cycle ;;
  summarize)
    summarize_cycle "${TIMESTAMP:-$(latest_timestamp)}"
    ;;
  prune) prune_logs ;;
  sync-docs) sync_docs ;;
  help) usage ;;
  *) usage; die "unknown subcommand: $SUBCOMMAND" ;;
esac
