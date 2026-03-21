#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_DIR="${KXKM_PROJECT_DIR:-$ROOT_DIR}"
REMOTE_HOST=""
REMOTE_PROJECT_DIR="${KXKM_REMOTE_DIR:-/home/kxkm/KXKM_Clown}"
VERBOSE=0
SUBCOMMAND="health"
PASSTHRU=()

usage() {
  cat <<'EOF'
Usage: bash scripts/ops-tui.sh <subcommand> [options] [-- passthrough...]

Subcommands:
  health       Run ops/v2/health-check.js
  queue        Run ops/v2/queue-viewer.js
  personas     Run ops/v2/persona-manager.js
  perf         Run ops/v2/perf-monitor.js
  rotate       Run ops/v2/log-rotate.js
  deep-audit   Run ops/v2/deep-audit.js
  cycle        Run ops/v2/run-deep-cycle.sh
  spikes       Run ops/v2/run-spike-checks.sh
  cleanup      Run scripts/cleanup-logs.sh
  services     Run scripts/service-status.sh

Wrapper options:
  --remote HOST        Execute on a remote host over SSH
  --project-dir DIR    Override project directory (local or remote target)
  --verbose            Print the delegated command before execution
  --help               Show this help

Examples:
  bash scripts/ops-tui.sh health -- --json
  bash scripts/ops-tui.sh health --remote kxkm@kxkm-ai -- --json --v2-url http://localhost:3333/api/v2/health
  bash scripts/ops-tui.sh rotate -- --dry-run --max-age-days 7
  bash scripts/ops-tui.sh cycle -- run --yes
EOF
}

log() {
  printf '[ops-tui] %s\n' "$1"
}

die() {
  printf '[ops-tui] error: %s\n' "$1" >&2
  exit 1
}

resolve_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi

  local nvm_sh="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  if [[ -s "$nvm_sh" ]]; then
    # shellcheck source=/dev/null
    . "$nvm_sh"
  fi

  command -v node >/dev/null 2>&1 || die "node introuvable. Charge nvm ou installe Node.js."
  command -v node
}

quote_args() {
  local quoted=()
  local arg
  for arg in "$@"; do
    quoted+=("$(printf '%q' "$arg")")
  done
  printf '%s' "${quoted[*]}"
}

if [[ $# -gt 0 && "${1:-}" != --* ]]; then
  SUBCOMMAND="$1"
  shift
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --remote)
      [[ $# -ge 2 ]] || die "--remote requiert un hote"
      REMOTE_HOST="$2"
      shift 2
      ;;
    --project-dir)
      [[ $# -ge 2 ]] || die "--project-dir requiert un chemin"
      PROJECT_DIR="$2"
      shift 2
      ;;
    --verbose)
      VERBOSE=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --)
      shift
      PASSTHRU+=("$@")
      break
      ;;
    *)
      PASSTHRU+=("$1")
      shift
      ;;
  esac
done

case "$SUBCOMMAND" in
  health|queue|personas|perf|rotate|deep-audit|cycle|spikes|cleanup|services) ;;
  *)
    usage
    die "subcommand inconnu: $SUBCOMMAND"
    ;;
esac

if [[ -n "$REMOTE_HOST" ]]; then
  remote_args=("$SUBCOMMAND" "--project-dir" "$REMOTE_PROJECT_DIR")
  if [[ "$VERBOSE" -eq 1 ]]; then
    remote_args+=("--verbose")
  fi
  if [[ "${#PASSTHRU[@]}" -gt 0 ]]; then
    remote_args+=("--")
    remote_args+=("${PASSTHRU[@]}")
  fi
  remote_cmd="cd $(printf '%q' "$PROJECT_DIR") && bash scripts/ops-tui.sh $(quote_args "${remote_args[@]}")"
  if [[ "$VERBOSE" -eq 1 ]]; then
    log "ssh $REMOTE_HOST $remote_cmd"
  fi
  exec ssh -o BatchMode=yes "$REMOTE_HOST" "$remote_cmd"
fi

cd "$PROJECT_DIR"

case "$SUBCOMMAND" in
  health)
    NODE_BIN="$(resolve_node)"
    CMD=("$NODE_BIN" "ops/v2/health-check.js")
    ;;
  queue)
    NODE_BIN="$(resolve_node)"
    CMD=("$NODE_BIN" "ops/v2/queue-viewer.js")
    ;;
  personas)
    NODE_BIN="$(resolve_node)"
    CMD=("$NODE_BIN" "ops/v2/persona-manager.js")
    ;;
  perf)
    NODE_BIN="$(resolve_node)"
    CMD=("$NODE_BIN" "ops/v2/perf-monitor.js")
    ;;
  rotate)
    NODE_BIN="$(resolve_node)"
    CMD=("$NODE_BIN" "ops/v2/log-rotate.js")
    ;;
  deep-audit)
    NODE_BIN="$(resolve_node)"
    CMD=("$NODE_BIN" "ops/v2/deep-audit.js")
    ;;
  cycle)
    CMD=("bash" "ops/v2/run-deep-cycle.sh")
    ;;
  spikes)
    CMD=("bash" "ops/v2/run-spike-checks.sh")
    ;;
  cleanup)
    CMD=("bash" "scripts/cleanup-logs.sh")
    ;;
  services)
    CMD=("bash" "scripts/service-status.sh")
    ;;
esac

if [[ "$VERBOSE" -eq 1 ]]; then
  log "$(quote_args "${CMD[@]}" "${PASSTHRU[@]}")"
fi

exec "${CMD[@]}" "${PASSTHRU[@]}"
