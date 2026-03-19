#!/usr/bin/env bash
set -euo pipefail

PERSONA="${VOICE_PERSONA:-pharmacius}"
JSON_MODE=0
STRICT=0
VERBOSE=0
CHECK_DEPS=1
CHECK_SAMPLES=1
PYTHON_BIN_VALUE=""
VOICE_SAMPLE_DIR_VALUE=""

usage() {
  cat <<'EOF'
Usage: scripts/health-voice-clone.sh [subcommand] [options]

Subcommands:
  all      Check XTTS deps and sample readiness
  deps     Check Python/runtime dependencies only
  samples  Check sample directory and dry-run generator seam

Options:
  --persona NICK   Persona/sample to inspect (default: pharmacius)
  --json           Emit JSON lines where possible
  --strict         Exit non-zero if any check fails
  --verbose        Print probe details
  --yes            Accepted for CLI parity
  --help           Show this help
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
    printf '[health-voice-clone] %s\n' "$message"
  fi
}

warn() {
  local message="$1"
  if [[ "$JSON_MODE" -eq 1 ]]; then
    python3 - "$message" <<'PY'
import json
import sys
print(json.dumps({"level": "warn", "msg": sys.argv[1]}))
PY
  else
    printf '[health-voice-clone] warn: %s\n' "$message" >&2
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
    printf '[health-voice-clone] error: %s\n' "$message" >&2
  fi
  exit 1
}

resolve_python_bin() {
  if [[ -n "${PYTHON_BIN:-}" ]]; then
    printf '%s\n' "$PYTHON_BIN"
    return 0
  fi

  local project_python
  project_python="$(pwd)/.venvs/voice-clone/bin/python"
  if [[ -x "$project_python" ]]; then
    printf '%s\n' "$project_python"
    return 0
  fi

  if [[ -x "/home/kxkm/venv/bin/python3" ]]; then
    printf '%s\n' "/home/kxkm/venv/bin/python3"
    return 0
  fi

  printf '%s\n' "python3"
}

resolve_voice_sample_dir() {
  if [[ -n "${KXKM_VOICE_SAMPLES_DIR:-}" ]]; then
    python3 - "$KXKM_VOICE_SAMPLES_DIR" <<'PY'
import os
import sys
print(os.path.abspath(sys.argv[1]))
PY
    return 0
  fi

  if [[ -n "${KXKM_LOCAL_DATA_DIR:-}" ]]; then
    python3 - "$KXKM_LOCAL_DATA_DIR" <<'PY'
import os
import sys
print(os.path.abspath(os.path.join(sys.argv[1], "voice-samples")))
PY
    return 0
  fi

  python3 <<'PY'
import os
print(os.path.abspath(os.path.join(os.getcwd(), "data", "voice-samples")))
PY
}

check_deps() {
  "$PYTHON_BIN_VALUE" - "$JSON_MODE" "$PYTHON_BIN_VALUE" <<'PY'
import importlib.util
import json
import os
import shutil
import sys

json_mode = sys.argv[1] == "1"
python_bin = sys.argv[2]

def has_module(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except ModuleNotFoundError:
        return False

torch_ok = has_module("torch")
tts_ok = has_module("TTS")
piper_module = has_module("piper")
piper_cli = shutil.which("piper") is not None or shutil.which("piper-tts") is not None
coqui_tos_agreed = os.environ.get("COQUI_TOS_AGREED") == "1"
cuda_ok = False
if torch_ok:
    try:
        import torch
        cuda_ok = bool(torch.cuda.is_available())
    except Exception:
        cuda_ok = False

payload = {
    "check": "deps",
    "ok": torch_ok and tts_ok,
    "python_bin": python_bin,
    "torch": torch_ok,
    "tts": tts_ok,
    "piper_module": piper_module,
    "coqui_tos_agreed": coqui_tos_agreed,
    "cuda": cuda_ok,
    "piper_cli": piper_cli,
}

if json_mode:
    print(json.dumps(payload))
else:
    print(
        "[health-voice-clone] deps: "
        f"python={python_bin}, "
        f"torch={'yes' if torch_ok else 'no'}, "
        f"TTS={'yes' if tts_ok else 'no'}, "
        f"piper_module={'yes' if piper_module else 'no'}, "
        f"coqui_tos_agreed={'yes' if coqui_tos_agreed else 'no'}, "
        f"cuda={'yes' if cuda_ok else 'no'}, "
        f"piper_cli={'yes' if piper_cli else 'no'}"
    )

if not payload["ok"]:
    raise SystemExit(1)
PY
}

check_samples() {
  local tmp_log
  tmp_log="$(mktemp)"
  if PYTHON_BIN="$PYTHON_BIN_VALUE" node scripts/generate-voice-samples.js --dry-run --persona "$PERSONA" >"$tmp_log" 2>&1; then
    :
  else
    cat "$tmp_log" >&2 || true
    rm -f "$tmp_log"
    return 1
  fi

  python3 - "$PERSONA" "$JSON_MODE" "$VOICE_SAMPLE_DIR_VALUE" <<'PY'
import json
import pathlib
import re
import sys

persona = sys.argv[1]
json_mode = sys.argv[2] == "1"
voice_dir = pathlib.Path(sys.argv[3])
sample_files = sorted([p.name for p in voice_dir.glob("*.wav")]) if voice_dir.exists() else []
basename = re.sub(r"[^a-z0-9_-]", "_", persona.lower())[:64]
sample_path = voice_dir / f"{basename}.wav"

payload = {
    "check": "samples",
    "ok": voice_dir.exists(),
    "voice_dir": str(voice_dir),
    "persona": persona,
    "expected_sample": str(sample_path),
    "sample_count": len(sample_files),
    "persona_sample_present": sample_path.exists(),
}

if json_mode:
    print(json.dumps(payload))
else:
    print(
        "[health-voice-clone] samples: "
        f"dir={'yes' if voice_dir.exists() else 'no'}, "
        f"count={len(sample_files)}, "
        f"persona_sample={'yes' if sample_path.exists() else 'no'} "
        f"({sample_path})"
    )

if not payload["ok"]:
    raise SystemExit(1)
PY

  rm -f "$tmp_log"
}

SUBCOMMAND="all"
if [[ $# -gt 0 && "$1" != --* ]]; then
  SUBCOMMAND="$1"
  shift
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --persona)
      shift
      [[ $# -gt 0 ]] || die "--persona requires a value"
      PERSONA="$1"
      ;;
    --json)
      JSON_MODE=1
      ;;
    --strict)
      STRICT=1
      ;;
    --verbose)
      VERBOSE=1
      ;;
    --yes)
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
  shift
done

case "$SUBCOMMAND" in
  all|deps|samples) ;;
  *) die "unknown subcommand: $SUBCOMMAND" ;;
esac

if [[ "$SUBCOMMAND" == "deps" ]]; then
  CHECK_SAMPLES=0
elif [[ "$SUBCOMMAND" == "samples" ]]; then
  CHECK_DEPS=0
fi

if [[ "$VERBOSE" -eq 1 ]]; then
  PYTHON_BIN_VALUE="$(resolve_python_bin)"
  VOICE_SAMPLE_DIR_VALUE="$(resolve_voice_sample_dir)"
  log "persona=$PERSONA"
  log "python-bin=$PYTHON_BIN_VALUE"
  log "voice-sample-dir=$VOICE_SAMPLE_DIR_VALUE"
else
  PYTHON_BIN_VALUE="$(resolve_python_bin)"
  VOICE_SAMPLE_DIR_VALUE="$(resolve_voice_sample_dir)"
fi

failures=0

if [[ "$CHECK_DEPS" -eq 1 ]]; then
  if ! check_deps; then
    warn "XTTS runtime deps missing; voice cloning will fall back to Piper or no audio"
    failures=$((failures + 1))
  fi
fi

if [[ "$CHECK_SAMPLES" -eq 1 ]]; then
  if ! check_samples; then
    warn "Voice sample seam not ready; upload a persona sample or generate references first"
    failures=$((failures + 1))
  fi
fi

if [[ "$failures" -gt 0 && "$STRICT" -eq 1 ]]; then
  die "one or more probes failed"
fi

exit 0
