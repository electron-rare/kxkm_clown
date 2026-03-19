#!/usr/bin/env python3
"""
KXKM Qwen3-TTS HTTP Server — Custom voice + voice cloning.

Models:
  - CustomVoice (0.6B): preset speakers with style instructions (~2GB VRAM)
  - Base (0.6B): voice cloning from reference audio (~2GB VRAM, lazy-loaded)

Endpoints:
  GET  /health                → {"ok": true, "model": "qwen3-tts"}
  POST /synthesize            → audio/wav  (custom voice with instruct)
  POST /clone                 → audio/wav  (voice cloning from ref audio)

Usage:
  python3 scripts/qwen3-tts-server.py [--port 9300] [--size 0.6b|1.7b]
"""
import argparse
import base64
import io
import json
import os
import sys
import tempfile
import time
from http.server import HTTPServer, BaseHTTPRequestHandler

import torch
import soundfile as sf

# Lazy-loaded models (separate models for custom voice vs cloning)
_custom_model = None
_clone_model = None
_model_size = "0.6b"

CUSTOM_MODEL_MAP = {
    "0.6b": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
    "1.7b": "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
}
BASE_MODEL_MAP = {
    "0.6b": "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
    "1.7b": "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
}

# Available preset speakers in CustomVoice models
# Vivian, Serena, Uncle_Fu (Chinese), Dylan, Eric (dialects),
# Ryan, Aiden (English), Ono_Anna (Japanese), Sohee (Korean)
DEFAULT_SPEAKER = "Aiden"
DEFAULT_INSTRUCT = "Speak in French with a warm, theatrical tone"

# Persona → (speaker, instruct) mapping for KXKM clown personas
# Using available preset speakers + style instructions
PERSONA_MAP = {
    "pharmacius": ("Aiden", "Speak in French with a warm theatrical tone, slightly ironic and gravelly"),
    "schaeffer": ("Ryan", "Speak in French with a precise analytical tone, measured like a scientist"),
    "batty": ("Aiden", "Speak in English with intense emotion and urgency, dramatic pauses"),
    "radigue": ("Serena", "Speak in French softly and meditatively, slow with gentle resonance"),
    "moorcock": ("Ryan", "Speak in English with a rich storyteller quality, deep and resonant"),
    "merzbow": ("Ryan", "Speak aggressively and chaotically, fast-paced with harsh tone"),
    "default": ("Aiden", "Speak in French with a warm, theatrical tone"),
}


def _get_model_kwargs():
    kwargs = dict(device_map="cuda:0", dtype=torch.bfloat16)
    try:
        import flash_attn  # noqa: F401
        kwargs["attn_implementation"] = "flash_attention_2"
    except ImportError:
        pass
    return kwargs


def load_custom_model(size=None):
    global _custom_model
    if _custom_model is not None:
        return _custom_model

    from qwen_tts import Qwen3TTSModel
    size = size or _model_size
    model_id = CUSTOM_MODEL_MAP[size]
    print(f"[qwen3-tts] Loading CustomVoice: {model_id}...", file=sys.stderr)
    t0 = time.time()
    _custom_model = Qwen3TTSModel.from_pretrained(model_id, **_get_model_kwargs())
    dt = time.time() - t0
    _log_vram(f"CustomVoice loaded in {dt:.1f}s")
    return _custom_model


def load_clone_model(size=None):
    global _clone_model
    if _clone_model is not None:
        return _clone_model

    from qwen_tts import Qwen3TTSModel
    size = size or _model_size
    model_id = BASE_MODEL_MAP[size]
    print(f"[qwen3-tts] Loading Base (clone): {model_id}...", file=sys.stderr)
    t0 = time.time()
    _clone_model = Qwen3TTSModel.from_pretrained(model_id, **_get_model_kwargs())
    dt = time.time() - t0
    _log_vram(f"Base (clone) loaded in {dt:.1f}s")
    return _clone_model


def _log_vram(msg):
    try:
        allocated = torch.cuda.memory_allocated() / 1024**3
        reserved = torch.cuda.memory_reserved() / 1024**3
        print(f"[qwen3-tts] {msg} — VRAM: {allocated:.1f}GB alloc, {reserved:.1f}GB reserved",
              file=sys.stderr)
    except Exception:
        print(f"[qwen3-tts] {msg}", file=sys.stderr)


def synthesize_custom(text: str, speaker: str, instruct: str,
                      language: str = "French") -> bytes:
    """Generate speech using preset speaker + style instruction."""
    model = load_custom_model()
    t0 = time.time()
    wavs, sr = model.generate_custom_voice(
        text=text,
        language=language,
        speaker=speaker,
        instruct=instruct,
    )
    dt = time.time() - t0
    print(f"[qwen3-tts] custom_voice({speaker}): {len(text)} chars, {dt:.2f}s", file=sys.stderr)

    buf = io.BytesIO()
    sf.write(buf, wavs[0], sr, format="WAV")
    return buf.getvalue()


def synthesize_clone(text: str, ref_audio_bytes: bytes, ref_text: str = "",
                     language: str = "French") -> bytes:
    """Generate speech cloning a reference voice."""
    model = load_clone_model()

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(ref_audio_bytes)
        tmp_path = tmp.name

    try:
        t0 = time.time()
        wavs, sr = model.generate_voice_clone(
            text=text,
            language=language,
            ref_audio=tmp_path,
            ref_text=ref_text,
        )
        dt = time.time() - t0
        print(f"[qwen3-tts] voice_clone: {len(text)} chars, {dt:.2f}s", file=sys.stderr)

        buf = io.BytesIO()
        sf.write(buf, wavs[0], sr, format="WAV")
        return buf.getvalue()
    finally:
        os.unlink(tmp_path)


class Qwen3TTSHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            payload = {
                "ok": True,
                "model": "qwen3-tts",
                "size": _model_size,
                "custom_loaded": _custom_model is not None,
                "clone_loaded": _clone_model is not None,
            }
            self.wfile.write(json.dumps(payload).encode())
        else:
            self.send_error(404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}

        if self.path == "/synthesize":
            self._handle_synthesize(body)
        elif self.path == "/clone":
            self._handle_clone(body)
        else:
            self.send_error(404)

    def _handle_synthesize(self, body):
        text = body.get("text", "")
        persona = body.get("persona", "").lower()
        language = body.get("language", "French")

        # Explicit speaker/instruct override persona mapping
        speaker = body.get("speaker", "")
        instruct = body.get("voice_prompt", "") or body.get("instruct", "")

        if not text:
            self.send_error(400, "Missing 'text'")
            return

        # Resolve from persona if no explicit speaker/instruct
        if not speaker or not instruct:
            p_speaker, p_instruct = PERSONA_MAP.get(persona, PERSONA_MAP["default"])
            if not speaker:
                speaker = p_speaker
            if not instruct:
                instruct = p_instruct

        try:
            audio = synthesize_custom(text, speaker, instruct, language)
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(audio)))
            self.end_headers()
            self.wfile.write(audio)
        except Exception as e:
            self._send_error_json(500, str(e))

    def _handle_clone(self, body):
        text = body.get("text", "")
        ref_audio_b64 = body.get("reference_audio", "")
        ref_text = body.get("reference_text", "")
        language = body.get("language", "French")

        if not text:
            self.send_error(400, "Missing 'text'")
            return
        if not ref_audio_b64:
            self.send_error(400, "Missing 'reference_audio' (base64 WAV)")
            return

        try:
            ref_audio_bytes = base64.b64decode(ref_audio_b64)
            audio = synthesize_clone(text, ref_audio_bytes, ref_text, language)
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(audio)))
            self.end_headers()
            self.wfile.write(audio)
        except Exception as e:
            self._send_error_json(500, str(e))

    def _send_error_json(self, code, message):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"error": message}).encode())
        print(f"[qwen3-tts] ERROR: {message}", file=sys.stderr)

    def log_message(self, format, *args):
        pass  # Suppress default access logs


def main():
    global _model_size
    parser = argparse.ArgumentParser(description="KXKM Qwen3-TTS Server")
    parser.add_argument("--port", type=int, default=9300)
    parser.add_argument("--size", choices=["0.6b", "1.7b"], default="0.6b",
                        help="Model size (default: 0.6b for lower VRAM)")
    parser.add_argument("--lazy", action="store_true",
                        help="Lazy-load models on first request (default: preload custom)")
    args = parser.parse_args()

    _model_size = args.size

    if not args.lazy:
        load_custom_model(args.size)
        # Clone model is always lazy-loaded (saves VRAM until needed)

    server = HTTPServer(("127.0.0.1", args.port), Qwen3TTSHandler)
    print(f"[qwen3-tts] Listening on http://127.0.0.1:{args.port}", file=sys.stderr)
    server.serve_forever()


if __name__ == "__main__":
    main()
