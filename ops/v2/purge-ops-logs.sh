#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OPS_DIR="${ROOT_DIR}/ops/v2"
LOG_DIR="${OPS_DIR}/logs"
SUMMARY_LOG="${LOG_DIR}/purge-ops-logs.jsonl"
MAX_AGE_DAYS="${MAX_AGE_DAYS:-3}"
DRY_RUN=1
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
CANDIDATE_COUNT=0
TOTAL_BYTES=0
DELETED_COUNT=0
RESULT="ok"

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '%s' "$value"
}

write_summary() {
  local exit_code="$1"
  local mode="dry-run"
  local finished_at
  finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [[ "$DRY_RUN" -eq 0 ]]; then
    mode="delete"
  fi
  if [[ -d "$LOG_DIR" ]]; then
    printf '{"ts":"%s","run_id":"%s","mode":"%s","max_age_days":%s,"candidates":%s,"bytes":%s,"deleted":%s,"result":"%s","exit_code":%s}\n' \
      "$finished_at" \
      "$(json_escape "$RUN_ID")" \
      "$mode" \
      "$MAX_AGE_DAYS" \
      "$CANDIDATE_COUNT" \
      "$TOTAL_BYTES" \
      "$DELETED_COUNT" \
      "$(json_escape "$RESULT")" \
      "$exit_code" >> "$SUMMARY_LOG" || true
  fi
}

on_exit() {
  local exit_code="$1"
  trap - EXIT
  write_summary "$exit_code"
  exit "$exit_code"
}

trap 'on_exit $?' EXIT

for arg in "$@"; do
  case "$arg" in
    --yes) DRY_RUN=0 ;;
    --days=*) MAX_AGE_DAYS="${arg#*=}" ;;
    --help|-h)
      cat <<'EOF'
Usage: ops/v2/purge-ops-logs.sh [--days=N] [--yes]

Options:
  --days=N   Maximum age in days (default: 3)
  --yes      Delete files (default is dry-run)
EOF
      exit 0
      ;;
  esac
done

if [[ ! "$MAX_AGE_DAYS" =~ ^[0-9]+$ ]]; then
  echo "Invalid --days value: $MAX_AGE_DAYS" >&2
  RESULT="invalid-args"
  exit 2
fi

if [[ -z "$LOG_DIR" || "$LOG_DIR" == "/" || "$LOG_DIR" != "${OPS_DIR}/logs" ]]; then
  echo "Refusing to purge unsafe log dir: $LOG_DIR" >&2
  RESULT="unsafe-log-dir"
  exit 2
fi

if [[ ! -d "$LOG_DIR" ]]; then
  echo "[purge-ops-logs] log dir missing: $LOG_DIR"
  RESULT="log-dir-missing"
  exit 0
fi

if command -v flock >/dev/null 2>&1; then
  exec 9>"${LOG_DIR}/.purge.lock"
  if ! flock -n 9; then
    echo "[purge-ops-logs] another purge run is already in progress"
    RESULT="locked"
    exit 0
  fi
fi

echo "=== OPS Logs Purge ==="
echo "Run:      $RUN_ID"
echo "Dir:      $LOG_DIR"
echo "Max age:  ${MAX_AGE_DAYS}d"
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "Mode:     DRY-RUN"
else
  echo "Mode:     DELETE"
fi
echo

mapfile -t CANDIDATES < <(
  find "$LOG_DIR" \
    -maxdepth 1 \
    -type f \
    -mtime +"$MAX_AGE_DAYS" \
    ! -name "$(basename "$SUMMARY_LOG")" \
    ! -name ".purge.lock" | sort
)

if [[ "${#CANDIDATES[@]}" -eq 0 ]]; then
  echo "No files to purge."
  RESULT="no-candidates"
  exit 0
fi

CANDIDATE_COUNT="${#CANDIDATES[@]}"
for f in "${CANDIDATES[@]}"; do
  size="$(stat -c%s "$f" 2>/dev/null || echo 0)"
  TOTAL_BYTES=$((TOTAL_BYTES + size))
  printf "  %8s  %s\n" "$size" "$(basename "$f")"
done

echo
echo "Candidates: ${CANDIDATE_COUNT} files"
echo "Bytes:      ${TOTAL_BYTES}"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "Dry-run complete. Re-run with --yes to delete."
  RESULT="dry-run-complete"
  exit 0
fi

for f in "${CANDIDATES[@]}"; do
  rm -f "$f"
  DELETED_COUNT=$((DELETED_COUNT + 1))
done

echo "Purge complete."
RESULT="purge-complete"
