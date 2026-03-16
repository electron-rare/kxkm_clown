#!/usr/bin/env python3
"""
KXKM_Clown — Model Evaluation Script

Evaluates a model (base or fine-tuned adapter) on a set of prompts.
Called by the Node Engine worker for benchmark/prompt_test nodes.

Usage:
  python scripts/eval_model.py \
    --model unsloth/llama-3-8b \
    [--adapter /path/to/adapter] \
    --prompts /path/to/prompts.jsonl \
    --output /path/to/eval_result.json \
    [--max-new-tokens 256] [--temperature 0.7]

Prompts JSONL format:
  {"prompt": "...", "expected": "..."}  (expected is optional)

Output: JSON with evaluation scores.
"""

import argparse
import json
import os
import sys
import time


def parse_args():
    p = argparse.ArgumentParser(description="KXKM Model Evaluation")
    p.add_argument("--model", required=True, help="Base model name or path")
    p.add_argument("--adapter", default=None, help="Path to LoRA adapter (optional)")
    p.add_argument("--prompts", required=True, help="Path to prompts JSONL file")
    p.add_argument("--output", required=True, help="Path to output JSON result")
    p.add_argument("--max-new-tokens", type=int, default=256)
    p.add_argument("--temperature", type=float, default=0.7)
    p.add_argument("--quantize", choices=["4bit", "none"], default="4bit")
    return p.parse_args()


def load_prompts(path):
    """Load prompts from JSONL."""
    prompts = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
                if isinstance(item, dict) and "prompt" in item:
                    prompts.append(item)
            except json.JSONDecodeError:
                continue
    return prompts


def compute_similarity(generated, expected):
    """Simple token overlap similarity score (0-1)."""
    if not expected:
        return None
    gen_tokens = set(generated.lower().split())
    exp_tokens = set(expected.lower().split())
    if not exp_tokens:
        return None
    overlap = gen_tokens & exp_tokens
    precision = len(overlap) / len(gen_tokens) if gen_tokens else 0
    recall = len(overlap) / len(exp_tokens) if exp_tokens else 0
    if precision + recall == 0:
        return 0.0
    return 2 * (precision * recall) / (precision + recall)  # F1


def main():
    args = parse_args()
    start_time = time.time()

    result = {
        "status": "failed",
        "model": args.model,
        "adapter": args.adapter,
        "error": None,
    }

    try:
        from unsloth import FastLanguageModel

        print(f"[eval] Loading model: {args.model}", file=sys.stderr)

        load_in_4bit = args.quantize == "4bit"

        model, tokenizer = FastLanguageModel.from_pretrained(
            model_name=args.model,
            max_seq_length=2048,
            load_in_4bit=load_in_4bit,
        )

        # Load adapter if specified
        if args.adapter and os.path.isdir(args.adapter):
            print(f"[eval] Loading adapter: {args.adapter}", file=sys.stderr)
            from peft import PeftModel
            model = PeftModel.from_pretrained(model, args.adapter)

        # Enable inference mode
        FastLanguageModel.for_inference(model)

        # Load prompts
        prompts = load_prompts(args.prompts)
        if not prompts:
            raise ValueError(f"No valid prompts in {args.prompts}")

        print(f"[eval] Evaluating {len(prompts)} prompts", file=sys.stderr)

        scores = []
        responses = []
        total_tokens = 0

        for i, item in enumerate(prompts):
            prompt_text = item["prompt"]
            expected = item.get("expected", None)

            inputs = tokenizer(prompt_text, return_tensors="pt").to(model.device)
            input_len = inputs["input_ids"].shape[1]

            outputs = model.generate(
                **inputs,
                max_new_tokens=args.max_new_tokens,
                temperature=args.temperature,
                do_sample=args.temperature > 0,
            )

            generated_tokens = outputs[0][input_len:]
            generated_text = tokenizer.decode(generated_tokens, skip_special_tokens=True)
            total_tokens += len(generated_tokens)

            similarity = compute_similarity(generated_text, expected)

            response_entry = {
                "prompt": prompt_text[:100],
                "generated": generated_text[:500],
                "tokens": len(generated_tokens),
            }

            if expected is not None:
                response_entry["expected"] = expected[:100]
                response_entry["similarity"] = similarity

            if similarity is not None:
                scores.append(similarity)

            responses.append(response_entry)

            print(
                f"[eval] {i+1}/{len(prompts)} tokens={len(generated_tokens)}"
                + (f" sim={similarity:.3f}" if similarity is not None else ""),
                file=sys.stderr,
            )

        duration = time.time() - start_time

        avg_score = sum(scores) / len(scores) if scores else None

        eval_data = {
            "score": avg_score,
            "total_prompts": len(prompts),
            "scored_prompts": len(scores),
            "total_tokens": total_tokens,
            "avg_tokens_per_prompt": total_tokens / len(prompts) if prompts else 0,
            "duration": round(duration, 2),
            "responses": responses,
        }

        # Write detailed result to output file
        os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(eval_data, f, indent=2, ensure_ascii=False)

        result = {
            "status": "completed",
            "model": args.model,
            "adapter": args.adapter,
            "score": avg_score,
            "metrics": {
                "score": avg_score,
                "total_prompts": len(prompts),
                "total_tokens": total_tokens,
                "duration": round(duration, 2),
            },
            "outputFile": args.output,
            "error": None,
        }

        print(f"[eval] Done in {duration:.1f}s, score={avg_score}", file=sys.stderr)

    except Exception as e:
        duration = time.time() - start_time
        result["error"] = str(e)
        result["metrics"] = {"duration": round(duration, 2)}
        print(f"[eval] ERROR: {e}", file=sys.stderr)

    # Output JSON result on stdout
    print(json.dumps(result))


if __name__ == "__main__":
    main()
