#!/usr/bin/env python3
"""
KXKM_Clown — Music Generation via ACE-Step 1.5
Uses ACE-Step Python API directly (not CLI) for proper duration control.
"""
import argparse, json, os, sys, time

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--prompt", required=True)
    p.add_argument("--duration", type=int, default=30)
    p.add_argument("--output", default="/tmp/kxkm-compose.wav")
    p.add_argument("--steps", type=int, default=100)
    p.add_argument("--seed", type=int, default=-1)
    return p.parse_args()

def generate_with_ace_step(prompt, duration, output, steps=100, seed=-1):
    ace_dir = os.environ.get("ACE_STEP_DIR", "/home/kxkm/ACE-Step-1.5")
    if not os.path.isdir(ace_dir):
        raise ImportError(f"ACE-Step not found at {ace_dir}")
    
    sys.path.insert(0, ace_dir)
    
    print(f"[compose] ACE-Step 1.5: {duration}s, {steps} steps...", file=sys.stderr)
    
    try:
        from acestep import ACEStepPipeline
        
        pipe = ACEStepPipeline()
        
        result = pipe.generate(
            prompt=prompt[:2000],
            duration=duration,
            num_inference_steps=steps,
            seed=seed if seed >= 0 else None,
        )
        
        # Save to WAV
        import scipy.io.wavfile as wavfile; import numpy as np
        sf.write(output, result["audio"], result.get("sample_rate", 32000))
        
        return {"seed": result.get("seed", 0), "duration": duration}
        
    except ImportError:
        # Fallback: use CLI with TOML config
        import tempfile, subprocess
        
        config = f"""[generation]
prompt = "{prompt[:500].replace('"', "'")}"
duration = {duration}
inference_steps = {steps}
"""
        if seed >= 0:
            config += f"seed = {seed}\n"
        
        config_path = tempfile.mktemp(suffix=".toml")
        with open(config_path, "w") as f:
            f.write(config)
        
        cmd = [sys.executable, os.path.join(ace_dir, "cli.py"), "-c", config_path]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600, cwd=ace_dir)
        os.unlink(config_path)
        
        if proc.returncode != 0:
            raise RuntimeError(f"ACE-Step CLI failed: {proc.stderr[:300]}")
        
        # Find the generated WAV in output dir
        out_dir = os.path.dirname(output) or "/tmp"
        wavs = sorted([f for f in os.listdir(out_dir) if f.endswith(".wav") and "acestep" in f.lower()], key=lambda f: os.path.getmtime(os.path.join(out_dir, f)), reverse=True)
        if wavs:
            import shutil
            shutil.move(os.path.join(out_dir, wavs[0]), output)
        
        return {"seed": 0, "duration": duration}

def generate_with_musicgen(prompt, duration, output):
    """Fallback: MusicGen (smaller, CPU-friendly)."""
    from transformers import AutoProcessor, MusicgenForConditionalGeneration
    import torch, scipy.io.wavfile, numpy as np
    
    print(f"[compose] MusicGen fallback: {duration}s...", file=sys.stderr)
    
    processor = AutoProcessor.from_pretrained("facebook/musicgen-small")
    model = MusicgenForConditionalGeneration.from_pretrained("facebook/musicgen-small").to("cuda")
    
    inputs = processor(text=[prompt], padding=True, return_tensors="pt").to("cuda")
    max_tokens = min(duration * 256, 1536)
    
    with torch.no_grad():
        audio_values = model.generate(**inputs, max_new_tokens=max_tokens)
    
    audio = audio_values[0, 0].cpu().numpy()
    # Normalize to int16
    audio = audio / max(abs(audio.max()), abs(audio.min()), 1e-8)
    audio_int16 = (audio * 32767).astype(np.int16)
    
    scipy.io.wavfile.write(output, model.config.audio_encoder.sampling_rate, audio_int16)
    return {"duration": duration}


def main():
    args = parse_args()
    t0 = time.time()
    
    try:
        gen_info = generate_with_ace_step(args.prompt, args.duration, args.output, args.steps, args.seed)
    except Exception as e:
        print(f"[compose] ACE-Step failed: {e}, trying MusicGen...", file=sys.stderr)
        try:
            gen_info = generate_with_musicgen(args.prompt, args.duration, args.output)
        except Exception as e2:
            print(json.dumps({"status": "failed", "error": str(e2)[:200]}))
            sys.exit(1)
    
    elapsed = round(time.time() - t0, 2)
    
    if os.path.exists(args.output):
        # Verify actual duration
        try:
            import wave
            with wave.open(args.output) as w:
                actual_dur = w.getnframes() / w.getframerate()
            gen_info["actual_duration"] = round(actual_dur, 1)
        except:
            pass
        
        print(json.dumps({
            "status": "completed",
            "seed": gen_info.get("seed", 0),
            "duration": elapsed,
            "requested_duration": args.duration,
            "actual_duration": gen_info.get("actual_duration", args.duration),
        }))
    else:
        print(json.dumps({"status": "failed", "error": "No output file generated"}))
        sys.exit(1)

if __name__ == "__main__":
    main()
