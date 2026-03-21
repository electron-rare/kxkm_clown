#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${ROOT_DIR}/ops/v2/logs/playwright"
SUBCOMMAND="${1:-run}"

mkdir -p "${LOG_DIR}"

print_usage() {
  cat <<'EOF'
Usage:
  bash scripts/run-playwright-e2e.sh run [playwright args...]
  bash scripts/run-playwright-e2e.sh clean-logs

Commands:
  run         Execute the Playwright E2E suite and tee logs to ops/v2/logs/playwright.
  clean-logs  Remove old Playwright runner logs (older than 7 days).
EOF
}

case "${SUBCOMMAND}" in
  run)
    shift || true
    TIMESTAMP="$(date +"%Y%m%d-%H%M%S")"
    LOG_FILE="${LOG_DIR}/playwright-e2e-${TIMESTAMP}.log"
    echo "[playwright-e2e] log file: ${LOG_FILE}"
    (
      cd "${ROOT_DIR}"
      node node_modules/@playwright/test/cli.js test "$@"
    ) 2>&1 | tee "${LOG_FILE}"
    ;;
  clean-logs)
    find "${LOG_DIR}" -type f -name 'playwright-e2e-*.log' -mtime +7 -delete
    echo "[playwright-e2e] old logs cleaned in ${LOG_DIR}"
    ;;
  help|-h|--help)
    print_usage
    ;;
  *)
    print_usage >&2
    exit 1
    ;;
esac
