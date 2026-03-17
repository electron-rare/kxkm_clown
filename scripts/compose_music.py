#!/usr/bin/env python3
"""
KXKM_Clown — Music Generation via ACE-Step 1.5

Generates music from text prompts locally on GPU.
Fallback to Meta's MusicGen if ACE-Step not available.

Usage:
  python scripts/compose_music.py \
    --prompt "ambient drone with deep bass, musique concrete style" \
    --duration 30 \
    --output /tmp/music.wav

ACE-Step 1.5: cloned at ACE_STEP_DIR (default: /home/kxkm/ACE-Step-1.5)
MusicGen fallback: pip install transformers scipy
"""
import argparse, json, os, sys, time


def parse_args():
    p = argparse.ArgumentParser(description="KXKM Music Generation")
    p.add_argument("--prompt", required=True)
    p.add_argument("--duration", type=int, default=30, help="Duration in seconds")
    p.add_argument("--output", required=True)
    p.add_argument("--style", default="experimental", help="Style hint")
    p.add_argument("--steps", type=int, default=100, help="Diffusion steps (ACE-Step only)")
    p.add_argument("--seed", type=int, default=-1, help="Random seed (-1 for random)")
    return p.parse_args()


def generate_with_ace_step(prompt, duration, output, steps=100, seed=-1):
    """Primary: ACE-Step 1.5 (<4GB VRAM, commercial-grade)."""
    ace_dir = os.environ.get("ACE_STEP_DIR", "/home/kxkm/ACE-Step-1.5")
    if not os.path.isdir(ace_dir):
        raise ImportError(f"ACE-Step not found at {ace_dir}")

    sys.path.insert(0, ace_dir)

    # ACE-Step 1.5 uses CLI interface
    import subprocess
    cli_path = os.path.join(ace_dir, "cli.py")

    cmd = [
        sys.executable, cli_path,
        "--prompt", prompt[:2000],
        "--duration", str(min(duration, 300)),
        "--output_dir", os.path.dirname(output) or "/tmp",
        "--num_inference_steps", str(steps),
    ]
    if seed >= 0:
        cmd.extend(["--seed", str(seed)])

    print(f"[compose] ACE-Step 1.5: {duration}s, {steps} steps...", file=sys.stderr)
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600, cwd=ace_dir)

    if proc.returncode != 0:
        raise RuntimeError(f"ACE-Step failed: {proc.stderr[:500]}")

    # Find output file (ACE-Step may name it differently)
    out_dir = os.path.dirname(output) or "/tmp"
    candidates = sorted(
        [f for f in os.listdir(out_dir) if f.endswith((".wav", ".mp3")) and "ace" in f.lower()],
        key=lambda f: os.path.getmtime(os.path.join(out_dir, f)),
        reverse=True,
    )
    if candidates:
        src = os.path.join(out_dir, candidates[0])
        if src != output:
            os.rename(src, output)
    elif not os.path.isfile(output):
        raise RuntimeError("ACE-Step produced no output file")

    return {"generator": "ace-step-1.5", "steps": steps}


def generate_with_musicgen(prompt, duration, output):
    """Fallback: Meta's MusicGen (smaller, widely available)."""
    from transformers import AutoProcessor, MusicgenForConditionalGeneration
    import scipy.io.wavfile
    import numpy as np

    print("[compose] Loading MusicGen small...", file=sys.stderr)
    processor = AutoProcessor.from_pretrained("facebook/musicgen-small")
    model = MusicgenForConditionalGeneration.from_pretrained("facebook/musicgen-small")

    import torch
    if torch.cuda.is_available():
        model = model.to("cuda")

    inputs = processor(text=[prompt], padding=True, return_tensors="pt")
    if torch.cuda.is_available():
        inputs = {k: v.to("cuda") for k, v in inputs.items()}

    # ~256 tokens per second of audio
    max_tokens = min(duration * 256, 1536)  # cap at ~6s for musicgen-small

    print(f"[compose] Generating {max_tokens} tokens...", file=sys.stderr)
    audio_values = model.generate(**inputs, max_new_tokens=max_tokens)

    sampling_rate = model.config.audio_encoder.sampling_rate
    audio_data = audio_values[0, 0].cpu().numpy()
    audio_int16 = (audio_data * 32767).astype(np.int16)

    scipy.io.wavfile.write(output, rate=sampling_rate, data=audio_int16)
    return {"generator": "musicgen-small", "sampling_rate": sampling_rate}


def main():
    args = parse_args()
    start = time.time()
    result = {"status": "failed", "error": None}

    try:
        os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
        full_prompt = f"{args.prompt}, {args.style} style"

        # Try ACE-Step 1.5 first
        try:
            gen_info = generate_with_ace_step(
                full_prompt, args.duration, args.output,
                steps=args.steps, seed=args.seed,
            )
        except (ImportError, RuntimeError) as e:
            print(f"[compose] ACE-Step unavailable ({e}), falling back to MusicGen", file=sys.stderr)
            gen_info = generate_with_musicgen(full_prompt, args.duration, args.output)

        elapsed = time.time() - start
        file_size = os.path.getsize(args.output) if os.path.isfile(args.output) else 0

        result = {
            "status": "completed",
            "outputFile": args.output,
            "duration": round(elapsed, 2),
            "fileSize": file_size,
            "prompt": args.prompt[:200],
            **gen_info,
        }
        print(f"[compose] Done in {elapsed:.1f}s -> {args.output} ({file_size} bytes)", file=sys.stderr)

    except Exception as e:
        result["error"] = str(e)[:500]
        print(f"[compose] ERROR: {e}", file=sys.stderr)

    print(json.dumps(result))


if __name__ == "__main__":
    main()
