#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob

KXKM_DIR=${KXKM_DIR:-/home/kxkm/KXKM_Clown}

resolve_repo_path() {
  local value="$1"
  case "$value" in
    /*) printf '%s\n' "$value" ;;
    *) printf '%s/%s\n' "$KXKM_DIR" "$value" ;;
  esac
}

LOCAL_DATA_ROOT=$(resolve_repo_path "${KXKM_LOCAL_DATA_DIR:-data/v2-local}")
PERSONA_MEMORY_DIR="$LOCAL_DATA_ROOT/persona-memory"
LEGACY_MEMORY_DIR=$(resolve_repo_path "${KXKM_PERSONA_MEMORY_LEGACY_DIR:-data/persona-memory}")

trim_persona_memory_dir() {
  local dir="$1"
  local file

  for file in "$dir"/*.json; do
    [ -e "$file" ] || continue

    local size
    size=$(stat -c%s "$file" 2>/dev/null || echo 0)
    [ "$size" -le 102400 ] && continue

    python3 - "$file" <<'PY'
import json
import sys
from pathlib import Path

file_path = Path(sys.argv[1])
with file_path.open("r", encoding="utf-8") as fh:
    data = json.load(fh)

if isinstance(data.get("workingMemory"), dict):
    working = data["workingMemory"]
    working["facts"] = list(working.get("facts") or [])[-20:]
    working["lastSourceMessages"] = list(working.get("lastSourceMessages") or [])[-10:]

if isinstance(data.get("archivalMemory"), dict):
    archival = data["archivalMemory"]
    archival["facts"] = list(archival.get("facts") or [])[-100:]
    archival["summaries"] = list(archival.get("summaries") or [])[-50:]

if isinstance(data.get("compat"), dict):
    compat = data["compat"]
    compat["facts"] = list(compat.get("facts") or [])[-20:]
else:
    data["facts"] = list(data.get("facts") or [])[-20:]

with file_path.open("w", encoding="utf-8") as fh:
    json.dump(data, fh, indent=2)
    fh.write("\n")
PY
    echo "[cleanup] Trimmed $file"
  done
}

find "$KXKM_DIR/data/chat-logs" -name "*.jsonl" -mtime +30 -delete 2>/dev/null || true
trim_persona_memory_dir "$PERSONA_MEMORY_DIR"
if [ "$LEGACY_MEMORY_DIR" != "$PERSONA_MEMORY_DIR" ]; then
  trim_persona_memory_dir "$LEGACY_MEMORY_DIR"
fi
echo "[cleanup] Done $(date)"
