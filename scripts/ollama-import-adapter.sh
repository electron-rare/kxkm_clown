#!/usr/bin/env bash
# -------------------------------------------------------------------------
# ollama-import-adapter.sh
#
# Import a fine-tuned LoRA adapter into Ollama as a new model.
#
# Usage:
#   ./ollama-import-adapter.sh \
#     --base-model llama3.2:1b \
#     --adapter-path /path/to/adapter \
#     --name kxkm-my-model
# -------------------------------------------------------------------------
set -euo pipefail

# ---- argument parsing ----------------------------------------------------
BASE_MODEL=""
ADAPTER_PATH=""
MODEL_NAME=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-model)  BASE_MODEL="$2";  shift 2 ;;
    --adapter-path) ADAPTER_PATH="$2"; shift 2 ;;
    --name)        MODEL_NAME="$2";  shift 2 ;;
    *)             echo "{\"status\":\"error\",\"error\":\"unknown arg: $1\"}" ; exit 1 ;;
  esac
done

if [[ -z "$BASE_MODEL" || -z "$ADAPTER_PATH" || -z "$MODEL_NAME" ]]; then
  echo "{\"status\":\"error\",\"error\":\"missing required args: --base-model, --adapter-path, --name\"}"
  exit 1
fi

# ---- validate adapter path exists ----------------------------------------
if [[ ! -d "$ADAPTER_PATH" ]]; then
  echo "{\"status\":\"error\",\"error\":\"adapter path does not exist: $ADAPTER_PATH\"}"
  exit 1
fi

# ---- create temporary Modelfile ------------------------------------------
TMPFILE=$(mktemp /tmp/kxkm-modelfile.XXXXXX)
cleanup() { rm -f "$TMPFILE"; }
trap cleanup EXIT

cat > "$TMPFILE" <<EOF
FROM ${BASE_MODEL}
ADAPTER ${ADAPTER_PATH}
EOF

>&2 echo "[ollama-import] Modelfile: FROM ${BASE_MODEL} / ADAPTER ${ADAPTER_PATH}"
>&2 echo "[ollama-import] Creating model '${MODEL_NAME}' ..."

# ---- create the model ----------------------------------------------------
if ! ollama create "$MODEL_NAME" -f "$TMPFILE" >&2 2>&1; then
  echo "{\"status\":\"error\",\"error\":\"ollama create failed\"}"
  exit 1
fi

# ---- verify ---------------------------------------------------------------
if ! ollama list 2>/dev/null | grep -q "$MODEL_NAME"; then
  echo "{\"status\":\"error\",\"error\":\"model not found after create\"}"
  exit 1
fi

>&2 echo "[ollama-import] Model '${MODEL_NAME}' created successfully."

# ---- output JSON result on stdout ----------------------------------------
echo "{\"status\":\"ok\",\"model\":\"${MODEL_NAME}\"}"
