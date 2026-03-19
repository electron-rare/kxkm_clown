#!/usr/bin/env python3
"""
Voice cloning TTS via Coqui XTTS-v2.
Clones a voice from a reference audio sample and synthesizes speech.

Usage:
    python tts_clone_voice.py --text "Bonjour" --reference data/voice-samples/schaeffer.wav --output /tmp/out.wav
    python tts_clone_voice.py --text "Hello" --reference data/voice-samples/batty.wav --output /tmp/out.wav --language en

Requires: coqui-tts[codec] (pip install coqui-tts[codec])
Falls back to piper-tts if XTTS fails or no reference sample.
"""
import argparse
import json
import os
import sys
import time


def main():
    parser = argparse.ArgumentParser(description="XTTS-v2 voice cloning TTS")
    parser.add_argument("--text", required=True, help="Text to synthesize")
    parser.add_argument("--reference", required=True, help="Path to reference voice WAV (6-30s)")
    parser.add_argument("--output", required=True, help="Output WAV path")
    parser.add_argument("--language", default="fr", help="Language code (default: fr)")
    parser.add_argument("--model", default="tts_models/multilingual/multi-dataset/xtts_v2",
                        help="XTTS model name")
    args = parser.parse_args()

    start = time.time()
    result = {"status": "failed", "error": None, "duration": 0}

    # Validate reference file
    if not os.path.isfile(args.reference):
        result["error"] = f"Reference file not found: {args.reference}"
        print(json.dumps(result))
        sys.exit(0)

    # Truncate text
    text = args.text[:1000]
    if len(text) < 2:
        result["error"] = "Text too short"
        print(json.dumps(result))
        sys.exit(0)

    if os.environ.get("COQUI_TOS_AGREED") != "1":
        result["error"] = (
            "XTTS requires COQUI_TOS_AGREED=1 after reviewing the CPML terms"
        )
        print(json.dumps(result))
        sys.exit(0)

    try:
        from TTS.api import TTS

        # Load XTTS-v2 model (cached after first load)
        tts = TTS(model_name=args.model)

        # Move to GPU if available
        import torch
        if torch.cuda.is_available():
            tts = tts.to("cuda")

        # Synthesize with voice cloning
        tts.tts_to_file(
            text=text,
            speaker_wav=args.reference,
            language=args.language,
            file_path=args.output,
        )

        duration = round(time.time() - start, 2)
        result = {
            "status": "completed",
            "output": args.output,
            "duration": duration,
            "model": "xtts_v2",
            "language": args.language,
        }
    except ImportError as exc:
        result["error"] = f"XTTS import failed: {exc}"
    except Exception as e:
        result["error"] = str(e)[:500]

    print(json.dumps(result))


if __name__ == "__main__":
    main()
