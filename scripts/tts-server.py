#!/usr/bin/env python3
"""
KXKM TTS HTTP Server — Sidecar for Docker container.
Runs on host, provides HTTP API for text-to-speech synthesis.

Usage:
  python3 scripts/tts-server.py [--port 9100]

Endpoints:
  POST /synthesize  { text, voice, persona }  → audio/wav
  GET  /health      → { ok: true }
"""
import argparse
import io
import json
import os
import sys
import wave
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

# Lazy-load piper to fail fast on import errors
PiperVoice = None

VOICE_DIR = Path(os.environ.get("PIPER_VOICE_DIR", "data/piper-voices"))
SAMPLES_DIR = Path(os.environ.get("KXKM_VOICE_SAMPLES_DIR", "data/voice-samples"))

VOICE_MAP = {
    "default": "fr_FR-siwis-medium",
    "schaeffer": "fr_FR-siwis-medium",
    "batty": "fr_FR-upmc-medium",
    "radigue": "fr_FR-siwis-low",
    "pharmacius": "fr_FR-gilles-low",
    "moorcock": "en_GB-alan-medium",
}


def load_piper():
    global PiperVoice
    if PiperVoice is None:
        from piper import PiperVoice as PV
        PiperVoice = PV
    return PiperVoice


def resolve_voice(persona: str) -> str:
    return VOICE_MAP.get(persona.lower(), VOICE_MAP["default"])


def synthesize(text: str, voice_name: str) -> bytes:
    PV = load_piper()
    from piper.download_voices import download_voice

    VOICE_DIR.mkdir(parents=True, exist_ok=True)
    model_path = VOICE_DIR / f"{voice_name}.onnx"
    config_path = VOICE_DIR / f"{voice_name}.onnx.json"

    if not model_path.exists() or not config_path.exists():
        download_voice(voice_name, VOICE_DIR)

    voice = PV.load(model_path, config_path=config_path, download_dir=VOICE_DIR)
    chunks = list(voice.synthesize(text))
    if not chunks:
        raise RuntimeError("No audio output")

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setframerate(chunks[0].sample_rate)
        wf.setsampwidth(chunks[0].sample_width)
        wf.setnchannels(chunks[0].sample_channels)
        for chunk in chunks:
            wf.writeframes(chunk.audio_int16_bytes)
    return buf.getvalue()


class TTSHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True}).encode())
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path != "/synthesize":
            self.send_error(404)
            return

        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}

        text = body.get("text", "")
        persona = body.get("persona", "default")
        voice_name = body.get("voice") or resolve_voice(persona)

        if not text:
            self.send_error(400, "Missing text")
            return

        try:
            audio = synthesize(text, voice_name)
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(audio)))
            self.end_headers()
            self.wfile.write(audio)
            print(f"[tts] {persona}/{voice_name}: {len(text)} chars → {len(audio)} bytes", file=sys.stderr)
        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())
            print(f"[tts] ERROR: {e}", file=sys.stderr)

    def log_message(self, format, *args):
        pass  # Suppress default access logs


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=9100)
    args = parser.parse_args()

    # Pre-load piper
    try:
        load_piper()
        print(f"[tts-server] Piper loaded, voices: {VOICE_DIR}", file=sys.stderr)
    except Exception as e:
        print(f"[tts-server] WARNING: Piper not available: {e}", file=sys.stderr)

    server = HTTPServer(("127.0.0.1", args.port), TTSHandler)
    print(f"[tts-server] Listening on http://127.0.0.1:{args.port}", file=sys.stderr)
    server.serve_forever()


if __name__ == "__main__":
    main()
