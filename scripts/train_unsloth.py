#!/usr/bin/env python3
"""
KXKM_Clown — Unsloth/TRL Training Script

Wrapper for fine-tuning LLMs with LoRA/QLoRA via Unsloth + TRL.
Called by the Node Engine worker via child_process.

Usage:
  python scripts/train_unsloth.py \
    --model unsloth/llama-3-8b \
    --data /path/to/dataset.jsonl \
    --output /path/to/output \
    --method lora \
    [--lr 2e-4] [--epochs 3] [--batch-size 4] \
    [--lora-rank 16] [--lora-alpha 32] \
    [--max-seq-length 2048] [--quantize 4bit]

Output: JSON on stdout with training result.
"""

import argparse
import json
import os
import sys
import time


def parse_args():
    p = argparse.ArgumentParser(description="KXKM Unsloth/TRL Training")
    p.add_argument("--model", required=True, help="Base model name or path")
    p.add_argument("--data", required=True, help="Path to dataset (JSONL/JSON)")
    p.add_argument("--output", required=True, help="Output directory for adapter")
    p.add_argument("--method", choices=["lora", "qlora", "sft"], default="lora")
    p.add_argument("--lr", type=float, default=2e-4)
    p.add_argument("--epochs", type=int, default=3)
    p.add_argument("--batch-size", type=int, default=4)
    p.add_argument("--lora-rank", type=int, default=16)
    p.add_argument("--lora-alpha", type=int, default=32)
    p.add_argument("--warmup-steps", type=int, default=10)
    p.add_argument("--max-seq-length", type=int, default=2048)
    p.add_argument("--quantize", choices=["4bit", "8bit", "none"], default="none")
    return p.parse_args()


def load_dataset_from_jsonl(path):
    """Load a JSONL file into a list of dicts."""
    from datasets import Dataset

    items = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                items.append(json.loads(line))
            except json.JSONDecodeError:
                continue

    if not items:
        raise ValueError(f"No valid items in {path}")

    return Dataset.from_list(items)


def format_for_sft(example):
    """Format a dataset example for SFT training.

    Supports formats:
    - {"instruction": ..., "output": ...}
    - {"prompt": ..., "completion": ...}
    - {"messages": [{"role": ..., "content": ...}, ...]}
    - {"text": ...}
    """
    if "text" in example and example["text"]:
        return {"text": example["text"]}

    if "messages" in example and example["messages"]:
        parts = []
        for msg in example["messages"]:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            parts.append(f"<|{role}|>\n{content}")
        return {"text": "\n".join(parts) + "\n<|end|>"}

    instruction = example.get("instruction", example.get("prompt", ""))
    output = example.get("output", example.get("completion", ""))
    if instruction and output:
        return {"text": f"### Instruction:\n{instruction}\n\n### Response:\n{output}"}

    return {"text": str(example)}


def main():
    args = parse_args()
    start_time = time.time()

    result = {
        "status": "failed",
        "model": args.model,
        "method": args.method,
        "error": None,
    }

    try:
        # Import ML libraries
        from unsloth import FastLanguageModel
        from trl import SFTTrainer, SFTConfig

        print(f"[train] Loading model: {args.model}", file=sys.stderr)

        # Determine quantization
        load_in_4bit = args.quantize == "4bit" or args.method == "qlora"

        # Load model with Unsloth
        model, tokenizer = FastLanguageModel.from_pretrained(
            model_name=args.model,
            max_seq_length=args.max_seq_length,
            load_in_4bit=load_in_4bit,
        )

        # Apply LoRA
        if args.method in ("lora", "qlora"):
            model = FastLanguageModel.get_peft_model(
                model,
                r=args.lora_rank,
                lora_alpha=args.lora_alpha,
                target_modules=[
                    "q_proj", "k_proj", "v_proj", "o_proj",
                    "gate_proj", "up_proj", "down_proj",
                ],
                lora_dropout=0,
                bias="none",
                use_gradient_checkpointing="unsloth",
            )

        print(f"[train] Loading dataset: {args.data}", file=sys.stderr)

        # Load dataset
        dataset = load_dataset_from_jsonl(args.data)
        dataset = dataset.map(format_for_sft)

        print(f"[train] Dataset loaded: {len(dataset)} examples", file=sys.stderr)

        # Configure training
        os.makedirs(args.output, exist_ok=True)

        training_args = SFTConfig(
            output_dir=args.output,
            per_device_train_batch_size=args.batch_size,
            num_train_epochs=args.epochs,
            learning_rate=args.lr,
            warmup_steps=args.warmup_steps,
            max_seq_length=args.max_seq_length,
            logging_steps=1,
            save_strategy="epoch",
            fp16=False,
            bf16=True,
            optim="adamw_8bit",
            seed=42,
        )

        trainer = SFTTrainer(
            model=model,
            tokenizer=tokenizer,
            train_dataset=dataset,
            args=training_args,
        )

        print(f"[train] Starting training: {args.epochs} epochs, lr={args.lr}", file=sys.stderr)

        # Train
        train_result = trainer.train()

        # Save adapter
        model.save_pretrained(args.output)
        tokenizer.save_pretrained(args.output)

        duration = time.time() - start_time
        train_loss = train_result.training_loss if hasattr(train_result, "training_loss") else None

        result = {
            "status": "completed",
            "model": args.model,
            "method": args.method,
            "adapterPath": args.output,
            "metrics": {
                "trainLoss": train_loss,
                "duration": round(duration, 2),
                "examples": len(dataset),
                "epochs": args.epochs,
            },
            "error": None,
        }

        print(f"[train] Training complete in {duration:.1f}s, loss={train_loss}", file=sys.stderr)

    except Exception as e:
        duration = time.time() - start_time
        result["error"] = str(e)
        result["metrics"] = {"duration": round(duration, 2)}
        print(f"[train] ERROR: {e}", file=sys.stderr)

    # Output JSON result on stdout (parsed by worker)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
