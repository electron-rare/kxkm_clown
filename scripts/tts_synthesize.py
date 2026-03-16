#!/usr/bin/env python3
"""
KXKM_Clown — TTS Synthesis Script

Synthesizes speech from text using Piper TTS (local, fast, offline).
Each persona can have a distinct voice.

Usage:
  python scripts/tts_synthesize.py \
    --text "Bonjour, je suis Schaeffer" \
    --voice fr_FR-siwis-medium \
    --output /tmp/speech.wav

Install: pip install piper-tts
"""
import argparse
import json
import os
import sys
import time

# Available French voices for Piper (downloaded on first use)
VOICE_MAP = {
    "default": "fr_FR-siwis-medium",
    "schaeffer": "fr_FR-siwis-medium",
    "batty": "fr_FR-upmc-medium",
    "radigue": "fr_FR-siwis-low",
    "pharmacius": "fr_FR-gilles-low",
    "moorcock": "en_GB-alan-medium",
}


def parse_args():
    p = argparse.ArgumentParser(description="KXKM TTS Synthesis")
    p.add_argument("--text", required=True, help="Text to synthesize")
    p.add_argument("--voice", default="default", help="Voice name or persona nick")
    p.add_argument("--output", required=True, help="Output WAV file path")
    p.add_argument("--speed", type=float, default=1.0, help="Speech speed multiplier")
    return p.parse_args()


def main():
    args = parse_args()
    start = time.time()
    result = {"status": "failed", "error": None}

    try:
        import piper

        # Resolve voice from persona nick or direct voice name
        voice = VOICE_MAP.get(args.voice.lower(), args.voice)

        os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)

        # Synthesize
        voice_obj = piper.PiperVoice.load(voice)

        with open(args.output, "wb") as f:
            voice_obj.synthesize(args.text, f)

        duration = time.time() - start
        file_size = os.path.getsize(args.output)

        result = {
            "status": "completed",
            "voice": voice,
            "outputFile": args.output,
            "duration": round(duration, 2),
            "fileSize": file_size,
            "textLength": len(args.text),
        }
        print(
            f"[tts] Synthesized {len(args.text)} chars in {duration:.1f}s → {args.output}",
            file=sys.stderr,
        )

    except ImportError:
        result["error"] = (
            "piper-tts not installed. Install with: pip install piper-tts"
        )
        print(f"[tts] ERROR: {result['error']}", file=sys.stderr)
    except Exception as e:
        result["error"] = str(e)
        print(f"[tts] ERROR: {e}", file=sys.stderr)

    print(json.dumps(result))


if __name__ == "__main__":
    main()
