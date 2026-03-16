#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -d /tmp/node-local/bin ]]; then
  export PATH="/tmp/node-local/bin:$PATH"
fi

STEPS=("$@")
if [[ ${#STEPS[@]} -eq 0 ]]; then
  STEPS=(check smoke build)
fi

run_step() {
  local step="$1"
  case "$step" in
    check)
      npm run check
      ;;
    smoke)
      npm run smoke
      ;;
    build)
      npm run build
      ;;
    verify)
      npm run verify
      ;;
    *)
      echo "[chain-actions] étape inconnue: $step" >&2
      return 1
      ;;
  esac
}

for step in "${STEPS[@]}"; do
  echo "[chain-actions] running: $step"
  run_step "$step"
done

echo "[chain-actions] done"
