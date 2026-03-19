#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JSON_MODE=0
VERBOSE=0
YES=0
PERSONA="${VOICE_PERSONA:-pharmacius}"
PYTHON_CMD="${VOICE_CLONE_PYTHON:-}"
VENV_DIR="${VOICE_CLONE_VENV_DIR:-$ROOT_DIR/.venvs/voice-clone}"

usage() {
  cat <<'EOF'
Usage: scripts/setup-voice-clone.sh <subcommand> [options]

Subcommands:
  bootstrap   Create/update the local XTTS venv and install runtime deps
  sample      Generate a local persona sample with Piper using the local venv
  smoke       Run a synthetic XTTS smoke using the local venv and sample
  all         Run bootstrap, sample and smoke in sequence
  help        Show this help

Options:
  --persona NICK    Persona/sample to target (default: pharmacius)
  --python CMD      Python interpreter used to create the venv (default: python3.12 if available)
  --venv-dir PATH   Virtualenv directory (default: .venvs/voice-clone)
  --json            Emit machine-readable log lines when possible
  --verbose         Print executed commands
  --yes             Accepted for CLI parity
  --help            Show this help
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
    printf '[voice-clone-setup] %s\n' "$message"
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
    printf '[voice-clone-setup] error: %s\n' "$message" >&2
  fi
  exit 1
}

run_cmd() {
  if [[ "$VERBOSE" -eq 1 ]]; then
    log "$*"
  fi
  "$@"
}

resolve_python_cmd() {
  if [[ -n "$PYTHON_CMD" ]]; then
    printf '%s\n' "$PYTHON_CMD"
    return 0
  fi

  if command -v python3.12 >/dev/null 2>&1; then
    printf '%s\n' "python3.12"
    return 0
  fi

  if command -v python3 >/dev/null 2>&1; then
    printf '%s\n' "python3"
    return 0
  fi

  die "python3.12 or python3 is required"
}

resolve_voice_sample_dir() {
  if [[ -n "${KXKM_VOICE_SAMPLES_DIR:-}" ]]; then
    python3 - "$KXKM_VOICE_SAMPLES_DIR" <<'PY'
import os, sys
print(os.path.abspath(sys.argv[1]))
PY
    return 0
  fi

  if [[ -n "${KXKM_LOCAL_DATA_DIR:-}" ]]; then
    python3 - "$KXKM_LOCAL_DATA_DIR" <<'PY'
import os, sys
print(os.path.abspath(os.path.join(sys.argv[1], "voice-samples")))
PY
    return 0
  fi

  python3 - "$ROOT_DIR" <<'PY'
import os, sys
print(os.path.join(sys.argv[1], "data", "voice-samples"))
PY
}

bootstrap_env() {
  local python_cmd="$1"
  command -v uv >/dev/null 2>&1 || die "uv is required"

  if [[ ! -x "$VENV_DIR/bin/python" ]]; then
    log "creating venv -> $VENV_DIR"
    run_cmd uv venv --python "$python_cmd" "$VENV_DIR"
  else
    log "reusing venv -> $VENV_DIR"
  fi

  log "installing XTTS runtime deps into $(basename "$VENV_DIR")"
  run_cmd uv pip install --python "$VENV_DIR/bin/python" torch torchaudio torchcodec 'transformers<5' coqui-tts piper-tts
}

generate_sample() {
  local python_bin="$1"
  local sample_dir="$2"
  mkdir -p "$sample_dir"
  log "generating sample for $PERSONA"
  (cd "$ROOT_DIR" && PYTHON_BIN="$python_bin" node scripts/generate-voice-samples.js --persona "$PERSONA")
}

smoke_xtts() {
  local python_bin="$1"
  local sample_dir="$2"
  local sample_basename
  sample_basename="$(printf '%s' "$PERSONA" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9_-]/_/g' | cut -c1-64)"
  local sample_path="$sample_dir/${sample_basename}.wav"
  local tmp_output
  local tmp_json

  [[ "${COQUI_TOS_AGREED:-}" == "1" ]] || die "XTTS smoke requires COQUI_TOS_AGREED=1 after reviewing the CPML terms"
  [[ -f "$sample_path" ]] || die "sample missing: $sample_path"
  tmp_output="$(mktemp "${TMPDIR:-/tmp}/kxkm-voice-clone-audio.XXXXXX")"
  tmp_json="$(mktemp "${TMPDIR:-/tmp}/kxkm-voice-clone-json.XXXXXX")"
  trap 'rm -f "${tmp_output:-}" "${tmp_json:-}"' EXIT

  log "running XTTS smoke for $PERSONA"
  (
    cd "$ROOT_DIR"
    "$python_bin" scripts/tts_clone_voice.py \
      --text "Bonjour, ceci est un test de clonage pour ${PERSONA}." \
      --reference "$sample_path" \
      --output "$tmp_output"
  ) | tee "$tmp_json" >/dev/null

  python3 - "$tmp_json" "$tmp_output" <<'PY'
import json
import pathlib
import sys

lines = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").splitlines()
payload = None
for line in reversed(lines):
    candidate = line.strip()
    if not candidate:
        continue
    try:
        payload = json.loads(candidate)
        break
    except json.JSONDecodeError:
        continue

if payload is None:
    raise SystemExit("XTTS smoke produced no JSON status line")

output_path = pathlib.Path(sys.argv[2])
if payload.get("status") != "completed":
    raise SystemExit(payload.get("error") or "XTTS smoke failed")
if not output_path.exists() or output_path.stat().st_size == 0:
    raise SystemExit("XTTS smoke produced no audio output")
print(json.dumps({"status": "completed", "output": str(output_path), "bytes": output_path.stat().st_size}))
PY
}

SUBCOMMAND="${1:-all}"
if [[ $# -gt 0 ]]; then
  shift
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --persona)
      shift
      [[ $# -gt 0 ]] || die "--persona requires a value"
      PERSONA="$1"
      ;;
    --python)
      shift
      [[ $# -gt 0 ]] || die "--python requires a value"
      PYTHON_CMD="$1"
      ;;
    --venv-dir)
      shift
      [[ $# -gt 0 ]] || die "--venv-dir requires a value"
      VENV_DIR="$1"
      ;;
    --json) JSON_MODE=1 ;;
    --verbose) VERBOSE=1 ;;
    --yes) YES=1 ;;
    --help|-h) usage; exit 0 ;;
    *) usage; die "unknown option: $1" ;;
  esac
  shift
done

case "$SUBCOMMAND" in
  bootstrap|sample|smoke|all|help) ;;
  *) usage; die "unknown subcommand: $SUBCOMMAND" ;;
esac

if [[ "$SUBCOMMAND" == "help" ]]; then
  usage
  exit 0
fi

PYTHON_CMD="$(resolve_python_cmd)"
VENV_DIR="$(cd "$ROOT_DIR" && python3 - "$VENV_DIR" <<'PY'
import os, sys
print(os.path.abspath(sys.argv[1]))
PY
)"
VOICE_SAMPLE_DIR="$(resolve_voice_sample_dir)"
VENV_PYTHON="$VENV_DIR/bin/python"

log "persona=$PERSONA"
log "python=$PYTHON_CMD"
log "venv=$VENV_DIR"
log "voice-sample-dir=$VOICE_SAMPLE_DIR"

case "$SUBCOMMAND" in
  bootstrap)
    bootstrap_env "$PYTHON_CMD"
    ;;
  sample)
    [[ -x "$VENV_PYTHON" ]] || die "venv missing: run bootstrap first"
    generate_sample "$VENV_PYTHON" "$VOICE_SAMPLE_DIR"
    ;;
  smoke)
    [[ -x "$VENV_PYTHON" ]] || die "venv missing: run bootstrap first"
    smoke_xtts "$VENV_PYTHON" "$VOICE_SAMPLE_DIR"
    ;;
  all)
    bootstrap_env "$PYTHON_CMD"
    generate_sample "$VENV_PYTHON" "$VOICE_SAMPLE_DIR"
    smoke_xtts "$VENV_PYTHON" "$VOICE_SAMPLE_DIR"
    ;;
esac
