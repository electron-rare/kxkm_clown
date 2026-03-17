#!/usr/bin/env python3
"""
KXKM_Clown — Voice Cloning via Coqui XTTS-v2

Clones a voice from a 6-second WAV sample and synthesizes speech.

Usage:
  python scripts/xtts_clone.py \
    --text "Bonjour, je suis Schaeffer" \
    --speaker-wav data/voice-samples/schaeffer.wav \
    --output /tmp/cloned-speech.wav \
    [--language fr]
"""
import argparse, json, os, sys, time

def parse_args():
    p = argparse.ArgumentParser(description="KXKM XTTS Voice Cloning")
    p.add_argument("--text", required=True)
    p.add_argument("--speaker-wav", required=True, help="6s reference WAV")
    p.add_argument("--output", required=True)
    p.add_argument("--language", default="fr")
    return p.parse_args()

def main():
    args = parse_args()
    start = time.time()
    result = {"status": "failed", "error": None}

    try:
        from TTS.api import TTS

        print(f"[xtts] Loading XTTS-v2...", file=sys.stderr)
        tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2", gpu=True)

        print(f"[xtts] Cloning voice from {args.speaker_wav}", file=sys.stderr)
        os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)

        tts.tts_to_file(
            text=args.text[:1000],
            speaker_wav=args.speaker_wav,
            language=args.language,
            file_path=args.output,
        )

        duration = time.time() - start
        result = {
            "status": "completed",
            "outputFile": args.output,
            "duration": round(duration, 2),
            "textLength": len(args.text),
        }
        print(f"[xtts] Done in {duration:.1f}s -> {args.output}", file=sys.stderr)

    except ImportError:
        result["error"] = "coqui-tts not installed. pip install coqui-tts"
        print(f"[xtts] ERROR: {result['error']}", file=sys.stderr)
    except Exception as e:
        result["error"] = str(e)
        print(f"[xtts] ERROR: {e}", file=sys.stderr)

    print(json.dumps(result))

if __name__ == "__main__":
    main()
