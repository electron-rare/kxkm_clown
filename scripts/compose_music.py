#!/usr/bin/env python3
"""
KXKM_Clown — Music Generation via ACE-Step 1.5

Generates music from text prompts locally.

Usage:
  python scripts/compose_music.py \
    --prompt "ambient drone with deep bass, musique concrete style" \
    --duration 30 \
    --output /tmp/music.wav

Fallback to MusicGen if ACE-Step not installed.
Install: pip install ace-step  OR  pip install transformers scipy
"""
import argparse, json, os, sys, time

def parse_args():
    p = argparse.ArgumentParser(description="KXKM Music Generation")
    p.add_argument("--prompt", required=True)
    p.add_argument("--duration", type=int, default=30, help="Duration in seconds")
    p.add_argument("--output", required=True)
    p.add_argument("--style", default="experimental", help="Style hint")
    return p.parse_args()

def generate_with_musicgen(prompt, duration, output):
    """Fallback: use Meta's MusicGen (smaller, more available)."""
    from transformers import AutoProcessor, MusicgenForConditionalGeneration
    import scipy.io.wavfile
    import numpy as np

    print("[compose] Loading MusicGen small...", file=sys.stderr)
    processor = AutoProcessor.from_pretrained("facebook/musicgen-small")
    model = MusicgenForConditionalGeneration.from_pretrained("facebook/musicgen-small")

    inputs = processor(text=[prompt], padding=True, return_tensors="pt")
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

        # Try ACE-Step first
        try:
            # ACE-Step API may vary — adapt based on actual package
            from ace_step import ACEStep
            model = ACEStep()
            model.generate(prompt=full_prompt, duration=args.duration, output_path=args.output)
            gen_info = {"generator": "ace-step"}
        except ImportError:
            # Fallback to MusicGen
            gen_info = generate_with_musicgen(full_prompt, args.duration, args.output)

        duration = time.time() - start
        file_size = os.path.getsize(args.output)

        result = {
            "status": "completed",
            "outputFile": args.output,
            "duration": round(duration, 2),
            "fileSize": file_size,
            "prompt": args.prompt[:200],
            **gen_info,
        }
        print(f"[compose] Done in {duration:.1f}s -> {args.output} ({file_size} bytes)", file=sys.stderr)

    except Exception as e:
        result["error"] = str(e)
        print(f"[compose] ERROR: {e}", file=sys.stderr)

    print(json.dumps(result))

if __name__ == "__main__":
    main()
