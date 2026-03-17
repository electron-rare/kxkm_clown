#!/bin/bash
# Fine-tune a persona on its extracted dataset
# Usage: ./scripts/finetune-persona.sh <persona-nick> [model]
#
# Example:
#   ./scripts/finetune-persona.sh Pharmacius qwen3.5:9b

set -e

NICK="${1:?Usage: finetune-persona.sh <persona-nick> [model]}"
MODEL="${2:-qwen3.5:9b}"
PYTHON="${PYTHON_BIN:-/home/kxkm/venv/bin/python3}"
SCRIPTS_DIR="${SCRIPTS_DIR:-scripts}"
DATA_DIR="data/training/personas"
ADAPTERS_DIR="data/training/adapters"

echo "=== KXKM Fine-Tune Pipeline ==="
echo "Persona: $NICK"
echo "Model:   $MODEL"
echo ""

# Step 1: Extract dataset
echo "[1/4] Extracting dataset..."
node scripts/extract-persona-dataset.js --persona "$NICK" --output "$DATA_DIR/${NICK,,}-dataset.jsonl" --min-pairs 10

DATASET="$DATA_DIR/${NICK,,}-dataset.jsonl"
if [ ! -f "$DATASET" ]; then
  echo "ERROR: No dataset generated for $NICK"
  exit 1
fi

PAIRS=$(wc -l < "$DATASET")
echo "      Dataset: $PAIRS pairs"

if [ "$PAIRS" -lt 10 ]; then
  echo "ERROR: Too few pairs ($PAIRS). Need at least 10."
  exit 1
fi

# Step 2: Train LoRA adapter
echo "[2/4] Training LoRA adapter..."
OUTPUT_DIR="$ADAPTERS_DIR/${NICK,,}"
mkdir -p "$OUTPUT_DIR"

$PYTHON "$SCRIPTS_DIR/train_unsloth.py" \
  --model "$MODEL" \
  --data "$DATASET" \
  --output "$OUTPUT_DIR" \
  --method lora \
  --epochs 3 \
  --batch-size 2 \
  --quantize 4bit

# Step 3: Evaluate
echo "[3/4] Evaluating..."
# Create simple eval prompts if they don't exist
EVAL_PROMPTS="$DATA_DIR/${NICK,,}-eval.jsonl"
if [ ! -f "$EVAL_PROMPTS" ]; then
  head -5 "$DATASET" | while IFS= read -r line; do
    echo "$line" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps({'prompt':d['messages'][0]['content'],'expected':d['messages'][1]['content'][:200]}))"
  done > "$EVAL_PROMPTS"
fi

$PYTHON "$SCRIPTS_DIR/eval_model.py" \
  --model "$MODEL" \
  --adapter "$OUTPUT_DIR" \
  --prompts "$EVAL_PROMPTS" \
  --output "$OUTPUT_DIR/eval-result.json"

# Step 4: Import into Ollama
echo "[4/4] Importing into Ollama..."
bash "$SCRIPTS_DIR/ollama-import-adapter.sh" \
  --base-model "$MODEL" \
  --adapter-path "$OUTPUT_DIR" \
  --name "kxkm-${NICK,,}"

echo ""
echo "=== Done ==="
echo "Model: kxkm-${NICK,,}"
echo "Test: ollama run kxkm-${NICK,,}"
