#!/usr/bin/env python3
"""
Audio transcription using Whisper (faster-whisper or whisper).
Called by the V2 WebSocket chat for audio uploads.

Install: pip install faster-whisper
Or:      pip install openai-whisper

Usage:
  python scripts/transcribe_audio.py --input /path/to/audio.wav --output /path/to/transcript.json
"""
import argparse
import json
import sys
import time
import os


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True)
    p.add_argument("--output", default=None)
    p.add_argument("--model", default="base")  # tiny, base, small, medium, large
    p.add_argument("--language", default="fr")
    return p.parse_args()


def main():
    args = parse_args()
    start = time.time()
    result = {"status": "failed", "transcript": "", "error": None}

    try:
        # Try faster-whisper first (much faster with CTranslate2)
        try:
            from faster_whisper import WhisperModel

            model = WhisperModel(args.model, device="cpu", compute_type="int8")
            segments, info = model.transcribe(args.input, language=args.language)
            transcript = " ".join(seg.text for seg in segments)
        except ImportError:
            # Fallback to openai-whisper
            try:
                import whisper

                model = whisper.load_model(args.model)
                r = model.transcribe(args.input, language=args.language)
                transcript = r["text"]
            except ImportError:
                raise RuntimeError(
                    "Neither faster-whisper nor whisper is installed. "
                    "Install with: pip install faster-whisper"
                )

        duration = time.time() - start
        result = {
            "status": "completed",
            "transcript": transcript.strip(),
            "language": args.language,
            "model": args.model,
            "duration": round(duration, 2),
        }

        if args.output:
            os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
            with open(args.output, "w") as f:
                json.dump(result, f, ensure_ascii=False, indent=2)

        print(f"[transcribe] Done in {duration:.1f}s", file=sys.stderr)

    except Exception as e:
        result["error"] = str(e)
        print(f"[transcribe] ERROR: {e}", file=sys.stderr)

    print(json.dumps(result))


if __name__ == "__main__":
    main()
